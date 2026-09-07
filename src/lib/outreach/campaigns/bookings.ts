import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/messaging/types";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import { promoteCampaignProspect } from "./replies";
import { recordCampaignEvent } from "./lifecycle";

/**
 * "Auto-promote on booked event" (V4 section 17.6).
 *
 * A cold prospect who books straight from the email never replies, so the
 * reply pipeline never sees them. Without this they would sit in the campaign
 * as an un-promoted prospect with a booking attached to nobody — and the
 * sequence would carry on emailing someone who has already booked.
 *
 * The rule only fires for campaigns configured for it. A campaign set to
 * manual promotion gets a notification instead, which is the whole point of
 * having chosen manual.
 */

export type BookedPromotion = {
  leadId: string;
  prospectId: string;
  campaignId: string;
};

/**
 * Finds the prospect behind a booking and promotes them, when their campaign
 * says to.
 *
 * Returns null when there is no matching prospect, or when their campaign does
 * not auto-promote — the caller then handles the booking as unmatched, exactly
 * as it did before.
 */
export async function promoteOnBookedEvent(input: {
  businessId: string;
  email?: string | null;
  phone?: string | null;
}): Promise<BookedPromotion | null> {
  const email = normaliseEmail(input.email ?? null);
  const phone = input.phone ? normalisePhone(input.phone) : null;
  if (!email && !phone) return null;

  const admin = createAdminClient();

  let query = admin
    .from("prospects")
    .select("id, campaign_id, replied_at, outreach_eligibility, status")
    .eq("business_id", input.businessId)
    .is("promoted_to_lead_id", null)
    .not("campaign_id", "is", null)
    .order("last_contacted_at", { ascending: false, nullsFirst: false })
    .limit(1);

  // Email is the identifier cold outreach actually holds; phone is a fallback
  // for a booking form that collected one.
  query = email ? query.ilike("email", email) : query.eq("phone_e164", phone!);

  const { data: prospect } = await query.maybeSingle();
  if (!prospect?.campaign_id) return null;

  // A suppressed prospect is never promoted, whatever they booked. Someone who
  // opted out and then landed on an old booking link has still opted out.
  if (prospect.outreach_eligibility === "SUPPRESSED" || prospect.status === "SUPPRESSED") {
    return null;
  }

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("id, promotion_rule")
    .eq("business_id", input.businessId)
    .eq("id", prospect.campaign_id)
    .maybeSingle();

  if (!campaign) return null;
  if (campaign.promotion_rule !== "BOOKED_EVENT") return null;

  // `promote_reviewed_prospect` refuses a prospect with no recorded
  // engagement, which is the right rule for a reply-driven promotion. A
  // booking *is* engagement — stronger than a reply — so it is recorded as
  // such before promoting rather than the guard being bypassed.
  if (!prospect.replied_at) {
    await admin
      .from("prospects")
      .update({
        replied_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", prospect.id);
  }

  const leadId = await promoteCampaignProspect(
    input.businessId,
    prospect.id,
    "booked_event",
  );

  if (!leadId) return null;

  // Booked and promoted: there is nothing left for the sequence to say.
  await admin
    .from("outreach_recipient_runs")
    .update({
      status: "COMPLETED",
      next_step_due_at: null,
      stop_reason: "BOOKED",
      completed_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("campaign_id", campaign.id)
    .eq("prospect_id", prospect.id)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"]);

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: campaign.id,
    eventType: "PROSPECT_PROMOTED",
    actorType: "SYSTEM",
    summary: "Prospect booked and was promoted to a lead.",
    metadata: { prospectId: prospect.id, leadId, trigger: "booked_event" },
  });

  return { leadId, prospectId: prospect.id, campaignId: campaign.id };
}
