/**
 * The quote service core: every quote operation's logic, over an injected
 * store and effects, so the service operations (operations/quotes.ts), the
 * jobs and the tests run the SAME code. Pure: relative imports only, no
 * `server-only`, no Supabase. `store.ts` is the Supabase implementation;
 * tests/quote-service.test.ts drives this with an in-memory fake that
 * mirrors the 0153 RPCs.
 *
 * Rules this module owns (the pure modules own the maths):
 *   - Prices come only from calculateQuote over a catalogue snapshot taken
 *     at draft time; the snapshot is stored in `calc_input`, so a revision
 *     can be re-verified forever and a catalogue edit never changes a sent
 *     quote.
 *   - Every state change goes through `store.transition` (quote_transition,
 *     row-locked, expected status, action key); nothing here writes a status.
 *   - Creation is idempotent on the request key (one quote per originating
 *     message / tool call / API request).
 *   - Approval: the discount policy decides; only a person approves or
 *     rejects, and an approval that needs the owner needs the owner.
 *   - Capabilities are asked through `deps.can` (billing/capabilities.ts):
 *     no plan names here.
 */

import { validateCatalogue } from "../catalogue/validate.ts";
import type { Catalogue, CatalogueBundle, CatalogueItem } from "../catalogue/types.ts";
import type { Capability } from "../billing/capability-rules.ts";
import { calculateQuote } from "./calculate.ts";
import { evaluateDiscount, roleRank, type ApproverRole, type WorkspaceRole } from "./discount-policy.ts";
import { quoteActionKey, quoteRequestKey } from "./idempotency.ts";
import { assertEditable, validUntilFrom, type QuoteAction, type QuoteEventType, type QuoteState } from "./lifecycle.ts";
import { buildQuoteRenderModel, renderModelHash } from "./render-model.ts";
import { tokenExpiry, generatePublicToken, type IssuedToken } from "./tokens.ts";
import type { QuoteSettings } from "./settings.ts";
import type {
  CalculateQuoteResult,
  CalculatedLine,
  DepositRule,
  PaymentTerms,
  QuoteCalculation,
  QuoteDiscount,
  QuoteLineInput,
  QuoteRenderModel,
} from "./types.ts";

/* ------------------------------------------------------------------ errors */

export type QuoteErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN_ROLE"
  | "INVALID_INPUT"
  | "PLAN_LIMIT"
  | "POLICY_BLOCKED"
  | "CONFLICT"
  | "UNAVAILABLE";

export class QuoteServiceError extends Error {
  readonly code: QuoteErrorCode;
  readonly issues: { path: (string | number)[]; message: string }[];
  constructor(code: QuoteErrorCode, message: string, issues: { path: (string | number)[]; message: string }[] = []) {
    super(message);
    this.name = "QuoteServiceError";
    this.code = code;
    this.issues = issues;
  }
}

/* ------------------------------------------------------------------- types */

export type ActorKind = "HUMAN" | "AI" | "API" | "SYSTEM";
export type QuoteActor = { kind: ActorKind; userId: string | null; role: WorkspaceRole };

export type QuoteRow = {
  id: string;
  businessId: string;
  opportunityId: string;
  serviceId: string | null;
  number: string;
  title: string;
  currency: string;
  status: QuoteState;
  currentRevisionId: string | null;
  createdByKind: "AI" | "HUMAN" | "API" | "LEAD_REQUEST";
  requestKey: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What a draft is made of, stored as `calc_input` with the catalogue snapshot. */
export type DraftContent = {
  lines: QuoteLineInput[];
  quoteDiscount?: QuoteDiscount;
  payment?: PaymentTerms;
  customerNote?: string | null;
};

export type StoredCalcInput = {
  currency: string;
  vatRegistered: boolean;
  catalogue: Catalogue;
  lines: QuoteLineInput[];
  quoteDiscount?: QuoteDiscount;
  payment?: PaymentTerms;
  /** Not part of the price; calculateQuote strips it. */
  customerNote?: string | null;
};

export type RevisionRow = {
  id: string;
  quoteId: string;
  revisionNo: number;
  status: QuoteState;
  calcInput: StoredCalcInput;
  calculation: QuoteCalculation;
  calculationHash: string;
  renderModel: QuoteRenderModel | null;
  renderHash: string | null;
  pdfObjectKey: string | null;
  approvalRequired: boolean;
  validUntil: string | null;
  frozenAt: string | null;
  sentAt: string | null;
  firstViewedAt: string | null;
  acceptedAt: string | null;
  signedAt: string | null;
  internalNote: string | null;
  aiRationale: string | null;
  createdByKind: "AI" | "HUMAN" | "API";
  createdAt: string;
};

export type NewRevision = Omit<
  RevisionRow,
  "id" | "renderModel" | "renderHash" | "pdfObjectKey" | "frozenAt" | "sentAt" | "firstViewedAt" | "acceptedAt" | "signedAt" | "createdAt" | "status" | "validUntil"
>;

export type OpportunityInfo = {
  id: string;
  leadId: string | null;
  serviceId: string | null;
  name: string;
  outcome: string;
  anonymised: boolean;
  checkoutLinkId: string | null;
  lead: { name: string; company: string | null; email: string | null; address: string[] } | null;
};

export type SellerInfo = { name: string; email: string | null };

export type TransitionRequest = {
  businessId: string;
  quoteId: string;
  action: Exclude<QuoteAction, "SIGN">;
  expectedStatus: QuoteState;
  actorKind: ActorKind | "CUSTOMER";
  actionKey?: string | null;
  detail?: Record<string, unknown>;
};

export type TransitionOutcome =
  | { ok: true; from?: QuoteState; to?: QuoteState; revisionId?: string; duplicate?: boolean; status?: QuoteState }
  | { ok: false; reason: string; status?: QuoteState };

export type ApprovalRow = {
  id: string;
  revisionId: string;
  requiredRole: ApproverRole;
  reason: "APPROVAL_THRESHOLD" | "MARGIN_FLOOR" | "TWO_STEP_ESCALATION" | "MANUAL";
  decision: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requestedByKind: "AI" | "HUMAN" | "API";
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type QuoteEventRow = { id: number | string; type: string; actorKind: string; revisionId: string | null; occurredAt: string; detail: Record<string, unknown> };

export type QuoteListFilter = { opportunityId?: string; leadId?: string; status?: QuoteState; limit: number };

export interface QuoteStore {
  loadSettings(businessId: string): Promise<QuoteSettings>;
  /** Every item (active or not) and every bundle, cost included. */
  loadCatalogue(businessId: string, currency: string): Promise<Catalogue>;
  loadSeller(businessId: string): Promise<SellerInfo>;
  loadOpportunity(businessId: string, opportunityId: string): Promise<OpportunityInfo | null>;
  findQuoteByRequestKey(businessId: string, requestKey: string): Promise<QuoteRow | null>;
  loadQuote(businessId: string, quoteId: string): Promise<QuoteRow | null>;
  loadRevision(businessId: string, revisionId: string): Promise<RevisionRow | null>;
  listRevisions(businessId: string, quoteId: string): Promise<RevisionRow[]>;
  allocateNumber(businessId: string, kind: "QUOTE"): Promise<string>;
  /** Returns null when the request key already exists (a concurrent create). */
  insertQuote(row: Omit<QuoteRow, "id" | "createdAt" | "updatedAt" | "status" | "currentRevisionId"> & { createdBy: string | null }): Promise<QuoteRow | null>;
  insertRevision(businessId: string, revision: NewRevision): Promise<RevisionRow>;
  /** Replace a DRAFT, unfrozen revision's content and lines. False when it is no longer editable. */
  replaceDraftRevision(businessId: string, revisionId: string, revision: Omit<NewRevision, "quoteId" | "revisionNo" | "createdByKind">): Promise<boolean>;
  deleteDraftRevision(businessId: string, revisionId: string): Promise<void>;
  setCurrentRevision(businessId: string, quoteId: string, revisionId: string): Promise<void>;
  updateTitle(businessId: string, quoteId: string, title: string): Promise<void>;
  /** Freeze once: false when it was already frozen. */
  freezeRevision(businessId: string, revisionId: string, freeze: { renderModel: QuoteRenderModel; renderHash: string; validUntil: string; frozenAt: string }): Promise<boolean>;
  transition(request: TransitionRequest): Promise<TransitionOutcome>;
  insertEvent(businessId: string, quoteId: string, revisionId: string | null, type: QuoteEventType, actorKind: ActorKind, detail: Record<string, unknown>): Promise<void>;
  listEvents(businessId: string, quoteId: string): Promise<QuoteEventRow[]>;
  loadPendingApproval(businessId: string, revisionId: string): Promise<ApprovalRow | null>;
  listApprovals(businessId: string, quoteId: string): Promise<ApprovalRow[]>;
  insertApproval(businessId: string, quoteId: string, approval: Omit<ApprovalRow, "id" | "decision" | "decidedBy" | "decisionNote" | "createdAt"> & { requestedBy: string | null; matchedRuleIds: string[] }): Promise<void>;
  decideApproval(businessId: string, approvalId: string, decision: "APPROVED" | "REJECTED", decidedBy: string | null, note: string | null): Promise<void>;
  insertToken(businessId: string, quoteId: string, token: IssuedToken): Promise<void>;
  listQuotes(businessId: string, filter: QuoteListFilter): Promise<QuoteRow[]>;
}

export type DeliveryResult = { queued: boolean; channel: "email" | "link"; detail: string };

export interface QuoteEffects {
  /** Queue the email carrying the public link (the send gate re-checks everything before it goes). */
  deliverLink(input: {
    businessId: string;
    quote: QuoteRow;
    revision: RevisionRow;
    opportunity: OpportunityInfo;
    url: string;
    sendKey: string;
    kind: "SENT" | "REMINDER";
    /** "automation" for a scheduled nudge (counted by the frequency guard). */
    origin?: "manual" | "automation";
  }): Promise<DeliveryResult>;
  enqueue(type: "quote.render_pdf" | "quote.expire" | "quote.nudge", payload: Record<string, unknown>, options: { businessId: string; runAt?: Date; idempotencyKey: string }): Promise<void>;
  /** Automation events + outgoing webhooks. Never throws. */
  emit(businessId: string, type: QuoteEventType, payload: Record<string, unknown>): Promise<void>;
  publicUrl(token: string): string;
}

export type QuoteDeps = {
  store: QuoteStore;
  effects: QuoteEffects;
  can: (capability: Capability) => Promise<{ allowed: boolean; message: string | null }>;
  now: () => Date;
  issueToken?: (input: { revisionId: string; expiresAt: string }) => IssuedToken;
};

/* ---------------------------------------------------------- the operations
 * The agent may later use (another phase wires the tools; see
 * AGENT_QUOTE_OPERATIONS in registry.ts): calculate, create (as a draft),
 * submit_for_approval and send (only where commercial authority permits and a
 * person confirms, which the risk class already enforces).
 */

export const NUDGE_AFTER_DAYS = 3;
export const MAX_NUDGES = 2;

async function requireCapability(deps: QuoteDeps, capability: Capability): Promise<void> {
  const decision = await deps.can(capability);
  if (!decision.allowed) throw new QuoteServiceError("PLAN_LIMIT", decision.message ?? "This feature is not on your plan.");
}

function canSeeInternal(actor: QuoteActor): boolean {
  return actor.kind === "SYSTEM" || actor.role === "owner" || actor.role === "admin";
}

function createdKind(actor: QuoteActor): "AI" | "HUMAN" | "API" {
  return actor.kind === "AI" ? "AI" : actor.kind === "HUMAN" ? "HUMAN" : "API";
}

/** Only the referenced part of the catalogue is snapshotted into a revision. */
export function catalogueSubset(catalogue: Catalogue, lines: readonly QuoteLineInput[]): Catalogue {
  const itemIds = new Set<string>();
  const bundleIds = new Set<string>();
  for (const line of lines) {
    if (line.kind === "ITEM") itemIds.add(line.itemId);
    else bundleIds.add(line.bundleId);
  }
  const bundles: CatalogueBundle[] = catalogue.bundles.filter((bundle) => bundleIds.has(bundle.id));
  for (const bundle of bundles) for (const component of bundle.components) itemIds.add(component.itemId);
  const items: CatalogueItem[] = catalogue.items
    .filter((item) => itemIds.has(item.id))
    .map((item) => ({ ...item, addOnItemIds: item.addOnItemIds.filter((id) => itemIds.has(id)) }));
  return { currency: catalogue.currency, items, bundles };
}

function paymentFor(settings: QuoteSettings, content: DraftContent): { payment: PaymentTerms | undefined; fromDefault: boolean } {
  if (content.payment) return { payment: content.payment, fromDefault: false };
  if (settings.defaultDepositBps) {
    const deposit: DepositRule = { type: "PERCENT", bps: settings.defaultDepositBps };
    return {
      payment: { deposit, remainder: { type: "SINGLE", due: { type: "ON_ACCEPTANCE" } }, recurringBilledUpfront: true },
      fromDefault: true,
    };
  }
  return { payment: undefined, fromDefault: false };
}

/** Price a draft against a catalogue snapshot; the default deposit is dropped when nothing one-off can carry it. */
export function priceDraft(
  settings: QuoteSettings,
  catalogue: Catalogue,
  content: DraftContent,
): { result: CalculateQuoteResult; input: StoredCalcInput } {
  const subset = catalogueSubset(catalogue, content.lines);
  const { payment, fromDefault } = paymentFor(settings, content);
  const base: StoredCalcInput = {
    currency: settings.currency,
    vatRegistered: settings.vatRegistered,
    catalogue: subset,
    lines: content.lines,
    ...(content.quoteDiscount ? { quoteDiscount: content.quoteDiscount } : {}),
    ...(payment ? { payment } : {}),
  };
  let result = calculateQuote(base);
  let input = base;
  if (!result.ok && fromDefault && result.issues.some((issue) => issue.code === "DEPOSIT_WITHOUT_ONE_OFF" || issue.code === "DEPOSIT_ROUNDS_TO_ZERO")) {
    const { payment: _dropped, ...withoutDeposit } = base;
    void _dropped;
    input = withoutDeposit;
    result = calculateQuote(input);
  }
  return { result, input: { ...input, customerNote: content.customerNote ?? null } };
}

export type ApprovalVerdict = {
  required: boolean;
  role: ApproverRole | null;
  reason: ApprovalRow["reason"] | null;
  matchedRuleIds: string[];
  detail: string;
  denied: boolean;
};

/** The discount part the policy governs: line and quote discounts, not catalogue bundle pricing. */
export function negotiatedDiscount(calc: QuoteCalculation): { baseMinor: number; discountMinor: number } {
  const priced = calc.lines.filter((line) => line.chargeType !== "USAGE");
  const baseMinor = priced.reduce((t, l) => t + l.listMinor - l.bundleDiscountMinor, 0);
  const discountMinor = priced.reduce((t, l) => t + l.lineDiscountMinor + l.quoteDiscountMinor, 0);
  return { baseMinor, discountMinor };
}

export function approvalVerdict(
  settings: QuoteSettings,
  calc: QuoteCalculation,
  actor: QuoteActor,
  approvalsEnabled: boolean,
  ai: { afterObjection: boolean; priorAiConcessions: number } = { afterObjection: false, priorAiConcessions: 0 },
): ApprovalVerdict {
  const policy = settings.discountPolicy;
  const { baseMinor, discountMinor } = negotiatedDiscount(calc);
  const marginAfterBps = calc.margin.complete ? calc.margin.marginBps : null;
  const isAi = actor.kind === "AI";
  const none: ApprovalVerdict = { required: false, role: null, reason: null, matchedRuleIds: [], detail: "No approval needed.", denied: false };

  if (discountMinor > 0) {
    const decision = evaluateDiscount(policy, {
      actor: isAi ? { kind: "AI" } : { kind: "HUMAN", role: actor.role },
      baseMinor,
      discountMinor,
      valueAfterMinor: calc.totals.netMinor,
      marginAfterBps,
      afterObjection: ai.afterObjection,
      priorAiConcessions: ai.priorAiConcessions,
    });
    if (decision.outcome === "DENY") return { ...none, denied: true, detail: decision.detail };
    if (decision.outcome === "REQUIRE_APPROVAL") {
      if (!isAi && !approvalsEnabled) return none;
      return {
        required: true,
        role: decision.role,
        reason: decision.reason === "MARGIN_FLOOR" ? "MARGIN_FLOOR" : decision.reason === "TWO_STEP_ESCALATION" ? "TWO_STEP_ESCALATION" : "APPROVAL_THRESHOLD",
        matchedRuleIds: decision.matchedRuleIds,
        detail: decision.detail,
        denied: false,
      };
    }
    return none;
  }

  // No negotiated discount: value and margin thresholds still apply.
  let role: ApproverRole | null = null;
  const matched: string[] = [];
  for (const rule of policy.approvalRules) {
    const hit =
      (rule.valueAboveMinor !== undefined && calc.totals.netMinor > rule.valueAboveMinor) ||
      (rule.marginBelowBps !== undefined && marginAfterBps !== null && marginAfterBps < rule.marginBelowBps);
    if (hit) {
      matched.push(rule.id);
      role = role === "owner" || rule.role === "owner" ? "owner" : "admin";
    }
  }
  if (role === null) return none;
  if (!isAi && (!approvalsEnabled || roleRank(actor.role) >= roleRank(role))) return none;
  return { required: true, role, reason: "APPROVAL_THRESHOLD", matchedRuleIds: matched, detail: `Needs ${role} approval (${matched.join(", ")}).`, denied: false };
}

function calcFailure(result: CalculateQuoteResult): never {
  if (result.ok) throw new Error("unreachable");
  const first = result.issues[0];
  throw new QuoteServiceError("INVALID_INPUT", first ? first.message : "Those quote lines could not be priced.", result.issues);
}

function revisionContent(calc: QuoteCalculation, input: StoredCalcInput, verdict: ApprovalVerdict, notes: { internalNote?: string | null; aiRationale?: string | null }) {
  return {
    calcInput: input,
    calculation: calc,
    calculationHash: calc.calculationHash,
    approvalRequired: verdict.required,
    internalNote: notes.internalNote ?? null,
    aiRationale: notes.aiRationale ?? null,
  };
}

/* ------------------------------------------------------------- presenting */

export function presentCalculation(calc: QuoteCalculation, internal: boolean) {
  if (internal) return calc;
  const lines = calc.lines.map((line: CalculatedLine) => ({ ...line, costMinor: null, marginMinor: null, marginBps: null }));
  return { ...calc, lines, margin: null };
}

export function presentQuote(quote: QuoteRow) {
  return {
    id: quote.id,
    opportunityId: quote.opportunityId,
    number: quote.number,
    title: quote.title,
    currency: quote.currency,
    status: quote.status,
    currentRevisionId: quote.currentRevisionId,
    createdByKind: quote.createdByKind,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}

export function presentRevision(revision: RevisionRow, internal: boolean) {
  return {
    id: revision.id,
    revisionNo: revision.revisionNo,
    status: revision.status,
    calculationHash: revision.calculationHash,
    renderHash: revision.renderHash,
    hasPdf: Boolean(revision.pdfObjectKey),
    approvalRequired: revision.approvalRequired,
    validUntil: revision.validUntil,
    frozenAt: revision.frozenAt,
    sentAt: revision.sentAt,
    firstViewedAt: revision.firstViewedAt,
    acceptedAt: revision.acceptedAt,
    signedAt: revision.signedAt,
    createdByKind: revision.createdByKind,
    createdAt: revision.createdAt,
    content: {
      lines: revision.calcInput.lines,
      quoteDiscount: revision.calcInput.quoteDiscount ?? null,
      payment: revision.calcInput.payment ?? null,
      customerNote: revision.calcInput.customerNote ?? null,
    },
    calculation: presentCalculation(revision.calculation, internal),
    internalNote: internal ? revision.internalNote : null,
    aiRationale: internal ? revision.aiRationale : null,
  };
}

/* ---------------------------------------------------------------- loaders */

async function loadQuoteOrFail(deps: QuoteDeps, businessId: string, quoteId: string) {
  const quote = await deps.store.loadQuote(businessId, quoteId);
  if (!quote) throw new QuoteServiceError("NOT_FOUND", "That quote could not be found.");
  if (!quote.currentRevisionId) throw new QuoteServiceError("CONFLICT", "That quote has no current revision.");
  const revision = await deps.store.loadRevision(businessId, quote.currentRevisionId);
  if (!revision) throw new QuoteServiceError("CONFLICT", "That quote's current revision could not be read.");
  return { quote, revision };
}

const REFUSAL_MESSAGE: Record<string, [QuoteErrorCode, string]> = {
  NOT_FOUND: ["NOT_FOUND", "That quote could not be found."],
  STALE: ["CONFLICT", "That quote changed while you were working on it. Refresh and try again."],
  ILLEGAL_TRANSITION: ["CONFLICT", "That step is not possible from the quote's current status."],
  ACTOR_NOT_PERMITTED: ["FORBIDDEN_ROLE", "Only a person can take that step."],
  EXPIRED: ["CONFLICT", "The quote has passed its valid-until date. Revise it to send a new one."],
  NOT_EXPIRED: ["CONFLICT", "The quote is still within its validity."],
  APPROVAL_REQUIRED: ["POLICY_BLOCKED", "This quote needs approval before it is sent."],
  NOT_FROZEN: ["CONFLICT", "The quote was not ready to send."],
  NEW_REVISION_INVALID: ["CONFLICT", "The new revision could not be started."],
  ACTION_KEY_CONFLICT: ["CONFLICT", "That request was already used for a different quote."],
};

async function transitionOrFail(deps: QuoteDeps, request: TransitionRequest): Promise<Extract<TransitionOutcome, { ok: true }>> {
  const outcome = await deps.store.transition(request);
  if (outcome.ok) return outcome;
  const [code, message] = REFUSAL_MESSAGE[outcome.reason] ?? ["CONFLICT", "That quote could not be updated."];
  throw new QuoteServiceError(code, message);
}

function transitionActor(actor: QuoteActor): ActorKind {
  return actor.kind;
}

/* ---------------------------------------------------------------- calculate */

export async function calculateQuoteDraft(deps: QuoteDeps, businessId: string, actor: QuoteActor, content: DraftContent) {
  const settings = await deps.store.loadSettings(businessId);
  const catalogue = await deps.store.loadCatalogue(businessId, settings.currency);
  const { result } = priceDraft(settings, catalogue, content);
  if (!result.ok) {
    return { ok: false as const, issues: result.issues };
  }
  const approvals = await deps.can("quote_approval_enabled");
  const verdict = approvalVerdict(settings, result.quote, actor, approvals.allowed);
  return {
    ok: true as const,
    calculation: presentCalculation(result.quote, canSeeInternal(actor)),
    approval: verdict,
  };
}

/* ------------------------------------------------------------------ create */

export type CreateQuoteArgs = DraftContent & {
  opportunityId: string;
  title?: string;
  requestId: string;
  internalNote?: string | null;
  aiRationale?: string | null;
  origin?: "LEAD_REQUEST";
  ai?: { afterObjection: boolean; priorAiConcessions: number };
};

export async function createQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: CreateQuoteArgs) {
  const opportunity = await deps.store.loadOpportunity(businessId, args.opportunityId);
  if (!opportunity) throw new QuoteServiceError("NOT_FOUND", "That opportunity could not be found.");

  const requestKey = quoteRequestKey({
    businessId,
    opportunityId: opportunity.id,
    leadId: opportunity.leadId,
    requestId: args.requestId,
  });
  const existing = await deps.store.findQuoteByRequestKey(businessId, requestKey);
  if (existing) {
    const revision = existing.currentRevisionId ? await deps.store.loadRevision(businessId, existing.currentRevisionId) : null;
    return { quote: existing, revision, duplicate: true };
  }

  await requireCapability(deps, "quote_builder_enabled");
  if (actor.kind === "AI") await requireCapability(deps, "quote_ai_enabled");
  if (opportunity.anonymised) throw new QuoteServiceError("CONFLICT", "The person on this opportunity has been anonymised.");
  if (opportunity.outcome !== "OPEN") throw new QuoteServiceError("CONFLICT", "That opportunity is already closed.");

  const settings = await deps.store.loadSettings(businessId);
  const catalogue = await deps.store.loadCatalogue(businessId, settings.currency);
  const { result, input } = priceDraft(settings, catalogue, args);
  if (!result.ok) calcFailure(result);
  const approvals = await deps.can("quote_approval_enabled");
  const verdict = approvalVerdict(settings, result.quote, actor, approvals.allowed, args.ai);
  if (verdict.denied) throw new QuoteServiceError("POLICY_BLOCKED", verdict.detail);

  const number = await deps.store.allocateNumber(businessId, "QUOTE");
  const title = args.title?.trim() || `${opportunity.name}`.slice(0, 200) || `Quote ${number}`;
  const inserted = await deps.store.insertQuote({
    businessId,
    opportunityId: opportunity.id,
    serviceId: opportunity.serviceId,
    number,
    title,
    currency: settings.currency,
    createdByKind: args.origin ?? createdKind(actor),
    requestKey,
    createdBy: actor.userId,
  });
  if (!inserted) {
    // Lost a race with the same request: return the winner.
    const winner = await deps.store.findQuoteByRequestKey(businessId, requestKey);
    if (!winner) throw new QuoteServiceError("CONFLICT", "That quote could not be created.");
    const revision = winner.currentRevisionId ? await deps.store.loadRevision(businessId, winner.currentRevisionId) : null;
    return { quote: winner, revision, duplicate: true };
  }

  const revision = await deps.store.insertRevision(businessId, {
    quoteId: inserted.id,
    revisionNo: 1,
    createdByKind: createdKind(actor),
    ...revisionContent(result.quote, input, verdict, args),
  });
  await deps.store.setCurrentRevision(businessId, inserted.id, revision.id);
  if (args.origin === "LEAD_REQUEST") {
    await deps.store.insertEvent(businessId, inserted.id, revision.id, "quote.requested", transitionActor(actor), {});
  }
  await deps.store.insertEvent(businessId, inserted.id, revision.id, "quote.created", transitionActor(actor), { number });
  await deps.effects.emit(businessId, "quote.created", { quoteId: inserted.id, opportunityId: opportunity.id, leadId: opportunity.leadId, number });

  return { quote: { ...inserted, currentRevisionId: revision.id }, revision, duplicate: false, approval: verdict };
}

/* ------------------------------------------------------------ update draft */

export type UpdateDraftArgs = Partial<DraftContent> & {
  quoteId: string;
  title?: string;
  internalNote?: string | null;
  expectedRevisionId?: string;
};

export async function updateDraft(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: UpdateDraftArgs) {
  const { quote, revision } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  if (args.expectedRevisionId && args.expectedRevisionId !== revision.id) {
    throw new QuoteServiceError("CONFLICT", "That quote has a newer revision. Refresh and try again.");
  }
  const editable = assertEditable(quote.status);
  if (!editable.ok) throw new QuoteServiceError("CONFLICT", editable.detail);
  if (revision.frozenAt) throw new QuoteServiceError("CONFLICT", "This revision was frozen for sending. Revise the quote to change it.");

  const content: DraftContent = {
    lines: args.lines ?? revision.calcInput.lines,
    quoteDiscount: args.quoteDiscount === undefined ? revision.calcInput.quoteDiscount : args.quoteDiscount,
    payment: args.payment === undefined ? revision.calcInput.payment : args.payment,
    customerNote: args.customerNote === undefined ? (revision.calcInput.customerNote ?? null) : args.customerNote,
  };
  const settings = await deps.store.loadSettings(businessId);
  // New or changed lines are priced from the CURRENT catalogue.
  const catalogue = await deps.store.loadCatalogue(businessId, settings.currency);
  const { result, input } = priceDraft(settings, catalogue, content);
  if (!result.ok) calcFailure(result);
  const approvals = await deps.can("quote_approval_enabled");
  const verdict = approvalVerdict(settings, result.quote, actor, approvals.allowed);
  if (verdict.denied) throw new QuoteServiceError("POLICY_BLOCKED", verdict.detail);

  const ok = await deps.store.replaceDraftRevision(businessId, revision.id, {
    ...revisionContent(result.quote, input, verdict, {
      internalNote: args.internalNote === undefined ? revision.internalNote : args.internalNote,
      aiRationale: revision.aiRationale,
    }),
  });
  if (!ok) throw new QuoteServiceError("CONFLICT", "That quote is no longer a draft.");
  if (args.title && args.title.trim() !== quote.title) await deps.store.updateTitle(businessId, quote.id, args.title.trim());

  const after = await deps.store.loadRevision(businessId, revision.id);
  return { quote: { ...quote, title: args.title?.trim() || quote.title }, revision: after ?? revision, approval: verdict };
}

/* --------------------------------------------------------------- approvals */

export async function submitForApproval(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string; note?: string | null }) {
  await requireCapability(deps, "quote_approval_enabled");
  const { quote, revision } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  const settings = await deps.store.loadSettings(businessId);
  const verdict = approvalVerdict(settings, revision.calculation, actor, true);
  const outcome = await transitionOrFail(deps, {
    businessId,
    quoteId: quote.id,
    action: "SUBMIT_FOR_APPROVAL",
    expectedStatus: quote.status,
    actorKind: transitionActor(actor),
    detail: args.note ? { note: args.note } : {},
  });
  await deps.store.insertApproval(businessId, quote.id, {
    revisionId: revision.id,
    requiredRole: verdict.role ?? "admin",
    reason: verdict.reason ?? "MANUAL",
    requestedByKind: createdKind(actor),
    requestedBy: actor.userId,
    matchedRuleIds: verdict.matchedRuleIds,
  });
  await deps.effects.emit(businessId, "quote.approval_requested", { quoteId: quote.id, number: quote.number, requiredRole: verdict.role ?? "admin" });
  return { status: outcome.to ?? "PENDING_APPROVAL", requiredRole: verdict.role ?? "admin" };
}

async function decide(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string; note?: string | null }, approve: boolean) {
  if (actor.kind !== "HUMAN") throw new QuoteServiceError("FORBIDDEN_ROLE", "Only a person can approve or reject a quote.");
  const { quote, revision } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  if (quote.status !== "PENDING_APPROVAL") throw new QuoteServiceError("CONFLICT", "That quote is not waiting for approval.");
  const pending = await deps.store.loadPendingApproval(businessId, revision.id);
  const required: ApproverRole = pending?.requiredRole ?? "admin";
  if (roleRank(actor.role) < roleRank(required)) {
    throw new QuoteServiceError("FORBIDDEN_ROLE", `This quote needs ${required === "owner" ? "the owner" : "an owner or admin"} to decide.`);
  }
  const outcome = await transitionOrFail(deps, {
    businessId,
    quoteId: quote.id,
    action: approve ? "APPROVE" : "REJECT_APPROVAL",
    expectedStatus: "PENDING_APPROVAL",
    actorKind: "HUMAN",
    actionKey: approve ? quoteActionKey({ revisionId: revision.id, action: "APPROVE" }) : null,
    detail: args.note ? { note: args.note } : {},
  });
  if (pending) await deps.store.decideApproval(businessId, pending.id, approve ? "APPROVED" : "REJECTED", actor.userId, args.note ?? null);
  if (!outcome.duplicate) {
    await deps.effects.emit(businessId, approve ? "quote.approved" : "quote.approval_rejected", { quoteId: quote.id, number: quote.number });
  }
  return { status: outcome.to ?? (approve ? "APPROVED" : "DRAFT"), duplicate: Boolean(outcome.duplicate) };
}

export function approveQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string; note?: string | null }) {
  return decide(deps, businessId, actor, args, true);
}

export function rejectQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string; note?: string | null }) {
  return decide(deps, businessId, actor, args, false);
}

/* -------------------------------------------------------------------- send */

export function isoDate(at: Date | string): string {
  return (typeof at === "string" ? new Date(at) : at).toISOString().slice(0, 10);
}

export async function buildRenderModelFor(
  deps: QuoteDeps,
  businessId: string,
  quote: QuoteRow,
  revision: RevisionRow,
  opportunity: OpportunityInfo,
  settings: QuoteSettings,
  issuedAt: Date,
  validUntil: string,
): Promise<QuoteRenderModel> {
  const seller = await deps.store.loadSeller(businessId);
  const whiteLabel = await deps.can("white_label_public_pages");
  return buildQuoteRenderModel({
    quote: { number: quote.number, revision: revision.revisionNo, title: quote.title, issuedOn: isoDate(issuedAt), validUntil: isoDate(validUntil) },
    seller: {
      name: seller.name,
      legalName: settings.legalName,
      address: settings.addressLines,
      companyNumber: settings.companyNumber,
      vatNumber: settings.vatNumber,
      email: seller.email,
      // The logo is presentation, not contract: it is drawn from the live
      // business profile at view time and is not sealed into the document.
      logoUrl: null,
    },
    buyer: {
      name: opportunity.lead?.name ?? opportunity.name,
      company: opportunity.lead?.company ?? null,
      email: opportunity.lead?.email ?? null,
      address: opportunity.lead?.address ?? [],
    },
    calculation: revision.calculation,
    terms: settings.termsText,
    customerNote: revision.calcInput.customerNote ?? null,
    poweredBy: !whiteLabel.allowed,
  });
}

export type SendArgs = { quoteId: string; channel: "email" | "link"; origin?: "manual" | "automation" };

/**
 * Freeze (render model + hash + validity), SEND through the RPC, issue a
 * public link, deliver it, and queue the PDF render, the expiry and the
 * first nudge. A quote that is already SENT or VIEWED gets a fresh link
 * (a resend) without a second transition.
 */
export async function sendQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: SendArgs) {
  await requireCapability(deps, "quote_builder_enabled");
  const { quote, revision } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  const resend = quote.status === "SENT" || quote.status === "VIEWED";
  if (!resend && quote.status !== "DRAFT" && quote.status !== "APPROVED") {
    throw new QuoteServiceError("CONFLICT", `A ${quote.status.toLowerCase().replace("_", " ")} quote cannot be sent.`);
  }
  if (quote.status === "DRAFT" && revision.approvalRequired) {
    throw new QuoteServiceError("POLICY_BLOCKED", "This quote needs approval before it is sent.");
  }
  const opportunity = await deps.store.loadOpportunity(businessId, quote.opportunityId);
  if (!opportunity) throw new QuoteServiceError("NOT_FOUND", "That quote's opportunity could not be found.");
  if (opportunity.anonymised) throw new QuoteServiceError("CONFLICT", "The person on this quote has been anonymised.");
  if (args.channel === "email" && !opportunity.lead?.email) {
    throw new QuoteServiceError("CONFLICT", "This lead has no email address. Send the link another way instead.");
  }

  const now = deps.now();
  const settings = await deps.store.loadSettings(businessId);
  let validUntil = revision.validUntil;
  if (!revision.frozenAt) {
    validUntil = validUntilFrom(now.toISOString(), settings.validityDays);
    const model = await buildRenderModelFor(deps, businessId, quote, revision, opportunity, settings, now, validUntil);
    await deps.store.freezeRevision(businessId, revision.id, {
      renderModel: model,
      renderHash: renderModelHash(model),
      validUntil,
      frozenAt: now.toISOString(),
    });
  }
  if (!validUntil) throw new QuoteServiceError("CONFLICT", "The quote has no validity date.");
  if (Date.parse(validUntil) < now.getTime()) {
    throw new QuoteServiceError("CONFLICT", "The quote has passed its valid-until date. Revise it to send a new one.");
  }

  let duplicate = false;
  if (!resend) {
    const outcome = await transitionOrFail(deps, {
      businessId,
      quoteId: quote.id,
      action: "SEND",
      expectedStatus: quote.status,
      actorKind: transitionActor(actor),
      actionKey: quoteActionKey({ revisionId: revision.id, action: "SEND" }),
      detail: { channel: args.channel },
    });
    duplicate = Boolean(outcome.duplicate);
  }

  const issue = deps.issueToken ?? generatePublicToken;
  const token = issue({ revisionId: revision.id, expiresAt: tokenExpiry(validUntil) });
  await deps.store.insertToken(businessId, quote.id, token);
  const url = deps.effects.publicUrl(token.token);

  const fresh = (await deps.store.loadRevision(businessId, revision.id)) ?? revision;
  let delivery: DeliveryResult = { queued: false, channel: "link", detail: "Copy the link and share it yourself." };
  if (args.channel === "email") {
    delivery = await deps.effects.deliverLink({
      businessId,
      quote,
      revision: fresh,
      opportunity,
      url,
      sendKey: `quote-link:${token.tokenHash.slice(0, 32)}`,
      kind: resend ? "REMINDER" : "SENT",
      origin: args.origin ?? "manual",
    });
  }

  if (!resend && !duplicate) {
    await deps.effects.enqueue("quote.render_pdf", { revisionId: revision.id }, { businessId, idempotencyKey: `quote.render_pdf:${revision.id}` });
    await deps.effects.enqueue(
      "quote.expire",
      { quoteId: quote.id, revisionId: revision.id },
      { businessId, runAt: new Date(Date.parse(validUntil) + 60_000), idempotencyKey: `quote.expire:${revision.id}` },
    );
    if (settings.quoteNudgesEnabled) {
      await deps.effects.enqueue(
        "quote.nudge",
        { quoteId: quote.id, revisionId: revision.id, step: 1 },
        { businessId, runAt: new Date(now.getTime() + NUDGE_AFTER_DAYS * 86_400_000), idempotencyKey: `quote.nudge:${revision.id}:1` },
      );
    }
    await deps.effects.emit(businessId, "quote.sent", {
      quoteId: quote.id,
      number: quote.number,
      opportunityId: quote.opportunityId,
      leadId: opportunity.leadId,
      revision: revision.revisionNo,
      totalGrossMinor: fresh.calculation.totals.grossMinor,
      currency: quote.currency,
      validUntil,
    });
  }

  return {
    status: (resend ? quote.status : "SENT") as QuoteState,
    publicUrl: url,
    validUntil,
    delivery,
    resend,
    duplicate,
  };
}

/* ------------------------------------------------------------ revise/withdraw */

export async function reviseQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string }) {
  const { quote, revision } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED"].includes(quote.status)) {
    throw new QuoteServiceError("CONFLICT", `A ${quote.status.toLowerCase()} quote cannot be revised.`);
  }
  // The new revision starts from the old one's content, re-priced against
  // the SAME catalogue snapshot (so nothing moves until someone edits it).
  const recheck = calculateQuote(revision.calcInput);
  if (!recheck.ok) calcFailure(recheck);
  const settings = await deps.store.loadSettings(businessId);
  const approvals = await deps.can("quote_approval_enabled");
  const verdict = approvalVerdict(settings, recheck.quote, actor, approvals.allowed);
  const all = await deps.store.listRevisions(businessId, quote.id);
  const nextNo = Math.max(...all.map((r) => r.revisionNo), revision.revisionNo) + 1;
  const draft = await deps.store.insertRevision(businessId, {
    quoteId: quote.id,
    revisionNo: nextNo,
    createdByKind: createdKind(actor),
    ...revisionContent(recheck.quote, revision.calcInput, verdict, { internalNote: revision.internalNote }),
  });
  try {
    await transitionOrFail(deps, {
      businessId,
      quoteId: quote.id,
      action: "REVISE",
      expectedStatus: quote.status,
      actorKind: transitionActor(actor),
      detail: { new_revision_id: draft.id },
    });
  } catch (error) {
    await deps.store.deleteDraftRevision(businessId, draft.id);
    throw error;
  }
  await deps.effects.emit(businessId, "quote.revised", { quoteId: quote.id, number: quote.number, revision: nextNo });
  return { status: "DRAFT" as QuoteState, revisionId: draft.id, revisionNo: nextNo };
}

export async function withdrawQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string; reason: string }) {
  const { quote } = await loadQuoteOrFail(deps, businessId, args.quoteId);
  const outcome = await transitionOrFail(deps, {
    businessId,
    quoteId: quote.id,
    action: "WITHDRAW",
    expectedStatus: quote.status,
    actorKind: transitionActor(actor),
    detail: { reason: args.reason },
  });
  await deps.effects.emit(businessId, "quote.withdrawn", { quoteId: quote.id, number: quote.number });
  return { status: outcome.to ?? "WITHDRAWN", from: quote.status };
}

/* --------------------------------------------------------------- get/list */

export async function getQuote(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: { quoteId: string }) {
  const quote = await deps.store.loadQuote(businessId, args.quoteId);
  if (!quote) throw new QuoteServiceError("NOT_FOUND", "That quote could not be found.");
  const [revisions, events, approvals] = await Promise.all([
    deps.store.listRevisions(businessId, quote.id),
    deps.store.listEvents(businessId, quote.id),
    deps.store.listApprovals(businessId, quote.id),
  ]);
  const internal = canSeeInternal(actor);
  const current = revisions.find((r) => r.id === quote.currentRevisionId) ?? null;
  return {
    quote: presentQuote(quote),
    current: current ? presentRevision(current, internal) : null,
    revisions: revisions
      .sort((a, b) => b.revisionNo - a.revisionNo)
      .map((r) => ({ id: r.id, revisionNo: r.revisionNo, status: r.status, sentAt: r.sentAt, totalGrossMinor: r.calculation.totals.grossMinor, createdAt: r.createdAt })),
    events: events.map((e) => ({ type: e.type, actorKind: e.actorKind, occurredAt: e.occurredAt, revisionId: e.revisionId })),
    approvals: approvals.map((a) => ({ requiredRole: a.requiredRole, reason: a.reason, decision: a.decision, decisionNote: a.decisionNote, createdAt: a.createdAt })),
  };
}

export async function listQuotes(deps: QuoteDeps, businessId: string, filter: QuoteListFilter) {
  const rows = await deps.store.listQuotes(businessId, filter);
  return { quotes: rows.map(presentQuote), count: rows.length };
}

/* ---------------------------------------------------------- catalogue view */

export function catalogueProblems(catalogue: Catalogue): string[] {
  const check = validateCatalogue(catalogue);
  return check.ok ? [] : check.issues.map((issue) => issue.message);
}
