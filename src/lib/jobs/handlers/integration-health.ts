import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { isTwilioConfigured, twilioConfigProblems } from "@/lib/messaging/twilio";
import { loadBusinessContext, queueNotification } from "./shared";
import { parsePayload } from "./parse";
import { integrationHealthPayload } from "./payloads";

type Probe = {
  status: "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED";
  errorCode: string | null;
  errorMessage: string | null;
};

const OK: Probe = { status: "HEALTHY", errorCode: null, errorMessage: null };

function actionRequired(code: string, message: string): Probe {
  return { status: "ACTION_REQUIRED", errorCode: code, errorMessage: message };
}

async function probeTwilio(): Promise<Probe> {
  if (!isTwilioConfigured()) {
    return actionRequired(
      "provider_not_configured",
      `Twilio credentials are missing: ${twilioConfigProblems().join(", ")}.`,
    );
  }

  const { accountSid, authToken } = serverEnv.twilio;
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
      },
    );
    if (response.ok) return OK;
    if (response.status === 401 || response.status === 403) {
      return actionRequired(
        String(response.status),
        "Twilio rejected the stored credentials.",
      );
    }
    return {
      status: "DEGRADED",
      errorCode: String(response.status),
      errorMessage: `Twilio responded with ${response.status}.`,
    };
  } catch (error) {
    return {
      status: "DEGRADED",
      errorCode: "network_error",
      errorMessage: error instanceof Error ? error.message : String(error),
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

  return OK;
}

function probeEmail(): Probe {
  return serverEnv.resend.apiKey
    ? OK
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
        last_success_at: result.status === "HEALTHY" ? now : undefined,
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
