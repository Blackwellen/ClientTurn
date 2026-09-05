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

export const PROMPT_REGISTRY: Record<TaskType, RegistryEntry> = Object.fromEntries(
  (Object.entries(PROMPT_BODIES) as [TaskType, string][]).map(([taskType, body]) => [
    taskType,
    { promptKey: taskType, version: 1, systemPrompt: body },
  ]),
) as Record<TaskType, RegistryEntry>;

export function getPrompt(taskType: TaskType): RegistryEntry {
  return PROMPT_REGISTRY[taskType];
}
