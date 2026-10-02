import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearReconnectFlag, getLiveAccessToken } from "@/lib/integrations/oauth";
import { refreshConfigFor } from "@/lib/integrations/refresh-config";
import { runMetaTokenCheck } from "@/lib/integrations/meta-token";
import { META_TOKEN_PROVIDERS, metaCheckDue } from "@/lib/integrations/meta-token-core";
import { metaTokenRenewal } from "@/lib/integrations/catalog";
import {
  PROACTIVE_REFRESH_PROVIDERS,
  PROACTIVE_REFRESH_WINDOW_MS,
  dueForProactiveRefresh,
  dueForRecovery,
  isRecoverySweep,
  refreshPolicy,
  type RefreshCandidate,
} from "@/lib/integrations/token-refresh-core";
import { loadBusinessContext, queueNotification } from "./shared";

/**
 * `integration.token_refresh`, queued every ten minutes by the worker tick.
 *
 * 1. Renews every refreshable connection (PROACTIVE_REFRESH_PROVIDERS:
 *    Calendly, Google Calendar, Google Ads, Salesforce, Zoho, Slack, LinkedIn
 *    Ads) whose access token expires within the next 30 minutes (owner,
 *    2026-09-30: "Calendly login must stay constant"; 2026-10-02: "check that
 *    the other integrations refresh"). Each renewal goes through
 *    `getLiveAccessToken` (compare-and-swap on the refresh token, rotation
 *    stored); a refused grant marks that one connection "Reconnect", a
 *    network blip is left for the next sweep.
 * 2. Every six hours, retries the connections flagged "Reconnect" by a
 *    refusal. A dead grant fails again quietly; a false flag is cleared.
 * 3. Once a day per Meta / WhatsApp Cloud connection (no refresh grant), asks
 *    Meta about the token, extends it where Meta allows, and warns the owner
 *    from ten days before an expiry it could not extend.
 *
 * One failure never stops the others.
 */
export async function handleIntegrationTokenRefresh(_job: ClaimedJob): Promise<void> {
  const admin = createAdminClient();
  const now = Date.now();
  const horizon = new Date(now + PROACTIVE_REFRESH_WINDOW_MS).toISOString();
  const select = "integration_id, refresh_token, token_expires_at, extra, integrations!inner(provider_type, status, last_error_code)";
  const { data, error } = await admin
    .from("integration_secrets")
    .select(select)
    .in("integrations.provider_type", [...PROACTIVE_REFRESH_PROVIDERS])
    .not("refresh_token", "is", null)
    .or(`token_expires_at.lt.${horizon},token_expires_at.is.null`)
    .order("token_expires_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) throw new Error(`token refresh sweep read failed: ${error.message}`);

  const candidates = toCandidates(data);
  const byId = new Map(candidates.map((c) => [c.integrationId, c]));

  for (const id of dueForProactiveRefresh(candidates, now)) {
    const c = byId.get(id)!;
    const config = refreshConfigFor(c.providerType, c.extra);
    if (!config) continue;
    try {
      await getLiveAccessToken(id, config, { ...refreshPolicy(c.providerType), windowMs: PROACTIVE_REFRESH_WINDOW_MS });
    } catch (e) {
      console.warn("[integration.token_refresh] could not renew", { integrationId: id, provider: c.providerType, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (isRecoverySweep(now)) {
    const { data: flagged } = await admin
      .from("integration_secrets")
      .select(select)
      .in("integrations.provider_type", [...PROACTIVE_REFRESH_PROVIDERS])
      .eq("integrations.status", "ACTION_REQUIRED")
      .not("refresh_token", "is", null)
      .limit(200);
    const rows = toCandidates(flagged);
    const flaggedById = new Map(rows.map((c) => [c.integrationId, c]));
    for (const id of dueForRecovery(rows)) {
      await recoverFlagged(id, flaggedById.get(id)!);
    }
  }

  await checkMetaTokens(now);
}

type SweepCandidate = RefreshCandidate & { errorCode: string | null; extra: unknown };

function toCandidates(data: unknown): SweepCandidate[] {
  type Integration = { provider_type: string; status: string; last_error_code: string | null };
  type Row = { integration_id: string; refresh_token: string | null; token_expires_at: string | null; extra: unknown; integrations: Integration | Integration[] };
  return ((data ?? []) as Row[]).map((r) => {
    const i = Array.isArray(r.integrations) ? r.integrations[0] : r.integrations;
    return {
      integrationId: r.integration_id,
      providerType: i?.provider_type ?? "",
      status: i?.status ?? "",
      errorCode: i?.last_error_code ?? null,
      refreshToken: r.refresh_token,
      tokenExpiresAt: r.token_expires_at,
      extra: r.extra,
    };
  });
}

/** One refresh for a connection flagged "Reconnect"; clears the flag if the provider accepts it. */
export async function recoverFlagged(id: string, c: { providerType: string; extra: unknown }): Promise<"recovered" | "still_refused" | "skipped"> {
  const config = refreshConfigFor(c.providerType, c.extra);
  if (!config) return "skipped";
  const admin = createAdminClient();
  const { data: secret } = await admin.from("integration_secrets").select("access_token").eq("integration_id", id).maybeSingle();
  if (!secret?.access_token) return "skipped";
  try {
    const token = await getLiveAccessToken(id, config, { ...refreshPolicy(c.providerType), rejectedAccessToken: secret.access_token });
    if (token === secret.access_token) return "skipped";
    await clearReconnectFlag(id);
    return "recovered";
  } catch {
    return "still_refused";
  }
}

async function checkMetaTokens(now: number): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_secrets")
    .select("integration_id, extra, integrations!inner(business_id, provider_type, status)")
    .in("integrations.provider_type", [...META_TOKEN_PROVIDERS])
    .not("access_token", "is", null)
    .limit(500);
  if (error) {
    console.warn("[integration.token_refresh] meta read failed", { message: error.message });
    return;
  }
  type Integration = { business_id: string; provider_type: string; status: string };
  type Row = { integration_id: string; extra: unknown; integrations: Integration | Integration[] };
  for (const row of (data ?? []) as Row[]) {
    const i = Array.isArray(row.integrations) ? row.integrations[0] : row.integrations;
    if (!i || i.status === "DISCONNECTED" || i.status === "ACTION_REQUIRED") continue;
    const extra = (row.extra ?? {}) as Record<string, unknown>;
    if (!metaCheckDue(typeof extra.meta_token_checked_at === "string" ? extra.meta_token_checked_at : null, now)) continue;
    try {
      const result = await runMetaTokenCheck(row.integration_id);
      if (!result) return; // Meta not configured on this platform.
      if (result.outcome === "ok" || result.outcome === "not_extended" || result.outcome === "extended" || result.outcome === "never_expires") {
        await warnIfExpiring(row.integration_id, i, result.expiresAt);
      }
    } catch (e) {
      console.warn("[integration.token_refresh] meta check failed", { integrationId: row.integration_id, message: e instanceof Error ? e.message : String(e) });
    }
  }
}

/**
 * From ten days out (META_TOKEN_WARN_DAYS, the rule the connection card uses):
 * the card shows "expires in N days" and the owner is told once per expiry date.
 */
async function warnIfExpiring(integrationId: string, i: { business_id: string; provider_type: string; status: string }, expiresAt: string | null) {
  const renewal = metaTokenRenewal(expiresAt);
  const admin = createAdminClient();
  if (!renewal?.warn) {
    // Extended, or never expires: an earlier warning no longer applies.
    if (i.status === "DEGRADED") {
      await admin
        .from("integrations")
        .update({ status: "HEALTHY", last_error_at: null, last_error_code: null, last_error_message: null })
        .eq("id", integrationId)
        .eq("last_error_code", "token_expiring");
    }
    return;
  }
  const name = i.provider_type === "whatsapp_cloud" ? "WhatsApp" : "Meta";
  const message = `${name} access expires in ${renewal.daysLeft} day${renewal.daysLeft === 1 ? "" : "s"}. Reconnect ${name} to renew it; Meta does not renew it automatically.`;
  await admin
    .from("integrations")
    .update({ status: "DEGRADED", last_error_at: new Date().toISOString(), last_error_code: "token_expiring", last_error_message: message })
    .eq("id", integrationId)
    .neq("status", "ACTION_REQUIRED");
  const business = await loadBusinessContext(i.business_id);
  if (!business?.notify.integrationFailure) return;
  await queueNotification({
    businessId: i.business_id,
    type: "integration_failure",
    severity: "warning",
    title: `Reconnect ${name} to keep it working`,
    body: message,
    entityType: "integration",
    entityId: integrationId,
    linkUrl: "/app/settings?section=connections",
    dedupeKey: `meta_token_expiring:${integrationId}:${(expiresAt ?? "").slice(0, 10)}`,
  });
}

/** One sweep per ten-minute bucket. */
export async function scheduleIntegrationTokenRefresh(): Promise<void> {
  const { enqueue } = await import("@/lib/jobs/queue");
  const bucket = Math.floor(Date.now() / (10 * 60_000));
  await enqueue("integration.token_refresh", {}, { idempotencyKey: `integration.token_refresh:${bucket}`, maxAttempts: 2 });
}
