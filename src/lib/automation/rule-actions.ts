"use server";

import { revalidatePath } from "next/cache";
import { runForUser } from "@/lib/quotes/run-action";
import type { QuoteActionResult } from "@/lib/quotes/action-result";

/**
 * Server actions for the automation rule builder (Follow-Up -> Automations)
 * and the pipeline mapping (Settings -> AI & selling). Each is one service
 * operation run for the signed-in person; the runtime checks the role,
 * validates the input and audits.
 */

export async function saveAutomationRule(input: unknown): Promise<QuoteActionResult<{ id: string; enabled: boolean }>> {
  const result = await runForUser<{ id: string; enabled: boolean }>("automation_rule.save", input);
  if (result.ok) revalidatePath("/app/follow-up");
  return result;
}

export async function setAutomationRuleEnabled(input: {
  ruleId: string;
  enabled: boolean;
  acknowledgeExternal?: boolean;
}): Promise<QuoteActionResult<{ id: string; enabled: boolean }>> {
  const result = await runForUser<{ id: string; enabled: boolean }>("automation_rule.set_enabled", input);
  if (result.ok) revalidatePath("/app/follow-up");
  return result;
}

export async function deleteAutomationRule(ruleId: string): Promise<QuoteActionResult<{ id: string }>> {
  const result = await runForUser<{ id: string }>("automation_rule.delete", { ruleId });
  if (result.ok) revalidatePath("/app/follow-up");
  return result;
}

export async function savePipelineMapping(mapping: unknown): Promise<QuoteActionResult<{ changed: string[] }>> {
  const result = await runForUser<{ changed: string[] }>("pipeline.set_mapping", { mapping });
  if (result.ok) revalidatePath("/app/settings");
  return result;
}
