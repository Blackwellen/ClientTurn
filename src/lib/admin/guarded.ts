import "server-only";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { getPlatformOperator } from "./guard";
import { requireStepUp, StepUpRequiredError } from "./step-up";

/**
 * The single authorisation path for every mutating platform-admin action.
 *
 * Extracted from `actions.ts` so that any admin surface — customers, system,
 * support — is guarded, step-up protected and audited identically. A second
 * copy of this logic is how one surface eventually ends up without step-up.
 */

export type AdminActionResult =
  | { ok: true; message?: string; redirectTo?: string }
  | { ok: false; error: string; code?: "step_up_required" | "forbidden" };

export async function operatorOrForbidden() {
  const operator = await getPlatformOperator();
  if (!operator) throw new Error("FORBIDDEN");
  return operator;
}

export async function guarded(
  action: AuditAction,
  run: (operator: { id: string; email: string }) => Promise<AdminActionResult>,
): Promise<AdminActionResult> {
  const startedAt = Date.now();
  try {
    const operator = await operatorOrForbidden();
    await requireStepUp(operator.id);
    const result = await run(operator);
    if (!result.ok) {
      await recordAudit({
        businessId: null,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action,
        metadata: {
          outcome: "failed",
          reason: result.error,
          duration_ms: Date.now() - startedAt,
        },
      });
    }
    return result;
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return {
        ok: false,
        code: "step_up_required",
        error: "Confirm your password to continue.",
      };
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      // Recorded without an actor: the caller was not a platform admin.
      await recordAudit({
        businessId: null,
        actorType: "platform_admin",
        action: "admin.action_denied",
        metadata: { attempted: action, duration_ms: Date.now() - startedAt },
      });
      return { ok: false, code: "forbidden", error: "Not permitted." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Action failed.",
    };
  }
}
