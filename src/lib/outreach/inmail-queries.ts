import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bestLinkedInTier,
  computeInMailBalance,
  INMAIL_REFUND_WINDOW_DAYS,
  inMailRulesForTier,
  type InMailBalance,
  type InMailTier,
} from "./inmail-credits";

/**
 * The LinkedIn InMail panel in the social queue (Phase 3.5): the derived
 * credit balance and the InMails still inside their 90-day reply window, so a
 * person can record a reply and get the credit back. LinkedIn stays ASSISTED:
 * nothing here sends anything.
 */

export type AwaitingInMail = {
  id: string;
  sentAt: string;
  name: string;
  prospectId: string | null;
  leadId: string | null;
};

export type InMailPanelData = {
  balance: InMailBalance;
  awaiting: AwaitingInMail[];
  /** The LinkedIn subscription the balance is worked out for. */
  tier: InMailTier | null;
  /** False on LinkedIn Free (or no LinkedIn account): no InMail to record. */
  hasInMail: boolean;
  basis: string;
};

/** The best active LinkedIn subscription in the workspace. */
export async function workspaceLinkedInTier(businessId: string): Promise<InMailTier | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("social_sending_accounts")
    .select("account_tier")
    .eq("business_id", businessId)
    .eq("platform", "LINKEDIN")
    .eq("status", "ACTIVE");
  if (error) throw new Error(`social_sending_accounts read: ${error.message}`);
  return bestLinkedInTier((data ?? []).map((row) => row.account_tier));
}

export async function loadInMailPanel(businessId: string, now: Date = new Date()): Promise<InMailPanelData> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("inmail_sends")
    .select("id, sent_at, replied_at, prospect_id, lead_id")
    .eq("business_id", businessId)
    .order("sent_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`inmail_sends read: ${error.message}`);
  const rows = data ?? [];

  const tier = await workspaceLinkedInTier(businessId);
  const rules = inMailRulesForTier(tier);
  const balance = computeInMailBalance({
    sends: rows.map((row) => ({ sentAt: row.sent_at, repliedAt: row.replied_at })),
    trackingSince: rows[0]?.sent_at ?? now.toISOString(),
    now,
    monthlyGrant: rules.monthlyGrant,
    rolloverCap: rules.rolloverCap,
  });

  const windowStart = now.getTime() - INMAIL_REFUND_WINDOW_DAYS * 86_400_000;
  const open = rows
    .filter((row) => !row.replied_at && Date.parse(row.sent_at) >= windowStart)
    .reverse()
    .slice(0, 25);

  const prospectIds = [...new Set(open.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)))];
  const leadIds = [...new Set(open.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
  const [prospects, leads] = await Promise.all([
    prospectIds.length
      ? db.from("prospects").select("id, first_name, last_name").eq("business_id", businessId).in("id", prospectIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string | null; last_name: string | null }[],
          error: null,
        }),
    leadIds.length
      ? db.from("leads").select("id, first_name, last_name").eq("business_id", businessId).in("id", leadIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string | null; last_name: string | null }[],
          error: null,
        }),
  ]);
  if (prospects.error) throw new Error(`prospects read: ${prospects.error.message}`);
  if (leads.error) throw new Error(`leads read: ${leads.error.message}`);

  const prospectName = new Map(
    (prospects.data ?? []).map((row) => [row.id, [row.first_name, row.last_name].filter(Boolean).join(" ")]),
  );
  const leadName = new Map(
    (leads.data ?? []).map((row) => [row.id, [row.first_name, row.last_name].filter(Boolean).join(" ")]),
  );

  return {
    tier,
    hasInMail: rules.monthlyGrant > 0,
    basis: rules.basis,
    balance,
    awaiting: open.map((row) => ({
      id: row.id,
      sentAt: row.sent_at,
      name:
        (row.prospect_id && prospectName.get(row.prospect_id)) ||
        (row.lead_id && leadName.get(row.lead_id)) ||
        "Unnamed contact",
      prospectId: row.prospect_id,
      leadId: row.lead_id,
    })),
  };
}
