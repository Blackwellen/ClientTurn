import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { checkSuppression, checkSuppressionBatch } from "@/lib/policy/suppression";
import { evaluateEligibility, type EligibilityCandidate } from "../campaign-eligibility";
import { gradesAtOrAbove, type CampaignDraft, type Grade } from "../campaign-draft";
import { loadDraft } from "./draft";
import { recordCampaignEvent } from "./lifecycle";

/**
 * Building a campaign's audience (V4 section 18.19).
 *
 * Runs in the background because it touches every candidate prospect and must
 * not sit inside a launch request. What it produces is a *selection*, not a
 * permission: `outreach_recipient_runs` rows in PENDING, each carrying the
 * eligibility snapshot that put it there.
 *
 * The snapshot is evidence, never authority. The dispatcher re-evaluates each
 * recipient immediately before sending against live suppression, because
 * someone can opt out between being selected and being written to.
 */

/** Per invocation, so one campaign cannot monopolise the worker. */
const BATCH = 500;

export type MaterializeOutcome = {
  considered: number;
  enrolled: number;
  review: number;
  excluded: number;
  more: boolean;
};

export async function materializeAudience(input: {
  businessId: string;
  campaignId: string;
}): Promise<MaterializeOutcome> {
  const admin = createAdminClient();
  const empty: MaterializeOutcome = {
    considered: 0,
    enrolled: 0,
    review: 0,
    excluded: 0,
    more: false,
  };

  const loaded = await loadDraft(input.businessId, input.campaignId);
  if (!loaded) return empty;

  const { draft, meta } = loaded;
  if (meta.status === "STOPPED" || meta.status === "COMPLETED") return empty;

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("active_sequence_id, prospects_per_run")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  const sequenceId = campaign?.active_sequence_id;
  if (!sequenceId) return empty;

  // Prospects already enrolled anywhere in this campaign are skipped by the
  // unique index; reading them first avoids relying on a constraint violation
  // as control flow.
  const { data: enrolledRows } = await admin
    .from("outreach_recipient_runs")
    .select("prospect_id")
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId);

  const enrolled = new Set((enrolledRows ?? []).map((row) => row.prospect_id));
  const room = Math.max(0, (campaign?.prospects_per_run ?? 0) - enrolled.size);
  if (room === 0) return empty;

  const candidates = await loadCandidates({
    businessId: input.businessId,
    campaignId: input.campaignId,
    draft,
    limit: Math.min(BATCH, room) + enrolled.size,
  });

  const fresh = candidates.filter((row) => !enrolled.has(row.id)).slice(0, Math.min(BATCH, room));
  if (fresh.length === 0) return empty;

  // `checkSuppressionBatch` returns an empty map both when nobody is
  // suppressed and when the lookup failed, which are not the same answer. The
  // single-address probe throws on failure, so it is what decides whether the
  // batch result can be trusted at all.
  const available = await checkSuppression(input.businessId, "EMAIL", {
    email: "audience-probe@clientturn.invalid",
  })
    .then(() => true)
    .catch(() => false);

  // Not knowing who opted out is not the same as nobody having opted out.
  // Enrolling anyway would be the one mistake that cannot be taken back.
  if (!available) return { ...empty, considered: fresh.length };

  // One batched lookup rather than one per prospect: the difference between a
  // query and five hundred.
  const emails = fresh.map((row) => row.email).filter((v): v is string => Boolean(v));
  const suppressed = await checkSuppressionBatch(input.businessId, emails);

  const intentByProspect = await loadIntentMatches(
    input.businessId,
    fresh.map((row) => row.id),
    draft.intentScore.intentCategoryIds,
    draft.intentScore.maxIntentAgeDays,
  );

  const excludedDomains = new Set(
    [...draft.audience.exclusions.companies].map((value) => value.toLowerCase().trim()),
  );

  const rows: {
    business_id: string;
    campaign_id: string;
    sequence_id: string;
    prospect_id: string;
    status: string;
    current_step_position: number;
    next_step_due_at: string | null;
    stop_reason: string | null;
  }[] = [];
  let review = 0;
  let excluded = 0;

  for (const prospect of fresh) {
    const candidate: EligibilityCandidate = {
      grade: prospect.grade,
      score: prospect.score,
      status: prospect.status,
      outreachEligibility: prospect.outreachEligibility,
      email: prospect.email,
      promotedToLeadId: prospect.promotedToLeadId,
      isExistingCustomer: prospect.isExistingCustomer,
      matchingIntentSignals: intentByProspect.get(prospect.id) ?? 0,
      suppressed: prospect.email ? suppressed.has(prospect.email.toLowerCase()) : false,
      companyExcluded: isExcluded(prospect, excludedDomains),
    };

    const verdict = evaluateEligibility(candidate, draft);

    if (verdict.outcome === "EXCLUDED") {
      excluded += 1;
      continue;
    }
    if (verdict.outcome === "REVIEW") review += 1;

    rows.push({
      business_id: input.businessId,
      campaign_id: input.campaignId,
      sequence_id: sequenceId,
      prospect_id: prospect.id,
      status: "PENDING",
      current_step_position: 0,
      // `next_step_due_at` is the only thing that makes a send eligible, so a
      // prospect needing review is enrolled with none. They appear in the
      // audience and in the review queue, and the scheduler cannot pick them
      // up until a person clears them.
      next_step_due_at: verdict.outcome === "ELIGIBLE" ? new Date().toISOString() : null,
      stop_reason: verdict.outcome === "REVIEW" ? verdict.reasonCode : null,
    });
  }

  if (rows.length > 0) {
    await admin.from("outreach_recipient_runs").upsert(rows, {
      onConflict: "campaign_id,prospect_id",
      ignoreDuplicates: true,
    });

    // Membership is recorded on the prospect too, because the Prospects table
    // and the Campaign audience tab must agree about who is in what.
    await admin
      .from("prospects")
      .update({ campaign_id: input.campaignId })
      .eq("business_id", input.businessId)
      .in(
        "id",
        rows.map((row) => row.prospect_id),
      )
      .is("campaign_id", null);
  }

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: "AUDIENCE_BUILT",
    actorType: "SYSTEM",
    summary: `${rows.length} prospect${rows.length === 1 ? "" : "s"} added to the campaign.`,
    metadata: { considered: fresh.length, review, excluded },
  });

  if (rows.length > 0) {
    await recordAudit({
      businessId: input.businessId,
      actorType: "system",
      action: "prospect.added_to_campaign",
      entityType: "outreach_campaign",
      entityId: input.campaignId,
      metadata: { added: rows.length, review, excluded },
    });
  }

  return {
    considered: fresh.length,
    enrolled: rows.length,
    review,
    excluded,
    more: fresh.length === Math.min(BATCH, room) && room > BATCH,
  };
}

type Candidate = {
  id: string;
  email: string | null;
  grade: Grade | null;
  score: number | null;
  status: string;
  outreachEligibility: string;
  promotedToLeadId: string | null;
  isExistingCustomer: boolean;
  companyName: string | null;
  companyDomain: string | null;
};

async function loadCandidates(input: {
  businessId: string;
  campaignId: string;
  draft: CampaignDraft;
  limit: number;
}): Promise<Candidate[]> {
  const admin = createAdminClient();
  const { draft } = input;

  let query = admin
    .from("prospects")
    .select(
      `id, email, grade, score, status, outreach_eligibility, promoted_to_lead_id, campaign_id,
       prospect_companies ( name, domain, is_existing_customer )`,
    )
    .eq("business_id", input.businessId)
    .eq("is_test", false)
    .is("promoted_to_lead_id", null)
    .not("email", "is", null)
    .in("grade", gradesAtOrAbove(draft.intentScore.minimumGrade))
    .in("status", ["VERIFIED", "READY", "APPROVED"])
    .order("score", { ascending: false, nullsFirst: false })
    .limit(input.limit);

  // An existing-prospects campaign never pulls in records another campaign is
  // already working; a prospect being contacted twice at once is the fastest
  // way to burn a domain.
  query = query.or(`campaign_id.is.null,campaign_id.eq.${input.campaignId}`);

  const { data } = await query;

  return (data ?? []).map((row) => {
    const company = row.prospect_companies as unknown as {
      name: string;
      domain: string | null;
      is_existing_customer: boolean;
    } | null;

    return {
      id: row.id,
      email: row.email,
      grade: row.grade as Grade | null,
      score: row.score === null ? null : Number(row.score),
      status: row.status,
      outreachEligibility: row.outreach_eligibility,
      promotedToLeadId: row.promoted_to_lead_id,
      isExistingCustomer: company?.is_existing_customer ?? false,
      companyName: company?.name ?? null,
      companyDomain: company?.domain ?? null,
    };
  });
}

function isExcluded(prospect: Candidate, excluded: Set<string>): boolean {
  if (excluded.size === 0) return false;
  const domain = prospect.companyDomain?.toLowerCase().trim();
  const name = prospect.companyName?.toLowerCase().trim();
  const emailDomain = prospect.email?.split("@")[1]?.toLowerCase().trim();

  return [domain, name, emailDomain].some((value) => Boolean(value) && excluded.has(value!));
}

/**
 * Matching, unexpired intent signals per prospect.
 *
 * `expires_at` is the category's own freshness rule; the campaign's maximum
 * age is applied on top, so whichever is stricter wins.
 */
async function loadIntentMatches(
  businessId: string,
  prospectIds: string[],
  categoryIds: string[],
  maxAgeDays: number,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (prospectIds.length === 0 || categoryIds.length === 0) return counts;

  const admin = createAdminClient();
  const from = new Date(Date.now() - maxAgeDays * 864e5).toISOString();

  const { data } = await admin
    .from("prospect_intent_matches")
    .select("prospect_id")
    .eq("business_id", businessId)
    .in("prospect_id", prospectIds)
    .in("intent_category_id", categoryIds)
    .gte("matched_at", from)
    .gt("expires_at", new Date().toISOString());

  for (const row of data ?? []) {
    counts.set(row.prospect_id, (counts.get(row.prospect_id) ?? 0) + 1);
  }

  return counts;
}
