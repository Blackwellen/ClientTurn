"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import { agentSettingsProblem, saveAiBehaviourSchema, type AiBehaviourSettings } from "./types";

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/**
 * Settings -> Workspace -> AI assistant. The one editor for the conversation
 * assistant's settings, including its mode (AI & selling shows the mode
 * read-only and links here).
 *
 * The write is the registry operation `ai_settings.update`, the same one
 * Copilot and MCP use: same entitlement check, same "agent off when AI is off"
 * rule, same audited before/after. The role is checked here only so the
 * message is clear; the runtime checks it again.
 */
export async function saveAiBehaviour(
  input: Partial<AiBehaviourSettings>,
): Promise<ActionResult> {
  const parsed = saveAiBehaviourSchema.safeParse(input);
  if (!parsed.success) return fail("Check the AI behaviour fields and try again.");

  // Re-checked server-side: an assistant with no channel would silently never run.
  const problem = agentSettingsProblem(parsed.data);
  if (problem) return fail(problem);

  const workspace = await admin();
  if (!workspace) return fail("You do not have permission to change AI settings.");

  const result = await runOperation("ai_settings.update", parsed.data, {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI",
    correlationId: randomUUID(),
  });
  if (!result.success) return fail(result.message);

  revalidatePath("/app/follow-up");
  revalidatePath("/app/settings");
  return { ok: true, warning: result.warnings[0]?.message };
}
