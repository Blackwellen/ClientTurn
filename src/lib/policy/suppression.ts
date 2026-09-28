import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/messaging/types";
import type { PolicyChannel } from "./types";

/**
 * Global suppression (V4 §69).
 *
 * Checked before EVERY send, whatever the source — warm follow-up, reactivation
 * campaign, cold acquisition sequence or a message a human typed by hand. The
 * lookup is destination-scoped rather than record-scoped, so suppressing an
 * address also stops a *different* lead or prospect that happens to share it.
 *
 * A row with a null business_id is a platform-wide suppression and outranks any
 * workspace-level state.
 */

export type SuppressionReason =
  | "OPT_OUT"
  | "COMPLAINT"
  | "INVALID"
  | "BOUNCE"
  | "LEGAL"
  | "MANUAL"
  | "PROVIDER";

export type SuppressionHit = {
  reason: SuppressionReason;
  scope: "PLATFORM" | "WORKSPACE";
  createdAt: string;
};

export type SuppressionDestination = {
  email?: string | null;
  phone?: string | null;
  social?: string | null;
};

/** Lower-cased and trimmed. Matches the citext column's own comparison. */
export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * One suppression check. Returns the blocking row, or null when nothing
 * suppresses this destination on this channel.
 *
 * Uses the `check_suppression` SQL function so the "workspace OR platform,
 * channel OR ALL, not expired" logic lives in exactly one place and can use the
 * partial indexes built for it.
 */
export async function checkSuppression(
  businessId: string,
  channel: PolicyChannel,
  destination: SuppressionDestination,
): Promise<SuppressionHit | null> {
  const email = normaliseEmail(destination.email);
  const phone = destination.phone ? normalisePhone(destination.phone) : null;
  const social = destination.social?.trim() || null;

  if (!email && !phone && !social) return null;

  const admin = createAdminClient();
  // The generated RPC signature takes optional args rather than nullable ones,
  // so an absent destination is omitted rather than passed as null.
  const { data, error } = await admin.rpc("check_suppression", {
    p_business_id: businessId,
    p_channel: channel,
    ...(email ? { p_email: email } : {}),
    ...(phone ? { p_phone: phone } : {}),
    ...(social ? { p_social: social } : {}),
  });

  // A failed suppression lookup must never be read as "not suppressed". The
  // caller treats a thrown error as a blocked send.
  if (error) {
    throw new Error(`Suppression lookup failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    reason: row.reason as SuppressionReason,
    scope: row.scope as "PLATFORM" | "WORKSPACE",
    createdAt: row.created_at,
  };
}

/**
 * Batch variant for list views, which need eligibility for many prospects at
 * once and must not issue one RPC per row.
 *
 * Returns a map keyed by normalised email. Only the email channel is covered:
 * the list surfaces that need this (Prospects, import review) are email-first,
 * and a per-row phone check would defeat the purpose of batching.
 */
export async function checkSuppressionBatch(
  businessId: string,
  emails: (string | null | undefined)[],
): Promise<Map<string, SuppressionHit>> {
  const normalised = [...new Set(emails.map(normaliseEmail).filter((v): v is string => v !== null))];
  const out = new Map<string, SuppressionHit>();
  if (normalised.length === 0) return out;

  const admin = createAdminClient();
  // `suppressed_emails` (0126) matches plaintext or the salted hash an erased
  // person's entry was converted to (0124), and filters expired rows itself.
  // Not in the generated types until they are regenerated.
  const rpc = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: { email: string; reason: string; business_id: string | null; created_at: string }[] | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await rpc("suppressed_emails", {
    p_business_id: businessId,
    p_emails: normalised,
  });

  // Fails closed. An empty map here reads as "nobody is suppressed", which is
  // how a failed lookup used to let a suppressed address into an import or a
  // campaign audience.
  if (error) throw new Error(`Suppression lookup failed: ${error.message}`);
  if (!data) return out;

  for (const row of data) {
    if (!row.email) continue;

    const key = row.email.toLowerCase();
    const scope: "PLATFORM" | "WORKSPACE" = row.business_id === null ? "PLATFORM" : "WORKSPACE";
    const existing = out.get(key);
    // A platform suppression outranks a workspace one for display purposes.
    if (!existing || (existing.scope === "WORKSPACE" && scope === "PLATFORM")) {
      out.set(key, {
        reason: row.reason as SuppressionReason,
        scope,
        createdAt: row.created_at,
      });
    }
  }

  return out;
}

export type SuppressInput = {
  businessId: string | null;
  channel: PolicyChannel | "ALL";
  reason: SuppressionReason;
  source: string;
  sourceReference?: string | null;
  note?: string | null;
  createdBy?: string | null;
  email?: string | null;
  phone?: string | null;
  social?: string | null;
  /** Only ever set for a provider-imposed temporary block. An opt-out never expires. */
  expiresAt?: string | null;
};

/**
 * Adds a suppression. Idempotent: the unique indexes mean re-suppressing an
 * address is a no-op rather than an error, which matters because provider
 * webhooks retry.
 */
export async function suppress(input: SuppressInput): Promise<void> {
  const email = normaliseEmail(input.email);
  const phone = input.phone ? normalisePhone(input.phone) : null;
  const social = input.social?.trim() || null;

  if (!email && !phone && !social) return;

  const admin = createAdminClient();
  const { error } = await admin.from("suppression_entries").insert({
    business_id: input.businessId,
    email,
    phone_e164: phone,
    social_identifier: social,
    channel: input.channel,
    reason: input.reason,
    source: input.source,
    source_reference: input.sourceReference ?? null,
    note: input.note ?? null,
    created_by: input.createdBy ?? null,
    expires_at: input.expiresAt ?? null,
  });

  // 23505 is "already suppressed", which is the outcome we wanted.
  if (error && error.code !== "23505") throw error;
}

/**
 * Removes a suppression. Deliberately narrow: only MANUAL and INVALID entries
 * can be lifted from the UI. An OPT_OUT, COMPLAINT or LEGAL suppression is the
 * recipient's decision or a legal obligation, and is not the workspace's to
 * reverse.
 */
export const REVERSIBLE_REASONS: SuppressionReason[] = ["MANUAL", "INVALID", "BOUNCE"];

export async function unsuppress(
  businessId: string,
  entryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: entry } = await admin
    .from("suppression_entries")
    .select("id, reason, business_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { ok: false, error: "That suppression entry no longer exists." };
  if (entry.business_id !== businessId) {
    return {
      ok: false,
      error: "This address is suppressed across ClientTurn and cannot be removed here.",
    };
  }
  if (!REVERSIBLE_REASONS.includes(entry.reason as SuppressionReason)) {
    return {
      ok: false,
      error:
        "This contact opted out or reported a message as spam. That cannot be undone from here.",
    };
  }

  const { error } = await admin
    .from("suppression_entries")
    .delete()
    .eq("id", entryId)
    .eq("business_id", businessId);
  if (error) {
    console.error("[suppression] unsuppress delete failed", {
      businessId,
      entryId,
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "That suppression could not be removed. Please try again." };
  }
  return { ok: true };
}

/**
 * Lifts a suppression by destination, for a recipient who asked to resume.
 *
 * Distinct from `unsuppress()` above, and deliberately so. That one is a
 * workspace lifting an entry it owns, and refuses OPT_OUT and COMPLAINT because
 * those are not the workspace's to reverse. This one is the *recipient*
 * reversing their own decision — texting START after STOP — which is the one
 * case where lifting an opt-out is right, and refusing it would leave someone
 * unable to resume a conversation they asked to resume.
 *
 * Platform-wide entries are never touched: `business_id is not null` in the SQL
 * routine, because one workspace may not lift a suppression that applies across
 * ClientTurn.
 */
export async function liftSuppressionForDestination(
  businessId: string,
  channel: PolicyChannel,
  destination: SuppressionDestination,
): Promise<number> {
  const email = normaliseEmail(destination.email);
  const phone = destination.phone ? normalisePhone(destination.phone) : null;
  if (!email && !phone) return 0;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("lift_suppression_for_destination", {
    p_business_id: businessId,
    p_channel: channel,
    // The generated signature takes `string | undefined`; a null would be sent
    // as an explicit JSON null rather than an omitted argument.
    p_email: email ?? undefined,
    p_phone: phone ?? undefined,
  });

  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * The recipient texting START on one channel (0111).
 *
 * Narrower than `liftSuppressionForDestination` above, and the one the inbound
 * keyword path uses: it lifts only this channel's OPT_OUT for this phone, never
 * a MANUAL, INVALID, BOUNCE, COMPLAINT or platform-wide row, and splits an
 * ALL-channel opt-out into per-channel opt-outs for every *other* channel
 * rather than deleting it. `remaining` is how many recipient opt-outs still
 * stand for the phone or email, so the caller knows whether the lead as a
 * whole is still opted out.
 */
export async function liftOptOutForChannel(
  businessId: string,
  channel: "SMS" | "WHATSAPP",
  destination: { phone: string; email?: string | null },
): Promise<{ lifted: number; split: number; remaining: number }> {
  const phone = normalisePhone(destination.phone);
  const email = normaliseEmail(destination.email);
  if (!phone) return { lifted: 0, split: 0, remaining: 0 };

  const admin = createAdminClient();
  // `lift_opt_out_for_channel` is added by migration 0111 and is absent from
  // the generated types until they are regenerated against the applied schema.
  const { data, error } = await admin.rpc(
    "lift_opt_out_for_channel" as never,
    {
      p_business_id: businessId,
      p_channel: channel,
      p_phone: phone,
      ...(email ? { p_email: email } : {}),
    } as never,
  );

  if (error) throw error;
  const result = (data ?? {}) as { lifted?: number; split?: number; remaining?: number };
  return {
    lifted: Number(result.lifted ?? 0),
    split: Number(result.split ?? 0),
    // Unknown is read as "still opted out": clearing the lead flag on a bad
    // read would be the unsafe direction.
    remaining: result.remaining == null ? 1 : Number(result.remaining),
  };
}

/**
 * A spam complaint against an email address (a feedback-loop / ARF abuse
 * report). Channel EMAIL, reason COMPLAINT — which `unsuppress()` refuses, so
 * the workspace cannot lift it either. Idempotent like `suppress()`, so an FBL
 * that re-delivers the same report is harmless.
 */
export async function recordComplaint(input: {
  businessId: string | null;
  email: string;
  source: string;
  sourceReference?: string | null;
  note?: string | null;
}): Promise<void> {
  await suppress({
    businessId: input.businessId,
    channel: "EMAIL",
    reason: "COMPLAINT",
    source: input.source,
    sourceReference: input.sourceReference ?? null,
    note: input.note ?? null,
    email: input.email,
  });
}

/**
 * Every suppressed destination in a workspace, for a bulk audience filter.
 *
 * The reactivation audience resolver needs to exclude thousands of leads in one
 * pass, so it reads the list rather than asking per contact. Returned as a Set
 * of normalised destinations — the same shape the old `contact_suppressions`
 * query produced, so the caller is unchanged apart from where it reads from.
 */
export async function suppressedDestinations(
  businessId: string,
  channels: PolicyChannel[],
): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("suppression_entries")
    .select("email, phone_e164, expires_at")
    .in("channel", [...channels, "ALL"])
    .or(`business_id.eq.${businessId},business_id.is.null`);

  const now = Date.now();
  const out = new Set<string>();
  for (const row of data ?? []) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;
    if (row.email) out.add(String(row.email).toLowerCase());
    if (row.phone_e164) out.add(row.phone_e164);
  }
  return out;
}

/**
 * Spam complaints recorded against this workspace's email since a moment, for
 * the complaint-rate monitor (brief §43). Only rows that still name an
 * address: an erased person's complaint survives as a hash, which cannot be
 * attributed to a sender and is left out rather than guessed at.
 */
export async function recentComplaints(
  businessId: string,
  sinceIso: string,
): Promise<{ email: string; createdAt: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("suppression_entries")
    .select("email, created_at")
    .eq("business_id", businessId)
    .eq("reason", "COMPLAINT")
    .in("channel", ["EMAIL", "ALL"])
    .gte("created_at", sinceIso)
    .limit(5000);
  if (error) throw new Error(`Complaints could not be read: ${error.message}`);
  return (data ?? [])
    .filter((row) => Boolean(row.email))
    .map((row) => ({ email: String(row.email), createdAt: row.created_at }));
}

/** Voice calls share the central suppression boundary, including platform and expiry rules. */
export async function checkVoiceSuppression(
  businessId: string,
  destination?: string | null,
): Promise<{ suppressed: boolean; voiceOptedOut: boolean; allChannels: boolean }> {
  // Suppression for calls: a VOICE or ALL entry for the number, this workspace or platform-wide.
  let suppressed = false;
  let voiceOptedOut = false;
  // An ALL entry: suppressed on every channel (inbound return calls read this:
  // a calls-only opt-out does not stop answering a call the person made).
  let allChannels = false;
  const phone = destination ? normalisePhone(destination) : null;
  if (phone) {
    const { data: hits, error } = await createAdminClient()
      .from("suppression_entries")
      .select("channel, expires_at, business_id")
      .eq("phone_e164", phone)
      .in("channel", ["VOICE", "ALL"])
      .or(`business_id.eq.${businessId},business_id.is.null`);
    // A failed lookup is never read as "not suppressed".
    if (error) throw new Error(`voice suppression lookup failed: ${error.message}`);
    const now = Date.now();
    const live = ((hits ?? []) as { channel: string; expires_at: string | null }[]).filter((h) => !h.expires_at || Date.parse(h.expires_at) > now);
    suppressed = live.length > 0;
    voiceOptedOut = live.some((h) => h.channel === "VOICE");
    allChannels = live.some((h) => h.channel === "ALL");
  }

  return { suppressed, voiceOptedOut, allChannels };
}

/** Persist a voice opt-out, failing closed on deployments awaiting the VOICE migration. */
export async function recordVoiceSuppression(input: { businessId: string; phone?: string | null; callId: string }): Promise<void> {
  const phone = input.phone ? normalisePhone(input.phone) : null;
  if (!phone) return;
  const base = {
    business_id: input.businessId,
    phone_e164: phone,
    reason: "OPT_OUT",
    source: "VOICE_CALL",
    source_reference: `voice_call:${input.callId}`,
    note: "Asked on an AI call not to be called again.",
  };
  const { error } = await createAdminClient().from("suppression_entries").insert({ ...base, channel: "VOICE" });
  if (!error || error.code === "23505") return;
  // 0157 not applied (the VOICE channel is refused by the CHECK): suppress
  // every channel rather than keep calling. Over-suppression is the safe side.
  if (error.code === "23514") {
    const fallback = await createAdminClient().from("suppression_entries").insert({ ...base, channel: "ALL", note: "Asked on an AI call not to be called again (all channels until the VOICE opt-out is available)." });
    if (!fallback.error || fallback.error.code === "23505") return;
    throw new Error(`voice opt-out: ${fallback.error.message}`);
  }
  throw new Error(`voice opt-out: ${error.message}`);
}
