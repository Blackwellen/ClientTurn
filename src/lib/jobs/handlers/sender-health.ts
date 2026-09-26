import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { recentComplaints } from "@/lib/policy/suppression";
import {
  COMPLAINT_WINDOW_DAYS,
  complaintsBySender,
  complaintVerdict,
  type SentEmail,
} from "@/lib/email/sender-health";
import { queueNotification } from "./shared";

/**
 * `email.sender_health` (brief §43), daily: the complaint rate per sender
 * identity over seven days, from COMPLAINT suppression rows (the ARF recorder,
 * B4) and messages flagged `complained_at`, against the emails each sender
 * actually sent.
 *
 *   >= 0.1%  WATCH, and the workspace is warned.
 *   >= 0.3%  PAUSED (with at least two complaints): the policy engine and the
 *            send-slot claim refuse the sender's marketing mail.
 *
 * Not sticky, and not overridable by a person (sender health is a platform
 * safety limit, §66.2): the state is recomputed every day, so a paused sender
 * returns to service once its complaints age out of the seven-day window.
 *
 * Without a business id it fans out one job per workspace with an active sender.
 */

export const senderHealthPayload = z.object({ businessId: z.uuid().optional() });

// 0127 columns post-date the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type SenderRow = { id: string; email: string; health_state: string | null };

type SentRow = {
  sender_identity_id: string | null;
  sent_at: string | null;
  complained_at: string | null;
  lead_id: string | null;
  prospect_id: string | null;
};

/** id -> email for a set of leads or prospects, in chunks. */
async function emailsById(table: "leads" | "prospects", businessId: string, ids: string[]) {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 200) {
    const { data, error } = await db()
      .from(table)
      .select("id, email")
      .eq("business_id", businessId)
      .in("id", unique.slice(index, index + 200));
    if (error) throw new Error(`sender health: ${table}: ${error.message}`);
    for (const row of (data ?? []) as { id: string; email: string | null }[]) {
      if (row.email) out.set(row.id, row.email);
    }
  }
  return out;
}

async function sentInWindow(businessId: string, sinceIso: string): Promise<SentEmail[]> {
  const rows: SentRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await db()
      .from("messages")
      .select("sender_identity_id, sent_at, complained_at, lead_id, prospect_id")
      .eq("business_id", businessId)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .not("sender_identity_id", "is", null)
      .not("sent_at", "is", null)
      .gte("sent_at", sinceIso)
      .order("sent_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sender health: messages: ${error.message}`);
    const page = (data ?? []) as SentRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const [leadEmails, prospectEmails] = await Promise.all([
    emailsById("leads", businessId, rows.flatMap((row) => (row.lead_id ? [row.lead_id] : []))),
    emailsById("prospects", businessId, rows.flatMap((row) => (row.prospect_id ? [row.prospect_id] : []))),
  ]);

  const out: SentEmail[] = [];
  for (const row of rows) {
    if (!row.sender_identity_id || !row.sent_at) continue;
    out.push({
      senderId: row.sender_identity_id,
      recipient:
        (row.lead_id ? leadEmails.get(row.lead_id) : undefined) ??
        (row.prospect_id ? prospectEmails.get(row.prospect_id) : undefined) ??
        "",
      sentAt: row.sent_at,
      complained: Boolean(row.complained_at),
    });
  }
  return out;
}

async function checkWorkspace(businessId: string): Promise<void> {
  const { data: senders, error } = await db()
    .from("sender_identities")
    .select("id, email, health_state")
    .eq("business_id", businessId)
    .eq("active", true);
  if (error) throw new Error(`sender health: senders: ${error.message}`);
  if (!senders?.length) return;

  const since = new Date(Date.now() - COMPLAINT_WINDOW_DAYS * 86_400_000).toISOString();
  const [sent, complaints] = await Promise.all([
    sentInWindow(businessId, since),
    recentComplaints(businessId, since),
  ]);
  const bySender = complaintsBySender(sent, complaints);
  const now = new Date().toISOString();
  const day = now.slice(0, 10);

  for (const sender of senders as SenderRow[]) {
    const counts = bySender.get(sender.id) ?? { sent: 0, complaints: 0 };
    const verdict = complaintVerdict(counts);
    const previous = sender.health_state ?? "HEALTHY";

    logWriteError(
      await db()
        .from("sender_identities")
        .update({
          health_state: verdict.state,
          health_reason: verdict.reason,
          complaint_rate_7d: Number(verdict.rate.toFixed(6)),
          sent_7d: counts.sent,
          complaints_7d: counts.complaints,
          health_checked_at: now,
        })
        .eq("id", sender.id)
        .eq("business_id", businessId),
      "sender health: write verdict",
      { businessId, senderId: sender.id },
    );

    // Tell the workspace on the way down, once a day per state.
    if (verdict.state !== "HEALTHY" && verdict.state !== previous) {
      await queueNotification({
        businessId,
        type: "integration_failure",
        severity: verdict.state === "PAUSED" ? "error" : "warning",
        title:
          verdict.state === "PAUSED"
            ? `Sending from ${sender.email} is paused`
            : `Spam complaints rising for ${sender.email}`,
        body: verdict.reason ?? undefined,
        entityType: "sender_identity",
        entityId: sender.id,
        linkUrl: "/app/settings?section=connections",
        dedupeKey: `sender_health:${sender.id}:${verdict.state}:${day}`,
      });
    }
  }
}

export async function handleSenderHealth(job: ClaimedJob): Promise<void> {
  const payload = senderHealthPayload.parse(job.payload ?? {});
  if (payload.businessId) {
    await checkWorkspace(payload.businessId);
    return;
  }

  const { data, error } = await db()
    .from("sender_identities")
    .select("business_id")
    .eq("active", true)
    .limit(5000);
  if (error) throw new Error(`sender health: fan-out: ${error.message}`);

  const day = new Date().toISOString().slice(0, 10);
  const businesses = new Set(((data ?? []) as { business_id: string }[]).map((row) => row.business_id));
  for (const businessId of businesses) {
    await enqueue(
      "email.sender_health",
      { businessId },
      { businessId, idempotencyKey: `sender-health:${businessId}:${day}` },
    );
  }
}
