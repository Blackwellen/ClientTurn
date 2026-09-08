import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import {
  isTwilioConfigured,
  twilioConfigProblems,
  twilioCredentials,
} from "@/lib/messaging/twilio";
import { loadBusinessContext, queueNotification } from "./shared";
import { parsePayload } from "./parse";
import { integrationHealthPayload } from "./payloads";

type Probe = {
  status: "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED";
  errorCode: string | null;
  errorMessage: string | null;
  /**
   * Did we actually reach the provider, or only look at what we hold?
   *
   * Only Twilio has a real probe. For every other connection "HEALTHY" means a
   * token row exists and has not expired -- which is worth knowing and is not
   * the same claim, and the difference used to be erased on write: any HEALTHY
   * result stamped `last_success_at`, and the connection card renders that as
   * **"Last sync"**. So the product told a customer their CRM had synced two
   * minutes ago when it had read a row out of its own database.
   *
   * `lead_source.poll` sets the same column after a genuine poll, so the field
   * does carry a true meaning elsewhere. That is exactly why it must not be
   * written by a check that synced nothing.
   */
  verified: boolean;
};

/** The provider answered. */
const VERIFIED_OK: Probe = {
  status: "HEALTHY",
  errorCode: null,
  errorMessage: null,
  verified: true,
};

/** We hold a usable credential. Nothing was asked of the provider. */
const CREDENTIAL_OK: Probe = {
  status: "HEALTHY",
  errorCode: null,
  errorMessage: null,
  verified: false,
};

function actionRequired(code: string, message: string): Probe {
  return {
    status: "ACTION_REQUIRED",
    errorCode: code,
    errorMessage: message,
    // A refusal is itself evidence the provider was reached, but nothing
    // succeeded, so there is no success to stamp either way.
    verified: false,
  };
}

async function probeTwilio(): Promise<Probe> {
  if (!isTwilioConfigured()) {
    return actionRequired(
      "provider_not_configured",
      `Twilio credentials are missing: ${twilioConfigProblems().join(", ")}.`,
    );
  }

  // Resolved through `twilioCredentials`, not read raw from the environment.
  //
  // Twilio's two SIDs go in two different places: the `AC…` account SID is the
  // path segment, and an `SK…` API key is what authenticates. Reading one value
  // and using it for both produces `20404 not found` when an API key is
  // configured — which this probe would then report as DEGRADED, blaming the
  // provider for a configuration mistake.
  const credentials = twilioCredentials();
  if (!credentials) {
    return actionRequired(
      "provider_not_configured",
      `Twilio credentials are missing: ${twilioConfigProblems().join(", ")}.`,
    );
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${credentials.authSid}:${credentials.authToken}`,
          ).toString("base64")}`,
        },
      },
    );
    if (response.ok) return VERIFIED_OK;
    if (response.status === 401 || response.status === 403) {
      return actionRequired(
        String(response.status),
        "Twilio rejected the stored credentials.",
      );
    }
    if (response.status === 404) {
      // Twilio returns 404, not 401, when the path names something the
      // credentials cannot see — most often an API key SID used as the account
      // SID. Saying so beats reporting a bare "404 from Twilio".
      return actionRequired(
        "account_not_found",
        "Twilio could not find that account. Check TWILIO_ACCOUNT_SID is the AC… account SID rather than an SK… API key.",
      );
    }
    return {
      status: "DEGRADED",
      errorCode: String(response.status),
      errorMessage: `Twilio responded with ${response.status}.`,
      verified: false,
    };
  } catch (error) {
    return {
      status: "DEGRADED",
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : String(error),
      verified: false,
    };
  }
}

async function probeToken(integrationId: string): Promise<Probe> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_secrets")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!data?.access_token) {
    return actionRequired(
      "missing_token",
      "This connection has no stored access token. Reconnect it.",
    );
  }

  if (
    data.token_expires_at &&
    new Date(data.token_expires_at).getTime() < Date.now() &&
    !data.refresh_token
  ) {
    return actionRequired(
      "token_expired",
      "The stored access token has expired. Reconnect it.",
    );
  }

  // The credential is present and in date. Whether the provider would still
  // accept it is a question this check does not ask -- there is no adapter
  // method for a cheap authenticated call, and inventing an endpoint per
  // provider would mark a working integration broken the moment one of the
  // guesses was wrong.
  return CREDENTIAL_OK;
}

function probeEmail(): Probe {
  // An environment variable, not a provider. Reading it proves the deployment
  // is configured, and nothing about whether the key still works.
  return serverEnv.resend.apiKey
    ? CREDENTIAL_OK
    : actionRequired("missing_api_key", "No email provider key is configured.");
}

async function probe(providerType: string, integrationId: string): Promise<Probe> {
  if (providerType === "twilio_sms" || providerType === "twilio_whatsapp") {
    return probeTwilio();
  }
  if (providerType === "email") return probeEmail();
  return probeToken(integrationId);
}

export type HealthCheckOutcome = {
  integrationId: string;
  providerType: string;
  status: "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED";
  errorMessage: string | null;
};

/**
 * Probes every live connection for one workspace (or a single connection) and
 * writes the result back. Shared by the queued health job and by the Refresh
 * control on Settings → Connections, so both can never drift apart.
 */
export async function runIntegrationHealthChecks(params: {
  businessId: string;
  integrationId?: string | null;
  /** Notifications belong to the background job, not to a user pressing Refresh. */
  notify?: boolean;
}): Promise<HealthCheckOutcome[]> {
  const admin = createAdminClient();
  const business = await loadBusinessContext(params.businessId);
  if (!business) {
    throw new PermanentJobError(`Business ${params.businessId} is gone.`);
  }

  let query = admin
    .from("integrations")
    .select("id, provider_type, status")
    .eq("business_id", params.businessId)
    .neq("status", "DISCONNECTED");

  if (params.integrationId) query = query.eq("id", params.integrationId);

  const { data: integrations } = await query;
  const outcomes: HealthCheckOutcome[] = [];

  for (const integration of integrations ?? []) {
    const result = await probe(integration.provider_type, integration.id);
    const now = new Date().toISOString();

    await admin
      .from("integrations")
      .update({
        status: result.status,
        // Only a probe that actually reached the provider may claim a success.
        // The connection card renders this as "Last sync"; a token-presence
        // check has synced nothing and must not write it.
        last_success_at: result.status === "HEALTHY" && result.verified ? now : undefined,
        last_error_at: result.errorCode ? now : null,
        last_error_code: result.errorCode,
        last_error_message: result.errorMessage,
      })
      .eq("id", integration.id);

    outcomes.push({
      integrationId: integration.id,
      providerType: integration.provider_type,
      status: result.status,
      errorMessage: result.errorMessage,
    });

    const becameBroken =
      result.status === "ACTION_REQUIRED" &&
      integration.status !== "ACTION_REQUIRED";

    if (params.notify && becameBroken && business.notify.integrationFailure) {
      await queueNotification({
        businessId: params.businessId,
        type: "integration_failure",
        severity: "error",
        title: `${integration.provider_type.replace(/_/g, " ")} needs attention`,
        body: result.errorMessage ?? undefined,
        entityType: "integration",
        entityId: integration.id,
        linkUrl: "/app/settings?section=connections",
        dedupeKey: `integration_failure:${integration.id}:${result.errorCode}`,
      });
    }
  }

  return outcomes;
}

export async function handleIntegrationHealthCheck(job: ClaimedJob) {
  const payload = parsePayload(integrationHealthPayload, job.payload);
  await runIntegrationHealthChecks({
    businessId: payload.businessId,
    integrationId: payload.integrationId,
    notify: true,
  });
}
