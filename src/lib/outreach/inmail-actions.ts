"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { computeInMailBalance, inMailRulesForTier, type InMailBalance } from "./inmail-credits";
import { workspaceLinkedInTier } from "./inmail-queries";

/**
 * The manual InMail actions (Phase 3.5). LinkedIn stays ASSISTED: nothing
 * here sends anything -- a person sends the InMail in LinkedIn and records it,
 * and records the reply when one arrives, so the credit balance stays true.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// inmail_sends (0125) is in the generated types now: the typed client.
function db() {
  return createAdminClient();
}

const sentSchema = z.object({
  prospectId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  sentAt: z.iso.datetime().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function recordInMailSentAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = sentSchema.safeParse(input);
  if (!parsed.success || (!parsed.data.prospectId && !parsed.data.leadId)) {
    return { ok: false, error: "Choose the prospect or lead the InMail went to." };
  }
  const workspace = await requireRole("member");

  // A Free LinkedIn account cannot send InMail, so there is nothing to record.
  const tier = await workspaceLinkedInTier(workspace.businessId).catch(() => null);
  if (inMailRulesForTier(tier).monthlyGrant === 0) {
    return {
      ok: false,
      error: "Your LinkedIn account has no InMail. InMail needs Premium or Sales Navigator; set the subscription in Settings, Connections.",
    };
  }

  // The record must belong to this workspace.
  if (parsed.data.prospectId) {
    const { data } = await db()
      .from("prospects")
      .select("id")
      .eq("id", parsed.data.prospectId)
      .eq("business_id", workspace.businessId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That prospect could not be found." };
  }
  if (parsed.data.leadId) {
    const { data } = await db()
      .from("leads")
      .select("id")
      .eq("id", parsed.data.leadId)
      .eq("business_id", workspace.businessId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That lead could not be found." };
  }

  const { data, error } = await db()
    .from("inmail_sends")
    .insert({
      business_id: workspace.businessId,
      prospect_id: parsed.data.prospectId ?? null,
      lead_id: parsed.data.leadId ?? null,
      sent_by: workspace.userId,
      sent_at: parsed.data.sentAt ?? new Date().toISOString(),
      note: parsed.data.note ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "The InMail could not be recorded." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "inmail.recorded",
    entityType: "prospect",
    entityId: parsed.data.prospectId ?? parsed.data.leadId ?? null,
  });
  revalidatePath("/app/find-leads");
  return { ok: true, data: { id: data.id } };
}

export async function recordInMailReplyAction(input: unknown): Promise<Result> {
  const parsed = z.object({ inmailId: z.uuid(), repliedAt: z.iso.datetime().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const workspace = await requireRole("member");

  const { data, error } = await db()
    .from("inmail_sends")
    .update({ replied_at: parsed.data.repliedAt ?? new Date().toISOString() })
    .eq("id", parsed.data.inmailId)
    .eq("business_id", workspace.businessId)
    .is("replied_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "The reply could not be recorded." };
  if (!data) return { ok: false, error: "That InMail was not found or already has a reply." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "inmail.reply_recorded",
    entityType: "inmail_send",
    entityId: parsed.data.inmailId,
  });
  revalidatePath("/app/find-leads");
  return { ok: true };
}

/** The workspace's derived InMail balance, under its LinkedIn subscription's rules. */
export async function inMailBalanceAction(): Promise<Result<InMailBalance>> {
  const workspace = await requireRole("viewer");
  const { data, error } = await db()
    .from("inmail_sends")
    .select("sent_at, replied_at")
    .eq("business_id", workspace.businessId)
    .order("sent_at", { ascending: true })
    .limit(5000);
  if (error) return { ok: false, error: "InMail credits could not be read." };
  const rows = data ?? [];
  const now = new Date();
  const rules = inMailRulesForTier(
    await workspaceLinkedInTier(workspace.businessId).catch(() => null),
  );
  return {
    ok: true,
    data: computeInMailBalance({
      sends: rows.map((row) => ({ sentAt: row.sent_at, repliedAt: row.replied_at })),
      // Tracking starts with the first recorded InMail, or this month.
      trackingSince: rows[0]?.sent_at ?? now.toISOString(),
      now,
      monthlyGrant: rules.monthlyGrant,
      rolloverCap: rules.rolloverCap,
    }),
  };
}
