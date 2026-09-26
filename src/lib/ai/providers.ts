import "server-only";
import {
  chat,
  chatWithTools,
  isAzureConfigured,
  type AiDeployment,
  type ChatMessage,
  type ChatResult,
  type ToolChatResult,
  type ToolSpec,
  type ToolTurn,
} from "./azure-client";
import type { ModelTier } from "./tiers";

/**
 * The model-provider seam (Phase 4). Today there is one provider, Azure OpenAI
 * in the EU, and that is a project decision, not a gap. The interface exists so
 * that a second provider is an adapter behind `providerFor`, not a rewrite of
 * the router, the meter and every caller.
 *
 * A provider is transport only: it takes a resolved deployment and messages and
 * returns content plus token usage. Task routing, schema validation, budgets
 * and metering stay in model-router.ts.
 */

export type ProviderId = "azure_openai";

/** Which model to call: the metering alias, plus an optional explicit deployment. */
export type DeploymentTarget = {
  alias: AiDeployment;
  deploymentName?: string | null;
};

export interface ChatProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  /** One JSON-object completion. */
  chat(target: DeploymentTarget, messages: ChatMessage[], maxTokens: number): Promise<ChatResult>;
  /** One tool-calling turn. */
  chatWithTools(
    target: DeploymentTarget,
    messages: ToolTurn[],
    tools: ToolSpec[],
    maxTokens: number,
  ): Promise<ToolChatResult>;
}

/** Azure OpenAI, wrapping azure-client.ts unchanged. */
export const azureProvider: ChatProvider = {
  id: "azure_openai",
  isConfigured: isAzureConfigured,
  chat: (target, messages, maxTokens) =>
    chat(target.alias, messages, maxTokens, target.deploymentName ?? null),
  chatWithTools: (target, messages, tools, maxTokens) =>
    chatWithTools(target.alias, messages, tools, maxTokens, target.deploymentName ?? null),
};

/** The provider for a tier. Every enabled model tier is Azure today. */
export function providerFor(tier: Pick<ModelTier, "provider">): ChatProvider {
  switch (tier.provider) {
    case "azure_openai":
    case "none":
    default:
      return azureProvider;
  }
}

/** The deployment a tier resolves to. Tier 0 has none. */
export function targetFor(tier: ModelTier): DeploymentTarget | null {
  if (!tier.deploymentAlias) return null;
  return { alias: tier.deploymentAlias, deploymentName: tier.deploymentName };
}
