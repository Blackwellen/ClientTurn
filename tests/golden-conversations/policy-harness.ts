/**
 * The hand-over policy harness (owner decision 2026-09-27: human hand-over is
 * the last resort). Pure.
 *
 * Drives a multi-turn conversation through the same three policy stages the
 * orchestrator runs, in the same order (src/lib/agent/handover-policy.ts):
 *
 *   policyOnMessage   the lead's words: a binding verdict, a data-rights
 *                     request, a discount outside policy, a legal or contract
 *                     objection (HANDOVER) or a specialist one (assist);
 *   policyOnAnswer    the reply against the configured question and the
 *                     deterministic verdict: clarify an unusable answer, flag
 *                     a REVIEW for a person and carry on;
 *   policyOnDecision  the model's proposal: an unreadable reply is clarified,
 *                     a hand-over request that is not a last resort becomes a
 *                     background assist.
 *
 * The clarification chain is threaded across turns exactly as the
 * orchestrator threads it through `decision_json.clarification`: a turn that
 * is not a clarification resets it.
 */

import {
  clarifyingQuestion,
  policyOnAnswer,
  policyOnDecision,
  policyOnMessage,
  type ClarificationState,
  type PolicyDecision,
} from "../../src/lib/agent/handover-policy.ts";
import { classifyDeterministic, classifyHeuristic, isBotQuestion } from "../../src/lib/agent/classification.ts";
import { matchObjection } from "../../src/lib/sales-library/objections.ts";
import { validateResponse, type ValidationResult } from "../../src/lib/agent/validate.ts";
import type { AgentRiskTolerance, HandoverReason, ProposedAction } from "../../src/lib/agent/types.ts";
import type { QualificationResult } from "../../src/lib/qualification/engine.ts";

export type PolicyTurn = {
  lead: string;
  /** The reply read against the conversation's configured question. */
  answer?: { matched: boolean };
  verdict?: { result: QualificationResult; reasons?: { code: string; onQuestion?: boolean }[] };
  model?: {
    proposed_action: ProposedAction;
    confidence: number;
    handover_reason?: HandoverReason | null;
    message?: string | null;
  };
  expect: {
    disposition: PolicyDecision["kind"];
    /** What the code did before the owner's decision, for the report. */
    was?: "HANDOVER" | "CONTINUE";
    trigger?: string;
    reason?: string;
    assist?: string | null;
    attempt?: number;
    validates?: boolean;
    textIncludes?: string[];
    /** "Are you a bot?": answered honestly, the conversation carries on. */
    disclose?: boolean;
    /** A discount ask this turn: whether it was within the approved maximum. */
    discountWithinPolicy?: boolean;
  };
};

export type PolicyConversation = {
  id: string;
  story: string;
  question?: { text: string; responseType: "single_choice" | "yes_no" | "number" | "timing" | "text"; options: string[] };
  settings?: {
    handoverOnReview?: boolean;
    riskTolerance?: AgentRiskTolerance;
    commercial?: { enabled: boolean; maxDiscountPercent: number };
    publishedPriceText?: string[];
  };
  turns: PolicyTurn[];
};

export type PolicyRow = {
  turn: number;
  lead: string;
  decision: PolicyDecision;
  /** Which stage decided (the first that did not simply continue). */
  stage: "MESSAGE" | "ANSWER" | "DECISION" | "NONE";
  /** The fixed clarifying question sent, when the decision is CLARIFY. */
  clarifyText: string | null;
  /** The model's draft through the outbound validator, when one is sent. */
  validation: ValidationResult | null;
  /** What stage 1 saw in the lead's words (policyOnMessage CONTINUE extras). */
  disclose: boolean;
  discountWithinPolicy: boolean | null;
};

const QUESTION_ID = "44444444-4444-4444-8444-444444444444";

/** The turn runs in OBJECTION_HANDLING mode (lifecycle.ts resolveMode). */
function objectionMode(text: string): boolean {
  const intent = classifyHeuristic(text)?.intent;
  return intent === "OBJECTION" || intent === "NOT_INTERESTED";
}

export function runPolicyConversation(conversation: PolicyConversation): PolicyRow[] {
  const rows: PolicyRow[] = [];
  let clarification: ClarificationState = null;
  // The previous turn answered an out-of-policy discount ask (the orchestrator's decision_json.discountDemand).
  let discountDemand = false;
  const settings = conversation.settings ?? {};

  for (const [index, turn] of conversation.turns.entries()) {
    let assist: PolicyDecision | null = null;
    let extras = { disclose: false, discountWithinPolicy: null as boolean | null };
    const finish = (decision: PolicyDecision, stage: PolicyRow["stage"], validation: ValidationResult | null = null) => {
      const clarifyText =
        decision.kind === "CLARIFY"
          ? clarifyingQuestion({
              question:
                decision.point === "reply" || !conversation.question
                  ? null
                  : {
                      questionText: conversation.question.text,
                      responseType: conversation.question.responseType,
                      options: conversation.question.options.map((label) => ({ label, value: label })),
                    },
              attempt: decision.attempt,
              firstName: null,
            })
          : null;
      clarification = decision.kind === "CLARIFY" ? { point: decision.point, attempt: decision.attempt } : null;
      discountDemand = extras.discountWithinPolicy === false;
      rows.push({ turn: index + 1, lead: turn.lead, decision, stage, clarifyText, validation, ...extras });
    };

    // 1. The lead's words.
    const onMessage = policyOnMessage({
      text: turn.lead,
      bindingIntent: classifyDeterministic(turn.lead)?.intent ?? null,
      // As in the orchestrator: objection playbooks are matched only when the
      // turn is handling an objection (lifecycle.ts resolveMode), so "our
      // contract ends in March" is never read as a contract question.
      objectionKeys: objectionMode(turn.lead) ? matchObjection(turn.lead).map((m) => m.key) : [],
      commercial: settings.commercial ?? null,
      previousDiscountDemand: discountDemand,
      botQuestion: isBotQuestion(turn.lead),
    });
    if (onMessage.kind === "CONTINUE") {
      extras = { disclose: onMessage.disclose === true, discountWithinPolicy: onMessage.discount ? onMessage.discount.withinPolicy : null };
    }
    if (onMessage.kind !== "CONTINUE") {
      finish(onMessage, "MESSAGE");
      if (onMessage.kind === "HANDOVER") break;
      continue;
    }
    if (onMessage.assist) assist = onMessage;

    // 2. The answer and the deterministic verdict.
    const onAnswer = policyOnAnswer({
      text: turn.lead,
      answer:
        turn.answer && conversation.question
          ? { questionId: QUESTION_ID, matched: turn.answer.matched, structured: conversation.question.responseType !== "text" }
          : null,
      verdict: turn.verdict
        ? {
            result: turn.verdict.result,
            reasons: (turn.verdict.reasons ?? []).map((r) => ({ code: r.code, questionId: r.onQuestion ? QUESTION_ID : undefined })),
          }
        : null,
      handoverOnReview: settings.handoverOnReview ?? false,
      previousClarification: clarification,
    });
    if (onAnswer.kind !== "CONTINUE") {
      finish(onAnswer, "ANSWER");
      if (onAnswer.kind === "HANDOVER") break;
      continue;
    }
    if (onAnswer.assist && !assist) assist = onAnswer;

    // 3. The model's proposal.
    if (turn.model) {
      const onDecision = policyOnDecision({
        proposedAction: turn.model.proposed_action,
        handoverReason: turn.model.handover_reason ?? null,
        confidence: turn.model.confidence,
        riskTolerance: settings.riskTolerance ?? null,
        previousClarification: clarification,
      });
      if (onDecision.kind !== "CONTINUE") {
        finish(onDecision, "DECISION");
        if (onDecision.kind === "HANDOVER") break;
        continue;
      }
      if (onDecision.assist && !assist) assist = onDecision;
      const message = turn.model.message?.trim() ?? "";
      const validation = message
        ? validateResponse(message, {
            channel: "email",
            businessName: "Acme Studio",
            publishedPriceText: settings.publishedPriceText ?? [],
            confirmedSlots: [],
            bookingConfirmed: false,
            allowedUrls: [],
            serviceAreaConfirmed: false,
            commercial: settings.commercial ? { ...settings.commercial, checkoutLinks: [] } : null,
          })
        : null;
      finish(assist ?? onDecision, assist ? "DECISION" : "NONE", validation);
      continue;
    }

    finish(assist ?? { kind: "CONTINUE", assist: null, detail: null }, "NONE");
  }
  return rows;
}
