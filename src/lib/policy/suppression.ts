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
  const { data, error } = await admin
    .from("suppression_entries")
    .select("email, reason, business_id, created_at, expires_at, channel")
    .in("email", normalised)
    .in("channel", ["EMAIL", "ALL"])
    .or(`business_id.eq.${businessId},business_id.is.null`);

  if (error || !data) return out;

  const now = Date.now();
  for (const row of data) {
    if (!row.email) continue;
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;

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

  await admin.from("suppression_entries").delete().eq("id", entryId).eq("business_id", businessId);
  return { ok: true };
}
