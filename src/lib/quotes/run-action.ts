import "server-only";
import { randomUUID } from "node:crypto";
import { requireWorkspace } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import type { QuoteActionResult } from "./action-result";

/**
 * Runs one service operation for the signed-in person (caller UI). The role
 * is the live workspace role; the runtime re-checks it, validates the input,
 * requires confirmation for EXTERNAL / DESTRUCTIVE / FINANCIAL operations
 * (`confirmed` is only ever passed by an action behind a confirmation
 * dialog), audits and returns the envelope, mapped here to a plain result.
 */
export async function runForUser<T>(
  name: string,
  args: unknown,
  options: { confirmed?: boolean; idempotencyKey?: string } = {},
): Promise<QuoteActionResult<T>> {
  const workspace = await requireWorkspace();
  const result = await runOperation<T>(name, args, {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI",
    confirmed: options.confirmed,
    correlationId: randomUUID(),
    idempotencyKey: options.idempotencyKey,
  });
  if (!result.success) return { ok: false, error: result.message, code: result.code };
  return { ok: true, data: result.data, warnings: result.warnings.map((w) => w.message) };
}
