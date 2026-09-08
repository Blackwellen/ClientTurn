import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { assertSafeUrl } from "@/lib/security/safe-fetch";
import { generateSigningSecret, secretHint } from "./signature";
import {
  ENDPOINT_FAILURE_LIMIT,
  isWebhookEventType,
  type WebhookEventType,
} from "./events";

/**
 * Managing the endpoints a workspace has told us to send events to.
 *
 * The two things this module has to get right:
 *
 *   1. **The URL is never taken on trust.** A webhook target is a
 *      customer-supplied address that our servers will connect to, which is a
 *      request-forgery primitive unless every one is checked — including its
 *      DNS resolution, because `webhooks.example.com` resolving to `10.0.0.5`
 *      is the interesting case, not `http://10.0.0.5` typed literally. Checked
 *      here at save time and again at delivery time, because DNS changes.
 *   2. **The signing secret is sealed, not hashed.** We have to sign with it,
 *      so both ends hold the same value. AES-256-GCM at rest means the database
 *      row alone is not enough to forge a signature, and the secret is decrypted
 *      only inside the delivery job.
 */

export type EndpointUrlProblem =
  | "INVALID_URL"
  | "BLOCKED_SCHEME"
  | "BLOCKED_HOST"
  | "BLOCKED_PORT"
  | "DNS_FAILED"
  | "INSECURE";

/**
 * Validates a target address.
 *
 * `https` is required, with no exception for development. Plain `http` would
 * send a customer's own lead data across the internet in the clear, and the
 * signature proves who sent a request — not that nobody read it. A developer
 * testing locally uses a tunnel, which is what they would need for any other
 * webhook provider too.
 */
export async function checkEndpointUrl(
  raw: string,
): Promise<{ ok: true; url: string } | { ok: false; problem: EndpointUrlProblem }> {
  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, problem: "INVALID_URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, problem: "INSECURE" };
  }

  const check = await assertSafeUrl(trimmed);
  if (!check.ok) {
    return {
      ok: false,
      problem:
        check.code === "TIMEOUT" || check.code === "FETCH_FAILED"
          ? "DNS_FAILED"
          : (check.code as EndpointUrlProblem),
    };
  }

  return { ok: true, url: check.url.toString() };
}

export const ENDPOINT_URL_MESSAGES: Record<EndpointUrlProblem, string> = {
  INVALID_URL: "That is not a valid web address.",
  INSECURE: "The address must start with https:// — events carry lead data.",
  BLOCKED_SCHEME: "The address must start with https://.",
  BLOCKED_HOST:
    "That address is on a private network, so our servers cannot reach it.",
  BLOCKED_PORT: "Use the standard https port.",
  DNS_FAILED: "We could not look that address up. Check the domain name.",
};

/* ------------------------------------------------------------------ create */

export type CreatedEndpoint = {
  id: string;
  /** Shown once, then only its last six characters. */
  secret: string;
  url: string;
};

export async function createEndpoint(input: {
  businessId: string;
  userId: string;
  url: string;
  description?: string | null;
  events: string[];
}): Promise<
  | { ok: true; endpoint: CreatedEndpoint }
  | { ok: false; error: string }
> {
  const events = input.events.filter(isWebhookEventType);
  if (events.length === 0) {
    return { ok: false, error: "Choose at least one event to send." };
  }

  const check = await checkEndpointUrl(input.url);
  if (!check.ok) return { ok: false, error: ENDPOINT_URL_MESSAGES[check.problem] };

  const secret = generateSigningSecret();

  let sealed: string;
  try {
    sealed = sealSecret(secret);
  } catch {
    // Without an encryption key we would have to store the secret in clear.
    // Refusing is the only honest option; a webhook nobody can verify is worse
    // than no webhook.
    return {
      ok: false,
      error:
        "This deployment cannot store signing secrets yet. Ask your administrator to configure credential encryption.",
    };
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("webhook_endpoints")
    .insert({
      business_id: input.businessId,
      url: check.url,
      description: input.description ?? null,
      secret_sealed: sealed,
      secret_hint: secretHint(secret),
      events,
      created_by: input.userId,
      status: "ACTIVE",
    })
    .select("id, url")
    .single();

  if (error) {
    // The unique constraint is on (business_id, url). Saying so is more useful
    // than "could not save", and reveals nothing.
    if (error.code === "23505") {
      return { ok: false, error: "That address already has an endpoint." };
    }
    return { ok: false, error: "That endpoint could not be created." };
  }

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "webhook_endpoint.created",
    entityType: "webhook_endpoint",
    entityId: data.id,
    metadata: { url: data.url, events },
  });

  return { ok: true, endpoint: { id: data.id, secret, url: data.url } };
}

/* ------------------------------------------------------------------ update */

export async function updateEndpoint(input: {
  businessId: string;
  endpointId: string;
  userId: string;
  description?: string | null;
  events?: string[];
  status?: "ACTIVE" | "PAUSED";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Typed against the table rather than `Record<string, unknown>`, so a column
  // renamed in a migration fails here at compile time instead of becoming an
  // update that silently changes nothing.
  const patch: {
    description?: string | null;
    events?: string[];
    status?: "ACTIVE" | "PAUSED";
    consecutive_failures?: number;
    disabled_reason?: string | null;
  } = {};

  if (input.description !== undefined) patch.description = input.description;

  if (input.events) {
    const events = input.events.filter(isWebhookEventType);
    if (events.length === 0) {
      return { ok: false, error: "Choose at least one event to send." };
    }
    patch.events = events;
  }

  if (input.status) {
    patch.status = input.status;
    // Re-enabling clears both the counter and the reason. Leaving the reason
    // behind would show a customer a stale explanation for a healthy endpoint.
    if (input.status === "ACTIVE") {
      patch.consecutive_failures = 0;
      patch.disabled_reason = null;
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const db = createAdminClient();
  const { data } = await db
    .from("webhook_endpoints")
    .update(patch)
    .eq("id", input.endpointId)
    .eq("business_id", input.businessId)
    .select("id, url")
    .maybeSingle();

  if (!data) return { ok: false, error: "That endpoint could not be found." };

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "webhook_endpoint.updated",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    metadata: { url: data.url, ...patch },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ rotate */

/**
 * Issues a new signing secret.
 *
 * There is no overlap window, and that is a deliberate trade rather than an
 * omission: supporting two live secrets means an endpoint whose old secret was
 * leaked keeps accepting it for the length of the window. Rotation is instead
 * an explicit act with an explicit consequence, stated in the dialog — the
 * customer updates their end, and events signed with the old secret stop
 * verifying immediately.
 */
export async function rotateEndpointSecret(input: {
  businessId: string;
  endpointId: string;
  userId: string;
}): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const secret = generateSigningSecret();

  let sealed: string;
  try {
    sealed = sealSecret(secret);
  } catch {
    return { ok: false, error: "This deployment cannot store signing secrets." };
  }

  const db = createAdminClient();
  const { data } = await db
    .from("webhook_endpoints")
    .update({ secret_sealed: sealed, secret_hint: secretHint(secret) })
    .eq("id", input.endpointId)
    .eq("business_id", input.businessId)
    .select("id, url")
    .maybeSingle();

  if (!data) return { ok: false, error: "That endpoint could not be found." };

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "webhook_endpoint.secret_rotated",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    metadata: { url: data.url },
  });

  return { ok: true, secret };
}

/* ------------------------------------------------------------------ delete */

export async function deleteEndpoint(input: {
  businessId: string;
  endpointId: string;
  userId: string;
}): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("webhook_endpoints")
    .delete()
    .eq("id", input.endpointId)
    .eq("business_id", input.businessId)
    .select("id, url")
    .maybeSingle();

  if (!data) return false;

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "webhook_endpoint.deleted",
    entityType: "webhook_endpoint",
    entityId: input.endpointId,
    metadata: { url: data.url },
  });

  return true;
}

/* ----------------------------------------------------------------- reading */

/** Server-only: returns the decrypted secret. Never call this from a query
 *  that feeds a component. */
export async function endpointSigningSecret(
  endpointId: string,
): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("webhook_endpoints")
    .select("secret_sealed")
    .eq("id", endpointId)
    .maybeSingle();

  return data ? openSecret(data.secret_sealed) : null;
}

/** The live endpoints subscribed to one event type. */
export async function endpointsForEvent(
  businessId: string,
  eventType: WebhookEventType | string,
): Promise<{ id: string; url: string }[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("webhook_endpoints")
    .select("id, url")
    .eq("business_id", businessId)
    .eq("status", "ACTIVE")
    .contains("events", [eventType]);

  return data ?? [];
}

/* -------------------------------------------------------------- health */

/** Records a successful delivery, clearing the failure streak. */
export async function markEndpointHealthy(endpointId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("webhook_endpoints")
    .update({
      consecutive_failures: 0,
      last_success_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", endpointId);
}

/**
 * Records a failed delivery, and disables the endpoint once it has failed
 * `ENDPOINT_FAILURE_LIMIT` times in a row.
 *
 * The increment is read-modify-write, which can undercount when two deliveries
 * fail at the same instant. That is acceptable here in a way it would not be
 * for billing: the consequence of undercounting is that we try a little longer
 * before giving up, which errs towards delivering the customer's events.
 */
export async function markEndpointFailure(
  endpointId: string,
  error: string,
): Promise<void> {
  const db = createAdminClient();

  const { data: current } = await db
    .from("webhook_endpoints")
    .select("consecutive_failures")
    .eq("id", endpointId)
    .maybeSingle();

  const failures = (current?.consecutive_failures ?? 0) + 1;
  const exhausted = failures >= ENDPOINT_FAILURE_LIMIT;

  await db
    .from("webhook_endpoints")
    .update({
      consecutive_failures: failures,
      last_failure_at: new Date().toISOString(),
      last_error: error.slice(0, 300),
      ...(exhausted
        ? {
            status: "DISABLED",
            disabled_reason: `Turned off automatically after ${ENDPOINT_FAILURE_LIMIT} failed deliveries in a row. Fix the endpoint and switch it back on.`,
          }
        : {}),
    })
    .eq("id", endpointId);
}
