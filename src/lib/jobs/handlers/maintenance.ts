import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily expiry sweeps.
 *
 * Two pieces of state in the V4 model go stale on a clock rather than on an
 * event, and both are wrong in a way that is invisible until someone checks:
 *
 *   * **Intent matches.** A buying signal only influences a prospect's score
 *     while it is fresh (§62.2). `prospect_intent_matches` rows past their
 *     `expires_at` keep contributing until something removes them, so a
 *     prospect can sit at grade A on evidence from six months ago.
 *
 *   * **Usage reservations.** The allowance system reserves before an expensive
 *     call and settles after. A worker that dies between the two leaves the
 *     reservation held, permanently consuming allowance the customer never
 *     actually used.
 *
 * Both sweeps are idempotent and safe to run repeatedly: they only touch rows
 * whose expiry has already passed.
 */
// No payload: the sweep is a trigger, and it decides what is stale itself.
export async function handleMaintenanceExpiry(): Promise<void> {
  const admin = createAdminClient();

  const [intent, reservations] = await Promise.all([
    admin.rpc("expire_intent_matches"),
    admin.rpc("expire_usage_reservations"),
  ]);

  // Reported rather than thrown: one sweep failing must not stop the other,
  // and the queue's retry will pick up a genuine outage on the next attempt.
  if (intent.error) {
    console.error("[maintenance] expire_intent_matches failed:", intent.error.message);
  }
  if (reservations.error) {
    console.error(
      "[maintenance] expire_usage_reservations failed:",
      reservations.error.message,
    );
  }

  if (intent.error || reservations.error) {
    throw new Error("Daily expiry sweep did not complete.");
  }

  const expiredIntent = typeof intent.data === "number" ? intent.data : 0;
  const releasedReservations =
    typeof reservations.data === "number" ? reservations.data : 0;

  if (expiredIntent > 0 || releasedReservations > 0) {
    console.info(
      `[maintenance] expired ${expiredIntent} intent match(es), released ${releasedReservations} stale reservation(s)`,
    );
  }
}
