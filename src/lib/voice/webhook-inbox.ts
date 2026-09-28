import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, webhookInboxStatus } from "@/lib/jobs/queue";
import { recordThenQueue } from "@/lib/jobs/inbox-core";
import { serverEnv } from "@/lib/env";
import { openSecret } from "@/lib/security/secret-box";
import { verifyTwilioSignature } from "@/lib/twilio/signature";
import type { VoiceEvent } from "./providers/types";
import { voiceWebhookBase } from "./providers/registry";

/**
 * The shared tail of every voice webhook route (CLAUDE.md): after the route
 * has verified the signature, write one `webhook_events` row per normalised
 * event (unique on provider + `VoiceEvent.dedupeKey`, so a provider retry is
 * acknowledged and not repeated), queue `voice.webhook_ingest`, and return.
 * No provider I/O happens on the request path.
 */

export type VoiceInboxProvider = "retell" | "twilio_voice";

export type StoreResult = { stored: number; duplicates: number; failed: number };

export async function storeVoiceEvents(provider: VoiceInboxProvider, events: readonly VoiceEvent[]): Promise<StoreResult> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const result: StoreResult = { stored: 0, duplicates: 0, failed: 0 };
  for (const event of events) {
    const externalEventId = event.dedupeKey.slice(0, 300);
    // A redelivery of an event recorded but never queued is queued now
    // (inbox-core.ts): a lost CALL_ENDED left the lead "on a call" and the
    // minutes held.
    const outcome = await recordThenQueue({
      insert: async () =>
        (
          await admin.from("webhook_events").insert({
            provider,
            external_event_id: externalEventId,
            event_type: event.type,
            status: "received",
            payload: { events: [event] },
          })
        ).error,
      status: () => webhookInboxStatus(provider, externalEventId),
      queue: () =>
        enqueue(
          "voice.webhook_ingest",
          { provider: provider === "retell" ? "retell" : "twilio", externalEventId },
          { priority: 10, idempotencyKey: `voice.webhook_ingest:${provider}:${event.dedupeKey}`.slice(0, 400) },
        ),
    });
    if (outcome === "FAILED") result.failed++;
    else if (outcome === "DUPLICATE") result.duplicates++;
    else result.stored++;
  }
  return result;
}

/**
 * The exact URL Twilio signed: the configured public voice origin plus the
 * route's path when set (behind a proxy `request.url` is the internal one),
 * else the forwarded host.
 */
export function twilioSignedUrl(request: Request): string {
  const url = new URL(request.url);
  const base = voiceWebhookBase();
  if (base) return `${base}${url.pathname}${url.search}`;
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/**
 * Twilio signs with the auth token of the account that owns the resource.
 * The platform (parent) token is tried first; a number held in a workspace
 * SUBACCOUNT may be signed with that subaccount's token (UNVERIFIED against a
 * live subaccount), which is tried only when it is stored sealed
 * (telephony_accounts.auth_token_ciphertext). A database read, not provider
 * I/O. No token at all is a refusal, never a pass.
 */
export async function verifyTwilioVoiceRequest(input: {
  request: Request;
  params: Record<string, string>;
}): Promise<boolean> {
  const signature = input.request.headers.get("x-twilio-signature");
  const url = twilioSignedUrl(input.request);
  const parent = serverEnv.twilio.authToken;
  if (parent && verifyTwilioSignature(parent, url, input.params, signature)) return true;

  const accountSid = input.params.AccountSid;
  if (!accountSid || !/^AC[0-9a-fA-F]{32}$/.test(accountSid)) return false;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from("telephony_accounts")
    .select("auth_token_ciphertext")
    .eq("subaccount_sid", accountSid)
    .maybeSingle();
  const sealed = (data as { auth_token_ciphertext: string | null } | null)?.auth_token_ciphertext ?? null;
  let token: string | null = null;
  try {
    token = openSecret(sealed);
  } catch {
    token = null;
  }
  return Boolean(token) && verifyTwilioSignature(token as string, url, input.params, signature);
}
