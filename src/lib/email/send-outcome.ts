import "server-only";
import { suppress } from "@/lib/policy/suppression";
import { sendOutcomeActions, type SendFailureLike } from "./bounce";
import { recordEmailHealth } from "./store";

/**
 * Applies one SMTP send result: a recipient-level hard bounce suppresses THAT
 * address (workspace scope, reason BOUNCE, reversible), while a mailbox-level
 * failure updates the mailbox's health. Never both.
 *
 * Best effort on the suppression write: the send has already failed and the
 * caller must see the result either way. The same address will be refused
 * again on the next send, so nothing is lost if a write fails once.
 */
export async function applyEmailSendOutcome(
  businessId: string,
  to: string,
  result: { ok: true } | ({ ok: false } & SendFailureLike),
  source: string,
): Promise<{ suppressed: boolean }> {
  const actions = sendOutcomeActions(result);
  let suppressed = false;

  if (actions.suppressRecipient) {
    try {
      await suppress({
        businessId,
        channel: "EMAIL",
        reason: "BOUNCE",
        source,
        sourceReference: result.ok ? null : result.errorCode,
        email: to,
      });
      suppressed = true;
    } catch (error) {
      console.error("[email] could not record a send-time bounce", {
        businessId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (actions.health !== "skip") {
    await recordEmailHealth(businessId, actions.health);
  }

  return { suppressed };
}
