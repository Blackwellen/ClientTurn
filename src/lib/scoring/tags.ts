/**
 * Automatic lead tags (design doc 04 §2 "Auto-tags", brief §20).
 *
 * Tags are derived, never typed in: each rule below has a stated condition, a
 * reason sentence and a confidence, and the whole set is versioned by
 * TAG_RULE_VERSION so a tag on a lead can be traced to the rule that set it.
 * The service layer diffs the derived set against the lead's current tags,
 * setting new ones and clearing ones whose condition no longer holds.
 *
 * Inputs are the score result, the lifecycle state and the reply
 * classifications (the canonical `messages.reply_classification` vocabulary,
 * migration 0115). No text, no personal data.
 *
 * Pure module.
 */

import { dimensionRatio, evidenceValue, type LeadScoreResult } from "./lead-score.ts";

export const TAG_RULE_VERSION = "lt-v1.2026.09";

export const LEAD_TAGS = [
  "HOT",
  "HIGH_FIT",
  "POOR_FIT",
  "HIGH_INTENT",
  "BUDGET_CONFIRMED",
  "DECISION_MAKER",
  "ENTERPRISE_POTENTIAL",
  "NURTURE",
  "NOT_NOW",
  "BOOKED",
  "NO_SHOW",
  "GONE_QUIET",
  "NEEDS_HUMAN",
  "WRONG_PERSON",
  "NEEDS_INFO",
  "OPTED_OUT",
] as const;
export type LeadTag = (typeof LEAD_TAGS)[number];

export type TagLifecycle = {
  status: string | null;
  optedOut: boolean;
  humanTakeover: boolean;
  /** Latest booking status (bookings.status), if any. */
  latestBookingStatus: "scheduled" | "completed" | "cancelled" | "no_show" | null;
  /** Start of the latest scheduled booking, ISO. */
  latestBookingStartsAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

export type TagContext = {
  score: LeadScoreResult;
  lifecycle: TagLifecycle;
  /** Newest first. */
  replyClassifications: string[];
  now: Date;
};

export type DerivedTag = {
  tag: LeadTag;
  reason: string;
  confidence: number;
  ruleVersion: string;
};

type Rule = {
  tag: LeadTag;
  /** The condition, in words, for reviewers and the audit trail. */
  condition: string;
  evaluate: (ctx: TagContext) => { reason: string; confidence: number } | null;
};

const DAY_MS = 86_400_000;
const GONE_QUIET_DAYS = 7;
const CLOSED_STATUSES = new Set(["WON", "LOST"]);

function daysBetween(fromIso: string, to: Date): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return (to.getTime() - from) / DAY_MS;
}

function dimensionConfidence(ctx: TagContext, dimension: LeadScoreResult["dimensions"][number]["dimension"]) {
  return ctx.score.dimensions.find((d) => d.dimension === dimension)?.confidence ?? 0;
}

export const TAG_RULES: Rule[] = [
  {
    tag: "OPTED_OUT",
    condition: "The lead has opted out.",
    evaluate: (ctx) => (ctx.lifecycle.optedOut ? { reason: "Opted out of contact.", confidence: 1 } : null),
  },
  {
    tag: "HOT",
    condition: "Grade A and intent at least 60% of its weight, and not opted out.",
    evaluate: (ctx) =>
      !ctx.lifecycle.optedOut && ctx.score.grade === "A" && dimensionRatio(ctx.score, "INTENT") >= 0.6
        ? { reason: `Grade A (${Math.round(ctx.score.total)}) with strong intent.`, confidence: ctx.score.confidence }
        : null,
  },
  {
    tag: "HIGH_FIT",
    condition: "Fit at least 80% of its weight, with fit confidence at least 0.5.",
    evaluate: (ctx) =>
      dimensionRatio(ctx.score, "FIT") >= 0.8 && dimensionConfidence(ctx, "FIT") >= 0.5
        ? { reason: "Matches the ideal customer profile closely.", confidence: dimensionConfidence(ctx, "FIT") }
        : null,
  },
  {
    tag: "POOR_FIT",
    condition: "Fit below 30% of its weight, with fit confidence at least 0.6.",
    evaluate: (ctx) =>
      dimensionRatio(ctx.score, "FIT") < 0.3 && dimensionConfidence(ctx, "FIT") >= 0.6
        ? { reason: "Known details do not match the ideal customer profile.", confidence: dimensionConfidence(ctx, "FIT") }
        : null,
  },
  {
    tag: "HIGH_INTENT",
    condition: "Intent at least 80% of its weight.",
    evaluate: (ctx) =>
      !ctx.lifecycle.optedOut && dimensionRatio(ctx.score, "INTENT") >= 0.8
        ? { reason: "Strong buying signal.", confidence: dimensionConfidence(ctx, "INTENT") }
        : null,
  },
  {
    tag: "BUDGET_CONFIRMED",
    condition: "A budget_confirmed fact is true.",
    evaluate: (ctx) =>
      evidenceValue(ctx.score, "budget_confirmed") === true
        ? { reason: "Budget confirmed.", confidence: dimensionConfidence(ctx, "COMMERCIAL") }
        : null,
  },
  {
    tag: "DECISION_MAKER",
    condition: "Role authority is DECISION_MAKER, or decision authority was confirmed.",
    evaluate: (ctx) =>
      evidenceValue(ctx.score, "role_authority") === "DECISION_MAKER" ||
      evidenceValue(ctx.score, "authority_confirmed") === true
        ? { reason: "Talking to the person who decides.", confidence: dimensionConfidence(ctx, "DECISION_ACCESS") }
        : null,
  },
  {
    tag: "ENTERPRISE_POTENTIAL",
    condition: "Three or more stakeholders known, or estimated value at least £50,000.",
    evaluate: (ctx) => {
      const stakeholders = evidenceValue(ctx.score, "stakeholder_count");
      const value = evidenceValue(ctx.score, "estimated_value_gbp");
      if (typeof stakeholders === "number" && stakeholders >= 3) {
        return { reason: `${stakeholders} stakeholders involved.`, confidence: 0.8 };
      }
      if (typeof value === "number" && value >= 50_000) {
        return { reason: "Estimated value in the enterprise range.", confidence: 0.7 };
      }
      return null;
    },
  },
  {
    tag: "NURTURE",
    condition: "Fit at least 60% but timing below 40%, not booked, not closed, not opted out.",
    evaluate: (ctx) =>
      !ctx.lifecycle.optedOut &&
      !CLOSED_STATUSES.has(ctx.lifecycle.status ?? "") &&
      ctx.lifecycle.latestBookingStatus !== "scheduled" &&
      dimensionRatio(ctx.score, "FIT") >= 0.6 &&
      dimensionRatio(ctx.score, "TIMING") < 0.4
        ? { reason: "Good fit, but not ready yet.", confidence: Math.min(dimensionConfidence(ctx, "FIT"), 0.8) }
        : null,
  },
  {
    tag: "NOT_NOW",
    condition: "The latest reply was classified NOT_NOW.",
    evaluate: (ctx) =>
      ctx.replyClassifications[0] === "NOT_NOW" ? { reason: "Asked to be contacted later.", confidence: 0.9 } : null,
  },
  {
    tag: "BOOKED",
    condition: "The latest booking is scheduled.",
    evaluate: (ctx) =>
      ctx.lifecycle.latestBookingStatus === "scheduled"
        ? { reason: "Has a booking scheduled.", confidence: 1 }
        : null,
  },
  {
    tag: "NO_SHOW",
    condition: "The latest booking is marked no_show.",
    evaluate: (ctx) =>
      ctx.lifecycle.latestBookingStatus === "no_show" ? { reason: "Missed their last booking.", confidence: 1 } : null,
  },
  {
    tag: "GONE_QUIET",
    condition: `Replied before, our last message is newer than theirs and at least ${GONE_QUIET_DAYS} days old; not booked, closed or opted out.`,
    evaluate: (ctx) => {
      const { lastInboundAt, lastOutboundAt, optedOut, latestBookingStatus, status } = ctx.lifecycle;
      if (!lastInboundAt || !lastOutboundAt || optedOut) return null;
      if (latestBookingStatus === "scheduled" || CLOSED_STATUSES.has(status ?? "")) return null;
      if (Date.parse(lastOutboundAt) <= Date.parse(lastInboundAt)) return null;
      const days = daysBetween(lastOutboundAt, ctx.now);
      return days >= GONE_QUIET_DAYS
        ? { reason: `No reply for ${Math.floor(days)} days after our last message.`, confidence: 0.9 }
        : null;
    },
  },
  {
    tag: "NEEDS_HUMAN",
    condition: "Human takeover is on, or the latest reply asked for a person or complained.",
    evaluate: (ctx) => {
      if (ctx.lifecycle.humanTakeover) return { reason: "A person has taken over.", confidence: 1 };
      const latest = ctx.replyClassifications[0];
      if (latest === "HUMAN_REQUEST") return { reason: "Asked to speak to a person.", confidence: 0.9 };
      if (latest === "COMPLAINT") return { reason: "Complained.", confidence: 0.9 };
      return null;
    },
  },
  {
    tag: "WRONG_PERSON",
    condition: "The latest reply was WRONG_PERSON or REFERRAL_TO_OTHER_PERSON.",
    evaluate: (ctx) => {
      const latest = ctx.replyClassifications[0];
      return latest === "WRONG_PERSON" || latest === "REFERRAL_TO_OTHER_PERSON"
        ? { reason: "Said we have the wrong person.", confidence: 0.85 }
        : null;
    },
  },
  {
    tag: "NEEDS_INFO",
    condition: "Overall score confidence below 0.35.",
    evaluate: (ctx) =>
      ctx.score.confidence < 0.35
        ? { reason: "Too little is known to score this lead reliably.", confidence: 1 - ctx.score.confidence }
        : null,
  },
];

/** Deterministic: the same context always yields the same tags, in rule order. */
export function deriveTags(ctx: TagContext): DerivedTag[] {
  const out: DerivedTag[] = [];
  for (const rule of TAG_RULES) {
    const result = rule.evaluate(ctx);
    if (result) {
      out.push({
        tag: rule.tag,
        reason: result.reason,
        confidence: Math.round(Math.min(1, Math.max(0, result.confidence)) * 1000) / 1000,
        ruleVersion: TAG_RULE_VERSION,
      });
    }
  }
  return out;
}
