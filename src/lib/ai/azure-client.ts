import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Raw Azure OpenAI transport. Nothing here decides business logic — see
 * model-router.ts for task routing, schema validation and usage metering.
 */

export type AiDeployment = "nano" | "mini";

export type ChatMessage = { role: "system" | "user"; content: string };

export class AiUnavailableError extends Error {}

export type ChatResult = {
  content: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

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
