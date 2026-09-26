import "server-only";
import { isAzureConfigured, AiUnavailableError, type ChatMessage } from "./azure-client";
import { providerFor, targetFor } from "./providers";
import { checkSpend } from "./budget-service";
import { tierFromDecision, type SpendStage } from "./budget";
import type { DealSizeBand } from "@/lib/sales-library/types";
import type { LeadGrade } from "@/lib/scoring/lead-score";
import { getPrompt } from "./prompt-registry";
import { recordAiUsage } from "./usage-meter";
import {
  SCHEMAS,
  FAST_STRUCTURED_TASKS,
  confidenceBand,
  type TaskType,
  type ConfidenceBand,
} from "./schemas";
import { z } from "zod";
import {
  recordTokenConsumption,
  releaseTokenReservation,
  reserveTokenCapacity,
} from "@/lib/billing/token-service";
import { estimateTokensForCall } from "@/lib/billing/tokens";
import { addAgentRunUsage } from "@/lib/agent/audit";
import { billableTokens, resolveIdempotencyKey } from "./tokens";

export { AiUnavailableError, isAzureConfigured };

/**
 * Routing rule (§4): callers never pick a deployment directly. The tier comes
 * from the budget manager (budget.ts / budget-service.ts), which reads the task
 * routes in `ai_task_routes` (0122) and falls back to the original rule --
 * fast/structured tasks on nano, generation on mini -- when those tables are
 * empty. This is the one place that decision gets made, so it can't drift
 * task-by-task.
 */

export type RunTaskInput<T> = {
  taskType: TaskType;
  businessId: string;
  leadId?: string | null;
  conversationId?: string | null;
  automationRunId?: string | null;
  /** Task-specific context block, built by context-builder.ts. */
  context: string;
  /**
   * Per-workspace context that is identical from call to call (the agent's
   * offer card and voice, business facts). Sent BEFORE `context` in the user
   * message, directly after the static system prompt, so the provider's
   * prefix cache covers system prompt + stable block and only the volatile
   * lead/turn text is new on each call (brief §73).
   */
  stableContext?: string;
  maxOutputTokens?: number;
  /** Called if Azure is unavailable or every call fails; must not throw. */
  onUnavailable?: () => T;
  /**
   * Stable key for the token debit. A retried worker presents the same key and
   * is charged once. Takes precedence over `correlationId`.
   */
  idempotencyKey?: string;
  /**
   * An id the caller already has that is the same on every retry of THIS model
   * call (job id, inbound message id, prospect id + step). The debit key is
   * derived from (businessId, taskType, correlationId). If one job makes
   * several calls of the same task type, each needs its own correlation id.
   * With neither this nor `idempotencyKey`, the key is random and a retry is
   * charged again -- logged so the caller can be fixed.
   */
  correlationId?: string | null;
  /**
   * The conversation_agent_runs row this call belongs to. Links the token
   * ledger row to it and adds the call's tokens and cost to the run.
   */
  agentRunId?: string | null;
  /**
   * Lifecycle stage, for the budget manager (Phase 4). PRE_REPLY caps the tier
   * and applies the pre-reply ceiling; OPPORTUNITY swaps the lead ceiling for
   * the opportunity one. Omitted = no stage-specific budget applies.
   */
  stage?: SpendStage | null;
  /**
   * Value facts for value-aware routing. When omitted and `leadId` is given,
   * the budget manager reads the lead's current score and archetype itself.
   */
  score?: number | null;
  grade?: LeadGrade | null;
  dealSizeBand?: DealSizeBand | null;
  /** Cost of sending the result on its channel, GBP pence (e.g. an SMS). */
  channelCostMinor?: number;
};

export type TaskResult<T> = {
  data: T | null;
  confidence: number | null;
  band: ConfidenceBand;
  requiresReview: boolean;
  /** True if a fallback was used instead of a real model response. */
  fallbackUsed: boolean;
  /**
   * Set when the call never happened. `NO_TOKENS` is a billing state, not an
   * error: the caller degrades to its deterministic path exactly as it would
   * for a workspace without AI.
   */
  skippedReason?: TaskSkippedReason;
};

/**
 * Why a call did not happen.
 *   AI_UNAVAILABLE  not configured, or the provider failed
 *   NO_TOKENS       the workspace's token allowance is used up
 *   BUDGET          the budget manager chose the deterministic path (a ceiling,
 *                   or the lead's value does not justify the spend)
 *   BUDGET_HUMAN    as BUDGET, in a live conversation: a person should reply
 * Every one degrades to the caller's deterministic path.
 */
export type TaskSkippedReason = "AI_UNAVAILABLE" | "NO_TOKENS" | "BUDGET" | "BUDGET_HUMAN";

/**
 * Runs one AI task end to end: picks nano/mini, calls Azure, validates the
 * response against the task's schema, records usage/cost, and applies the
 * confidence policy. The caller (deterministic orchestration layer) decides
 * what to do with the result — this function never sends a message, writes
 * a qualification answer, or takes any other side-effecting action itself.
 */
export async function runTask<T = unknown>(
  input: RunTaskInput<T>,
): Promise<TaskResult<T>> {
  const prompt = getPrompt(input.taskType);
  const schema = SCHEMAS[input.taskType] as z.ZodType<T>;

  if (!isAzureConfigured()) {
    return fallbackResult(input, "AI_UNAVAILABLE");
  }

  // Budget manager (Phase 4): skip / tier / human, decided and recorded before
  // any token is reserved. A refusal degrades exactly like NO_TOKENS.
  const spend = await checkSpend({
    businessId: input.businessId,
    taskType: input.taskType,
    leadId: input.leadId ?? null,
    stage: input.stage ?? null,
    score: input.score,
    grade: input.grade,
    dealSizeBand: input.dealSizeBand,
    channelCostMinor: input.channelCostMinor,
    promptChars: prompt.systemPrompt.length + input.context.length,
    maxOutputTokens: input.maxOutputTokens ?? 200,
  });
  if (spend.decision === "SKIP") return fallbackResult(input, "BUDGET");
  if (spend.decision === "HUMAN") return fallbackResult(input, "BUDGET_HUMAN");
  const tierNumber = tierFromDecision(spend.decision);
  const tier = tierNumber ? spend.config.tiers[tierNumber] : null;
  const target = tier ? targetFor(tier) : null;
  if (!tier || !target) return fallbackResult(input, "BUDGET");
  const provider = providerFor(tier);
  // The metering class: ai_runs.deployment and the usage metrics know nano/mini.
  const deployment = target.alias;

  // Token gate. Checked before the call rather than after, so a workspace at
  // its limit never spends on a call it cannot pay for. Running out degrades
  // to the deterministic path -- it does not fail the caller.
  const userContent = input.stableContext
    ? `${input.stableContext}\n\n${input.context}`
    : input.context;
  const estimated = estimateTokensForCall(
    input.maxOutputTokens ?? 200,
    prompt.systemPrompt.length + userContent.length,
  );
  // Atomic admission: the estimate is held under a row lock, counting every
  // call already in flight, so concurrent workers cannot all spend the same
  // remaining balance (B21).
  const admission = await reserveTokenCapacity(input.businessId, estimated);
  if (!admission.ok) {
    return fallbackResult(input, "NO_TOKENS");
  }
  const reservationId = admission.reservationId;

  const debitKey = resolveIdempotencyKey({
    businessId: input.businessId,
    taskType: input.taskType,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
  if (!debitKey.stable) {
    console.warn(
      `[model-router] ${input.taskType} called without idempotencyKey or correlationId; a retry will be charged again`,
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: prompt.systemPrompt },
    // Stable first, volatile last: see `stableContext`.
    { role: "user", content: userContent },
  ];

  try {
    const result = await provider.chat(target, messages, input.maxOutputTokens ?? 200);
    // Malformed JSON is a schema failure, not a transport failure: the call
    // happened and was billed, so it must reach the metering below rather
    // than the catch (which records zero tokens).
    let raw: unknown;
    try {
      raw = JSON.parse(result.content);
    } catch {
      raw = undefined;
    }
    const parsed = schema.safeParse(raw);

    const data = parsed.success ? parsed.data : null;
    const confidence = extractConfidence(parsed.success ? parsed.data : null);

    // Confidence banding only applies to extraction/classification tasks —
    // generation tasks (reply/summary/reactivation copy) have no notion of
    // confidence, so a missing field must not be treated as "low confidence"
    // and silently discard a perfectly valid generated message.
    const usesConfidence = FAST_STRUCTURED_TASKS.has(input.taskType);
    const band = !usesConfidence ? "automatic" : confidence === null ? "review" : confidenceBand(confidence);
    const requiresReview = !parsed.success || (usesConfidence && band === "review");

    const usage = await recordAiUsage({
      businessId: input.businessId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      taskType: input.taskType,
      deployment,
      promptKey: prompt.promptKey,
      promptVersion: prompt.version,
      operationKey: debitKey.stable ? debitKey.key : null,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      confidence,
      resultJson: parsed.success ? parsed.data : { raw: result.content },
      status: parsed.success ? (band === "review" ? "low_confidence" : "ok") : "error",
      errorCode: parsed.success ? null : "SCHEMA_VALIDATION_FAILED",
    });

    // Debit the true cost, not the estimate. Charged even when the response
    // failed validation: the provider billed us for it either way, and hiding
    // that from the customer's meter would misrepresent their usage.
    // prompt_tokens already includes the cached prefix: debit prompt +
    // completion, never cached on top (B17).
    const tokens = billableTokens(result);
    await recordTokenConsumption({
      businessId: input.businessId,
      totalTokens: tokens.allowanceDebit,
      idempotencyKey: debitKey.key,
      aiRunId: usage.runId,
      agentRunId: input.agentRunId ?? null,
      taskType: input.taskType,
      deployment,
      reservationId,
    }).catch(() => {
      // Metering must never mask a successful call.
    });

    if (input.agentRunId) {
      await addAgentRunUsage(input.businessId, input.agentRunId, {
        modelProvider: provider.id,
        modelName: deployment,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      });
    }

    return {
      data: band === "review" ? null : data,
      confidence,
      band,
      requiresReview,
      fallbackUsed: false,
    };
  } catch (error) {
    const errorCode = error instanceof AiUnavailableError ? "AI_UNAVAILABLE" : "UNKNOWN_ERROR";
    // The call failed before the provider billed anything; give the hold back
    // now rather than waiting for it to expire.
    if (reservationId) {
      await releaseTokenReservation(input.businessId, reservationId).catch(() => {});
    }
    await recordAiUsage({
      businessId: input.businessId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      taskType: input.taskType,
      deployment,
      promptKey: prompt.promptKey,
      promptVersion: prompt.version,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      confidence: null,
      resultJson: null,
      status: "error",
      errorCode,
    }).catch(() => {
      // Metering must never mask the original failure.
    });

    return fallbackResult(input, "AI_UNAVAILABLE");
  }
}

function fallbackResult<T>(
  input: RunTaskInput<T>,
  skippedReason?: TaskResult<T>["skippedReason"],
): TaskResult<T> {
  const fallback = input.onUnavailable?.() ?? null;
  return {
    data: fallback,
    confidence: null,
    band: "review",
    requiresReview: fallback === null,
    fallbackUsed: fallback !== null,
    skippedReason,
  };
}

function extractConfidence(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { confidence?: unknown }).confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
