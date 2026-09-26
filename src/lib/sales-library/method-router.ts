/**
 * Method router (design doc 04 §4, brief §§36–39).
 *
 * Chooses the question-planning method for a conversation from structured
 * facts: motion, deal size, direction, stage, what is already known and how
 * many people are involved. The output is a *plan* handed to the model in the
 * strategy block, so the model is not left to invent its own sales approach.
 *
 * Evidence (01-evidence-register.md §7), stated once here and carried on every
 * decision:
 *   * SPIN, Challenger and MEDDPICC are sales *convention*, not science. They
 *     are used internally as question-planning heuristics and are never named
 *     to, or presented as proven to, a buyer or a customer.
 *   * TRANSACTIONAL, SIMPLE_QUALIFICATION and PLG are operational defaults:
 *     "ask the one relevant thing, then offer the next step".
 *   * NLP is not implemented in any form.
 *
 * Workspace preferences bias the choice but never override a hard rule: see
 * `eligibleMethods` and `chooseMethod`.
 *
 * Two hard rules, both tested:
 *   * MEDDPICC is only ever chosen for the ENTERPRISE motion. It is a checklist
 *     for multi-stakeholder deals; used on a £300 job it becomes interrogation.
 *   * CHALLENGER_INSIGHT is only chosen when the workspace has an approved
 *     insight or claim to teach with. Without one, "challenging" the buyer
 *     means making something up.
 *
 * Pure module.
 */

import { MOTIONS } from "./motions.ts";
import {
  LIBRARY_VERSION,
  type CloseTarget,
  type DealSizeBand,
  type EvidenceGrade,
  type QualificationDimensionKey,
  type SalesMethod,
  type SalesMotion,
} from "./types.ts";

export type ConversationStage =
  | "NEW"
  | "ENGAGED"
  | "QUALIFYING"
  | "OBJECTION"
  | "CLOSING"
  | "POST_BOOKING";

export type QuestionStyle =
  /** One plain question, no framing. */
  | "ONE_DIRECT_QUESTION"
  /** Situation first, then the problem it causes (SPIN order). */
  | "SITUATION_THEN_PROBLEM"
  /** Share one approved insight, then ask how it applies to them. */
  | "INSIGHT_THEN_QUESTION"
  /** Fill the next gap in the enterprise checklist. */
  | "CHECKLIST_GAP"
  /** Match to a product, then point at checkout. */
  | "PRODUCT_MATCH"
  /** Point at the product doing the work (trial, signup, a feature). */
  | "USAGE_LED";

export type MethodInput = {
  motion: SalesMotion;
  archetypeKey?: string | null;
  dealSizeBand: DealSizeBand;
  direction: "INBOUND" | "OUTBOUND";
  channel?: string | null;
  stage: ConversationStage;
  known?: QualificationDimensionKey[];
  /** People already identified on the buyer's side. */
  stakeholderCount?: number;
  /** True only if the workspace has at least one *approved* insight/claim. */
  hasApprovedInsight?: boolean;
  /**
   * The workspace's preferred methods (Settings -> AI & selling), in the order
   * chosen. A preference is honoured only where `eligibleMethods` allows it, so
   * it can never break the hard rules above.
   */
  preferredMethods?: readonly SalesMethod[];
};

export type MethodDecision = {
  method: SalesMethod;
  questionStyle: QuestionStyle;
  closeTarget: CloseTarget;
  /** Stored verbatim with the decision; plain English, no jargon for buyers. */
  reason: string;
  evidenceGrade: EvidenceGrade;
  libraryVersion: string;
};

export const METHOD_EVIDENCE: Record<SalesMethod, { grade: EvidenceGrade; note: string }> = {
  TRANSACTIONAL: {
    grade: "OPERATIONAL_DEFAULT",
    note: "Answer, match, and offer the next step. No persuasion theory involved.",
  },
  SIMPLE_QUALIFICATION: {
    grade: "OPERATIONAL_DEFAULT",
    note: "Ask the one question that unblocks the next step.",
  },
  PLG: {
    grade: "OPERATIONAL_DEFAULT",
    note: "Let the product demonstrate value; the conversation removes friction.",
  },
  SPIN: {
    grade: "SALES_CONVENTION_OBSERVATIONAL",
    note: "Huthwaite observational study, published commercially, not peer-reviewed. Internal question ordering only.",
  },
  CHALLENGER_INSIGHT: {
    grade: "SALES_CONVENTION",
    note: "CEB proprietary research, not peer-reviewed. Only with an approved, defensible insight.",
  },
  MEDDPICC: {
    grade: "SALES_CONVENTION",
    note: "Practitioner checklist (PTC, 1996), no peer-reviewed validation. A completeness checklist, not a predictor.",
  },
};

/**
 * Plain words for each method, for surfaces a person in the workspace reads
 * (the handoff brief, a CRM note). Never rendered to a buyer: the agent prompt
 * gets only the question style (strategy.ts STYLE_TEXT).
 */
export const METHOD_PLAIN_NAME: Record<SalesMethod, string> = {
  TRANSACTIONAL: "match the product, then point to checkout",
  SIMPLE_QUALIFICATION: "one direct qualifying question at a time",
  PLG: "product-led: point to a trial or signup",
  SPIN: "consultative discovery: their situation before the problem",
  CHALLENGER_INSIGHT: "insight-led: one approved point, then a question",
  MEDDPICC: "enterprise checklist: the problem, the people and the process",
};

const GRADE_PLAIN: Record<EvidenceGrade, string> = {
  OPERATIONAL_DEFAULT: "operational default, no persuasion theory",
  SALES_CONVENTION_OBSERVATIONAL: "sales convention from an observational study, not peer-reviewed",
  SALES_CONVENTION: "sales convention, not peer-reviewed",
};

/** "consultative discovery: … (sales convention …, not peer-reviewed)". */
export function internalApproachLabel(method: SalesMethod): string {
  return `${METHOD_PLAIN_NAME[method]} (${GRADE_PLAIN[METHOD_EVIDENCE[method].grade]})`;
}

const STYLE_FOR: Record<SalesMethod, QuestionStyle> = {
  TRANSACTIONAL: "PRODUCT_MATCH",
  SIMPLE_QUALIFICATION: "ONE_DIRECT_QUESTION",
  PLG: "USAGE_LED",
  SPIN: "SITUATION_THEN_PROBLEM",
  CHALLENGER_INSIGHT: "INSIGHT_THEN_QUESTION",
  MEDDPICC: "CHECKLIST_GAP",
};

const CONSIDERED_SALE: DealSizeBand[] = ["MID", "LARGE", "ENTERPRISE"];

function decision(input: MethodInput, method: SalesMethod, reason: string): MethodDecision {
  // An objection or a closing turn is always one direct thing, whatever the
  // method: the style narrows, the method (and its record) stays.
  const style: QuestionStyle =
    input.stage === "OBJECTION" || input.stage === "CLOSING" || input.stage === "POST_BOOKING"
      ? "ONE_DIRECT_QUESTION"
      : STYLE_FOR[method];
  return {
    method,
    questionStyle: style,
    closeTarget: MOTIONS[input.motion].closeTarget,
    reason,
    evidenceGrade: METHOD_EVIDENCE[method].grade,
    libraryVersion: LIBRARY_VERSION,
  };
}

/**
 * The methods a workspace preference may select for this input. The hard rules
 * live here: MEDDPICC only on ENTERPRISE, CHALLENGER_INSIGHT only with an
 * approved insight, PLG only self-serve, TRANSACTIONAL only ecommerce.
 */
export function eligibleMethods(input: MethodInput): SalesMethod[] {
  const insight: SalesMethod[] = input.hasApprovedInsight === true ? ["CHALLENGER_INSIGHT"] : [];
  switch (input.motion) {
    case "ENTERPRISE":
      return ["MEDDPICC", "SPIN", ...insight];
    case "SAAS_SELF_SERVE":
      return ["PLG", "SIMPLE_QUALIFICATION"];
    case "ECOMMERCE_DIRECT":
      return ["TRANSACTIONAL", "SIMPLE_QUALIFICATION"];
    case "LOCAL_SERVICE":
      return ["SIMPLE_QUALIFICATION"];
    case "HIGH_TICKET_B2C":
      return ["SIMPLE_QUALIFICATION", "SPIN"];
    case "BOOK_MEETING_B2B":
    case "DIRECT_B2B":
      return ["SIMPLE_QUALIFICATION", "SPIN", ...insight];
  }
}

/**
 * Deterministic: the same input always yields the same method. The default
 * policy (`defaultMethod`) runs first; a workspace preference then wins only
 * when the default is not already preferred and a preferred method is
 * eligible. Preferences are tried in the order the workspace listed them.
 */
export function chooseMethod(input: MethodInput): MethodDecision {
  const base = defaultMethod(input);
  const preferred = input.preferredMethods ?? [];
  if (preferred.length === 0 || preferred.includes(base.method)) return base;
  const eligible = eligibleMethods(input);
  const pick = preferred.find((method) => eligible.includes(method));
  if (!pick) {
    return {
      ...base,
      reason: `${base.reason} (The workspace's preferred approaches do not fit this motion, so the default applies.)`,
    };
  }
  return decision(input, pick, `Workspace preference, within the rules for this motion. Default would have been: ${base.reason}`);
}

/**
 * The default policy. The order of the checks is the policy; read it top to
 * bottom.
 */
function defaultMethod(input: MethodInput): MethodDecision {
  const stakeholders = Math.max(0, input.stakeholderCount ?? 0);

  switch (input.motion) {
    case "ENTERPRISE":
      return decision(
        input,
        "MEDDPICC",
        "Enterprise motion: several people decide, so the next question fills the biggest gap in what we know about the problem, the people and the process.",
      );
    case "SAAS_SELF_SERVE":
      return decision(input, "PLG", "Self-serve motion: point the buyer at a trial or signup once the use case fits.");
    case "ECOMMERCE_DIRECT":
      return decision(input, "TRANSACTIONAL", "Ecommerce motion: match the product, then checkout.");
    case "LOCAL_SERVICE":
    case "HIGH_TICKET_B2C":
      return decision(
        input,
        "SIMPLE_QUALIFICATION",
        input.motion === "LOCAL_SERVICE"
          ? "Local service: confirm the job, the location and the timing, then quote or visit."
          : "High-value consumer purchase: check suitability, then offer a consultation.",
      );
    case "BOOK_MEETING_B2B":
    case "DIRECT_B2B": {
      const early = input.stage === "NEW" || input.stage === "ENGAGED";
      if (input.direction === "OUTBOUND" && early && input.hasApprovedInsight === true) {
        return decision(
          input,
          "CHALLENGER_INSIGHT",
          "Outbound first contact with an approved insight available: lead with that insight, then ask how it applies.",
        );
      }
      if (CONSIDERED_SALE.includes(input.dealSizeBand) || stakeholders >= 3) {
        return decision(
          input,
          "SPIN",
          stakeholders >= 4 && (input.dealSizeBand === "LARGE" || input.dealSizeBand === "ENTERPRISE")
            ? "Considered B2B sale with several stakeholders: understand the situation before the problem. Consider switching this workspace to the enterprise motion."
            : "Considered B2B sale: understand the situation before the problem.",
        );
      }
      return decision(
        input,
        "SIMPLE_QUALIFICATION",
        "Smaller B2B sale: ask the one question that unblocks the next step.",
      );
    }
  }
}
