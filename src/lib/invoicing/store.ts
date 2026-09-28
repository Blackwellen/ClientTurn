import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/billing/capabilities";
import type { Capability } from "@/lib/billing/capability-rules";
import { enqueue } from "@/lib/jobs/queue";
import { formatMinor } from "@/lib/quotes/money";
import { emitQuoteEvent } from "@/lib/quotes/events";
import { queueLeadEmail } from "@/lib/quotes/effects";
import { loadOpportunityInfo, loadQuoteSettings } from "@/lib/quotes/store";
import { stopSalesChasing } from "@/lib/quotes/chasing";
import type { DueRule, QuoteCalculation, VatBucket } from "@/lib/quotes/types";
import type {
  InvoiceDeps,
  InvoiceEffects,
  InvoiceRecord,
  InvoiceStore,
  PartySnapshot,
  QuoteForInvoicing,
} from "./service-core";
import type { CreditNote, InvoiceKind, InvoiceStatus } from "./types";

/**
 * The Supabase implementation of `InvoiceStore` (service role, every query
 * scoped by business_id). Payment and credit bounds are enforced again by
 * the 0154 triggers, so a race between two people cannot overpay or
 * over-credit an invoice.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const INVOICE_COLUMNS =
  "id, opportunity_id, quote_id, revision_id, kind, status, number, currency, total_minor, paid_minor, credited_minor, vat_by_rate, issue_date, due_date, schedule_seq, buyer, created_at";

type Raw = Record<string, unknown>;

function invoiceFromRow(row: Raw, dueRule: DueRule | null): InvoiceRecord {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    quoteId: (row.quote_id as string | null) ?? null,
    revisionId: (row.revision_id as string | null) ?? null,
    kind: row.kind as InvoiceKind,
    status: row.status as InvoiceStatus,
    number: (row.number as string | null) ?? null,
    currency: String(row.currency),
    totalMinor: Number(row.total_minor),
    paidMinor: Number(row.paid_minor),
    creditedMinor: Number(row.credited_minor),
    vatByRate: (row.vat_by_rate as VatBucket[]) ?? [],
    issueDate: (row.issue_date as string | null) ?? null,
    dueDate: (row.due_date as string | null) ?? null,
    scheduleSeq: (row.schedule_seq as number | null) ?? null,
    dueRule,
    buyer: (row.buyer as PartySnapshot) ?? { name: "", address: [] },
    createdAt: String(row.created_at),
  };
}

async function dueRules(businessId: string, invoiceIds: string[]): Promise<Map<string, DueRule>> {
  if (invoiceIds.length === 0) return new Map();
  const { data } = await db().from("payment_schedules").select("invoice_id, due_rule").eq("business_id", businessId).in("invoice_id", invoiceIds);
  return new Map(((data ?? []) as { invoice_id: string; due_rule: DueRule }[]).map((row) => [row.invoice_id, row.due_rule]));
}

export function createInvoiceStore(): InvoiceStore {
  const store: InvoiceStore = {
    loadSettings: loadQuoteSettings,

    async loadSeller(businessId) {
      const [{ data }, settings] = await Promise.all([
        db().from("businesses").select("name").eq("id", businessId).maybeSingle(),
        loadQuoteSettings(businessId),
      ]);
      return {
        name: settings.legalName || (data as { name?: string } | null)?.name || "",
        address: settings.addressLines,
        vatNumber: settings.vatRegistered ? settings.vatNumber : null,
        companyNumber: settings.companyNumber,
      };
    },

    async loadQuoteForInvoicing(businessId, quoteId): Promise<QuoteForInvoicing | null> {
      const { data: quote } = await db()
        .from("quotes")
        .select("id, number, status, opportunity_id, current_revision_id")
        .eq("business_id", businessId)
        .eq("id", quoteId)
        .maybeSingle();
      const q = quote as { id: string; number: string; status: string; opportunity_id: string; current_revision_id: string | null } | null;
      if (!q?.current_revision_id) return null;
      const { data: revision } = await db()
        .from("quote_revisions")
        .select("id, calculation, accepted_at")
        .eq("business_id", businessId)
        .eq("id", q.current_revision_id)
        .maybeSingle();
      const rev = revision as { id: string; calculation: QuoteCalculation; accepted_at: string | null } | null;
      if (!rev) return null;
      const { data: opp } = await db().from("opportunities").select("lead_id").eq("id", q.opportunity_id).maybeSingle();
      return {
        id: q.id,
        number: q.number,
        status: q.status,
        opportunityId: q.opportunity_id,
        leadId: (opp as { lead_id: string | null } | null)?.lead_id ?? null,
        revisionId: rev.id,
        calculation: rev.calculation,
        acceptedAt: rev.accepted_at,
      };
    },

    async loadBuyer(businessId, opportunityId) {
      const info = await loadOpportunityInfo(businessId, opportunityId);
      return {
        name: info?.lead?.company || info?.lead?.name || info?.name || "Customer",
        address: info?.lead?.address ?? [],
        email: info?.lead?.email ?? null,
        ...(info?.lead?.company && info.lead.name ? { contactName: info.lead.name } : {}),
      };
    },

    async insertDraft(businessId, { draft, quote, seller, buyer }) {
      const client = db();
      const { data, error } = await client
        .from("invoices")
        .insert({
          business_id: businessId,
          opportunity_id: quote.opportunityId,
          quote_id: quote.id,
          revision_id: quote.revisionId,
          kind: draft.kind,
          status: "DRAFT",
          currency: draft.currency,
          vat_registered: draft.vatRegistered,
          seller,
          buyer,
          schedule_seq: draft.scheduleSeq,
          net_minor: draft.netMinor,
          vat_minor: draft.vatMinor,
          total_minor: draft.totalMinor,
          vat_by_rate: draft.vatByRate,
          idempotency_key: draft.idempotencyKey,
        })
        .select("id")
        .single();
      if (error?.code === "23505") {
        const { data: existing } = await client.from("invoices").select("id").eq("business_id", businessId).eq("idempotency_key", draft.idempotencyKey).maybeSingle();
        if (!existing) throw new Error("invoice idempotency conflict without a row");
        return { id: (existing as { id: string }).id, created: false };
      }
      if (error || !data) throw new Error(`invoice insert failed: ${error?.message ?? "no row"}`);
      const invoiceId = (data as { id: string }).id;
      const items = draft.lines.map((line, position) => ({
        business_id: businessId,
        invoice_id: invoiceId,
        position,
        description: line.description.slice(0, 500),
        quantity_milli: line.quantityMilli,
        unit_net_minor: line.unitNetMinor,
        discount_minor: line.discountMinor,
        discount_bps: line.discountBps,
        net_minor: line.netMinor,
        vat_rate: line.vatRate,
        vat_bps: line.vatBps,
        vat_minor: line.vatMinor,
        gross_minor: line.grossMinor,
        apportioned: line.apportioned,
      }));
      if (items.length > 0) {
        const lines = await client.from("invoice_items").insert(items);
        if (lines.error) throw new Error(`invoice lines insert failed: ${lines.error.message}`);
      }
      if (draft.scheduleSeq !== null && draft.due) {
        const schedule = await client.from("payment_schedules").insert({
          business_id: businessId,
          quote_id: quote.id,
          revision_id: quote.revisionId,
          seq: draft.scheduleSeq,
          kind: draft.kind === "RECURRING" ? "FULL" : draft.kind,
          due_rule: draft.due,
          gross_minor: draft.totalMinor,
          net_minor: draft.netMinor,
          vat_minor: draft.vatMinor,
          vat_by_rate: draft.vatByRate,
          status: "INVOICED",
          invoice_id: invoiceId,
        });
        if (schedule.error && schedule.error.code !== "23505") throw new Error(`payment schedule insert failed: ${schedule.error.message}`);
      }
      return { id: invoiceId, created: true };
    },

    async loadInvoice(businessId, invoiceId) {
      const { data } = await db().from("invoices").select(INVOICE_COLUMNS).eq("business_id", businessId).eq("id", invoiceId).maybeSingle();
      if (!data) return null;
      const rules = await dueRules(businessId, [invoiceId]);
      return invoiceFromRow(data as Raw, rules.get(invoiceId) ?? null);
    },

    async listInvoices(businessId, filter) {
      let query = db().from("invoices").select(INVOICE_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: true }).limit(filter.limit);
      if (filter.quoteId) query = query.eq("quote_id", filter.quoteId);
      if (filter.opportunityId) query = query.eq("opportunity_id", filter.opportunityId);
      if (filter.status) query = query.eq("status", filter.status);
      const { data, error } = await query;
      if (error) throw new Error(`invoices read failed: ${error.message}`);
      const rows = (data ?? []) as Raw[];
      const rules = await dueRules(businessId, rows.map((row) => String(row.id)));
      return rows.map((row) => invoiceFromRow(row, rules.get(String(row.id)) ?? null));
    },

    async allocateNumber(businessId, kind) {
      const { data, error } = await db().rpc("allocate_document_number", { p_business_id: businessId, p_kind: kind });
      if (error || typeof data !== "string") throw new Error(`document number allocation failed: ${error?.message ?? "no number"}`);
      return data;
    },

    async issue(businessId, invoiceId, fields) {
      const { data, error } = await db()
        .from("invoices")
        .update({ status: "OPEN", number: fields.number, issue_date: fields.issueDate, due_date: fields.dueDate, supply_date: fields.supplyDate })
        .eq("business_id", businessId)
        .eq("id", invoiceId)
        .eq("status", "DRAFT")
        .select("id");
      if (error) throw new Error(`invoice issue failed: ${error.message}`);
      return Boolean(data && data.length > 0);
    },

    async insertPayment(businessId, input) {
      const { error } = await db().from("invoice_payments").insert({
        business_id: businessId,
        invoice_id: input.invoiceId,
        provider: input.provider,
        external_payment_id: input.externalId,
        amount_minor: input.amountMinor,
        received_at: input.receivedAt,
        recorded_by: input.recordedBy,
      });
      if (!error) return "RECORDED";
      if (error.code === "23505") return "DUPLICATE";
      if (error.code === "23514") return "REFUSED";
      throw new Error(`payment insert failed: ${error.message}`);
    },

    async voidInvoice(businessId, invoiceId) {
      const { data, error } = await db()
        .from("invoices")
        .update({ status: "VOID", voided_at: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("id", invoiceId)
        .in("status", ["DRAFT", "OPEN"])
        .eq("paid_minor", 0)
        .select("id");
      if (error) throw new Error(`invoice void failed: ${error.message}`);
      return Boolean(data && data.length > 0);
    },

    async loadCreditNotes(businessId, invoiceId): Promise<CreditNote[]> {
      const { data } = await db()
        .from("credit_notes")
        .select("id, number, invoice_id, amount_minor, net_minor, vat_minor, vat_by_rate, reason, issued_at")
        .eq("business_id", businessId)
        .eq("invoice_id", invoiceId);
      return ((data ?? []) as Raw[]).map((row) => ({
        id: String(row.id),
        number: String(row.number),
        invoiceId: String(row.invoice_id),
        amountMinor: Number(row.amount_minor),
        netMinor: Number(row.net_minor),
        vatMinor: Number(row.vat_minor),
        vatByRate: (row.vat_by_rate as VatBucket[]) ?? [],
        reason: String(row.reason),
        issuedAt: String(row.issued_at),
      }));
    },

    async findCreditNoteByKey(businessId, idempotencyKey) {
      const { data } = await db()
        .from("credit_notes")
        .select("number, amount_minor, net_minor, vat_minor")
        .eq("business_id", businessId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      const row = data as { number: string; amount_minor: number; net_minor: number; vat_minor: number } | null;
      return row ? { number: row.number, amountMinor: Number(row.amount_minor), netMinor: Number(row.net_minor), vatMinor: Number(row.vat_minor) } : null;
    },

    async insertCreditNote(businessId, note) {
      const { error } = await db().from("credit_notes").insert({
        business_id: businessId,
        invoice_id: note.invoiceId,
        number: note.number,
        amount_minor: note.amountMinor,
        net_minor: note.netMinor,
        vat_minor: note.vatMinor,
        vat_by_rate: note.vatByRate,
        reason: note.reason,
        idempotency_key: note.idempotencyKey,
        issued_by: note.issuedBy,
      });
      if (!error) return "RECORDED";
      if (error.code === "23505") return "DUPLICATE";
      if (error.code === "23514") return "REFUSED";
      throw new Error(`credit note insert failed: ${error.message}`);
    },

    async quoteTransition(businessId, quoteId, action, expectedStatus, actionKey) {
      const { data, error } = await db().rpc("quote_transition", {
        p_business_id: businessId,
        p_quote_id: quoteId,
        p_action: action,
        p_expected_status: expectedStatus,
        p_actor_kind: "SYSTEM",
        p_action_key: actionKey,
        p_detail: {},
      });
      if (error) return { ok: false };
      const result = data as { ok: boolean; duplicate?: boolean };
      // Paid (a deposit or in full): every sales chase for the lead stops now
      // (brief §72). Idempotent, never throws.
      if (result.ok) await stopSalesChasing(businessId, quoteId, action === "RECORD_PAID" ? "PAID" : "DEPOSIT_PAID");
      return result;
    },

    async loadQuoteStatus(businessId, quoteId) {
      const { data } = await db().from("quotes").select("status").eq("business_id", businessId).eq("id", quoteId).maybeSingle();
      return (data as { status: string } | null)?.status ?? null;
    },
  };
  return store;
}

export const invoiceEffects: InvoiceEffects = {
  async deliverInvoice({ businessId, invoice, leadId, sendKey, kind }) {
    if (!leadId) return { queued: false, detail: "This invoice has no lead to email." };
    const { data } = await db().from("businesses").select("name").eq("id", businessId).maybeSingle();
    const seller = (data as { name?: string } | null)?.name || "Your supplier";
    const due = Math.max(0, invoice.totalMinor - invoice.paidMinor);
    const amount = formatMinor(due, invoice.currency);
    const subject = kind === "REMINDER" ? `Reminder: invoice ${invoice.number} from ${seller}` : `Invoice ${invoice.number} from ${seller}`;
    const body =
      kind === "REMINDER"
        ? `Hello,\n\nThis is a reminder that invoice ${invoice.number} for ${amount} is due on ${invoice.dueDate}. If you have already paid, thank you, and please ignore this message.\n\n${seller}`
        : `Hello,\n\nPlease find invoice ${invoice.number} for ${amount}, due on ${invoice.dueDate}. Reply to this email if you need a copy or have any questions.\n\n${seller}`;
    return queueLeadEmail({ businessId, leadId, subject, body, sendKey, origin: kind === "REMINDER" ? "automation" : "manual" });
  },
  async enqueue(type, payload, options) {
    await enqueue(type, payload, { businessId: options.businessId, runAt: options.runAt, idempotencyKey: options.idempotencyKey });
  },
  async emit(businessId, type, payload) {
    await emitQuoteEvent(businessId, type, payload);
  },
};

export function liveInvoiceDeps(businessId: string): InvoiceDeps {
  return {
    store: createInvoiceStore(),
    effects: invoiceEffects,
    can: async (capability: Capability) => {
      const decision = await can(businessId, capability);
      return { allowed: decision.allowed, message: decision.message };
    },
    now: () => new Date(),
  };
}
