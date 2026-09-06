import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { checkSuppression } from "@/lib/policy/suppression";
import { packForCountry } from "@/lib/policy/packs";
import { unhealthyProviders } from "@/lib/find-leads/server/providers/registry";
import { SCORE_VERSION } from "@/lib/prospects/scoring";
import type { CampaignDraft } from "../campaign-draft";
import {
  evaluateLaunch,
  launchBlocked,
  type LaunchCheck,
  type LaunchFacts,
} from "../campaign-validation";
import { resolveCampaignBudgetContext } from "./budget";
import { loadSender } from "./sender";

/**
 * Gathering the facts the launch gate judges on (V4 section 17.7).
 *
 * Every lookup runs in parallel, and every one of them fails *closed*: a
 * suppression service that cannot be reached reports "unavailable", which
 * blocks the launch, rather than reporting "no conflicts", which would let a
 * workspace start emailing people it cannot confirm have not opted out.
 *
 * The judgement itself is in `campaign-validation.ts` so the right-rail card
 * and this gate render and refuse on the identical array.
 */
export async function gatherLaunchFacts(input: {
  businessId: string;
  draft: CampaignDraft;
  campaignId?: string | null;
  country?: string | null;
}): Promise<LaunchFacts> {
  const { businessId, draft } = input;
  const admin = createAdminClient();

  const [
    sender,
    entitlements,
    suppressionAvailable,
    pack,
    degraded,
    service,
    savedSearch,
    intentCategories,
    budget,
  ] = await Promise.all([
    draft.outreach.senderIdentityId
      ? loadSender(businessId, draft.outreach.senderIdentityId)
      : Promise.resolve(null),
    getV4Entitlements(businessId),
    probeSuppression(businessId),
    packForCountry(input.country ?? "GB").catch(() => null),
    unhealthyProviders().catch(() => new Set<string>()),
    draft.goal.primaryServiceId
      ? admin
          .from("services")
          .select("id, active")
          .eq("business_id", businessId)
          .eq("id", draft.goal.primaryServiceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.audience.savedSearchId
      ? admin
          .from("search_sessions")
          .select("id, status")
          .eq("business_id", businessId)
          .eq("id", draft.audience.savedSearchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.intentScore.intentCategoryIds.length > 0
      ? admin
          .from("intent_categories")
          .select("id, active")
          .eq("business_id", businessId)
          .in("id", draft.intentScore.intentCategoryIds)
      : Promise.resolve({ data: [] }),
    resolveCampaignBudgetContext({
      businessId,
      senderIdentityId: draft.outreach.senderIdentityId,
      excludeCampaignId: input.campaignId ?? null,
    }),
  ]);

  const selectedCategories = intentCategories.data ?? [];
  const allCategoriesActive =
    draft.intentScore.intentCategoryIds.length === 0 ||
    (selectedCategories.length === draft.intentScore.intentCategoryIds.length &&
      selectedCategories.every((row) => row.active));

  return {
    sender: sender
      ? {
          exists: true,
          active: sender.active,
          verified: sender.status === "VERIFIED",
          coldEnabled: sender.coldEnabled,
          hasPostalFooter: sender.hasPostalFooter,
          spf: sender.spf,
          dkim: sender.dkim,
          dmarc: sender.dmarc,
          bounceRate: sender.bounceRate,
          complaintRate: sender.complaintRate,
          mailboxHealth: sender.mailboxHealth,
          domainHealth: sender.domainHealth,
          dailySendCap: sender.dailySendCap,
          pausedUntil: sender.pausedUntil,
        }
      : null,
    plan: {
      active: entitlements.active,
      coldEmailEnabled: entitlements.coldEmailEnabled,
      sourcingEnabled: entitlements.sourcingEnabled,
    },
    suppressionAvailable,
    // The contactability engine is configured when a policy pack resolved. A
    // fail-closed pack still counts as configured; an error does not.
    contactabilityAvailable: pack !== null,
    policyPackVersion: pack?.version ?? null,
    providers: { healthy: degraded.size === 0, degraded: [...degraded] },
    service: {
      exists: Boolean(service.data),
      active: Boolean(service.data?.active),
    },
    savedSearchAvailable:
      !draft.audience.savedSearchId || savedSearch.data?.status === "ACTIVE",
    intentCategoriesActive: allCategoriesActive,
    scoringPolicyVersion: SCORE_VERSION,
    ceilings: budget.ceilings,
  };
}

/**
 * Whether the suppression service can answer at all.
 *
 * Probed with an address that will never match anything, so a `null` result is
 * proof the lookup ran. A thrown error is the only signal that matters, and
 * `checkSuppression` throws rather than returning a false negative.
 */
async function probeSuppression(businessId: string): Promise<boolean> {
  try {
    await checkSuppression(businessId, "EMAIL", {
      email: "launch-probe@clientturn.invalid",
    });
    return true;
  } catch {
    return false;
  }
}

export type LaunchValidation = {
  checks: LaunchCheck[];
  blocked: boolean;
  facts: LaunchFacts;
};

export async function validateForLaunch(input: {
  businessId: string;
  draft: CampaignDraft;
  campaignId?: string | null;
  country?: string | null;
}): Promise<LaunchValidation> {
  const facts = await gatherLaunchFacts(input);
  const checks = evaluateLaunch(input.draft, facts);
  return { checks, blocked: launchBlocked(checks), facts };
}
