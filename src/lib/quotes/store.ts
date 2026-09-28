import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { validateCatalogue } from "@/lib/catalogue/validate";
import {
  bundleFromRows,
  itemFromRow,
  type BundleItemRow,
  type BundleRow,
  type CatalogueItemRow,
  type PriceTierRow,
} from "@/lib/catalogue/rows";
import type { Catalogue, CatalogueBundle } from "@/lib/catalogue/types";
import { settingsFromRow, type CounterRow, type QuoteSettings, type QuoteSettingsRow } from "./settings";
import type {
  ApprovalRow,
  NewRevision,
  OpportunityInfo,
  QuoteEventRow,
  QuoteListFilter,
  QuoteRow,
  QuoteStore,
  RevisionRow,
  SellerInfo,
  TransitionOutcome,
  TransitionRequest,
} from "./service-core";
import type { QuoteCalculation, QuoteRenderModel } from "./types";
import type { QuoteState } from "./lifecycle";

/**
 * The Supabase implementation of `QuoteStore` (service-core.ts). Service
 * role, and every query is scoped by `business_id` as well as by id, so a
 * caller holding another workspace's id reads nothing.
 *
 * State changes are only ever `quote_transition` (0153): this file writes
 * content (drafts, lines, the freeze, tokens, approvals), never a status.
 */

export function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const QUOTE_SETTINGS_BASE_COLUMNS =
  "currency, vat_registered, vat_number, legal_name, company_number, address_lines, validity_days, payment_terms_days, default_deposit_bps, terms_text, reminder_offsets, discount_policy";

const QUOTE_COLUMNS =
  "id, business_id, opportunity_id, service_id, number, title, currency, status, current_revision_id, created_by_kind, request_key, created_at, updated_at";

const REVISION_COLUMNS =
  "id, quote_id, revision_no, status, calc_input, calculation, calculation_hash, render_model, render_hash, pdf_object_key, approval_required, valid_until, frozen_at, sent_at, first_viewed_at, accepted_at, signed_at, internal_note, ai_rationale, created_by_kind, created_at";

const ITEM_COLUMNS =
  "id, key, service_id, sku, name, description, currency, charge_type, interval_unit, interval_count, unit, unit_price_minor, cost_price_minor, vat_rate, tier_mode, min_quantity, max_quantity, options, add_on_item_keys, add_on_only, checkout_link_id, active, archived_at";

type Raw = Record<string, unknown>;

export function quoteFromRow(row: Raw): QuoteRow {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    opportunityId: String(row.opportunity_id),
    serviceId: (row.service_id as string | null) ?? null,
    number: String(row.number),
    title: String(row.title),
    currency: String(row.currency),
    status: row.status as QuoteState,
    currentRevisionId: (row.current_revision_id as string | null) ?? null,
    createdByKind: row.created_by_kind as QuoteRow["createdByKind"],
    requestKey: (row.request_key as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function revisionFromRow(row: Raw): RevisionRow {
  return {
    id: String(row.id),
    quoteId: String(row.quote_id),
    revisionNo: Number(row.revision_no),
    status: row.status as QuoteState,
    calcInput: row.calc_input as RevisionRow["calcInput"],
    calculation: row.calculation as QuoteCalculation,
    calculationHash: String(row.calculation_hash),
    renderModel: (row.render_model as QuoteRenderModel | null) ?? null,
    renderHash: (row.render_hash as string | null) ?? null,
    pdfObjectKey: (row.pdf_object_key as string | null) ?? null,
    approvalRequired: Boolean(row.approval_required),
    validUntil: (row.valid_until as string | null) ?? null,
    frozenAt: (row.frozen_at as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    firstViewedAt: (row.first_viewed_at as string | null) ?? null,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    signedAt: (row.signed_at as string | null) ?? null,
    internalNote: (row.internal_note as string | null) ?? null,
    aiRationale: (row.ai_rationale as string | null) ?? null,
    createdByKind: row.created_by_kind as RevisionRow["createdByKind"],
    createdAt: String(row.created_at),
  };
}

export async function loadQuoteSettings(businessId: string): Promise<QuoteSettings> {
  const client = db();
  const [base, counters] = await Promise.all([
    client.from("quote_settings").select(QUOTE_SETTINGS_BASE_COLUMNS).eq("business_id", businessId).maybeSingle(),
    client.from("document_counters").select("kind, prefix").eq("business_id", businessId),
  ]);
  if (base.error) throw new Error(`quote settings read failed: ${base.error.message}`);
  let row = (base.data as QuoteSettingsRow | null) ?? null;
  // 0156 columns: read separately so a database behind the code still works.
  const extended = await client
    .from("quote_settings")
    .select("require_drawn_signature, quote_nudges_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!extended.error && extended.data && row) row = { ...row, ...(extended.data as QuoteSettingsRow) };
  else if (extended.error && !isSchemaLag(extended.error)) throw new Error(`quote settings read failed: ${extended.error.message}`);
  // 0173 columns (invoice pay links): the same pattern. Before the migration
  // every workspace reads as "bank transfer only".
  const pay = await client
    .from("quote_settings")
    .select("invoice_pay_mode, invoice_pay_link_url")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!pay.error && pay.data && row) row = { ...row, ...(pay.data as QuoteSettingsRow) };
  else if (pay.error && !isSchemaLag(pay.error)) throw new Error(`quote settings read failed: ${pay.error.message}`);
  return settingsFromRow(row, (counters.data ?? []) as CounterRow[]);
}

/** Every item and bundle, cost included (service role). Items that do not parse are skipped and logged. */
export async function loadWorkspaceCatalogue(businessId: string, currency: string): Promise<Catalogue> {
  const client = db();
  const [items, tiers, bundles, bundleItems] = await Promise.all([
    client.from("catalogue_items").select(ITEM_COLUMNS).eq("business_id", businessId).order("name"),
    client.from("catalogue_price_tiers").select("item_id, position, up_to, unit_price_minor, flat_fee_minor").eq("business_id", businessId),
    client
      .from("catalogue_bundles")
      .select("id, key, name, description, currency, pricing_type, fixed_price_minor, percent_off_bps, active")
      .eq("business_id", businessId)
      .order("name"),
    client.from("catalogue_bundle_items").select("bundle_id, item_id, position, quantity").eq("business_id", businessId),
  ]);
  for (const result of [items, tiers, bundles, bundleItems]) {
    if (result.error) throw new Error(`catalogue read failed: ${result.error.message}`);
  }
  const itemRows = (items.data ?? []) as CatalogueItemRow[];
  const keyById = new Map(itemRows.map((row) => [row.id, row.key]));
  const catalogue: Catalogue = {
    currency,
    items: itemRows.filter((row) => row.currency === currency).map((row) => itemFromRow(row, (tiers.data ?? []) as PriceTierRow[])),
    bundles: ((bundles.data ?? []) as BundleRow[])
      .filter((row) => row.currency === currency)
      .map((row) => bundleFromRows(row, (bundleItems.data ?? []) as BundleItemRow[], keyById))
      .filter((bundle): bundle is CatalogueBundle => bundle !== null),
  };
  const check = validateCatalogue(catalogue);
  if (!check.ok) {
    console.warn("[quotes] catalogue has problems; quotes over the affected items will refuse", {
      businessId,
      issues: check.issues.slice(0, 5),
    });
  }
  return catalogue;
}

async function itemIdsByKey(businessId: string, keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const { data } = await db().from("catalogue_items").select("id, key").eq("business_id", businessId).in("key", [...new Set(keys)]);
  return new Map(((data ?? []) as { id: string; key: string }[]).map((row) => [row.key, row.id]));
}

function lineRows(businessId: string, revisionId: string, calc: QuoteCalculation, ids: Map<string, string>) {
  return calc.lines.map((line, position) => ({
    business_id: businessId,
    revision_id: revisionId,
    position,
    line_key: line.lineId,
    source_line_key: line.sourceLineId,
    parent_line_key: line.parentLineId,
    item_id: ids.get(line.itemId) ?? null,
    item_key: line.itemId,
    bundle_key: line.bundleId,
    description: line.description.slice(0, 500),
    unit: line.unit,
    charge_type: line.chargeType,
    interval_unit: line.interval?.unit ?? null,
    interval_count: line.interval?.count ?? null,
    quantity_milli: line.quantityMilli,
    unit_price_minor: line.unitPriceMinor,
    list_minor: line.listMinor,
    bundle_discount_minor: line.bundleDiscountMinor,
    line_discount_minor: line.lineDiscountMinor,
    line_discount_bps: line.lineDiscountBps,
    quote_discount_minor: line.quoteDiscountMinor,
    net_minor: line.netMinor,
    vat_rate: line.vatRate,
    vat_bps: line.vatBps,
    vat_minor: line.vatMinor,
    gross_minor: line.grossMinor,
    cost_minor: line.costMinor,
    margin_minor: line.marginMinor,
  }));
}

function revisionColumns(revision: Omit<NewRevision, "quoteId" | "revisionNo" | "createdByKind">) {
  const calc = revision.calculation;
  return {
    calc_input: revision.calcInput,
    calculation: calc,
    calc_version: calc.version,
    calculation_hash: calc.calculationHash,
    one_off_gross_minor: calc.oneOff.grossMinor,
    total_net_minor: calc.totals.netMinor,
    total_vat_minor: calc.totals.vatMinor,
    total_gross_minor: calc.totals.grossMinor,
    deposit_minor: calc.depositMinor,
    first_payment_minor: calc.firstPaymentMinor,
    margin_bps: calc.margin.marginBps,
    internal_note: revision.internalNote,
    ai_rationale: revision.aiRationale,
    approval_required: revision.approvalRequired,
  };
}

async function writeLines(businessId: string, revisionId: string, calc: QuoteCalculation) {
  const ids = await itemIdsByKey(businessId, calc.lines.map((line) => line.itemId));
  const rows = lineRows(businessId, revisionId, calc, ids);
  if (rows.length === 0) return;
  const { error } = await db().from("quote_line_items").insert(rows);
  if (error) throw new Error(`quote lines write failed: ${error.message}`);
}

function approvalFromRow(row: Raw): ApprovalRow {
  return {
    id: String(row.id),
    revisionId: String(row.revision_id),
    requiredRole: row.required_role as ApprovalRow["requiredRole"],
    reason: row.reason as ApprovalRow["reason"],
    decision: row.decision as ApprovalRow["decision"],
    requestedByKind: row.requested_by_kind as ApprovalRow["requestedByKind"],
    decidedBy: (row.decided_by as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export async function loadOpportunityInfo(businessId: string, opportunityId: string): Promise<OpportunityInfo | null> {
  const { data } = await db()
    .from("opportunities")
    .select("id, lead_id, service_id, name, outcome, checkout_link_id")
    .eq("id", opportunityId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) return null;
  const opp = data as { id: string; lead_id: string | null; service_id: string | null; name: string; outcome: string; checkout_link_id: string | null };
  let lead: OpportunityInfo["lead"] = null;
  let anonymised = false;
  if (opp.lead_id) {
    const { data: leadRow } = await db()
      .from("leads")
      .select("first_name, last_name, company_name, email, postcode, anonymised_at")
      .eq("id", opp.lead_id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (leadRow) {
      const l = leadRow as { first_name: string | null; last_name: string | null; company_name: string | null; email: string | null; postcode: string | null; anonymised_at: string | null };
      anonymised = Boolean(l.anonymised_at);
      lead = {
        name: [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || l.company_name || "Customer",
        company: l.company_name,
        email: l.email,
        address: l.postcode ? [l.postcode] : [],
      };
    }
  }
  return {
    id: opp.id,
    leadId: opp.lead_id,
    serviceId: opp.service_id,
    name: opp.name,
    outcome: opp.outcome,
    anonymised,
    checkoutLinkId: opp.checkout_link_id,
    lead,
  };
}

export function createQuoteStore(): QuoteStore {
  return {
    loadSettings: loadQuoteSettings,
    loadCatalogue: loadWorkspaceCatalogue,

    async loadSeller(businessId): Promise<SellerInfo> {
      const { data } = await db().from("businesses").select("name").eq("id", businessId).maybeSingle();
      return { name: (data as { name?: string } | null)?.name ?? "", email: null };
    },

    loadOpportunity: loadOpportunityInfo,

    async findQuoteByRequestKey(businessId, requestKey) {
      const { data } = await db().from("quotes").select(QUOTE_COLUMNS).eq("business_id", businessId).eq("request_key", requestKey).maybeSingle();
      return data ? quoteFromRow(data as Raw) : null;
    },

    async loadQuote(businessId, quoteId) {
      const { data } = await db().from("quotes").select(QUOTE_COLUMNS).eq("business_id", businessId).eq("id", quoteId).maybeSingle();
      return data ? quoteFromRow(data as Raw) : null;
    },

    async loadRevision(businessId, revisionId) {
      const { data } = await db().from("quote_revisions").select(REVISION_COLUMNS).eq("business_id", businessId).eq("id", revisionId).maybeSingle();
      return data ? revisionFromRow(data as Raw) : null;
    },

    async listRevisions(businessId, quoteId) {
      const { data, error } = await db().from("quote_revisions").select(REVISION_COLUMNS).eq("business_id", businessId).eq("quote_id", quoteId).order("revision_no", { ascending: false });
      if (error) throw new Error(`quote revisions read failed: ${error.message}`);
      return ((data ?? []) as Raw[]).map(revisionFromRow);
    },

    async allocateNumber(businessId, kind) {
      const { data, error } = await db().rpc("allocate_document_number", { p_business_id: businessId, p_kind: kind });
      if (error || typeof data !== "string") throw new Error(`document number allocation failed: ${error?.message ?? "no number"}`);
      return data;
    },

    async insertQuote(row) {
      const { data, error } = await db()
        .from("quotes")
        .insert({
          business_id: row.businessId,
          opportunity_id: row.opportunityId,
          service_id: row.serviceId,
          number: row.number,
          title: row.title,
          currency: row.currency,
          created_by_kind: row.createdByKind,
          created_by: row.createdBy,
          request_key: row.requestKey,
        })
        .select(QUOTE_COLUMNS)
        .single();
      if (error?.code === "23505") return null;
      if (error || !data) throw new Error(`quote insert failed: ${error?.message ?? "no row"}`);
      return quoteFromRow(data as Raw);
    },

    async insertRevision(businessId, revision) {
      const { data, error } = await db()
        .from("quote_revisions")
        .insert({
          business_id: businessId,
          quote_id: revision.quoteId,
          revision_no: revision.revisionNo,
          created_by_kind: revision.createdByKind,
          ...revisionColumns(revision),
        })
        .select(REVISION_COLUMNS)
        .single();
      if (error || !data) throw new Error(`quote revision insert failed: ${error?.message ?? "no row"}`);
      const row = revisionFromRow(data as Raw);
      await writeLines(businessId, row.id, revision.calculation);
      return row;
    },

    async replaceDraftRevision(businessId, revisionId, revision) {
      const { data, error } = await db()
        .from("quote_revisions")
        .update(revisionColumns(revision))
        .eq("business_id", businessId)
        .eq("id", revisionId)
        .eq("status", "DRAFT")
        .is("frozen_at", null)
        .select("id");
      if (error) throw new Error(`quote draft update failed: ${error.message}`);
      if (!data || data.length === 0) return false;
      const del = await db().from("quote_line_items").delete().eq("business_id", businessId).eq("revision_id", revisionId);
      if (del.error) throw new Error(`quote lines replace failed: ${del.error.message}`);
      await writeLines(businessId, revisionId, revision.calculation);
      return true;
    },

    async deleteDraftRevision(businessId, revisionId) {
      await db().from("quote_revisions").delete().eq("business_id", businessId).eq("id", revisionId).is("frozen_at", null);
    },

    async setCurrentRevision(businessId, quoteId, revisionId) {
      const { error } = await db().from("quotes").update({ current_revision_id: revisionId }).eq("business_id", businessId).eq("id", quoteId);
      if (error) throw new Error(`quote current revision failed: ${error.message}`);
    },

    async updateTitle(businessId, quoteId, title) {
      await db().from("quotes").update({ title: title.slice(0, 200) }).eq("business_id", businessId).eq("id", quoteId);
    },

    async freezeRevision(businessId, revisionId, freeze) {
      const { data, error } = await db()
        .from("quote_revisions")
        .update({
          render_model: freeze.renderModel,
          render_hash: freeze.renderHash,
          valid_until: freeze.validUntil,
          frozen_at: freeze.frozenAt,
        })
        .eq("business_id", businessId)
        .eq("id", revisionId)
        .is("frozen_at", null)
        .select("id");
      if (error) throw new Error(`quote freeze failed: ${error.message}`);
      return Boolean(data && data.length > 0);
    },

    async transition(request: TransitionRequest): Promise<TransitionOutcome> {
      const { data, error } = await db().rpc("quote_transition", {
        p_business_id: request.businessId,
        p_quote_id: request.quoteId,
        p_action: request.action,
        p_expected_status: request.expectedStatus,
        p_actor_kind: request.actorKind,
        p_action_key: request.actionKey ?? null,
        p_detail: request.detail ?? {},
      });
      if (error) throw new Error(`quote transition failed: ${error.message}`);
      return data as TransitionOutcome;
    },

    async insertEvent(businessId, quoteId, revisionId, type, actorKind, detail) {
      const { error } = await db().from("quote_events").insert({
        business_id: businessId,
        quote_id: quoteId,
        revision_id: revisionId,
        event_type: type,
        actor_kind: actorKind === "SYSTEM" ? "SYSTEM" : actorKind,
        detail,
      });
      if (error) console.error("[quotes] event not recorded", { quoteId, type, message: error.message });
    },

    async listEvents(businessId, quoteId): Promise<QuoteEventRow[]> {
      const { data } = await db()
        .from("quote_events")
        .select("id, event_type, actor_kind, revision_id, occurred_at, detail")
        .eq("business_id", businessId)
        .eq("quote_id", quoteId)
        .order("occurred_at", { ascending: true })
        .limit(200);
      return ((data ?? []) as Raw[]).map((row) => ({
        id: row.id as number,
        type: String(row.event_type),
        actorKind: String(row.actor_kind),
        revisionId: (row.revision_id as string | null) ?? null,
        occurredAt: String(row.occurred_at),
        detail: (row.detail as Record<string, unknown>) ?? {},
      }));
    },

    async loadPendingApproval(businessId, revisionId) {
      const { data } = await db()
        .from("quote_approvals")
        .select("id, revision_id, required_role, reason, decision, requested_by_kind, decided_by, decision_note, created_at")
        .eq("business_id", businessId)
        .eq("revision_id", revisionId)
        .eq("decision", "PENDING")
        .maybeSingle();
      return data ? approvalFromRow(data as Raw) : null;
    },

    async listApprovals(businessId, quoteId) {
      const { data } = await db()
        .from("quote_approvals")
        .select("id, revision_id, required_role, reason, decision, requested_by_kind, decided_by, decision_note, created_at")
        .eq("business_id", businessId)
        .eq("quote_id", quoteId)
        .order("created_at", { ascending: false });
      return ((data ?? []) as Raw[]).map(approvalFromRow);
    },

    async insertApproval(businessId, quoteId, approval) {
      const { error } = await db().from("quote_approvals").insert({
        business_id: businessId,
        quote_id: quoteId,
        revision_id: approval.revisionId,
        required_role: approval.requiredRole,
        reason: approval.reason,
        matched_rule_ids: approval.matchedRuleIds,
        requested_by_kind: approval.requestedByKind,
        requested_by: approval.requestedBy,
      });
      // One pending approval per revision: a repeat request is the same request.
      if (error && error.code !== "23505") throw new Error(`quote approval insert failed: ${error.message}`);
    },

    async decideApproval(businessId, approvalId, decision, decidedBy, note) {
      const { error } = await db()
        .from("quote_approvals")
        .update({ decision, decided_by: decidedBy, decided_at: new Date().toISOString(), decision_note: note })
        .eq("business_id", businessId)
        .eq("id", approvalId)
        .eq("decision", "PENDING");
      if (error) throw new Error(`quote approval decision failed: ${error.message}`);
    },

    async insertToken(businessId, quoteId, token) {
      const { error } = await db().from("quote_access_tokens").insert({
        business_id: businessId,
        quote_id: quoteId,
        revision_id: token.revisionId,
        token_hash: token.tokenHash,
        expires_at: token.expiresAt,
      });
      if (error) throw new Error(`quote link could not be issued: ${error.message}`);
    },

    async listQuotes(businessId, filter: QuoteListFilter) {
      let query = db().from("quotes").select(QUOTE_COLUMNS).eq("business_id", businessId).order("updated_at", { ascending: false }).limit(filter.limit);
      if (filter.opportunityId) query = query.eq("opportunity_id", filter.opportunityId);
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.leadId) {
        const { data: opps } = await db().from("opportunities").select("id").eq("business_id", businessId).eq("lead_id", filter.leadId);
        const ids = ((opps ?? []) as { id: string }[]).map((o) => o.id);
        if (ids.length === 0) return [];
        query = query.in("opportunity_id", ids);
      }
      const { data, error } = await query;
      if (error) throw new Error(`quotes read failed: ${error.message}`);
      return ((data ?? []) as Raw[]).map(quoteFromRow);
    },
  };
}
