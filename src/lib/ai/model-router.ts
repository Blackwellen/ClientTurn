import "server-only";
import { chat, isAzureConfigured, AiUnavailableError, type ChatMessage } from "./azure-client";
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
import { hasTokenCapacity, recordTokenConsumption } from "@/lib/billing/token-service";
import { estimateTokensForCall } from "@/lib/billing/tokens";

export { AiUnavailableError, isAzureConfigured };

/**
 * Routing rule (§4): fast/structured tasks always go to nano; everything
 * else that needs generation or ambiguity handling goes to mini. Callers
 * never pick a deployment directly — this is the one place that decision
 * gets made, so it can't drift task-by-task.
 */
function deploymentFor(taskType: TaskType) {
  return FAST_STRUCTURED_TASKS.has(taskType) ? "nano" : "mini";
}

export type RunTaskInput<T> = {
  taskType: TaskType;
  businessId: string;
  leadId?: string | null;
  conversationId?: string | null;
  automationRunId?: string | null;
  /** Task-specific context block, built by context-builder.ts. */
  context: string;
  maxOutputTokens?: number;
  /** Called if Azure is unavailable or every call fails; must not throw. */
  onUnavailable?: () => T;
  /**
   * Stable key for the token debit. A retried worker presents the same key and
   * is charged once. Defaults to a per-call random key, which is correct for
   * one-off calls and wrong for anything the queue may retry -- those pass
   * their own.
   */
  idempotencyKey?: string;
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
  skippedReason?: "AI_UNAVAILABLE" | "NO_TOKENS";
};

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
  const deployment = deploymentFor(input.taskType);
  const prompt = getPrompt(input.taskType);
  const schema = SCHEMAS[input.taskType] as z.ZodType<T>;

  if (!isAzureConfigured()) {
    return fallbackResult(input, "AI_UNAVAILABLE");
  }

  // Token gate. Checked before the call rather than after, so a workspace at
  // its limit never spends on a call it cannot pay for. Running out degrades
  // to the deterministic path -- it does not fail the caller.
  const estimated = estimateTokensForCall(
    input.maxOutputTokens ?? 200,
    prompt.systemPrompt.length + input.context.length,
  );
  const capacity = await hasTokenCapacity(input.businessId, estimated);
  if (!capacity.ok) {
    return fallbackResult(input, "NO_TOKENS");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: prompt.systemPrompt },
    { role: "user", content: input.context },
  ];

  try {
    const result = await chat(deployment, messages, input.maxOutputTokens ?? 200);
    const parsed = schema.safeParse(JSON.parse(result.content));

    const data = parsed.success ? parsed.data : null;
    const confidence = extractConfidence(parsed.success ? parsed.data : null);

    // Confidence banding only applies to extraction/classification tasks —
    // generation tasks (reply/summary/reactivation copy) have no notion of
    // confidence, so a missing field must not be treated as "low confidence"
    // and silently discard a perfectly valid generated message.
    const usesConfidence = FAST_STRUCTURED_TASKS.has(input.taskType);
    const band = !usesConfidence ? "automatic" : confidence === null ? "review" : confidenceBand(confidence);
    const requiresReview = !parsed.success || (usesConfidence && band === "review");

    await recordAiUsage({
      businessId: input.businessId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      taskType: input.taskType,
      deployment,
      promptKey: prompt.promptKey,
      promptVersion: prompt.version,
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
    await recordTokenConsumption({
      businessId: input.businessId,
      totalTokens:
        result.inputTokens + result.cachedInputTokens + result.outputTokens,
      idempotencyKey: input.idempotencyKey ?? `ai:${crypto.randomUUID()}`,
      taskType: input.taskType,
      deployment,
    }).catch(() => {
      // Metering must never mask a successful call.
    });

    return {
      data: band === "review" ? null : data,
      confidence,
      band,
      requiresReview,
      fallbackUsed: false,
    };
  } catch (error) {
    const errorCode = error instanceof AiUnavailableError ? "AI_UNAVAILABLE" : "UNKNOWN_ERROR";
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
