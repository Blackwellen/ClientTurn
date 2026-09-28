import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/billing/capabilities";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { aiMay } from "@/lib/commercial/ai-permissions";
import { liveQuoteDeps } from "@/lib/quotes/effects";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { aiDiscountPolicyFromAuthority, type DiscountPolicy } from "@/lib/quotes/discount-policy";
import { readLiveFacts } from "@/lib/qualification-intelligence/store-reads";
import type { AgentContext } from "./context";
import type { QuoteToolAccess } from "./tools";
import {
  QUOTE_INPUT_KINDS,
  detectDiscountAsk,
  detectPriceObjection,
  detectQuoteQuestion,
  detectQuoteRequest,
  emptyQuotePathState,
  parseQuotePathState,
  type KnownFact,
  type OpenQuote,
  type QuoteCatalogueItem,
  type QuoteInputKind,
  type QuotePathState,
} from "./quote-flow";

/**
 * Everything the quote path needs for one turn, read once (brief §7, §72-74).
 * Server-only; the decisions are agent/quote-flow.ts (pure).
 *
 * Cheap on an ordinary turn: unless the lead's words are about a quote, a
 * price or a discount, a quote path is in progress, the lead already has a
 * live quote, or the engine is at its close, it returns null after two small
 * indexed reads (the open quote, the last quote turn) and the turn is the
 * ordinary one. Without "Draft quotes" and with no live quote it stops there.
 */
export type QuoteTurnData = {
  access: QuoteToolAccess;
  /** The workspace's sellable catalogue items (never their cost). */
  items: QuoteCatalogueItem[];
  state: QuotePathState;
  /** What the previous turn asked, when it was a quote input question. */
  answering: { kind: QuoteInputKind; itemId: string | null } | null;
  openQuote: OpenQuote | null;
  facts: KnownFact[];
  /** The lead has objected on price in this conversation (ONLY_AFTER_OBJECTION). */
  priceObjectionSeen: boolean;
  /** The assistant's discount policy (quote policy + commercial authority v2). */
  aiPolicy: DiscountPolicy;
  /** The offer's pricing model, for the quote-led close. */
  pricingModel: string | null;
  leadHasEmail: boolean;
};

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const LIVE_STATES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED", "ACCEPTED", "SIGNED", "DEPOSIT_PAID"];
const STATE_WINDOW_MS = 14 * 86_400_000;

/** The quote path state the last quote turn on this conversation left, and whether it was the latest run. */
async function loadPathState(conversationId: string | null, runId: string): Promise<{ state: QuotePathState | null; answering: QuoteTurnData["answering"] }> {
  if (!conversationId) return { state: null, answering: null };
  const { data } = await db()
    .from("conversation_agent_runs")
    .select("id, decision_json, created_at")
    .eq("conversation_id", conversationId)
    .neq("id", runId)
    .order("created_at", { ascending: false })
    .limit(12);
  const rows = (data ?? []) as { id: string; decision_json: Record<string, unknown> | null; created_at: string }[];
  const index = rows.findIndex((row) => row.decision_json && typeof row.decision_json === "object" && "quote" in row.decision_json);
  if (index < 0) return { state: null, answering: null };
  const row = rows[index];
  if (Date.now() - Date.parse(row.created_at) > STATE_WINDOW_MS) return { state: null, answering: null };
  const state = parseQuotePathState(row.decision_json?.quote);
  const ask = row.decision_json?.quoteAsk as { kind?: unknown; itemId?: unknown } | undefined;
  const answering =
    index === 0 && ask && typeof ask.kind === "string" && (QUOTE_INPUT_KINDS as readonly string[]).includes(ask.kind)
      ? { kind: ask.kind as QuoteInputKind, itemId: typeof ask.itemId === "string" ? ask.itemId : null }
      : null;
  return { state, answering };
}

/** The lead's latest live quote (any of its opportunities), with the current revision's figures. */
async function loadOpenQuote(businessId: string, leadId: string): Promise<OpenQuote | null> {
  const { data, error } = await db()
    .from("quotes")
    .select("id, status, current_revision_id, updated_at, opportunities!inner(lead_id)")
    .eq("business_id", businessId)
    .eq("opportunities.lead_id", leadId)
    .in("status", LIVE_STATES)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return null; // before 0153, or a read failure: no quote path on quotes
  const quote = ((data ?? []) as { id: string; status: string; current_revision_id: string | null }[])[0];
  if (!quote) return null;
  let calculation: OpenQuote["calculation"] = null;
  let validUntil: string | null = null;
  let sent = false;
  if (quote.current_revision_id) {
    const { data: rev } = await db()
      .from("quote_revisions")
      .select("calculation, valid_until, frozen_at")
      .eq("business_id", businessId)
      .eq("id", quote.current_revision_id)
      .maybeSingle();
    const r = rev as { calculation: OpenQuote["calculation"]; valid_until: string | null; frozen_at: string | null } | null;
    calculation = r?.calculation ?? null;
    validUntil = r?.valid_until ?? null;
    sent = Boolean(r?.frozen_at);
  }
  return { id: quote.id, status: quote.status, revisionId: quote.current_revision_id, calculation, validUntil, sent };
}

export async function loadQuoteTurn(input: {
  context: AgentContext;
  runId: string;
  latestMessage: string | null;
  /** The service of the turn's interest, or the lead's own. */
  serviceId: string | null;
  /** The engine's planned action this turn (for the quote-led close). */
  nbaAction: string | null;
}): Promise<QuoteTurnData | null> {
  const { context } = input;
  const businessId = context.business.businessId;
  const leadId = context.lead.id;
  const text = input.latestMessage;
  const wordsAboutQuotes =
    detectQuoteRequest(text) || detectQuoteQuestion(text) || detectDiscountAsk(text) !== null || detectPriceObjection(text);

  const [openQuote, path] = await Promise.all([
    loadOpenQuote(businessId, leadId).catch(() => null),
    loadPathState(context.conversation.conversationId, input.runId).catch(() => ({ state: null, answering: null })),
  ]);
  const inProgress = Boolean(path.state && path.state.itemIds.length > 0 && !path.state.quoteId);
  const closing = input.nbaAction === "CTA_BOOK" || input.nbaAction === "CTA_CHECKOUT";
  if (!wordsAboutQuotes && !inProgress && !openQuote && !closing) return null;

  const authority = context.commerce?.authority ?? null;
  const ai = aiAuthorityOf(authority);
  const aiEnabled = context.business.aiAssistEnabled && context.business.agent.mode !== "OFF";
  // A live quote on the lead is answered from even without drafting rights;
  // anything else needs "Draft quotes" on.
  if (!openQuote && !aiMay(ai, "create_quote")) return null;

  const capability = await can(businessId, "quote_ai_enabled").catch(() => null);
  const settings = await loadQuoteSettings(businessId).catch(() => null);
  if (!settings) return null;
  const catalogue = await liveQuoteDeps(businessId).store.loadCatalogue(businessId, settings.currency).catch(() => null);
  const items: QuoteCatalogueItem[] = (catalogue?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    serviceId: item.serviceId,
    unit: item.unit,
    chargeType: item.chargeType,
    interval: item.interval,
    options: item.options,
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity,
    addOnOnly: item.addOnOnly,
    active: item.active,
  }));

  const facts: KnownFact[] = await readLiveFacts(businessId, leadId)
    .then((rows) =>
      rows
        .filter((fact) => fact.state === "CONFIRMED" || fact.state === "INFERRED")
        .map((fact) => ({ dimension: String(fact.dimension), value: fact.value, status: fact.state as "CONFIRMED" | "INFERRED" })),
    )
    .catch(() => []);

  let pricingModel: string | null = null;
  if (input.serviceId) {
    const { data } = await db().from("services").select("offer_profile").eq("business_id", businessId).eq("id", input.serviceId).maybeSingle();
    const profile = (data as { offer_profile: { pricingModel?: unknown } | null } | null)?.offer_profile ?? null;
    pricingModel = typeof profile?.pricingModel === "string" ? profile.pricingModel : null;
  }

  const leadWords = context.conversation.recentMessages.filter((m) => m.role === "lead").map((m) => m.body);
  const priceObjectionSeen = [...leadWords, text ?? ""].some((body) => detectPriceObjection(body));

  return {
    access: { aiEnabled, quoteAiCapability: capability?.allowed === true, authority: ai },
    items,
    state: path.state ?? emptyQuotePathState(),
    answering: path.answering,
    openQuote,
    facts,
    priceObjectionSeen,
    aiPolicy: aiDiscountPolicyFromAuthority(settings.discountPolicy, authority ?? { enabled: false, approved_checkout_links: [], max_discount_percent: 0, requires_human_above_value_minor: null }, ai),
    pricingModel,
    leadHasEmail: Boolean(context.lead.email),
  };
}
