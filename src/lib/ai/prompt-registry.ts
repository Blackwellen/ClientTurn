import { PROMPT_BODIES } from "./prompts";
import type { TaskType } from "./schemas";

/**
 * Code-side prompt registry. Each task has exactly one active version here;
 * bumping a prompt body means bumping its version number so ai_runs rows
 * stay attributable to the exact prompt that produced them. The durable copy
 * lives in the `ai_prompt_versions` table (written by an admin/deploy step,
 * not by request-time code) — this registry is what the router actually
 * sends to Azure.
 */

type RegistryEntry = { promptKey: TaskType; version: number; systemPrompt: string };

/**
 * Versions above 1. A task not listed is at version 1. Bump here in the same
 * change as the body.
 *
 *   v2 (2026-09-25, revenue engine phase 2B):
 *     agent_decision        strategy block + offer card, neutral B2B wording, style rules
 *     intent_classification "UK home-service business" framing removed
 *     variant_generation    "UK home-services business" framing removed
 *   v3 (2026-09-26, revenue engine phase 3):
 *     agent_decision        PROPOSE_CHECKOUT + checkout_link_id, no discounts/purchase claims
 */
export const PROMPT_VERSIONS: Partial<Record<TaskType, number>> = {
  agent_decision: 3,
  intent_classification: 2,
  variant_generation: 2,
};

export const PROMPT_REGISTRY: Record<TaskType, RegistryEntry> = Object.fromEntries(
  (Object.entries(PROMPT_BODIES) as [TaskType, string][]).map(([taskType, body]) => [
    taskType,
    { promptKey: taskType, version: PROMPT_VERSIONS[taskType] ?? 1, systemPrompt: body },
  ]),
) as Record<TaskType, RegistryEntry>;

export function getPrompt(taskType: TaskType): RegistryEntry {
  return PROMPT_REGISTRY[taskType];
}
