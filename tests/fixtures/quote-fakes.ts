/**
 * In-memory fakes for the quote service core (tests/quote-service.test.ts,
 * tests/quote-public-sign.test.ts). The store mirrors the 0153 functions it
 * stands in for: quote_transition's transition table, expected-status check,
 * actor rules, expiry/approval/freeze checks and action-key idempotency.
 * Nothing here spends money: no Stripe, email or AI.
 */

import { TRANSITIONS, type QuoteState } from "../../src/lib/quotes/lifecycle.ts";
import { DEFAULT_QUOTE_SETTINGS, type QuoteSettings } from "../../src/lib/quotes/settings.ts";
import type { Catalogue } from "../../src/lib/catalogue/types.ts";
import type {
  ApprovalRow,
  OpportunityInfo,
  QuoteDeps,
  QuoteEventRow,
  QuoteRow,
  QuoteStore,
  RevisionRow,
  TransitionOutcome,
  TransitionRequest,
} from "../../src/lib/quotes/service-core.ts";
import type { IssuedToken } from "../../src/lib/quotes/tokens.ts";

export const BUSINESS = "11111111-1111-4111-8111-111111111111";
export const OTHER_BUSINESS = "22222222-2222-4222-8222-222222222222";
export const OPPORTUNITY = "33333333-3333-4333-8333-333333333333";
export const LEAD = "44444444-4444-4444-8444-444444444444";

export const CATALOGUE: Catalogue = {
  currency: "GBP",
  items: [
    {
      id: "website",
      name: "Website build",
      serviceId: null,
      currency: "GBP",
      chargeType: "ONE_OFF",
      unit: "project",
      unitPriceMinor: 500_000,
      costPriceMinor: 200_000,
      vatRate: "STANDARD",
      tiers: [],
      options: [],
      addOnItemIds: ["hosting"],
      addOnOnly: false,
      active: true,
    },
    {
      id: "hosting",
      name: "Managed hosting",
      serviceId: null,
      currency: "GBP",
      chargeType: "RECURRING",
      interval: { unit: "MONTH", count: 1 },
      unit: "month",
      unitPriceMinor: 5_000,
      costPriceMinor: 1_000,
      vatRate: "STANDARD",
      tiers: [],
      options: [],
      addOnItemIds: [],
      addOnOnly: false,
      active: true,
    },
    {
      id: "consulting",
      name: "Consulting",
      serviceId: null,
      currency: "GBP",
      chargeType: "ONE_OFF",
      unit: "hour",
      unitPriceMinor: 12_000,
      costPriceMinor: null,
      vatRate: "STANDARD",
      tiers: [],
      options: [],
      addOnItemIds: [],
      addOnOnly: false,
      active: true,
    },
  ],
  bundles: [],
};

let seq = 0;
export function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export type FakeState = {
  quotes: Map<string, QuoteRow>;
  revisions: Map<string, RevisionRow>;
  events: (QuoteEventRow & { quoteId: string; actionKey: string | null })[];
  approvals: (ApprovalRow & { quoteId: string })[];
  tokens: (IssuedToken & { quoteId: string; revokedAt: string | null })[];
  transitions: TransitionRequest[];
  numbers: number;
};

export function createFakeStore(options: { settings?: Partial<QuoteSettings>; opportunity?: Partial<OpportunityInfo> } = {}) {
  const state: FakeState = { quotes: new Map(), revisions: new Map(), events: [], approvals: [], tokens: [], transitions: [], numbers: 0 };
  const settings: QuoteSettings = { ...DEFAULT_QUOTE_SETTINGS, vatRegistered: true, vatNumber: "GB123456789", addressLines: ["1 High St"], termsText: "Payment within 14 days.", ...options.settings };
  const opportunity: OpportunityInfo = {
    id: OPPORTUNITY,
    leadId: LEAD,
    serviceId: null,
    name: "Website for Acme",
    outcome: "OPEN",
    anonymised: false,
    checkoutLinkId: null,
    lead: { name: "Priya Shah", company: "Acme Ltd", email: "priya@acme.test", address: ["EC1A 1BB"] },
    ...options.opportunity,
  };
  const now = () => new Date().toISOString();

  const scoped = <T extends { businessId?: string }>(row: T | undefined, businessId: string) => (row && (!row.businessId || row.businessId === businessId) ? row : undefined);

  const store: QuoteStore = {
    async loadSettings() {
      return settings;
    },
    async loadCatalogue() {
      return structuredClone(CATALOGUE);
    },
    async loadSeller() {
      return { name: "Studio North", email: "hello@studio.test" };
    },
    async loadOpportunity(businessId, id) {
      return businessId === BUSINESS && id === opportunity.id ? opportunity : null;
    },
    async findQuoteByRequestKey(businessId, key) {
      return [...state.quotes.values()].find((q) => q.businessId === businessId && q.requestKey === key) ?? null;
    },
    async loadQuote(businessId, id) {
      return scoped(state.quotes.get(id), businessId) ?? null;
    },
    async loadRevision(businessId, id) {
      const rev = state.revisions.get(id);
      if (!rev) return null;
      const quote = state.quotes.get(rev.quoteId);
      return quote?.businessId === businessId ? structuredClone(rev) : null;
    },
    async listRevisions(businessId, quoteId) {
      return [...state.revisions.values()].filter((r) => r.quoteId === quoteId && state.quotes.get(quoteId)?.businessId === businessId);
    },
    async allocateNumber() {
      state.numbers += 1;
      return `Q-${String(state.numbers).padStart(5, "0")}`;
    },
    async insertQuote(row) {
      if ([...state.quotes.values()].some((q) => q.businessId === row.businessId && q.requestKey === row.requestKey)) return null;
      const quote: QuoteRow = { ...row, id: uuid(), status: "DRAFT", currentRevisionId: null, createdAt: now(), updatedAt: now() };
      state.quotes.set(quote.id, quote);
      return quote;
    },
    async insertRevision(_businessId, revision) {
      const row: RevisionRow = {
        ...revision,
        id: uuid(),
        status: "DRAFT",
        renderModel: null,
        renderHash: null,
        pdfObjectKey: null,
        validUntil: null,
        frozenAt: null,
        sentAt: null,
        firstViewedAt: null,
        acceptedAt: null,
        signedAt: null,
        createdAt: now(),
      };
      state.revisions.set(row.id, row);
      return structuredClone(row);
    },
    async replaceDraftRevision(_businessId, id, revision) {
      const row = state.revisions.get(id);
      if (!row || row.status !== "DRAFT" || row.frozenAt) return false;
      Object.assign(row, revision);
      return true;
    },
    async deleteDraftRevision(_b, id) {
      const row = state.revisions.get(id);
      if (row && !row.frozenAt) state.revisions.delete(id);
    },
    async setCurrentRevision(_b, quoteId, revisionId) {
      const q = state.quotes.get(quoteId);
      if (q) q.currentRevisionId = revisionId;
    },
    async updateTitle(_b, quoteId, title) {
      const q = state.quotes.get(quoteId);
      if (q) q.title = title;
    },
    async freezeRevision(_b, id, freeze) {
      const row = state.revisions.get(id);
      if (!row || row.frozenAt) return false;
      row.renderModel = freeze.renderModel;
      row.renderHash = freeze.renderHash;
      row.validUntil = freeze.validUntil;
      row.frozenAt = freeze.frozenAt;
      return true;
    },
    async transition(request): Promise<TransitionOutcome> {
      state.transitions.push(request);
      const quote = state.quotes.get(request.quoteId);
      if (!quote || quote.businessId !== request.businessId) return { ok: false, reason: "NOT_FOUND" };
      if (request.actionKey) {
        if (state.events.some((e) => e.actionKey === request.actionKey && e.quoteId === quote.id)) return { ok: true, duplicate: true, status: quote.status };
        if (state.events.some((e) => e.actionKey === request.actionKey)) return { ok: false, reason: "ACTION_KEY_CONFLICT" };
      }
      if (quote.status !== request.expectedStatus) return { ok: false, reason: "STALE", status: quote.status };
      if ((request.action === "APPROVE" || request.action === "REJECT_APPROVAL") && request.actorKind !== "HUMAN") return { ok: false, reason: "ACTOR_NOT_PERMITTED" };
      if ((request.action === "ACCEPT" || request.action === "DECLINE") && request.actorKind !== "CUSTOMER") return { ok: false, reason: "ACTOR_NOT_PERMITTED" };
      const to = TRANSITIONS[quote.status][request.action];
      if (!to) return { ok: false, reason: "ILLEGAL_TRANSITION", status: quote.status };
      const rev = quote.currentRevisionId ? state.revisions.get(quote.currentRevisionId) : undefined;
      if (!rev) return { ok: false, reason: "NO_CURRENT_REVISION" };
      const expired = rev.validUntil !== null && Date.parse(rev.validUntil) < Date.now();
      if (["ACCEPT", "SEND", "APPROVE"].includes(request.action) && expired) return { ok: false, reason: "EXPIRED" };
      if (request.action === "EXPIRE" && !expired) return { ok: false, reason: "NOT_EXPIRED" };
      if (request.action === "SEND" && quote.status === "DRAFT" && rev.approvalRequired) return { ok: false, reason: "APPROVAL_REQUIRED" };
      if (request.action === "SEND" && !rev.frozenAt) return { ok: false, reason: "NOT_FROZEN" };
      if (request.action === "REVISE") {
        const next = state.revisions.get(String(request.detail?.new_revision_id ?? ""));
        if (!next || next.quoteId !== quote.id || next.status !== "DRAFT" || next.revisionNo <= rev.revisionNo) return { ok: false, reason: "NEW_REVISION_INVALID" };
        rev.status = "REVISED";
        for (const token of state.tokens) if (token.revisionId === rev.id && !token.revokedAt) token.revokedAt = now();
        quote.currentRevisionId = next.id;
        quote.status = "DRAFT";
      } else {
        rev.status = to;
        if (request.action === "SEND") rev.sentAt ??= now();
        if (request.action === "MARK_VIEWED") rev.firstViewedAt ??= now();
        if (request.action === "ACCEPT") rev.acceptedAt ??= now();
        if (to === "WITHDRAWN") for (const token of state.tokens) if (token.revisionId === rev.id && !token.revokedAt) token.revokedAt = now();
        quote.status = to as QuoteState;
      }
      if (!(request.action === "MARK_VIEWED" && request.expectedStatus === "VIEWED")) {
        state.events.push({ id: state.events.length + 1, quoteId: quote.id, type: `quote.${request.action.toLowerCase()}`, actorKind: String(request.actorKind), revisionId: rev.id, occurredAt: now(), detail: {}, actionKey: request.actionKey ?? null });
      }
      return { ok: true, from: request.expectedStatus, to: request.action === "REVISE" ? "DRAFT" : to, revisionId: quote.currentRevisionId ?? undefined };
    },
    async insertEvent(_b, quoteId, revisionId, type, actorKind, detail) {
      state.events.push({ id: state.events.length + 1, quoteId, type, actorKind, revisionId, occurredAt: now(), detail, actionKey: null });
    },
    async listEvents(_b, quoteId) {
      return state.events.filter((e) => e.quoteId === quoteId);
    },
    async loadPendingApproval(_b, revisionId) {
      return state.approvals.find((a) => a.revisionId === revisionId && a.decision === "PENDING") ?? null;
    },
    async listApprovals(_b, quoteId) {
      return state.approvals.filter((a) => a.quoteId === quoteId);
    },
    async insertApproval(_b, quoteId, approval) {
      if (state.approvals.some((a) => a.revisionId === approval.revisionId && a.decision === "PENDING")) return;
      state.approvals.push({ ...approval, id: uuid(), quoteId, decision: "PENDING", decidedBy: null, decisionNote: null, createdAt: now() });
    },
    async decideApproval(_b, id, decision, decidedBy, note) {
      const row = state.approvals.find((a) => a.id === id);
      if (row && row.decision === "PENDING") Object.assign(row, { decision, decidedBy, decisionNote: note });
    },
    async insertToken(_b, quoteId, token) {
      state.tokens.push({ ...token, quoteId, revokedAt: null });
    },
    async listQuotes(businessId, filter) {
      return [...state.quotes.values()].filter((q) => q.businessId === businessId && (!filter.status || q.status === filter.status)).slice(0, filter.limit);
    },
  };
  return { store, state, settings, opportunity };
}

export type FakeEffects = {
  delivered: { url: string; kind: string; origin: string | undefined }[];
  jobs: { type: string; key: string; runAt?: Date }[];
  emitted: { type: string; payload: Record<string, unknown> }[];
};

export function createFakeDeps(options: {
  settings?: Partial<QuoteSettings>;
  capabilities?: Partial<Record<string, boolean>>;
  opportunity?: Partial<OpportunityInfo>;
} = {}) {
  const fake = createFakeStore(options);
  const effects: FakeEffects = { delivered: [], jobs: [], emitted: [] };
  const caps: Record<string, boolean> = {
    quote_builder_enabled: true,
    quote_ai_enabled: true,
    quote_approval_enabled: true,
    esign_enabled: true,
    invoicing_enabled: true,
    white_label_public_pages: false,
    ...options.capabilities,
  } as Record<string, boolean>;
  let tokenSeq = 0;
  const deps: QuoteDeps = {
    store: fake.store,
    now: () => new Date(),
    can: async (capability) => ({ allowed: Boolean(caps[capability]), message: caps[capability] ? null : `${capability} is not on this plan.` }),
    issueToken: ({ revisionId, expiresAt }) => {
      tokenSeq += 1;
      const token = `tok${String(tokenSeq).padStart(4, "0")}${"x".repeat(40)}`;
      return { token, tokenHash: (tokenSeq.toString(16).padStart(64, "0")), revisionId, expiresAt };
    },
    effects: {
      async deliverLink(input) {
        effects.delivered.push({ url: input.url, kind: input.kind, origin: input.origin });
        return { queued: true, channel: "email", detail: "queued (fake)" };
      },
      async enqueue(type, _payload, opts) {
        effects.jobs.push({ type, key: opts.idempotencyKey, runAt: opts.runAt });
      },
      async emit(_b, type, payload) {
        effects.emitted.push({ type, payload });
      },
      publicUrl: (token) => `https://app.test/q/${token}`,
    },
  };
  return { deps, effects, ...fake, caps };
}
