/**
 * Opportunity stages, motions and the CRM stage maps (decision Q3, Phase 3.3).
 *
 * Pure: no Supabase, no `server-only`, relative imports with `.ts`, so the
 * whole vocabulary is asserted by tests/opportunities.test.ts.
 *
 * ## The rules
 *
 *   * **One vocabulary**, mirrored by `opportunities_stage_check` (0125) and
 *     `opportunity_stage_rank()`. CLOSED is never *advanced* to: it is reached
 *     only by closing with WON or LOST and a reason.
 *   * **Automatic moves are forward only.** Qualification arriving after a
 *     booking must not pull the opportunity back. A person may move an open
 *     opportunity to any stage its motion uses.
 *   * **Stages follow the motion.** A checkout motion has no MEETING_BOOKED;
 *     a meeting motion has no CHECKOUT_SENT.
 *   * **Lead status is a projection**: WON/LOST on the opportunity become the
 *     lead's status, in the same transaction (close_opportunity()).
 */

import type { SalesMotion } from "../sales-library/types.ts";

export const OPPORTUNITY_STAGES = [
  "OPEN",
  "QUALIFYING",
  "QUALIFIED",
  "MEETING_BOOKED",
  "PROPOSAL",
  "CHECKOUT_SENT",
  "NEGOTIATION",
  "CLOSED",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPEN_STAGES = OPPORTUNITY_STAGES.filter(
  (stage) => stage !== "CLOSED",
) as Exclude<OpportunityStage, "CLOSED">[];
export type OpenStage = Exclude<OpportunityStage, "CLOSED">;

export const OPPORTUNITY_OUTCOMES = ["OPEN", "WON", "LOST"] as const;
export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];

/** `opportunities.close_target` (0121). */
export const OPPORTUNITY_CLOSE_TARGETS = [
  "BOOK",
  "BUY",
  "QUOTE",
  "PROPOSAL",
  "TRIAL",
  "APPLY",
  "NEXT_STAGE",
] as const;
export type OpportunityCloseTarget = (typeof OPPORTUNITY_CLOSE_TARGETS)[number];

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  OPEN: "Open",
  QUALIFYING: "Qualifying",
  QUALIFIED: "Qualified",
  MEETING_BOOKED: "Meeting booked",
  PROPOSAL: "Proposal",
  CHECKOUT_SENT: "Checkout sent",
  NEGOTIATION: "Negotiation",
  CLOSED: "Closed",
};

/** Mirrors `opportunity_stage_rank()` in 0125. CLOSED ranks 0: never advanced to. */
export function stageRank(stage: string): number {
  const index = (OPEN_STAGES as string[]).indexOf(stage);
  return index + 1;
}

/**
 * Whether an automatic event may move `from` to `to`. Forward only, open
 * stages only, and never out of a closed opportunity.
 */
export function canAdvance(from: string, to: string): boolean {
  if (from === "CLOSED") return false;
  const target = stageRank(to);
  return target > 0 && target > stageRank(from);
}

/** The stages each motion's pipeline uses, in order. */
export const MOTION_STAGES: Record<SalesMotion, readonly OpenStage[]> = {
  BOOK_MEETING_B2B: ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL", "NEGOTIATION"],
  DIRECT_B2B: ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL", "CHECKOUT_SENT", "NEGOTIATION"],
  LOCAL_SERVICE: ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL"],
  HIGH_TICKET_B2C: ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL", "NEGOTIATION"],
  ECOMMERCE_DIRECT: ["OPEN", "QUALIFIED", "CHECKOUT_SENT"],
  SAAS_SELF_SERVE: ["OPEN", "QUALIFIED", "CHECKOUT_SENT", "MEETING_BOOKED"],
  ENTERPRISE: ["OPEN", "QUALIFYING", "QUALIFIED", "MEETING_BOOKED", "PROPOSAL", "NEGOTIATION"],
};

/** Stages a person may set for an opportunity on this motion (null = any open stage). */
export function stagesForMotion(motion: string | null | undefined): readonly OpenStage[] {
  if (motion && motion in MOTION_STAGES) return MOTION_STAGES[motion as SalesMotion];
  return OPEN_STAGES;
}

/**
 * The stage an automatic event should move to on this motion, or null when
 * the motion does not use it. MEETING_BOOKED on a checkout motion is still
 * recorded as a meeting where the motion allows one; otherwise skipped.
 */
export function stageForEvent(
  motion: string | null | undefined,
  event: "QUALIFIED" | "MEETING_BOOKED" | "CHECKOUT_SENT",
): OpenStage | null {
  return stagesForMotion(motion).includes(event) ? event : null;
}

/** Motions on which the agent may close directly with a checkout link (Q2). */
export const DIRECT_CLOSE_MOTIONS: readonly SalesMotion[] = [
  "DIRECT_B2B",
  "ECOMMERCE_DIRECT",
  "SAAS_SELF_SERVE",
];

export function motionAllowsDirectClose(motion: string | null | undefined): boolean {
  return Boolean(motion) && (DIRECT_CLOSE_MOTIONS as readonly string[]).includes(motion!);
}

/** The motion's close target (sales library) in `opportunities.close_target` terms. */
export function closeTargetForMotion(motion: string | null | undefined): OpportunityCloseTarget {
  switch (motion) {
    case "ECOMMERCE_DIRECT":
      return "BUY";
    case "SAAS_SELF_SERVE":
      return "TRIAL";
    case "DIRECT_B2B":
      return "PROPOSAL";
    case "LOCAL_SERVICE":
      return "QUOTE";
    case "ENTERPRISE":
      return "NEXT_STAGE";
    case "BOOK_MEETING_B2B":
    case "HIGH_TICKET_B2C":
    default:
      return "BOOK";
  }
}

/**
 * The lead status an opportunity outcome projects. OPEN projects nothing: an
 * open opportunity leaves the lead's funnel status alone.
 */
export function leadStatusFor(outcome: OpportunityOutcome): "WON" | "LOST" | null {
  return outcome === "WON" ? "WON" : outcome === "LOST" ? "LOST" : null;
}

/* ------------------------------------------------------------------ CRMs */

/**
 * HubSpot's default sales pipeline stage ids. These are HubSpot's
 * internal names for the stages every portal is created with
 * (pipeline id `default`). A portal that renamed or deleted them rejects the
 * value; the adapter then retries without a stage rather than failing the
 * push (see hubspot.ts).
 */
export function hubspotDealStage(stage: string, outcome: string): string {
  if (outcome === "WON") return "closedwon";
  if (outcome === "LOST") return "closedlost";
  switch (stage) {
    case "MEETING_BOOKED":
      return "appointmentscheduled";
    case "PROPOSAL":
      return "presentationscheduled";
    case "CHECKOUT_SENT":
      return "contractsent";
    case "NEGOTIATION":
      return "decisionmakerboughtin";
    case "QUALIFIED":
    case "QUALIFYING":
    case "OPEN":
    default:
      return "qualifiedtobuy";
  }
}

/** One row of Salesforce's `OpportunityStage` object. */
export type SalesforceStage = {
  label: string;
  isClosed: boolean;
  isWon: boolean;
  sortOrder: number;
};

/**
 * Picks a StageName from the org's own active stages.
 *
 * Salesforce's StageName picklist is customised per org, so nothing is
 * guessed: WON takes the first won stage, LOST the first closed-not-won stage,
 * and an open stage maps by its position in our forward order onto the org's
 * open stages (label matches for proposal/negotiation win when present).
 * Returns null when the org has no suitable stage, which the adapter reports
 * rather than sending an invalid value.
 */
export function salesforceStageName(
  stage: string,
  outcome: string,
  stages: SalesforceStage[],
): string | null {
  const sorted = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  if (outcome === "WON") return sorted.find((s) => s.isClosed && s.isWon)?.label ?? null;
  if (outcome === "LOST") return sorted.find((s) => s.isClosed && !s.isWon)?.label ?? null;

  const open = sorted.filter((s) => !s.isClosed);
  if (open.length === 0) return null;

  const byLabel = (pattern: RegExp) => open.find((s) => pattern.test(s.label))?.label ?? null;
  if (stage === "PROPOSAL" || stage === "CHECKOUT_SENT") {
    const match = byLabel(/proposal|quote|price/i);
    if (match) return match;
  }
  if (stage === "NEGOTIATION") {
    const match = byLabel(/negotiat|review/i);
    if (match) return match;
  }

  // Positional fallback: OPEN/QUALIFYING -> first, QUALIFIED -> second,
  // MEETING_BOOKED -> third, later stages -> further along, capped.
  const position: Record<string, number> = {
    OPEN: 0,
    QUALIFYING: 0,
    QUALIFIED: 1,
    MEETING_BOOKED: 2,
    PROPOSAL: 3,
    CHECKOUT_SENT: 4,
    NEGOTIATION: 5,
  };
  const index = Math.min(position[stage] ?? 0, open.length - 1);
  return open[index].label;
}

/** An opportunity as handed to a CRM adapter. */
export type CrmOpportunity = {
  id: string;
  name: string;
  stage: string;
  outcome: string;
  outcomeReason: string | null;
  value: number | null;
  currency: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
};

/** Salesforce requires a CloseDate on every Opportunity. */
export function salesforceCloseDate(opportunity: CrmOpportunity, now: Date = new Date()): string {
  if (opportunity.closedAt) return opportunity.closedAt.slice(0, 10);
  if (opportunity.expectedCloseDate) return opportunity.expectedCloseDate.slice(0, 10);
  const inThirtyDays = new Date(now.getTime() + 30 * 86_400_000);
  return inThirtyDays.toISOString().slice(0, 10);
}
