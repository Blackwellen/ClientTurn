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
 *   * **Abandoned wizard state.** A campaign draft and a `lead_imports` row are
 *     both written before the person has finished deciding, because the later
 *     steps hang off them. Neither is cleaned up when the tab closes, so
 *     Campaigns and Imports slowly fill with rows the customer cannot tell
 *     apart from work in progress.
 *
 * Every sweep is idempotent and safe to run repeatedly: each only touches rows
 * already past its window.
 */
// No payload: the sweep is a trigger, and it decides what is stale itself.
export async function handleMaintenanceExpiry(): Promise<void> {
  const admin = createAdminClient();

  const [intent, reservations, drafts, imports] = await Promise.all([
    admin.rpc("expire_intent_matches"),
    admin.rpc("expire_usage_reservations"),
    // Conservative by construction: only a draft still exactly as the wizard
    // created it, and only after 30 days. The function carries the reasoning.
    admin.rpc("expire_abandoned_campaign_drafts"),
    // Marked CANCELLED, never deleted -- the row is the only record that a file
    // was uploaded, and the file is the customer's own data.
    admin.rpc("expire_stalled_imports"),
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
  if (drafts.error) {
    console.error(
      "[maintenance] expire_abandoned_campaign_drafts failed:",
      drafts.error.message,
    );
  }
  if (imports.error) {
    console.error("[maintenance] expire_stalled_imports failed:", imports.error.message);
  }

  if (intent.error || reservations.error || drafts.error || imports.error) {
    throw new Error("Daily expiry sweep did not complete.");
  }

  const count = (value: unknown) => (typeof value === "number" ? value : 0);

  const expiredIntent = count(intent.data);
  const releasedReservations = count(reservations.data);
  const removedDrafts = count(drafts.data);
  const closedImports = count(imports.data);

  if (expiredIntent + releasedReservations + removedDrafts + closedImports > 0) {
    console.info(
      `[maintenance] expired ${expiredIntent} intent match(es), ` +
        `released ${releasedReservations} stale reservation(s), ` +
        `removed ${removedDrafts} abandoned draft(s), ` +
        `closed ${closedImports} stalled import(s)`,
    );
  }
}
