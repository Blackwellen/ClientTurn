import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ResolvedRange } from "@/lib/dates";
import { getCreditStatus, type CreditStatus } from "@/lib/billing/token-service";
import {
  assembleRevenueFunnel,
  type RevenueFunnelKey,
  type RevenueFunnelStage,
} from "@/lib/analytics/revenue-surfaces";
import { leadDisplayName } from "@/lib/leads/types";

/**
 * The Dashboard's "Revenue control" section (design doc 05, Phase 5).
 *
 * Each card loads independently and reports its own state. The tables behind
 * most of them (0121-0123) are newer than some databases: a missing table or a
 * failed read makes *that card* say it is unavailable, and never zero -- "0 hot
 * leads" when the scores table does not exist would be a fabricated metric.
 *
 * Member-readable tables are read with the person's own session (RLS). AI
 * spend lives in service-only tables, so the budget card alone uses the
 * service role, scoped to the workspace the session resolved.
 */

export type CardState<T> =
  { status: "ok"; data: T } | { status: "unavailable"; message: string };

type Named = { id: string; name: string };

export type RevenueControlData = {
  hotNotContacted: CardState<{ count: number; examples: Named[] }>;
  unansweredReplies: CardState<{ count: number; oldestAt: string | null }>;
  bookingReady: CardState<{ count: number }>;
  stalledOpportunities: CardState<{ count: number; value: number }>;
  aiEscalations: CardState<{ count: number; urgent: number }>;
  deliverability: CardState<
    | { checked: false; mailboxes: number }
    | {
        checked: true;
        worst: "HEALTHY" | "WATCH" | "WARNING" | "PAUSED";
        domains: number;
        latestDate: string;
        attention: string[];
      }
  >;
  aiBudget: CardState<AiCreditSnapshot>;
  compliance: CardState<{
    reviewContactability: number;
    openMergeCandidates: number;
  }>;
  funnel: CardState<(RevenueFunnelStage & { tracked: boolean })[]>;
};

const STALL_MS = 7 * 864e5;
const HOT_LIMIT = 1000;

type Untyped = SupabaseClient;

function unavailable(what: string): { status: "unavailable"; message: string } {
  return { status: "unavailable", message: `${what} is not available yet.` };
}

/** Runs a card loader; any throw becomes that card's unavailable state. */
async function card<T>(
  what: string,
  load: () => Promise<T>,
): Promise<CardState<T>> {
  try {
    return { status: "ok", data: await load() };
  } catch (error) {
    console.error(`[dashboard] revenue card "${what}" failed`, error);
    return unavailable(what);
  }
}

function check<T>(result: {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}) {
  if (result.error) throw new Error(result.error.message);
  return result;
}

export async function getRevenueControl(
  businessId: string,
  range: ResolvedRange,
): Promise<RevenueControlData> {
  const supabase = (await createClient()) as unknown as Untyped;
  const now = Date.now();

  const [
    hotNotContacted,
    unansweredReplies,
    bookingReady,
    stalledOpportunities,
    aiEscalations,
    deliverability,
    aiBudget,
    compliance,
    funnel,
  ] = await Promise.all([
    card("Hot leads", async () => {
      const scores = check(
        await supabase
          .from("lead_scores")
          .select("lead_id")
          .eq("business_id", businessId)
          .eq("is_current", true)
          .in("grade", ["A", "B"])
          .limit(HOT_LIMIT),
      );
      const ids = ((scores.data ?? []) as { lead_id: string }[]).map(
        (row) => row.lead_id,
      );
      if (ids.length === 0) return { count: 0, examples: [] };
      const leads = check(
        await supabase
          .from("leads")
          .select("id, first_name, last_name, email, phone", { count: "exact" })
          .eq("business_id", businessId)
          .in("id", ids)
          .eq("is_test", false)
          .eq("opted_out", false)
          .is("archived_at", null)
          .is("first_contacted_at", null)
          .order("created_at", { ascending: false })
          .limit(3),
      );
      const rows = (leads.data ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
      }[];
      return {
        count: leads.count ?? rows.length,
        examples: rows.map((row) => ({
          id: row.id,
          name: leadDisplayName(row),
        })),
      };
    }),

    card("Unanswered replies", async () => {
      const result = check(
        await supabase
          .from("conversations")
          .select("last_inbound_at, last_outbound_at")
          .eq("business_id", businessId)
          .eq("is_archived", false)
          .not("lead_id", "is", null)
          .not("last_inbound_at", "is", null)
          .order("last_inbound_at", { ascending: false })
          .limit(500),
      );
      const waiting = (
        (result.data ?? []) as {
          last_inbound_at: string;
          last_outbound_at: string | null;
        }[]
      ).filter(
        (row) =>
          !row.last_outbound_at ||
          Date.parse(row.last_outbound_at) < Date.parse(row.last_inbound_at),
      );
      return {
        count: waiting.length,
        oldestAt: waiting.length
          ? waiting[waiting.length - 1].last_inbound_at
          : null,
      };
    }),

    // Qualified and not yet booked: a lead leaves QUALIFIED the moment it is
    // booked, won or lost. The same set as the Leads "Qualified" tab the card
    // links to (non-test leads with status QUALIFIED), so the two agree.
    card("Booking-ready leads", async () => {
      const result = check(
        await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("is_test", false)
          .eq("status", "QUALIFIED"),
      );
      return { count: result.count ?? 0 };
    }),

    card("Stalled opportunities", async () => {
      const result = check(
        await supabase
          .from("opportunities")
          .select("value")
          .eq("business_id", businessId)
          .eq("outcome", "OPEN")
          .lt("updated_at", new Date(now - STALL_MS).toISOString())
          .limit(2000),
      );
      const rows = (result.data ?? []) as { value: number | string | null }[];
      return {
        count: rows.length,
        value: rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
      };
    }),

    card("AI escalations", async () => {
      const result = check(
        await supabase
          .from("agent_handoffs")
          .select("priority")
          .eq("business_id", businessId)
          .in("status", ["OPEN", "ACKNOWLEDGED"])
          .limit(1000),
      );
      const rows = (result.data ?? []) as { priority: string }[];
      return {
        count: rows.length,
        urgent: rows.filter(
          (row) => row.priority === "URGENT" || row.priority === "HIGH",
        ).length,
      };
    }),

    card("Deliverability", async () => {
      const since = new Date(now - 7 * 864e5).toISOString().slice(0, 10);
      const [snapshots, mailboxes] = await Promise.all([
        supabase
          .from("domain_health_snapshots")
          .select(
            "domain, snapshot_date, health_state, spf_state, dkim_state, dmarc_state",
          )
          .eq("business_id", businessId)
          .gte("snapshot_date", since)
          .order("snapshot_date", { ascending: false })
          .limit(200),
        supabase
          .from("mailbox_connections")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId),
      ]);
      check(snapshots);
      const rows = (snapshots.data ?? []) as {
        domain: string;
        snapshot_date: string;
        health_state: "HEALTHY" | "WATCH" | "WARNING" | "PAUSED";
        spf_state: string;
        dkim_state: string;
        dmarc_state: string;
      }[];
      if (rows.length === 0) {
        // Honest: no snapshot means nobody has checked, not that all is well.
        return { checked: false as const, mailboxes: mailboxes.count ?? 0 };
      }
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows)
        if (!latest.has(row.domain)) latest.set(row.domain, row);
      const rank = { HEALTHY: 0, WATCH: 1, WARNING: 2, PAUSED: 3 } as const;
      let worst: keyof typeof rank = "HEALTHY";
      const attention: string[] = [];
      for (const row of latest.values()) {
        if (rank[row.health_state] > rank[worst]) worst = row.health_state;
        const failing = (["spf", "dkim", "dmarc"] as const).filter(
          (key) =>
            row[`${key}_state`] === "FAIL" || row[`${key}_state`] === "MISSING",
        );
        // Failing authentication is a warning even when bounces are low;
        // otherwise the tile reads "Healthy" above "SPF not passing".
        if (failing.length && rank[worst] < rank.WARNING) worst = "WARNING";
        if (row.health_state !== "HEALTHY" || failing.length) {
          attention.push(
            failing.length
              ? `${row.domain}: ${failing.map((f) => f.toUpperCase()).join(", ")} not passing`
              : `${row.domain}: ${row.health_state.toLowerCase()}`,
          );
        }
      }
      return {
        checked: true as const,
        worst,
        domains: latest.size,
        latestDate: rows[0].snapshot_date,
        attention: attention.slice(0, 3),
      };
    }),

    card("AI credits", () => loadAiCredits(businessId)),

    card("Compliance", async () => {
      const [review, merges] = await Promise.all([
        supabase
          .from("contactability_results")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("result", "REVIEW_REQUIRED"),
        supabase
          .from("merge_candidates")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("status", "OPEN"),
      ]);
      check(review);
      check(merges);
      return {
        reviewContactability: review.count ?? 0,
        openMergeCandidates: merges.count ?? 0,
      };
    }),

    card("Funnel", async () =>
      assembleRevenueFunnel(
        await countRevenueFunnel(supabase, businessId, range.from, range.to),
      ),
    ),
  ]);

  return {
    hotNotContacted,
    unansweredReplies,
    bookingReady,
    stalledOpportunities,
    aiEscalations,
    deliverability,
    aiBudget,
    compliance,
    funnel,
  };
}

/* ------------------------------------------------------- shared loaders
 *
 * Also used by the `funnel.get` and `ai_usage.get` service operations, which
 * run without a browser session and so pass the service-role client, already
 * scoped to the caller's workspace by the service runtime.
 */

/** Stage counts for the leads created in [from, to). `showed` is null when bookings cannot be read. */
export async function countRevenueFunnel(
  client: Untyped,
  businessId: string,
  from: Date,
  to: Date,
): Promise<Record<RevenueFunnelKey, number | null>> {
  const cohort = check(
    await client
      .from("leads")
      .select(
        "id, first_contacted_at, first_replied_at, qualified_at, booked_at, won_at",
      )
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .limit(5000),
  );
  const rows = (cohort.data ?? []) as {
    id: string;
    first_contacted_at: string | null;
    first_replied_at: string | null;
    qualified_at: string | null;
    booked_at: string | null;
    won_at: string | null;
  }[];

  // Show-up comes from bookings marked completed. Read in chunks so a large
  // cohort does not build an unbounded `in (...)`.
  let showed: number | null = 0;
  const bookedIds = rows.filter((row) => row.booked_at).map((row) => row.id);
  const attended = new Set<string>();
  for (let i = 0; i < bookedIds.length && showed !== null; i += 200) {
    const result = await client
      .from("bookings")
      .select("lead_id")
      .eq("business_id", businessId)
      .eq("status", "completed")
      .in("lead_id", bookedIds.slice(i, i + 200));
    if (result.error) showed = null;
    else
      for (const b of (result.data ?? []) as { lead_id: string }[])
        attended.add(b.lead_id);
  }
  if (showed !== null) showed = attended.size;

  return {
    source: rows.length,
    contacted: rows.filter((r) => r.first_contacted_at).length,
    replied: rows.filter((r) => r.first_replied_at).length,
    qualified: rows.filter((r) => r.qualified_at).length,
    booked: rows.filter((r) => r.booked_at).length,
    showed,
    won: rows.filter((r) => r.won_at).length,
  };
}

/**
 * AI credits this month (owner decision, 2026-09-30: customers see AI usage in
 * AI credits only, never money or model tokens). Read from the credit
 * allowance ledger; the £ ceilings stay in Admin.
 */
export type AiCreditSnapshot = CreditStatus;

export async function loadAiCredits(businessId: string): Promise<AiCreditSnapshot> {
  return getCreditStatus(businessId);
}
