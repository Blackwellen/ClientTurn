import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { logEvent } from "@/lib/observability/log";
import { USD_TO_GBP } from "@/lib/voice/cost";
import { voiceRevenueLines, type LedgerSaleRow } from "@/lib/admin/voice-ops-model";
import { attributeRevenue, JOURNEY_CHANNEL_LABEL, channelForSourceType } from "./attribution";
import { loadRevenue, loadTouches } from "./revenue-journey-query";
import {
  buildRoiCard,
  computeQuoteAnalytics,
  computeVoiceAnalytics,
  type ObjectionFact,
  type QuoteAnalytics,
  type QuoteAuthorKind,
  type QuoteFact,
  type RoiCard,
  type VoiceAnalytics,
  type VoiceCallFact,
} from "./insight-metrics";

/**
 * Quote analytics (§42), voice analytics (§40) and the ROI card (§70): the
 * reads. The arithmetic is insight-metrics.ts.
 *
 * Workspace-scoped by the business id the page resolved server-side; service
 * role because quote internals, cost ledgers and voice rows are server-only.
 * RESTRICTED figures (margin, cost per outcome) are removed here unless the
 * viewer is an owner or admin, so they never reach a member's browser.
 *
 * A missing table (schema lag) is "not set up yet" for that section; any other
 * failure is "unavailable". Neither ever renders as zero.
 */

type Db = SupabaseClient;
const db = (): Db => createAdminClient() as unknown as Db;
const CHUNK = 250;
const MAX = 5000;

export type InsightResult<T> =
  | { status: "ok"; data: T; truncated: boolean }
  | { status: "not_set_up"; message: string }
  | { status: "unavailable"; message: string };

class SchemaLag extends Error {}

async function read<T>(run: () => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (isSchemaLag(error)) throw new SchemaLag(error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

function canSeeRestricted(role: string): boolean {
  return role === "owner" || role === "admin";
}

type Bounds = { from: Date; to: Date };

/* =================================================================== quotes */

const PRICE_OBJECTION = /(price|discount|budget|cost|expensive|afford)/i;

export async function getQuoteAnalytics(
  businessId: string,
  bounds: Bounds,
  role: string,
): Promise<InsightResult<QuoteAnalytics & { restrictedVisible: boolean }>> {
  try {
    const quotes = await read<{ id: string; opportunity_id: string; created_by_kind: QuoteAuthorKind; currency: string; created_at: string; current_revision_id: string | null }>(() =>
      db()
        .from("quotes")
        .select("id, opportunity_id, created_by_kind, currency, created_at, current_revision_id")
        .eq("business_id", businessId)
        .gte("created_at", bounds.from.toISOString())
        .lte("created_at", bounds.to.toISOString())
        .order("created_at", { ascending: true })
        .limit(MAX),
    );
    const truncated = quotes.length >= MAX;
    if (quotes.length === 0) {
      return { status: "ok", data: { ...computeQuoteAnalytics([]), restrictedVisible: canSeeRestricted(role) }, truncated };
    }

    const quoteIds = quotes.map((q) => q.id);
    const revisionIds = quotes.map((q) => q.current_revision_id).filter((id): id is string => Boolean(id));
    const oppIds = [...new Set(quotes.map((q) => q.opportunity_id))];

    const revisions: { quote_id: string; id: string; total_gross_minor: number }[] = [];
    const events: { quote_id: string; event_type: string; occurred_at: string; detail: Record<string, unknown> | null }[] = [];
    const lines: { revision_id: string; list_minor: number; bundle_discount_minor: number; line_discount_minor: number; quote_discount_minor: number; net_minor: number; margin_minor: number | null }[] = [];
    const opps: { id: string; lead_id: string | null }[] = [];

    for (const ids of chunks(quoteIds)) {
      const [r, e] = await Promise.all([
        read<{ quote_id: string; id: string; total_gross_minor: number }>(() =>
          db().from("quote_revisions").select("quote_id, id, total_gross_minor").eq("business_id", businessId).in("quote_id", ids),
        ),
        read<{ quote_id: string; event_type: string; occurred_at: string; detail: Record<string, unknown> | null }>(() =>
          db()
            .from("quote_events")
            .select("quote_id, event_type, occurred_at, detail")
            .eq("business_id", businessId)
            .in("quote_id", ids)
            .order("occurred_at", { ascending: true }),
        ),
      ]);
      revisions.push(...r);
      events.push(...e);
    }
    for (const ids of chunks(revisionIds)) {
      lines.push(
        ...(await read<(typeof lines)[number]>(() =>
          db()
            .from("quote_line_items")
            .select("revision_id, list_minor, bundle_discount_minor, line_discount_minor, quote_discount_minor, net_minor, margin_minor")
            .eq("business_id", businessId)
            .in("revision_id", ids),
        )),
      );
    }
    for (const ids of chunks(oppIds)) {
      opps.push(...(await read<{ id: string; lead_id: string | null }>(() => db().from("opportunities").select("id, lead_id").eq("business_id", businessId).in("id", ids))));
    }
    const leadByOpp = new Map(opps.map((o) => [o.id, o.lead_id]));
    const leadIds = [...new Set(opps.map((o) => o.lead_id).filter((id): id is string => Boolean(id)))];

    const firstSource = new Map<string, string>();
    const objections = new Map<string, string[]>();
    for (const ids of chunks(leadIds)) {
      const [touches, obj] = await Promise.all([
        read<{ lead_id: string; source_type: string }>(() => db().from("lead_first_touch").select("lead_id, source_type").eq("business_id", businessId).in("lead_id", ids)).catch((error) => {
          if (error instanceof SchemaLag) return [];
          throw error;
        }),
        read<{ lead_id: string; objection_key: string; occurred_at: string }>(() =>
          db().from("objection_events").select("lead_id, objection_key, occurred_at").eq("business_id", businessId).in("lead_id", ids),
        ).catch((error) => {
          if (error instanceof SchemaLag) return [];
          throw error;
        }),
      ]);
      for (const t of touches) firstSource.set(t.lead_id, JOURNEY_CHANNEL_LABEL[channelForSourceType(t.source_type)]);
      for (const o of obj) if (PRICE_OBJECTION.test(o.objection_key)) objections.set(o.lead_id, [...(objections.get(o.lead_id) ?? []), o.occurred_at]);
    }

    const revisionCount = new Map<string, number>();
    const grossByRevision = new Map<string, number>();
    for (const r of revisions) {
      revisionCount.set(r.quote_id, (revisionCount.get(r.quote_id) ?? 0) + 1);
      grossByRevision.set(r.id, r.total_gross_minor);
    }
    const linesByRevision = new Map<string, typeof lines>();
    for (const l of lines) linesByRevision.set(l.revision_id, [...(linesByRevision.get(l.revision_id) ?? []), l]);
    const eventsByQuote = new Map<string, typeof events>();
    for (const e of events) eventsByQuote.set(e.quote_id, [...(eventsByQuote.get(e.quote_id) ?? []), e]);

    const facts: QuoteFact[] = quotes.map((q) => {
      const ev = eventsByQuote.get(q.id) ?? [];
      const firstAt = (...types: string[]) => ev.find((e) => types.includes(e.event_type))?.occurred_at ?? null;
      const sent = ev.find((e) => e.event_type === "quote.sent");
      const revLines = q.current_revision_id ? (linesByRevision.get(q.current_revision_id) ?? []) : [];
      const listMinor = revLines.length ? revLines.reduce((s, l) => s + l.list_minor, 0) : null;
      const discountMinor = revLines.length
        ? revLines.reduce((s, l) => s + l.bundle_discount_minor + l.line_discount_minor + l.quote_discount_minor, 0)
        : null;
      const netMinor = revLines.length ? revLines.reduce((s, l) => s + l.net_minor, 0) : null;
      const marginMinor = revLines.length && revLines.every((l) => l.margin_minor !== null) ? revLines.reduce((s, l) => s + (l.margin_minor as number), 0) : null;
      const leadId = leadByOpp.get(q.opportunity_id) ?? null;
      const sentAt = sent?.occurred_at ?? null;
      const priceObjections = leadId ? (objections.get(leadId) ?? []) : [];
      const channel = sent?.detail && typeof sent.detail.channel === "string" ? sent.detail.channel : null;
      return {
        id: q.id,
        createdAt: q.created_at,
        createdByKind: q.created_by_kind,
        currency: q.currency,
        source: leadId ? (firstSource.get(leadId) ?? null) : null,
        sentVia: channel,
        requestedAt: firstAt("quote.requested"),
        sentAt,
        firstViewedAt: firstAt("quote.viewed"),
        acceptedAt: firstAt("quote.accepted"),
        signedAt: firstAt("quote.signed"),
        paidAt: firstAt("quote.deposit_paid", "quote.paid"),
        declinedAt: firstAt("quote.declined"),
        expiredAt: firstAt("quote.expired"),
        revisions: Math.max(1, revisionCount.get(q.id) ?? 1),
        grossMinor: q.current_revision_id ? (grossByRevision.get(q.current_revision_id) ?? null) : null,
        listMinor,
        discountMinor,
        netMinor,
        marginMinor,
        discountRequested: priceObjections.some((at) => !sentAt || at <= sentAt),
      };
    });

    const analytics = computeQuoteAnalytics(facts);
    const restrictedVisible = canSeeRestricted(role);
    if (!restrictedVisible) {
      analytics.margin = { restricted: true, quotesWithCost: 0, averageMarginPercent: null, averageMarginPercentBeforeDiscount: null, impactPoints: null };
    }
    return { status: "ok", data: { ...analytics, restrictedVisible }, truncated };
  } catch (error) {
    if (error instanceof SchemaLag) return { status: "not_set_up", message: "Quotes are not set up on this workspace's database yet." };
    logEvent("analytics.read_failed", { area: "quote_analytics", businessId, error }, "error");
    return { status: "unavailable", message: "Quote analytics could not be loaded right now." };
  }
}

/* ==================================================================== voice */

type CallRow = {
  id: string;
  lead_id: string;
  route: string;
  direction: "OUTBOUND" | "INBOUND";
  outcome: string | null;
  answered_at: string | null;
  started_at: string | null;
  created_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  billed_sec: number | null;
};

async function loadCalls(businessId: string, bounds: Bounds): Promise<CallRow[]> {
  return read<CallRow>(() =>
    db()
      .from("voice_calls")
      .select("id, lead_id, route, direction, outcome, answered_at, started_at, created_at, ended_at, duration_sec, billed_sec")
      .eq("business_id", businessId)
      .gte("created_at", bounds.from.toISOString())
      .lte("created_at", bounds.to.toISOString())
      .order("created_at", { ascending: true })
      .limit(MAX),
  );
}

export async function getVoiceAnalytics(
  businessId: string,
  bounds: Bounds,
  role: string,
): Promise<InsightResult<VoiceAnalytics & { restrictedVisible: boolean; quality: { available: false; note: string } }>> {
  const quality = {
    available: false as const,
    note: "No call quality grades are recorded yet. Objection handling (resolved share) is the closest measured signal and is shown above.",
  };
  try {
    const calls = await loadCalls(businessId, bounds);
    const restrictedVisible = canSeeRestricted(role);
    if (calls.length === 0) {
      return { status: "ok", data: { ...computeVoiceAnalytics([], []), restrictedVisible, quality }, truncated: false };
    }
    const callIds = calls.map((c) => c.id);
    const leadIds = [...new Set(calls.map((c) => c.lead_id))];

    const outcomes = new Map<string, string>();
    const costByCall = new Map<string, number>();
    for (const ids of chunks(callIds)) {
      const [o, costs] = await Promise.all([
        read<{ voice_call_id: string; disposition: string }>(() =>
          db().from("voice_call_outcomes").select("voice_call_id, disposition").eq("business_id", businessId).in("voice_call_id", ids),
        ),
        restrictedVisible
          ? read<{ id: string; voice_call_id: string | null; total_cost: number | string; currency: string; reconciles_id: string | null }>(() =>
              db().from("voice_cost_ledger").select("id, voice_call_id, total_cost, currency, reconciles_id").eq("business_id", businessId).in("voice_call_id", ids),
            )
          : Promise.resolve([]),
      ]);
      for (const row of o) outcomes.set(row.voice_call_id, row.disposition);
      const superseded = new Set(costs.map((c) => c.reconciles_id).filter(Boolean));
      for (const c of costs) {
        if (!c.voice_call_id || superseded.has(c.id)) continue;
        const amount = Number(c.total_cost);
        if (!Number.isFinite(amount)) continue;
        costByCall.set(c.voice_call_id, (costByCall.get(c.voice_call_id) ?? 0) + (c.currency === "GBP" ? amount : amount * USD_TO_GBP));
      }
    }

    // What happened after each call: bookings, quotes sent, recorded revenue.
    const bookingsByLead = new Map<string, string[]>();
    const quotesByLead = new Map<string, string[]>();
    for (const ids of chunks(leadIds)) {
      const [bookings, opps] = await Promise.all([
        read<{ lead_id: string; created_at: string }>(() =>
          db().from("bookings").select("lead_id, created_at").eq("business_id", businessId).in("lead_id", ids).neq("status", "cancelled"),
        ),
        read<{ id: string; lead_id: string }>(() => db().from("opportunities").select("id, lead_id").eq("business_id", businessId).in("lead_id", ids)),
      ]);
      for (const b of bookings) bookingsByLead.set(b.lead_id, [...(bookingsByLead.get(b.lead_id) ?? []), b.created_at]);
      const leadByOpp = new Map(opps.map((o) => [o.id, o.lead_id]));
      for (const oppIds of chunks([...leadByOpp.keys()])) {
        const quotes = await read<{ id: string; opportunity_id: string }>(() =>
          db().from("quotes").select("id, opportunity_id").eq("business_id", businessId).in("opportunity_id", oppIds),
        ).catch((error) => {
          if (error instanceof SchemaLag) return [];
          throw error;
        });
        const oppByQuote = new Map(quotes.map((q) => [q.id, q.opportunity_id]));
        for (const qIds of chunks([...oppByQuote.keys()])) {
          const sent = await read<{ quote_id: string; occurred_at: string }>(() =>
            db().from("quote_events").select("quote_id, occurred_at").eq("business_id", businessId).in("quote_id", qIds).eq("event_type", "quote.sent"),
          );
          for (const s of sent) {
            const lead = leadByOpp.get(oppByQuote.get(s.quote_id) ?? "");
            if (lead) quotesByLead.set(lead, [...(quotesByLead.get(lead) ?? []), s.occurred_at]);
          }
        }
      }
    }
    const missing: string[] = [];
    const revenue = await loadRevenue(businessId, { leadIds }, missing);
    const revenueByLead = new Map<string, string[]>();
    for (const r of revenue) revenueByLead.set(r.leadId, [...(revenueByLead.get(r.leadId) ?? []), r.at]);

    const after = (list: string[] | undefined, at: string) => (list ?? []).some((x) => x >= at);
    const facts: VoiceCallFact[] = calls.map((c) => {
      const at = c.started_at ?? c.created_at;
      return {
        id: c.id,
        leadId: c.lead_id,
        route: c.route,
        direction: c.direction,
        outcome: c.outcome,
        answeredAt: c.answered_at,
        endedAt: c.ended_at,
        durationSec: c.duration_sec,
        disposition: outcomes.get(c.id) ?? null,
        costGbp: costByCall.has(c.id) ? (costByCall.get(c.id) as number) : null,
        bookedAfter: after(bookingsByLead.get(c.lead_id), at),
        quotedAfter: after(quotesByLead.get(c.lead_id), at),
        soldAfter: after(revenueByLead.get(c.lead_id), at),
      };
    });

    const objectionRows = await read<{ objection_key: string; handled_outcome: string | null; channel: string }>(() =>
      db()
        .from("objection_events")
        .select("objection_key, handled_outcome, channel")
        .eq("business_id", businessId)
        .eq("channel", "VOICE")
        .gte("occurred_at", bounds.from.toISOString())
        .lte("occurred_at", bounds.to.toISOString())
        .limit(MAX),
    );
    const objections: ObjectionFact[] = objectionRows.map((o) => ({ key: o.objection_key, handledOutcome: o.handled_outcome, channel: o.channel }));

    const analytics = computeVoiceAnalytics(facts, objections);
    if (!restrictedVisible) {
      analytics.costPerOutcome = { restricted: true, totalCostGbp: null, perConnectedCall: null, perBooking: null, perQuote: null, perSale: null };
    }
    return { status: "ok", data: { ...analytics, restrictedVisible, quality }, truncated: calls.length >= MAX };
  } catch (error) {
    if (error instanceof SchemaLag) return { status: "not_set_up", message: "AI calling is not set up on this workspace's database yet." };
    logEvent("analytics.read_failed", { area: "voice_analytics", businessId, error }, "error");
    return { status: "unavailable", message: "Voice analytics could not be loaded right now." };
  }
}

/* ====================================================================== ROI */

export const ROI_MODEL = "position" as const;

/**
 * The ROI chain for voice: minutes and spend -> qualified -> booked -> quotes
 * -> sales -> revenue credited to calls (position-based). Renders only with
 * real minutes AND real recorded revenue (buildRoiCard).
 */
export async function getVoiceRoi(businessId: string, bounds: Bounds): Promise<InsightResult<RoiCard>> {
  try {
    const calls = await loadCalls(businessId, bounds);
    const voiceMinutes = calls.reduce((s, c) => s + (typeof c.billed_sec === "number" ? c.billed_sec : 0), 0) / 60;
    const ledger = await read<LedgerSaleRow>(() =>
      db()
        .from("voice_minute_ledger")
        .select("business_id, kind, pack_delta_sec, included_delta_sec, created_at")
        .eq("business_id", businessId)
        .in("kind", ["PACK_PURCHASE", "PACK_REFUND", "PERIOD_GRANT"])
        .gte("created_at", bounds.from.toISOString())
        .lte("created_at", bounds.to.toISOString())
        .limit(MAX),
    );
    const { lines } = voiceRevenueLines(ledger);
    const spend = lines.length ? lines.reduce((s, l) => s + l.sign * l.priceGbp, 0) : null;

    const leadIds = [...new Set(calls.filter((c) => c.outcome && c.outcome !== "CANCELLED").map((c) => c.lead_id))];
    if (leadIds.length === 0) {
      return { status: "ok", data: buildRoiCard({ voiceMinutes, voiceSpendGbp: spend, qualified: 0, booked: 0, quotes: 0, sales: 0, attributedRevenueMinor: {}, model: ROI_MODEL }), truncated: false };
    }

    let qualified = 0;
    let booked = 0;
    for (const ids of chunks(leadIds)) {
      const leads = await read<{ id: string; qualified_at: string | null; booked_at: string | null }>(() =>
        db().from("leads").select("id, qualified_at, booked_at").eq("business_id", businessId).in("id", ids),
      );
      qualified += leads.filter((l) => l.qualified_at).length;
      booked += leads.filter((l) => l.booked_at).length;
    }

    const missing: string[] = [];
    const [touches, revenue] = await Promise.all([
      loadTouches(businessId, leadIds, missing),
      loadRevenue(businessId, { leadIds, from: bounds.from, to: bounds.to }, missing),
    ]);
    const quotes = new Set(touches.filter((t) => t.kind === "QUOTE_SENT").map((t) => t.leadId)).size;
    const sales = new Set(revenue.map((r) => r.leadId)).size;
    const summary = attributeRevenue(touches, revenue, ROI_MODEL);
    const voiceRow = summary.rows.find((r) => r.channel === "VOICE");

    return {
      status: "ok",
      data: buildRoiCard({
        voiceMinutes,
        voiceSpendGbp: spend,
        qualified,
        booked,
        quotes,
        sales,
        attributedRevenueMinor: voiceRow?.revenueMinor ?? {},
        model: ROI_MODEL,
      }),
      truncated: calls.length >= MAX,
    };
  } catch (error) {
    if (error instanceof SchemaLag) return { status: "not_set_up", message: "AI calling is not set up on this workspace's database yet." };
    logEvent("analytics.read_failed", { area: "voice_roi", businessId, error }, "error");
    return { status: "unavailable", message: "The return on voice could not be calculated right now." };
  }
}
