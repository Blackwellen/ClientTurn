/**
 * Discount policy: may this proposed discount go out, need a person's
 * approval, or not happen at all? Deterministic; the model only proposes a
 * figure (produced by calculateQuote), this decides.
 *
 * Rules, in order:
 *   1. No discount -> ALLOW.
 *   2. Margin floor: below the floor the AI is DENIED; a person needs owner
 *      approval (an owner proposing it is allowed). With a floor set and the
 *      cost unknown, the AI is denied: it may not discount blind.
 *   3. AI only:
 *      - restraint NEVER -> DENY; ONLY_AFTER_OBJECTION before the lead has
 *        objected on price -> DENY; PROACTIVE -> may offer unprompted.
 *      - The two-step rule (docs/AGENT_RUNTIME.md, owner decision
 *        2026-09-27): the AI's FIRST concession is small (at most
 *        `firstConcessionMaxBps`, itself at most the AI maximum); a SECOND
 *        concession is never the AI's to make -> REQUIRE_APPROVAL (the
 *        conversation is escalated to a person).
 *      - Above the AI maximum (% or amount) -> DENY, with the largest
 *        discount the AI could offer instead.
 *   4. Approval thresholds (value, discount %, discount amount, margin):
 *      the highest role any matching rule names is required. A person whose
 *      role meets it is allowed; the AI always goes to approval.
 *   5. Otherwise ALLOW.
 *
 * Percentages are compared exactly in integer arithmetic (discount x 10 000
 * against max x base), never through a rounded percentage.
 */

import { z } from "zod";
import type { CommercialAuthority } from "../commercial/authority.ts";
import type { AiAuthority } from "../commercial/ai-permissions.ts";
import { bpsSchema, minorSchema } from "../catalogue/types.ts";
import { mulDivFloor, ratioBps } from "./money.ts";

export const RESTRAINT_MODES = ["NEVER", "ONLY_AFTER_OBJECTION", "PROACTIVE"] as const;
export type RestraintMode = (typeof RESTRAINT_MODES)[number];

/** Workspace roles (team/rules.ts), lowest to highest. */
export const WORKSPACE_ROLES = ["viewer", "member", "admin", "owner"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const APPROVER_ROLES = ["admin", "owner"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export function roleRank(role: WorkspaceRole): number {
  return WORKSPACE_ROLES.indexOf(role);
}

export const approvalRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    /** The rule matches when ANY of its set conditions holds. */
    discountAboveBps: bpsSchema.optional(),
    discountAboveMinor: minorSchema.optional(),
    valueAboveMinor: minorSchema.optional(),
    marginBelowBps: z.number().int().min(-10_000).max(10_000).optional(),
    role: z.enum(APPROVER_ROLES),
  })
  .refine(
    (rule) =>
      rule.discountAboveBps !== undefined ||
      rule.discountAboveMinor !== undefined ||
      rule.valueAboveMinor !== undefined ||
      rule.marginBelowBps !== undefined,
    "An approval rule needs at least one condition.",
  );
export type ApprovalRule = z.infer<typeof approvalRuleSchema>;

export const discountPolicySchema = z
  .object({
    restraint: z.enum(RESTRAINT_MODES).default("NEVER"),
    /** The most the AI may take off, as a percentage of the discounted base. */
    aiMaxBps: bpsSchema.default(0),
    /** The most the AI may take off in money. null = no amount cap. */
    aiMaxMinor: minorSchema.nullable().default(null),
    /** The AI's first concession cap. null = the AI maximum. */
    firstConcessionMaxBps: bpsSchema.nullable().default(null),
    /** Minimum margin after discount. null = no floor. */
    marginFloorBps: z.number().int().min(-10_000).max(10_000).nullable().default(null),
    approvalRules: z.array(approvalRuleSchema).max(20).default([]),
  })
  .superRefine((policy, ctx) => {
    if (policy.firstConcessionMaxBps !== null && policy.firstConcessionMaxBps > policy.aiMaxBps) {
      ctx.addIssue({
        code: "custom",
        path: ["firstConcessionMaxBps"],
        message: "The first concession cannot be larger than the AI maximum.",
      });
    }
  });
export type DiscountPolicy = z.infer<typeof discountPolicySchema>;
export type DiscountPolicyInput = z.input<typeof discountPolicySchema>;

export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = discountPolicySchema.parse({});

/**
 * Bridge from today's commercial_authority row (0125): its
 * `max_discount_percent` becomes the AI maximum (after an objection only,
 * matching the current two-step discount answer) and its
 * `requires_human_above_value_minor` an admin approval threshold. A
 * disabled authority allows no AI discount.
 */
export function policyFromAuthority(authority: CommercialAuthority): DiscountPolicy {
  const maxBps = authority.enabled ? Math.max(0, Math.min(10_000, Math.round(authority.max_discount_percent * 100))) : 0;
  return discountPolicySchema.parse({
    restraint: maxBps > 0 ? "ONLY_AFTER_OBJECTION" : "NEVER",
    aiMaxBps: maxBps,
    approvalRules:
      authority.requires_human_above_value_minor !== null
        ? [{ id: "authority-value-ceiling", valueAboveMinor: authority.requires_human_above_value_minor, role: "admin" }]
        : [],
  });
}

/**
 * The policy the ASSISTANT is held to (brief §74, commercial authority v2):
 * the workspace's quote policy (quote_settings.discount_policy: its approval
 * rules and margin floor bind everyone) plus what the owner lets the AI do
 * (ai-permissions.ts), which is the one source of the AI's own limits:
 *
 *   restraint      the AI setting; NEVER when the "Offer discounts" switch is off
 *   aiMaxBps       the AI maximum percent
 *   aiMaxMinor     the AI money cap
 *   first step     the AI first concession, capped at the maximum
 *   margin floor   the higher of the two floors
 *   approvals      the quote policy's rules plus the AI thresholds (percent,
 *                  amount, value) and the v1 "a person above this value" ceiling,
 *                  each needing the role the owner chose
 *
 * Pure; `evaluateDiscount` then decides every proposal with it.
 */
export function aiDiscountPolicy(
  base: DiscountPolicy | DiscountPolicyInput,
  ai: AiAuthority,
  legacy: { requiresHumanAboveValueMinor?: number | null } = {},
): DiscountPolicy {
  const quote = discountPolicySchema.parse(base);
  const d = ai.discount;
  const allowed = ai.capabilities.discount === true && d.restraint !== "NEVER";
  const toBps = (percent: number) => Math.max(0, Math.min(10_000, Math.round(percent * 100)));
  const aiMaxBps = allowed ? toBps(d.maxPercent) : 0;
  const firstBps = d.firstConcessionPercent !== null ? Math.min(toBps(d.firstConcessionPercent), aiMaxBps) : null;
  const floors = [quote.marginFloorBps, d.marginFloorPercent !== null ? Math.round(d.marginFloorPercent * 100) : null].filter(
    (v): v is number => v !== null,
  );
  const rules: ApprovalRule[] = [...quote.approvalRules];
  if (d.approvalAbovePercent !== null) rules.push({ id: "ai-discount-percent", discountAboveBps: toBps(d.approvalAbovePercent), role: d.approvalRole });
  if (d.approvalAboveAmountMinor !== null) rules.push({ id: "ai-discount-amount", discountAboveMinor: d.approvalAboveAmountMinor, role: d.approvalRole });
  if (d.approvalAboveValueMinor !== null) rules.push({ id: "ai-quote-value", valueAboveMinor: d.approvalAboveValueMinor, role: d.approvalRole });
  if (legacy.requiresHumanAboveValueMinor != null) {
    rules.push({ id: "authority-value-ceiling", valueAboveMinor: legacy.requiresHumanAboveValueMinor, role: "admin" });
  }
  return discountPolicySchema.parse({
    restraint: allowed ? d.restraint : "NEVER",
    aiMaxBps,
    aiMaxMinor: allowed ? d.maxAmountMinor : null,
    firstConcessionMaxBps: allowed ? firstBps : null,
    marginFloorBps: floors.length > 0 ? Math.max(...floors) : null,
    approvalRules: rules.slice(0, 20),
  });
}

/** The assistant's policy for a workspace, from its quote policy and its commercial authority row. */
export function aiDiscountPolicyFromAuthority(base: DiscountPolicy | DiscountPolicyInput, authority: CommercialAuthority, ai: AiAuthority): DiscountPolicy {
  return aiDiscountPolicy(base, ai, { requiresHumanAboveValueMinor: authority.requires_human_above_value_minor });
}

export type DiscountActor = { kind: "AI" } | { kind: "HUMAN"; role: WorkspaceRole };

export type DiscountProposal = {
  actor: DiscountActor;
  /** The amount the discount is taken from (the discounted base before this discount). */
  baseMinor: number;
  /** The proposed discount amount, from calculateQuote. */
  discountMinor: number;
  /** The deal value after the discount, for value thresholds. */
  valueAfterMinor: number;
  /** Margin after the discount (calculateQuote margin.marginBps); null when cost unknown. */
  marginAfterBps: number | null;
  /** The lead has raised a price objection in this conversation. */
  afterObjection: boolean;
  /** Discount concessions the AI has already made on this quote / opportunity. */
  priorAiConcessions: number;
};

export type DiscountDecisionReason =
  | "NO_DISCOUNT"
  | "WITHIN_POLICY"
  | "WITHIN_APPROVER_AUTHORITY"
  | "INVALID_DISCOUNT"
  | "MARGIN_FLOOR"
  | "MARGIN_UNKNOWN"
  | "RESTRAINT_NEVER"
  | "NO_OBJECTION_YET"
  | "TWO_STEP_ESCALATION"
  | "ABOVE_AI_MAX_PERCENT"
  | "ABOVE_AI_MAX_AMOUNT"
  | "FIRST_CONCESSION_TOO_LARGE"
  | "APPROVAL_THRESHOLD";

export type DiscountDecision =
  | { outcome: "ALLOW"; reason: DiscountDecisionReason; detail: string; discountBps: number | null }
  | {
      outcome: "REQUIRE_APPROVAL";
      role: ApproverRole;
      reason: DiscountDecisionReason;
      detail: string;
      discountBps: number | null;
      matchedRuleIds: string[];
    }
  | {
      outcome: "DENY";
      reason: DiscountDecisionReason;
      detail: string;
      discountBps: number | null;
      /** The largest discount the AI could offer instead, when there is one. */
      maxAllowedMinor: number | null;
    };

/** discount / base > bps / 10 000, exactly. */
function exceedsBps(discountMinor: number, baseMinor: number, bps: number): boolean {
  return BigInt(discountMinor) * BigInt(10_000) > BigInt(bps) * BigInt(baseMinor);
}

function higher(a: ApproverRole | null, b: ApproverRole): ApproverRole {
  if (a === null) return b;
  return APPROVER_ROLES.indexOf(b) > APPROVER_ROLES.indexOf(a) ? b : a;
}

export function evaluateDiscount(policyInput: DiscountPolicy | DiscountPolicyInput, proposal: DiscountProposal): DiscountDecision {
  const policy = discountPolicySchema.parse(policyInput);
  const { discountMinor, baseMinor, actor } = proposal;
  if (!Number.isSafeInteger(discountMinor) || !Number.isSafeInteger(baseMinor) || discountMinor < 0 || baseMinor < 0 || discountMinor > baseMinor) {
    return { outcome: "DENY", reason: "INVALID_DISCOUNT", detail: "The discount must be a whole amount between zero and the base.", discountBps: null, maxAllowedMinor: null };
  }
  const discountBps = baseMinor > 0 ? ratioBps(discountMinor, baseMinor) : null;
  if (discountMinor === 0) {
    return { outcome: "ALLOW", reason: "NO_DISCOUNT", detail: "No discount proposed.", discountBps: 0 };
  }

  const isAi = actor.kind === "AI";
  const humanRole = actor.kind === "HUMAN" ? actor.role : null;

  // 2. Margin floor.
  if (policy.marginFloorBps !== null) {
    if (proposal.marginAfterBps === null) {
      if (isAi) {
        return {
          outcome: "DENY",
          reason: "MARGIN_UNKNOWN",
          detail: "A margin floor is set and this quote has no cost price, so the assistant may not discount it.",
          discountBps,
          maxAllowedMinor: null,
        };
      }
    } else if (proposal.marginAfterBps < policy.marginFloorBps) {
      if (isAi) {
        return { outcome: "DENY", reason: "MARGIN_FLOOR", detail: "The discount takes the margin below the workspace floor.", discountBps, maxAllowedMinor: null };
      }
      if (humanRole !== "owner") {
        return {
          outcome: "REQUIRE_APPROVAL",
          role: "owner",
          reason: "MARGIN_FLOOR",
          detail: "Below the margin floor: the owner must approve.",
          discountBps,
          matchedRuleIds: [],
        };
      }
    }
  }

  // 3. The assistant's own limits.
  if (isAi) {
    if (policy.restraint === "NEVER") {
      return { outcome: "DENY", reason: "RESTRAINT_NEVER", detail: "This workspace does not let the assistant offer discounts.", discountBps, maxAllowedMinor: 0 };
    }
    if (policy.restraint === "ONLY_AFTER_OBJECTION" && !proposal.afterObjection) {
      return {
        outcome: "DENY",
        reason: "NO_OBJECTION_YET",
        detail: "The assistant may discount only after the lead has objected on price.",
        discountBps,
        maxAllowedMinor: 0,
      };
    }
    if (proposal.priorAiConcessions >= 1) {
      let role: ApproverRole = "admin";
      for (const rule of policy.approvalRules) role = higher(role, rule.role);
      return {
        outcome: "REQUIRE_APPROVAL",
        role,
        reason: "TWO_STEP_ESCALATION",
        detail: "The assistant has already made its one concession; a further discount goes to a person.",
        discountBps,
        matchedRuleIds: [],
      };
    }
    const firstStepBps = policy.firstConcessionMaxBps ?? policy.aiMaxBps;
    let cap = mulDivFloor(baseMinor, firstStepBps, 10_000);
    if (policy.aiMaxMinor !== null) cap = Math.min(cap, policy.aiMaxMinor);
    if (exceedsBps(discountMinor, baseMinor, policy.aiMaxBps)) {
      return { outcome: "DENY", reason: "ABOVE_AI_MAX_PERCENT", detail: "Above the most the assistant may take off.", discountBps, maxAllowedMinor: cap };
    }
    if (policy.aiMaxMinor !== null && discountMinor > policy.aiMaxMinor) {
      return { outcome: "DENY", reason: "ABOVE_AI_MAX_AMOUNT", detail: "Above the most money the assistant may take off.", discountBps, maxAllowedMinor: cap };
    }
    if (exceedsBps(discountMinor, baseMinor, firstStepBps)) {
      return {
        outcome: "DENY",
        reason: "FIRST_CONCESSION_TOO_LARGE",
        detail: "The assistant's first concession must be small; offer the smaller step first.",
        discountBps,
        maxAllowedMinor: cap,
      };
    }
  }

  // 4. Approval thresholds.
  let required: ApproverRole | null = null;
  const matched: string[] = [];
  for (const rule of policy.approvalRules) {
    const hit =
      (rule.discountAboveBps !== undefined && exceedsBps(discountMinor, baseMinor, rule.discountAboveBps)) ||
      (rule.discountAboveMinor !== undefined && discountMinor > rule.discountAboveMinor) ||
      (rule.valueAboveMinor !== undefined && proposal.valueAfterMinor > rule.valueAboveMinor) ||
      (rule.marginBelowBps !== undefined && proposal.marginAfterBps !== null && proposal.marginAfterBps < rule.marginBelowBps);
    if (hit) {
      matched.push(rule.id);
      required = higher(required, rule.role);
    }
  }
  if (required !== null) {
    if (humanRole !== null && roleRank(humanRole) >= roleRank(required)) {
      return { outcome: "ALLOW", reason: "WITHIN_APPROVER_AUTHORITY", detail: `Approved by the proposer's ${humanRole} role.`, discountBps };
    }
    return {
      outcome: "REQUIRE_APPROVAL",
      role: required,
      reason: "APPROVAL_THRESHOLD",
      detail: `Needs ${required} approval (${matched.join(", ")}).`,
      discountBps,
      matchedRuleIds: matched,
    };
  }
  return { outcome: "ALLOW", reason: "WITHIN_POLICY", detail: "Within the workspace discount policy.", discountBps };
}
