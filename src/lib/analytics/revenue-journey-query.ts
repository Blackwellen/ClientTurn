import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { logEvent } from "@/lib/observability/log";
import {
  attributeRevenue,
  buildLeadJourney,
  channelForMessage,
  channelForSourceType,
  revenueEventsFrom,
  type AttributionSummary,
  type CheckoutPaymentFact,
  type InvoicePaymentFact,
  type JourneyModel,
  type JourneyTouch,
  type LeadJourney,
  type RevenueEvent,
  type WonOpportunityFact,
} from "./attribution";

/**
 * The revenue journey reads (§41). Pure maths in attribution.ts; this file
 * only reads rows and turns them into touches and revenue facts.
 *
 * Workspace-scoped: every read filters on the business id the caller resolved
 * server-side (requireWorkspace / the service context), with the service role
 * because voice, quote and payment rows are partly server-only. Bounded: a
 * lead set is capped and read in chunks.
 *
 * A source table that does not exist yet (schema lag) is skipped and named in
 * `missing`, so the UI can say which channels are not counted. A failed read
 * of anything else makes the whole result unavailable: a journey with a
 * silently missing payment would under-report and look complete.
 */

type Db = SupabaseClient;
const db = (): Db => createAdminClient() as unknown as Db;

const CHUNK = 250;
const MAX_LEADS = 2000;
const MAX_ROWS = 20_000;

export type JourneyLoad = {
  touches: JourneyTouch[];
  revenue: RevenueEvent[];
  missing: string[];
};

class ReadFailed extends Error {}

async function rows<T>(
  label: string,
  missing: string[],
  run: () => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (isSchemaLag(error)) {
      if (!missing.includes(label)) missing.push(label);
      return [];
    }
    throw new ReadFailed(`${label}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

function sourceLabel(row: { provider: string | null; campaign_name: string | null; form_name: string | null; utm_campaign: string | null }): string {
  const detail = row.campaign_name ?? row.form_name ?? row.utm_campaign;
  const provider = row.provider ? row.provider.replace(/_/g, " ") : "Source";
  return detail ? `${provider}: ${detail.slice(0, 60)}` : provider;
}

const QUOTE_TOUCH_EVENTS: Record<string, JourneyTouch["kind"]> = {
  "quote.sent": "QUOTE_SENT",
  "quote.viewed": "QUOTE_VIEWED",
  "quote.accepted": "QUOTE_ACCEPTED",
  "quote.signed": "QUOTE_SIGNED",
};
const QUOTE_TOUCH_LABEL: Record<string, string> = {
  QUOTE_SENT: "Quote sent",
  QUOTE_VIEWED: "Quote viewed",
  QUOTE_ACCEPTED: "Quote accepted",
  QUOTE_SIGNED: "Quote signed",
};

/** Every touch for these leads, across every channel, all time. */
export async function loadTouches(businessId: string, leadIds: readonly string[], missing: string[]): Promise<JourneyTouch[]> {
  const touches: JourneyTouch[] = [];
  for (const ids of chunks(leadIds)) {
    const [sources, messages, calls, bookings, opportunities] = await Promise.all([
      rows<{ id: string; lead_id: string; occurred_at: string; source_type: string; provider: string | null; campaign_name: string | null; form_name: string | null; utm_campaign: string | null }>(
        "lead_touches",
        missing,
        () =>
          db()
            .from("lead_touches")
            .select("id, lead_id, occurred_at, source_type, provider, campaign_name, form_name, utm_campaign")
            .eq("business_id", businessId)
            .in("lead_id", ids)
            .limit(MAX_ROWS),
      ),
      rows<{ id: string; lead_id: string; channel: string; sent_at: string }>("messages", missing, () =>
        db()
          .from("messages")
          .select("id, lead_id, channel, sent_at")
          .eq("business_id", businessId)
          .eq("direction", "outbound")
          .in("lead_id", ids)
          .not("sent_at", "is", null)
          .limit(MAX_ROWS),
      ),
      rows<{ id: string; lead_id: string; opportunity_id: string | null; created_at: string; started_at: string | null; outcome: string | null; duration_sec: number | null; direction: string }>(
        "voice_calls",
        missing,
        () =>
          db()
            .from("voice_calls")
            .select("id, lead_id, opportunity_id, created_at, started_at, outcome, duration_sec, direction")
            .eq("business_id", businessId)
            .in("lead_id", ids)
            .not("outcome", "is", null)
            .neq("outcome", "CANCELLED")
            .limit(MAX_ROWS),
      ),
      rows<{ id: string; lead_id: string; created_at: string; status: string }>("bookings", missing, () =>
        db()
          .from("bookings")
          .select("id, lead_id, created_at, status")
          .eq("business_id", businessId)
          .in("lead_id", ids)
          .neq("status", "cancelled")
          .limit(MAX_ROWS),
      ),
      rows<{ id: string; lead_id: string }>("opportunities", missing, () =>
        db().from("opportunities").select("id, lead_id").eq("business_id", businessId).in("lead_id", ids).limit(MAX_ROWS),
      ),
    ]);

    for (const s of sources) {
      touches.push({ id: `src:${s.id}`, leadId: s.lead_id, opportunityId: null, at: s.occurred_at, channel: channelForSourceType(s.source_type), kind: "SOURCE", label: sourceLabel(s) });
    }
    for (const m of messages) {
      const channel = channelForMessage(m.channel);
      if (!channel) continue;
      touches.push({ id: `msg:${m.id}`, leadId: m.lead_id, opportunityId: null, at: m.sent_at, channel, kind: "OUTBOUND_MESSAGE", label: `${channel === "SOCIAL" ? "Social" : channel === "WHATSAPP" ? "WhatsApp" : channel === "EMAIL" ? "Email" : "SMS"} sent` });
    }
    for (const c of calls) {
      const mins = typeof c.duration_sec === "number" ? ` (${Math.floor(c.duration_sec / 60)}m ${c.duration_sec % 60}s)` : "";
      touches.push({
        id: `call:${c.id}`,
        leadId: c.lead_id,
        opportunityId: c.opportunity_id,
        at: c.started_at ?? c.created_at,
        channel: "VOICE",
        kind: "CALL",
        label: `${c.direction === "INBOUND" ? "Inbound" : "Outbound"} call, ${(c.outcome ?? "").toLowerCase().replace(/_/g, " ")}${mins}`,
      });
    }
    for (const b of bookings) {
      touches.push({ id: `bk:${b.id}`, leadId: b.lead_id, opportunityId: null, at: b.created_at, channel: "BOOKING", kind: "BOOKING", label: "Meeting booked" });
    }

    // Quotes hang off opportunities.
    const leadByOpp = new Map(opportunities.map((o) => [o.id, o.lead_id]));
    for (const oppIds of chunks([...leadByOpp.keys()])) {
      const quotes = await rows<{ id: string; opportunity_id: string }>("quotes", missing, () =>
        db().from("quotes").select("id, opportunity_id").eq("business_id", businessId).in("opportunity_id", oppIds).limit(MAX_ROWS),
      );
      const oppByQuote = new Map(quotes.map((q) => [q.id, q.opportunity_id]));
      for (const quoteIds of chunks([...oppByQuote.keys()])) {
        const events = await rows<{ id: number; quote_id: string; event_type: string; occurred_at: string }>("quote_events", missing, () =>
          db()
            .from("quote_events")
            .select("id, quote_id, event_type, occurred_at")
            .eq("business_id", businessId)
            .in("quote_id", quoteIds)
            .in("event_type", Object.keys(QUOTE_TOUCH_EVENTS))
            .limit(MAX_ROWS),
        );
        for (const e of events) {
          const opp = oppByQuote.get(e.quote_id) ?? null;
          const lead = opp ? leadByOpp.get(opp) : undefined;
          if (!lead) continue;
          const kind = QUOTE_TOUCH_EVENTS[e.event_type];
          touches.push({ id: `qe:${e.id}`, leadId: lead, opportunityId: opp, at: e.occurred_at, channel: "QUOTE", kind, label: QUOTE_TOUCH_LABEL[kind] });
        }
      }
    }
  }
  return touches.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

type Window = { from?: Date; to?: Date; leadIds?: readonly string[] };

/** Recorded revenue (payments, invoice payments, won values) in a window or for a lead set. */
export async function loadRevenue(businessId: string, window: Window, missing: string[]): Promise<RevenueEvent[]> {
  const inRange = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, column: string): Q => {
    let out = q;
    if (window.from) out = out.gte(column, window.from.toISOString());
    if (window.to) out = out.lte(column, window.to.toISOString());
    return out;
  };

  const leadChunks = window.leadIds ? chunks(window.leadIds) : [null];
  const checkout: CheckoutPaymentFact[] = [];
  const won: WonOpportunityFact[] = [];
  const invoicePayments: InvoicePaymentFact[] = [];

  for (const ids of leadChunks) {
    const [payments, opps] = await Promise.all([
      rows<CheckoutPaymentFact>("checkout_payments", missing, () => {
        let q = db()
          .from("checkout_payments")
          .select("id, lead_id, opportunity_id, amount_minor, currency, status, paid_at")
          .eq("business_id", businessId)
          .in("status", ["MATCHED", "LINKED"]);
        if (ids) q = q.in("lead_id", ids);
        return inRange(q, "paid_at").limit(MAX_ROWS);
      }),
      rows<WonOpportunityFact>("opportunities", missing, () => {
        let q = db()
          .from("opportunities")
          .select("id, lead_id, value, currency, outcome, closed_at")
          .eq("business_id", businessId)
          .eq("outcome", "WON");
        if (ids) q = q.in("lead_id", ids);
        return inRange(q, "closed_at").limit(MAX_ROWS);
      }),
    ]);
    checkout.push(...payments);
    won.push(...opps);
  }

  // Invoice payments: payment -> invoice -> opportunity -> lead.
  const received = await rows<{ id: string; invoice_id: string; amount_minor: number; received_at: string; checkout_payment_id: string | null }>(
    "invoice_payments",
    missing,
    () =>
      inRange(
        db()
          .from("invoice_payments")
          .select("id, invoice_id, amount_minor, received_at, checkout_payment_id")
          .eq("business_id", businessId),
        "received_at",
      ).limit(MAX_ROWS),
  );
  if (received.length > 0) {
    const invoiceIds = [...new Set(received.map((r) => r.invoice_id))];
    const invoices: { id: string; opportunity_id: string; currency: string }[] = [];
    for (const ids of chunks(invoiceIds)) {
      invoices.push(
        ...(await rows<{ id: string; opportunity_id: string; currency: string }>("invoices", missing, () =>
          db().from("invoices").select("id, opportunity_id, currency").eq("business_id", businessId).in("id", ids),
        )),
      );
    }
    const oppIds = [...new Set(invoices.map((i) => i.opportunity_id))];
    const leadByOpp = new Map<string, string | null>();
    for (const ids of chunks(oppIds)) {
      const opps = await rows<{ id: string; lead_id: string | null }>("opportunities", missing, () =>
        db().from("opportunities").select("id, lead_id").eq("business_id", businessId).in("id", ids),
      );
      for (const o of opps) leadByOpp.set(o.id, o.lead_id);
    }
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const leadFilter = window.leadIds ? new Set(window.leadIds) : null;
    for (const r of received) {
      const invoice = invoiceById.get(r.invoice_id);
      if (!invoice) continue;
      const leadId = leadByOpp.get(invoice.opportunity_id) ?? null;
      if (leadFilter && (!leadId || !leadFilter.has(leadId))) continue;
      invoicePayments.push({
        id: r.id,
        lead_id: leadId,
        opportunity_id: invoice.opportunity_id,
        amount_minor: r.amount_minor,
        currency: invoice.currency,
        received_at: r.received_at,
        checkout_payment_id: r.checkout_payment_id,
      });
    }
  }

  // A won value only counts when no payment was EVER recorded against the
  // opportunity, including before this window.
  const wonIds = won.map((o) => o.id);
  const paidOpportunityIds = new Set<string>();
  for (const ids of chunks(wonIds)) {
    const [paid, invoiced] = await Promise.all([
      rows<{ opportunity_id: string | null }>("checkout_payments", missing, () =>
        db().from("checkout_payments").select("opportunity_id").eq("business_id", businessId).in("opportunity_id", ids).in("status", ["MATCHED", "LINKED"]),
      ),
      rows<{ opportunity_id: string }>("invoices", missing, () =>
        db().from("invoices").select("opportunity_id").eq("business_id", businessId).in("opportunity_id", ids).gt("paid_minor", 0),
      ),
    ]);
    for (const p of paid) if (p.opportunity_id) paidOpportunityIds.add(p.opportunity_id);
    for (const i of invoiced) paidOpportunityIds.add(i.opportunity_id);
  }

  return revenueEventsFrom({ checkoutPayments: checkout, invoicePayments, wonOpportunities: won, paidOpportunityIds });
}

export type JourneyResult<T> = { status: "ok"; data: T; missing: string[] } | { status: "unavailable"; message: string };

/** One lead's journey, or one opportunity's (touches and revenue narrowed to it). */
export async function getLeadJourney(
  businessId: string,
  target: { leadId: string; opportunityId?: string | null },
): Promise<JourneyResult<LeadJourney>> {
  const missing: string[] = [];
  try {
    const [touches, revenue] = await Promise.all([
      loadTouches(businessId, [target.leadId], missing),
      loadRevenue(businessId, { leadIds: [target.leadId] }, missing),
    ]);
    const opp = target.opportunityId ?? null;
    const t = opp ? touches.filter((x) => x.opportunityId === null || x.opportunityId === opp) : touches;
    const r = opp ? revenue.filter((x) => x.opportunityId === opp) : revenue;
    return { status: "ok", data: buildLeadJourney(t, r), missing };
  } catch (error) {
    logEvent("analytics.read_failed", { area: "lead_journey", businessId, error }, "error");
    return { status: "unavailable", message: "The revenue journey could not be loaded right now." };
  }
}

export type AttributionReport = AttributionSummary & { truncated: boolean };

/**
 * Revenue recorded in the window, credited across each converting lead's
 * touches under `model`. Touches before the window count (a lead found in
 * March who paid in May credits March's ad).
 */
export async function getAttribution(
  businessId: string,
  bounds: { from: Date; to: Date },
  model: JourneyModel,
): Promise<JourneyResult<AttributionReport>> {
  const missing: string[] = [];
  try {
    const revenue = await loadRevenue(businessId, { from: bounds.from, to: bounds.to }, missing);
    const leadIds = [...new Set(revenue.map((r) => r.leadId))];
    const truncated = leadIds.length > MAX_LEADS;
    const kept = new Set(leadIds.slice(0, MAX_LEADS));
    const touches = await loadTouches(businessId, [...kept], missing);
    const summary = attributeRevenue(touches, revenue.filter((r) => kept.has(r.leadId)), model);
    return { status: "ok", data: { ...summary, truncated }, missing };
  } catch (error) {
    logEvent("analytics.read_failed", { area: "attribution", businessId, error }, "error");
    return { status: "unavailable", message: "Attribution could not be calculated right now." };
  }
}
