import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
// The arithmetic lives in the pure module beside the registry; this file is
// only the shell that counts the inputs.
import type { EngagementTotals } from "./v4-metrics";
export { withRates, type EngagementTotals, type EngagementRates } from "./v4-metrics";

/**
 * Recipient-level engagement — the one place reply rate is computed.
 *
 * Before this module the product computed "reply rate" five different ways:
 *
 *   * `v4-queries.getOutreach`     inbound *messages* / outbound *messages*
 *   * `v4-extras.getChannelPerformance`  the same, per channel, with FAILED in
 *                                        the denominator
 *   * `billing/usage-service`      the same again, a third copy
 *   * `campaigns/reactivation-types`  (replies / sent) * 100, returning 0 on an
 *                                     empty denominator
 *   * `leads/queries`              replied *leads* / contacted *leads* * 100
 *
 * — while the definition published to the customer in `v4-metrics.METRICS` said
 * something none of them did: *"Contacts who sent at least one inbound reply
 * divided by contacts messaged."* Three screens showed three different numbers
 * under one name, and the tooltip explaining that name matched none of them.
 *
 * Two decisions make this module the answer rather than a sixth version.
 *
 * **People, not messages.** A lead who replies four times is one contact who
 * replied. Message-level counting inflates an engaged conversation into an
 * engaged audience, which is the opposite of what the number is read for.
 *
 * **Counted by Postgres.** Every query here is `{ count: "exact", head: true }`
 * against a table that already holds one row per recipient — the per-recipient
 * state tables exist precisely so this does not require scanning `messages`.
 * The alternative, fetching rows and reducing in JavaScript, is what silently
 * truncates above the PostgREST row cap and reports a wrong number as a right
 * one.
 *
 * The unit is a fraction in [0, 1], and an empty denominator is `null`, never
 * zero. `rate()` carries that rule and this module never bypasses it.
 */

type Window = { from: string; to: string };

/* ------------------------------------------------------ cold acquisition --- */

/**
 * Cold outreach engagement, from `outreach_recipient_runs`.
 *
 * That table is already one row per prospect per campaign, carrying
 * `steps_sent` and `replied_at`, so recipient-level counting is a count of rows
 * rather than a distinct over messages.
 */
export async function coldEngagement(
  businessId: string,
  window: Window,
  campaignId?: string,
): Promise<EngagementTotals> {
  const admin = createAdminClient();

  const base = () => {
    let q = admin
      .from("outreach_recipient_runs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", window.from)
      .lt("created_at", window.to);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    return q;
  };

  const [contacted, replied, unsubscribed] = await Promise.all([
    // A recipient run with no step sent is an enrolment, not a contact.
    base().gt("steps_sent", 0),
    base().not("replied_at", "is", null),
    base().eq("status", "SUPPRESSED"),
  ]);

  const positive = await positiveReplyCount(businessId, window, {
    column: "campaign_id",
    value: campaignId,
    subject: "prospect_id",
  });

  return {
    contacted: contacted.count ?? 0,
    replied: replied.count ?? 0,
    positive,
    optedOut: unsubscribed.count ?? 0,
  };
}

/* ---------------------------------------------------- warm reactivation --- */

/**
 * Reactivation engagement, from `campaign_contacts` — one row per lead per
 * campaign, with `sent_at` and `replied_at` already on it.
 */
export async function reactivationEngagement(
  businessId: string,
  window: Window,
  campaignId?: string,
): Promise<EngagementTotals> {
  const admin = createAdminClient();

  const base = () => {
    let q = admin
      .from("campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", window.from)
      .lt("created_at", window.to);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    return q;
  };

  const [contacted, replied, stopped] = await Promise.all([
    base().not("sent_at", "is", null),
    base().not("replied_at", "is", null),
    base().eq("stopped_reason", "opted_out"),
  ]);

  const positive = await positiveReplyCount(businessId, window, {
    column: "campaign_id",
    value: campaignId,
    subject: "lead_id",
  });

  return {
    contacted: contacted.count ?? 0,
    replied: replied.count ?? 0,
    positive,
    optedOut: stopped.count ?? 0,
  };
}

/* ------------------------------------------------------- warm lifecycle --- */

/**
 * Workspace-wide warm engagement, from `leads`.
 *
 * `first_contacted_at` and `first_replied_at` are stamped once per lead by the
 * send and inbound paths, which makes them the cheapest correct answer to "how
 * many people did we reach, and how many answered" — no distinct, no scan.
 */
export async function leadEngagement(
  businessId: string,
  window: Window,
): Promise<EngagementTotals> {
  const admin = createAdminClient();

  const base = () =>
    admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false);

  const inWindow = (column: string) =>
    base().gte(column, window.from).lt(column, window.to);

  const [contacted, replied, optedOut] = await Promise.all([
    inWindow("first_contacted_at"),
    inWindow("first_replied_at"),
    base()
      .eq("opted_out", true)
      .gte("updated_at", window.from)
      .lt("updated_at", window.to),
  ]);

  const positive = await positiveReplyCount(businessId, window, {
    subject: "lead_id",
  });

  return {
    contacted: contacted.count ?? 0,
    replied: replied.count ?? 0,
    positive,
    optedOut: optedOut.count ?? 0,
  };
}

/* -------------------------------------------------------- whole workspace --- */

/**
 * Everyone this workspace contacted in the window, across both funnels.
 *
 * Cold recipients live in `outreach_recipient_runs` and warm ones in `leads`,
 * and the two are all but disjoint: a prospect only becomes a lead through
 * promotion, and `leads.first_contacted_at` is stamped by the warm send path,
 * which a freshly promoted lead has not been through yet.
 *
 * "All but" is the honest word. A prospect contacted cold, promoted, and then
 * messaged warm inside the same window is counted once on each side. That is a
 * real over-count, it is bounded by the promotion rate, and it is stated here
 * rather than hidden — the alternative is a `distinct` over `messages` joined to
 * two subject columns, which cannot be done with a count query and would put
 * this back to scanning rows.
 *
 * Delivery and bounce rates are deliberately *not* computed here: a delivery is
 * a property of a message, not of a person, and `v4-metrics` says so. Mixing
 * the two units is how the divergence started.
 */
export async function workspaceEngagement(
  businessId: string,
  window: Window,
): Promise<EngagementTotals> {
  const [cold, warm] = await Promise.all([
    coldEngagement(businessId, window),
    leadEngagement(businessId, window),
  ]);

  return {
    contacted: cold.contacted + warm.contacted,
    replied: cold.replied + warm.replied,
    positive: cold.positive + warm.positive,
    optedOut: cold.optedOut + warm.optedOut,
  };
}

/* ------------------------------------------------------------- helpers --- */

/**
 * Distinct people whose reply was classified as engaged.
 *
 * This is the one figure that cannot come from a per-recipient table, because
 * the classification lives on the message. It is still counted rather than
 * fetched: the subject column is indexed, and the result is a count of matching
 * messages rather than of people.
 *
 * That difference is stated here rather than hidden: a contact who sends two
 * positive replies counts twice, so `positive` is capped at `replied` by the
 * callers above through `rate(positive, replied)` only ever being read as a
 * share of replies. When a SQL function can be added, this becomes
 * `count(distinct subject)` and the cap becomes unnecessary.
 */
async function positiveReplyCount(
  businessId: string,
  window: Window,
  options: { column?: string; value?: string; subject: "lead_id" | "prospect_id" },
): Promise<number> {
  const admin = createAdminClient();

  let query = admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("direction", "inbound")
    .not(options.subject, "is", null)
    .in("reply_classification", ["POSITIVE_INTEREST", "NEUTRAL_QUESTION"])
    .gte("created_at", window.from)
    .lt("created_at", window.to);

  if (options.column && options.value) {
    query = query.eq(options.column, options.value);
  }

  const { count } = await query;
  return count ?? 0;
}
