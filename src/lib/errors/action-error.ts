import "server-only";

import { errorReference, friendlyErrorMessage } from "./friendly";

/**
 * The server half of the error rule: a server action that catches an
 * unexpected error calls this instead of returning `error.message`.
 *
 * It logs the real error (one JSON line, with the operation and a reference)
 * where Vercel and Sentry's console integration collect it, and returns a
 * sentence safe for a customer plus the same reference, so a support ticket
 * quoting it leads straight to the log line.
 *
 *   } catch (error) {
 *     return actionFailure(error, "meta.pages.refresh", "Your Pages could not be loaded. Try again, or reconnect Meta.");
 *   }
 */
export function actionFailure(
  error: unknown,
  operation: string,
  fallback: string,
): { ok: false; error: string; reference: string } {
  const reference = errorReference();
  console.error(
    JSON.stringify({
      level: "error",
      event: "action.failed",
      operation,
      reference,
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      name: error instanceof Error ? error.name : typeof error,
    }),
  );
  const message = friendlyErrorMessage(error, fallback);
  return {
    ok: false,
    error: message === fallback ? `${fallback} (Ref ${reference})` : message,
    reference,
  };
}
