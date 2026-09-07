import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OptimizationProposal } from "../campaign-draft";
import { applyOptimization, loadOptimizationConfig } from "./optimization";

/**
 * The optimiser that actually runs (V4 section 18.22-18.26).
 *
 * It proposes; `applyOptimization` decides. Everything here is evidence from
 * the campaign's own sends — no model, no heuristic dressed up as a finding —
 * and a dimension with too small a sample produces no proposal at all rather
 * than a confident guess from twelve emails.
 *
 * It cannot reach spend. Not because it is careful, but because the bounded
 * dimensions in `campaign-draft.ts` do not include budget, allowance, overage,
 * suppression, contactability, sender or channel, and `optimizationAllowed`
 * refuses anything not on that list.
 */

/**
 * Below this, a difference between two variants is noise. Cold email reply
 * rates sit in single digits, so a smaller sample routinely "shows" a winner
 * that reverses next week.
 */
const MIN_VARIANT_SAMPLE = 100;

/** Send-time evidence needs a fortnight of sends before it means anything. */
const MIN_SEND_TIME_SAMPLE = 200;

/** A reply-rate gap smaller than this is not worth acting on. */
const MIN_RELATIVE_LIFT = 0.2;

/** Never move an allocation by more than this in one pass. */
const MAX_ALLOCATION_STEP = 20;

export type OptimizerOutcome = {
  campaignId: string;
  proposed: number;
  applied: number;
  refused: number;
};

/**
 * Runs one campaign's optimisation pass.
 *
 * Deliberately does nothing for a campaign that is not sending: a paused
 * campaign is waiting on a person, and changing it under them would be a
 * surprise they did not ask for.
 */
export async function optimizeCampaign(input: {
  businessId: string;
  campaignId: string;
}): Promise<OptimizerOutcome> {
  const empty: OptimizerOutcome = {
    campaignId: input.campaignId,
    proposed: 0,
    applied: 0,
    refused: 0,
  };

  const config = await loadOptimizationConfig(input.businessId, input.campaignId);
  if (!config?.enabled) return empty;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("status")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return empty;
  if (campaign.status !== "ACTIVE" && campaign.status !== "OPTIMIZING") return empty;

  const proposals = [
    ...(await proposeVariantAllocation(input.businessId)),
    ...(await proposeSendWindow(input.businessId, input.campaignId)),
  ];

  let applied = 0;
  let refused = 0;

  for (const { proposal, rationale } of proposals) {
    const result = await applyOptimization({
      businessId: input.businessId,
      campaignId: input.campaignId,
      proposal,
      rationale,
    });

    if (result.ok && result.applied) applied += 1;
    else refused += 1;
  }

  return { campaignId: input.campaignId, proposed: proposals.length, applied, refused };
}

type Candidate = { proposal: OptimizationProposal; rationale: string };

/**
 * Shifts allocation toward the variant that is actually getting replies.
 *
 * Moves in bounded steps rather than jumping to the winner: an early lead on a
 * few hundred sends is often not a lead at all, and a gradual shift keeps
 * enough traffic on the other variant to find out.
 */
async function proposeVariantAllocation(businessId: string): Promise<Candidate[]> {
  const admin = createAdminClient();

  const { data: variants } = await admin
    .from("campaign_variants")
    .select("id, label, step_id, allocation_percent, sent_count, reply_count, positive_reply_count")
    .eq("business_id", businessId)
    .eq("active", true);

  if (!variants || variants.length < 2) return [];

  // Grouped per step: variant B of step 1 competes with variant A of step 1,
  // not with a variant of the follow-up.
  const byStep = new Map<string, typeof variants>();
  for (const variant of variants) {
    const key = variant.step_id ?? "all";
    byStep.set(key, [...(byStep.get(key) ?? []), variant]);
  }

  const candidates: Candidate[] = [];

  for (const group of byStep.values()) {
    if (group.length < 2) continue;

    const sample = group.reduce((total, v) => total + v.sent_count, 0);
    if (sample < MIN_VARIANT_SAMPLE) continue;

    const scored = group
      .filter((variant) => variant.sent_count > 0)
      .map((variant) => ({
        variant,
        // Positive replies, not all replies: "not interested" is a reply, and
        // optimising toward it would be optimising toward annoying people.
        rate: variant.positive_reply_count / variant.sent_count,
      }))
      .sort((a, b) => b.rate - a.rate);

    if (scored.length < 2) continue;

    const best = scored[0];
    const worst = scored[scored.length - 1];

    // A relative lift, not an absolute one: 2% versus 1% is a doubling and
    // worth acting on; 2% versus 1.9% is nothing.
    if (worst.rate <= 0 && best.rate <= 0) continue;
    const lift = worst.rate > 0 ? (best.rate - worst.rate) / worst.rate : 1;
    if (lift < MIN_RELATIVE_LIFT) continue;

    const current = Number(best.variant.allocation_percent);
    const next = Math.min(100, Math.round(current + MAX_ALLOCATION_STEP));
    if (next === current) continue;

    candidates.push({
      proposal: {
        dimension: "VARIANT_ALLOCATION",
        before: current,
        after: next,
      },
      rationale: `Variant ${best.variant.label} replied at ${(best.rate * 100).toFixed(1)}% against ${(worst.rate * 100).toFixed(1)}% over ${sample} sends.`,
    });
  }

  return candidates;
}

/**
 * Narrows the send window toward the hours that get replies.
 *
 * Reads the hour a message was *sent* against whether that thread later got an
 * inbound reply, which is the only version of this question the data can
 * actually answer.
 */
async function proposeSendWindow(
  businessId: string,
  campaignId: string,
): Promise<Candidate[]> {
  const admin = createAdminClient();

  const [{ data: sent }, { data: replied }] = await Promise.all([
    admin
      .from("messages")
      .select("id, conversation_id, created_at")
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .eq("direction", "outbound")
      .limit(5000),
    admin
      .from("messages")
      .select("conversation_id")
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .eq("direction", "inbound")
      .limit(5000),
  ]);

  if (!sent || sent.length < MIN_SEND_TIME_SAMPLE) return [];

  const repliedThreads = new Set(
    (replied ?? []).map((row) => row.conversation_id).filter(Boolean),
  );

  const byHour = new Map<number, { sent: number; replies: number }>();
  for (const message of sent) {
    const hour = new Date(message.created_at).getUTCHours();
    const bucket = byHour.get(hour) ?? { sent: 0, replies: 0 };
    bucket.sent += 1;
    if (message.conversation_id && repliedThreads.has(message.conversation_id)) {
      bucket.replies += 1;
    }
    byHour.set(hour, bucket);
  }

  // Only hours with enough sends to mean anything on their own.
  const hours = [...byHour.entries()]
    .filter(([, bucket]) => bucket.sent >= 25)
    .map(([hour, bucket]) => ({ hour, rate: bucket.replies / bucket.sent }))
    .sort((a, b) => b.rate - a.rate);

  if (hours.length < 3) return [];

  const best = hours.slice(0, 3).map((entry) => entry.hour).sort((a, b) => a - b);
  const startHour = best[0];
  const endHour = Math.max(startHour + 1, best[best.length - 1] + 1);

  return [
    {
      proposal: {
        dimension: "SEND_TIME",
        before: null,
        after: { startHour, endHour },
      },
      rationale: `Replies concentrate between ${String(startHour).padStart(2, "0")}:00 and ${String(endHour).padStart(2, "0")}:00 across ${sent.length} sends.`,
    },
  ];
}

/**
 * Every campaign that has opted into optimisation and is currently sending.
 *
 * Read here rather than by the caller so "who gets optimised" is one query
 * with one definition, and a campaign that turns the switch off stops being
 * touched immediately.
 */
export async function campaignsDueForOptimization(limit = 200): Promise<
  { businessId: string; campaignId: string }[]
> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaigns")
    .select("id, business_id")
    .eq("auto_optimize", true)
    .in("status", ["ACTIVE", "OPTIMIZING"])
    .is("archived_at", null)
    .limit(limit);

  return (data ?? []).map((row) => ({
    businessId: row.business_id,
    campaignId: row.id,
  }));
}
