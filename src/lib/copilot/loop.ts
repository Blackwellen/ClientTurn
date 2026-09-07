import "server-only";
import { randomUUID } from "node:crypto";
import {
  AiUnavailableError,
  chatWithTools,
  isAzureConfigured,
  type ToolSpec,
  type ToolTurn,
} from "@/lib/ai/azure-client";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { recordAiUsage } from "@/lib/ai/usage-meter";
import { estimateTokensForCall } from "@/lib/billing/tokens";
import { hasTokenCapacity, recordTokenConsumption } from "@/lib/billing/token-service";
import { handlerSchema } from "@/lib/services/runtime";
import { serviceOperation } from "@/lib/services";
import { toolInputSchema } from "@/lib/services/json-schema";
import {
  COPILOT_TOOLS,
  fromFunctionName,
  roleAllows,
  toFunctionName,
  type ToolDeclaration,
} from "./types";
import { runTool, type ToolContext, type ToolOutcome } from "./tool-service";

/**
 * Copilot's tool-calling loop (Programme §2).
 *
 * What this replaced: a keyword router that matched `/intent|expansion|signal/`
 * against the message and ran a fixed query. It could not plan, could not
 * combine two lookups, and could not act — and because it composed its answer
 * itself, nothing structurally prevented it from describing a change that had
 * not happened.
 *
 * The rule that shapes this file: **Copilot cannot report a change the service
 * layer did not make.** That is not asked for in the prompt and hoped for; it
 * is arranged. The model never executes anything itself — it names a tool, the
 * loop runs it through `runTool` (which runs it through the service runtime,
 * with the person's live role), and only the real result is fed back. A model
 * that hallucinates a success sees the next turn's context contradict it.
 *
 * Three limits bound the cost of a turn, because an agentic loop's failure mode
 * is not a wrong answer but an expensive one:
 *
 *   * **MAX_STEPS** — the model gets a small number of chances to call tools
 *     before it must answer with what it has.
 *   * **MAX_TOOL_CALLS** — a hard ceiling across the whole turn, so a model
 *     looping on one failing tool cannot spend a workspace's allowance.
 *   * **The token gate** — checked before the first call, exactly as `runTask`
 *     does, so a workspace at its limit degrades rather than overspends.
 */

/** Enough for read, think, act, confirm. Beyond this it is looping, not working. */
const MAX_STEPS = 5;

/** Across the whole turn, not per step. */
const MAX_TOOL_CALLS = 8;

const MAX_OUTPUT_TOKENS = 700;

/** Trimmed hard: a tool result is context, and a 200-row list crowds out the
 *  conversation that gives it meaning. */
const MAX_RESULT_CHARS = 6000;

export type CopilotTurnResult = {
  reply: string;
  /** Every tool that ran, in order, with what it did. */
  steps: CopilotStep[];
  /** Set when a tool needs a person to confirm before it can run. */
  awaitingConfirmation: {
    tool: string;
    summary: string;
    effect: string;
    args: Record<string, unknown>;
  } | null;
  /** True when the model was unavailable or out of allowance. */
  degraded: boolean;
  correlationId: string;
};

export type CopilotStep = {
  tool: string;
  ok: boolean;
  summary: string;
  /** The service envelope, when the tool was a service-layer operation. */
  entityId?: string | null;
  auditEventId?: string | null;
  warnings?: { code: string; message: string }[];
};

/* ------------------------------------------------------------- tool specs */

/**
 * The tools this person may use, as the model is shown them.
 *
 * Role-filtered before the model ever sees them. Offering a tool that would be
 * refused invites the model to try it, explain the refusal, and spend a turn
 * discovering a boundary the loop already knew about.
 */
function toolSpecsFor(role: string): ToolSpec[] {
  const specs: ToolSpec[] = [];

  for (const tool of COPILOT_TOOLS) {
    if (!roleAllows(role, tool.scope)) continue;

    const parameters = parametersFor(tool);
    if (!parameters) continue;

    specs.push({
      type: "function",
      function: {
        name: toFunctionName(tool.name),
        description: tool.effect ? `${tool.summary}. ${tool.effect}` : tool.summary,
        parameters,
      },
    });
  }

  return specs;
}

/**
 * A service-layer tool's parameters come from its own Zod validator, so what
 * the model is shown is what will be enforced. Tools that predate the service
 * layer have no declared schema; they are offered with an open object, which is
 * honest about the fact that nothing is validating their shape yet.
 */
function parametersFor(tool: ToolDeclaration): Record<string, unknown> | null {
  if (serviceOperation(tool.name)) {
    const schema = handlerSchema(tool.name);
    if (!schema) return null;
    try {
      return toolInputSchema(schema) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return { type: "object", properties: {}, additionalProperties: true };
}

/* ------------------------------------------------------------------- turn */

export async function runCopilotTurn(input: {
  context: ToolContext;
  /** The person's message. */
  message: string;
  /** Earlier turns, oldest first, already trimmed by the caller. */
  history: { role: "user" | "assistant"; content: string }[];
  /** Workspace facts worth knowing without a tool call. */
  preamble?: string;
  /**
   * Set when the person has just confirmed a specific action. It applies to
   * that one tool call and nothing else — a confirmation is not a mode.
   */
  confirmed?: { tool: string; args: Record<string, unknown> } | null;
}): Promise<CopilotTurnResult> {
  const correlationId = randomUUID();
  const steps: CopilotStep[] = [];

  if (!isAzureConfigured()) {
    return degraded(correlationId, steps);
  }

  const prompt = getPrompt("copilot_turn");
  const specs = toolSpecsFor(input.context.role);

  const turns: ToolTurn[] = [
    {
      role: "system",
      content: input.preamble
        ? `${prompt.systemPrompt}\n\nAbout this workspace:\n${input.preamble}`
        : prompt.systemPrompt,
    },
    ...input.history.map((entry) => ({
      role: entry.role === "user" ? ("user" as const) : ("assistant" as const),
      content: entry.content,
    })),
    { role: "user", content: input.message },
  ];

  // Checked before the first call, not after: a workspace at its limit should
  // never spend on a turn it cannot pay for.
  const estimate = estimateTokensForCall(
    MAX_OUTPUT_TOKENS,
    prompt.systemPrompt.length + input.message.length + (input.preamble?.length ?? 0),
  );
  const capacity = await hasTokenCapacity(input.context.businessId, estimate);
  if (!capacity.ok) {
    return degraded(correlationId, steps);
  }

  let toolCallsMade = 0;
  let awaiting: CopilotTurnResult["awaitingConfirmation"] = null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // On the final step the tools are withheld, which forces an answer from
    // what has already been gathered rather than one more call it has no
    // opportunity to use.
    const lastStep = step === MAX_STEPS - 1 || toolCallsMade >= MAX_TOOL_CALLS;

    let result;
    try {
      result = await chatWithTools(
        "mini",
        turns,
        lastStep ? [] : specs,
        MAX_OUTPUT_TOKENS,
      );
    } catch (error) {
      await meter(input.context.businessId, correlationId, 0, 0, 0, 0, "error",
        error instanceof AiUnavailableError ? "AI_UNAVAILABLE" : "UNKNOWN_ERROR");
      return degraded(correlationId, steps);
    }

    await meter(
      input.context.businessId,
      correlationId,
      result.inputTokens,
      result.cachedInputTokens,
      result.outputTokens,
      result.latencyMs,
      "ok",
      null,
    );

    await recordTokenConsumption({
      businessId: input.context.businessId,
      totalTokens:
        result.inputTokens + result.cachedInputTokens + result.outputTokens,
      idempotencyKey: `copilot:${correlationId}:${step}`,
      taskType: "copilot_turn",
      deployment: "mini",
    }).catch(() => {
      // Metering must never mask a successful turn.
    });

    if (result.toolCalls.length === 0) {
      return {
        reply: cleanReply(result.content),
        steps,
        awaitingConfirmation: awaiting,
        degraded: false,
        correlationId,
      };
    }

    turns.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      if (toolCallsMade >= MAX_TOOL_CALLS) {
        turns.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: "Too many actions in one turn. Answer with what you have.",
          }),
        });
        continue;
      }

      toolCallsMade += 1;
      const outcome = await executeCall(input, call.function.name, call.function.arguments);

      if (outcome.needsConfirmation && !awaiting) {
        awaiting = outcome.needsConfirmation;
      }
      if (outcome.step) steps.push(outcome.step);

      turns.push({
        role: "tool",
        tool_call_id: call.id,
        content: outcome.payload.slice(0, MAX_RESULT_CHARS),
      });
    }
  }

  // Every step used without the model producing prose. Rather than invent a
  // summary of tool results it did not conclude, say what happened.
  return {
    reply:
      steps.length > 0
        ? "I looked into that but could not finish. Here is what I found so far."
        : "I could not work that out. Try asking in a different way.",
    steps,
    awaitingConfirmation: awaiting,
    degraded: false,
    correlationId,
  };
}

/* -------------------------------------------------------------- execution */

/**
 * Runs one tool call the model asked for.
 *
 * Everything the model supplies is untrusted: the tool name may not exist, and
 * the arguments arrive as a JSON string it composed. Both are checked here, and
 * the tool itself is run through `runTool`, which applies the role check, the
 * confirmation gate and the audit trail. This function has no authority of its
 * own to add.
 */
async function executeCall(
  input: Parameters<typeof runCopilotTurn>[0],
  functionName: string,
  rawArguments: string,
): Promise<{
  payload: string;
  step: CopilotStep | null;
  needsConfirmation: CopilotTurnResult["awaitingConfirmation"];
}> {
  const toolName = fromFunctionName(functionName);
  const declaration = COPILOT_TOOLS.find((tool) => tool.name === toolName);

  if (!declaration) {
    return {
      payload: JSON.stringify({ ok: false, error: "No such action." }),
      step: null,
      needsConfirmation: null,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return {
      payload: JSON.stringify({
        ok: false,
        error: "Those arguments were not valid JSON.",
      }),
      step: null,
      needsConfirmation: null,
    };
  }

  // A confirmation applies to one specific call. Matching on the tool name
  // alone would let a model obtain agreement for one archive and then use it
  // for a different record.
  const confirmed =
    input.confirmed?.tool === toolName &&
    JSON.stringify(input.confirmed.args) === JSON.stringify(args);

  const outcome: ToolOutcome = await runTool(input.context, toolName, args, confirmed);

  if (!outcome.ok) {
    if (outcome.needsConfirmation) {
      return {
        payload: JSON.stringify({
          ok: false,
          awaiting_confirmation: true,
          error:
            "This needs the person to confirm. Describe what will happen and stop.",
        }),
        step: null,
        needsConfirmation: {
          tool: toolName,
          summary: declaration.summary,
          effect: outcome.error,
          args,
        },
      };
    }

    return {
      payload: JSON.stringify({ ok: false, error: outcome.error }),
      step: {
        tool: toolName,
        ok: false,
        summary: outcome.error,
      },
      needsConfirmation: null,
    };
  }

  return {
    payload: JSON.stringify({
      ok: true,
      summary: outcome.summary,
      data: outcome.data,
      // Handed back so the model can quote the change rather than describe it
      // from memory of what it asked for.
      change: outcome.envelope
        ? {
            entity_id: outcome.envelope.entityId,
            before: outcome.envelope.before,
            after: outcome.envelope.after,
            warnings: outcome.envelope.warnings,
          }
        : undefined,
    }),
    step: {
      tool: toolName,
      ok: true,
      summary: outcome.summary,
      entityId: outcome.envelope?.entityId,
      auditEventId: outcome.envelope?.auditEventId,
      warnings: outcome.envelope?.warnings,
    },
    needsConfirmation: null,
  };
}

/* ---------------------------------------------------------------- helpers */

function degraded(correlationId: string, steps: CopilotStep[]): CopilotTurnResult {
  return {
    reply:
      "I cannot answer that right now. You can still use everything in the app as normal.",
    steps,
    awaitingConfirmation: null,
    degraded: true,
    correlationId,
  };
}

/**
 * Strips the markdown the prompt asked it not to use.
 *
 * Prompts are requests, not guarantees, and a stray `**` in a chat bubble that
 * renders as plain text is a visible defect. Cheaper to remove than to keep
 * asking.
 */
function cleanReply(content: string | null): string {
  if (!content) return "I could not work that out.";
  return content
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .trim();
}

async function meter(
  businessId: string,
  correlationId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  latencyMs: number,
  status: "ok" | "error",
  errorCode: string | null,
): Promise<void> {
  const prompt = getPrompt("copilot_turn");
  await recordAiUsage({
    businessId,
    taskType: "copilot_turn",
    deployment: "mini",
    promptKey: prompt.promptKey,
    promptVersion: prompt.version,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    latencyMs,
    confidence: null,
    resultJson: { correlation_id: correlationId },
    status,
    errorCode,
  }).catch(() => {
    // Metering must never mask the turn it is measuring.
  });
}
