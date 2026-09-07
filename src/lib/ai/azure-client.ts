import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Raw Azure OpenAI transport. Nothing here decides business logic — see
 * model-router.ts for task routing, schema validation and usage metering.
 */

export type AiDeployment = "nano" | "mini";

export type ChatMessage = { role: "system" | "user"; content: string };

/**
 * A turn in a tool-calling conversation.
 *
 * Wider than `ChatMessage` because a tool loop has to send back what the model
 * previously decided (`assistant`, possibly with `tool_calls`) and what
 * happened when those calls ran (`tool`). Without both, the model cannot see
 * the result of its own action and will either repeat it or invent an outcome.
 */
export type ToolTurn =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCallRequest[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCallRequest = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** A tool as the model is shown it. `parameters` is JSON Schema. */
export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolChatResult = {
  content: string | null;
  toolCalls: ToolCallRequest[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Why the model stopped. `length` means the answer was cut off. */
  finishReason: string | null;
};

export class AiUnavailableError extends Error {}

export type ChatResult = {
  content: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

/**
 * One turn of a tool-calling conversation.
 *
 * Distinct from `chat` rather than a flag on it: `chat` forces a JSON object
 * response, which is exactly wrong here — a tool-calling turn either asks for a
 * tool or answers in prose, and forcing JSON would make it do neither well.
 *
 * The timeout is longer than `chat`'s because the model is reasoning about
 * which of many tools to use rather than filling in one small schema.
 */
export async function chatWithTools(
  deployment: AiDeployment,
  messages: ToolTurn[],
  tools: ToolSpec[],
  maxTokens: number,
): Promise<ToolChatResult> {
  const url =
    `${serverEnv.azure.endpoint}/openai/deployments/${deploymentName(deployment)}` +
    `/chat/completions?api-version=${serverEnv.azure.apiVersion}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": serverEnv.azure.apiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_completion_tokens: maxTokens,
        // "auto", never "required": some questions are answered from what the
        // model already has, and forcing a call would make it invent one.
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiUnavailableError(`Azure AI returned ${response.status}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0] ?? {};
    const usage = json.usage ?? {};

    return {
      content: choice.message?.content ?? null,
      toolCalls: Array.isArray(choice.message?.tool_calls)
        ? (choice.message.tool_calls as ToolCallRequest[])
        : [],
      inputTokens: usage.prompt_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      finishReason: choice.finish_reason ?? null,
    };
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    throw new AiUnavailableError(
      error instanceof Error ? error.message : "Azure AI request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function deploymentName(deployment: AiDeployment): string {
  const name =
    deployment === "nano"
      ? serverEnv.azure.deploymentFast
      : serverEnv.azure.deploymentDefault;
  if (!name || !serverEnv.azure.endpoint || !serverEnv.azure.apiKey) {
    throw new AiUnavailableError("Azure AI is not configured");
  }
  return name;
}

export function isAzureConfigured(): boolean {
  return Boolean(
    serverEnv.azure.endpoint &&
      serverEnv.azure.apiKey &&
      serverEnv.azure.deploymentDefault &&
      serverEnv.azure.deploymentFast,
  );
}

/**
 * One chat-completion call. Always requests a JSON object response so
 * callers never have to parse free-form prose out of the model.
 */
export async function chat(
  deployment: AiDeployment,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResult> {
  const url =
    `${serverEnv.azure.endpoint}/openai/deployments/${deploymentName(deployment)}` +
    `/chat/completions?api-version=${serverEnv.azure.apiVersion}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": serverEnv.azure.apiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiUnavailableError(`Azure AI returned ${response.status}`);
    }

    const json = await response.json();
    const usage = json.usage ?? {};

    return {
      content: json.choices?.[0]?.message?.content ?? "",
      inputTokens: usage.prompt_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    throw new AiUnavailableError(
      error instanceof Error ? error.message : "Azure AI request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
