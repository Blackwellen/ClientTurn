import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assembleContext, type AgentContext } from "@/lib/agent/context";
import {
  calculateQuoteForLead,
  createBooking,
  draftQuote,
  getCalendarAvailability,
  proposeCheckout,
  requestHumanHandover,
  requestQuoteApproval,
  sendQuoteToLead,
  sendBookingLink,
  applySuppression,
  type HandoverSummary,
  type QuoteToolAccess,
  type ToolContext,
} from "@/lib/agent/tools";
import type { AgentRunHandle } from "@/lib/agent/audit";
import type { AgentChannel } from "@/lib/agent/types";
import { aiAuthorityOf, checkoutGate, DISABLED_AUTHORITY, toMinor } from "@/lib/commercial/authority";
import { can } from "@/lib/billing/capabilities";
import { motionAllowsDirectClose } from "@/lib/opportunities/stages";
import { latestLeadOpportunity } from "@/lib/opportunities/service";
import { trackCheckoutLink } from "@/lib/payments/attempts";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { liveQuoteDeps } from "@/lib/quotes/effects";
import { formatMinor } from "@/lib/quotes/money";
import { matchCatalogueItems, quoteLinesFor, emptyQuotePathState, type QuoteCatalogueItem } from "@/lib/agent/quote-flow";
import { claimCommercialAction } from "@/lib/commercial/lead-lock";
import { bookingActionKey } from "@/lib/commercial/locks";
import { factDimensionSchema } from "@/lib/qualification-intelligence/types";
import { writeQualificationFact, writeIntentSignals, enqueueReassessment } from "@/lib/qualification-intelligence/service";
import { buildSignalWrite, extractTextSignals } from "@/lib/qualification-intelligence/signals";
import { recordVoiceSuppression } from "@/lib/policy/suppression";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import { cancelQueuedCall, requestCall } from "../runtime-core";
import { localWhen } from "../post-call";
import { serverVoiceDeps } from "../server-deps";
import { classifyDestination } from "../destinations";
import { spokenSlotChoice, spokenSlotLabel, spokenWhen } from "../spoken-time";
import type { VoiceToolArgs } from "./definitions";
import { deriveToolPermissions, type PortOutcome, type ToolPermissions, type ToolCallRow } from "./core";

/**
 * The work behind each voice tool, run by the `voice_agent.*` service
 * operations (services/operations/voice-agent.ts) as caller AGENT.
 *
 * Nothing here is a second implementation. Each tool reuses the text agent's
 * own tool functions (agent/tools.ts) with a ToolContext built from the SAME
 * context a text turn assembles (agent/context.ts assembleContext), so the
 * policy gate, the quote gate (quoteToolGate), the commercial checkout gate,
 * the booking re-check and the service registry's quote operations all apply
 * unchanged. The actions are logged on one agent run per call
 * (conversation_agent_runs, idempotency key `voice:<call id>`).
 *
 * Words for the lead: every figure, time and price in `say` is taken from a
 * tool's result (slot labels, the quote calculation, a link's approved
 * price_text), never composed.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type VoiceCallLite = ToolCallRow & { to_e164: string | null; from_e164: string | null; recording_enabled: boolean };

const CALL_COLUMNS = "id, business_id, lead_id, route, state, direction, consent_basis, answered_at, started_at, created_at, to_e164, from_e164, recording_enabled";

export async function loadVoiceCall(businessId: string, callId: string): Promise<VoiceCallLite | null> {
  const { data } = await db().from("voice_calls").select(CALL_COLUMNS).eq("business_id", businessId).eq("id", callId).maybeSingle();
  return (data as VoiceCallLite | null) ?? null;
}

type Loaded = { call: VoiceCallLite; context: AgentContext; run: AgentRunHandle; channel: AgentChannel };

/** One agent run per call, so the text agent's action log records the call's tools. */
async function voiceRun(call: VoiceCallLite, context: AgentContext): Promise<AgentRunHandle> {
  const key = `voice:${call.id}`;
  const found = await db().from("conversation_agent_runs").select("id").eq("business_id", call.business_id).eq("idempotency_key", key).maybeSingle();
  let id = (found.data as { id: string } | null)?.id ?? null;
  if (!id) {
    const inserted = await db()
      .from("conversation_agent_runs")
      .insert({
        business_id: call.business_id,
        lead_id: call.lead_id,
        conversation_id: context.conversation.conversationId,
        trigger_event_type: "VOICE_CALL",
        trigger_event_id: call.id,
        idempotency_key: key,
        mode: "QUALIFICATION",
        agent_mode: context.business.agent.mode,
        channel: "voice",
        status: "RUNNING",
        lifecycle_before: context.lifecycle,
        qualification_before: context.lead.qualification_state,
      })
      .select("id")
      .single();
    if (inserted.error?.code === "23505") {
      const again = await db().from("conversation_agent_runs").select("id").eq("business_id", call.business_id).eq("idempotency_key", key).maybeSingle();
      id = (again.data as { id: string } | null)?.id ?? null;
    } else {
      id = (inserted.data as { id: string } | null)?.id ?? null;
    }
  }
  if (!id) throw new Error("voice tool: could not open the agent run");
  const { count } = await db().from("conversation_agent_actions").select("id", { count: "exact", head: true }).eq("agent_run_id", id);
  return { id, businessId: call.business_id, startedAt: Date.now(), step: count ?? 0 };
}

async function load(businessId: string, callId: string, channel: AgentChannel = "sms"): Promise<Loaded | null> {
  const call = await loadVoiceCall(businessId, callId);
  if (!call) return null;
  const context = await assembleContext({ businessId, leadId: call.lead_id, conversationId: null, channel });
  if (!context) return null;
  const run = await voiceRun(call, context);
  return { call, context, run, channel };
}

function aiEnabled(context: AgentContext): boolean {
  return context.business.aiAssistEnabled && context.business.agent.mode !== "OFF";
}

async function quoteAccess(context: AgentContext): Promise<QuoteToolAccess> {
  const capability = await can(context.business.businessId, "quote_ai_enabled").catch(() => null);
  return { aiEnabled: aiEnabled(context), quoteAiCapability: capability?.allowed === true, authority: aiAuthorityOf(context.commerce?.authority) };
}

function toolContext(l: Loaded, facts: Partial<ToolContext["facts"]> = {}, ai?: QuoteToolAccess): ToolContext {
  return {
    run: l.run,
    business: l.context.business,
    lead: l.context.lead,
    conversationId: l.context.conversation.conversationId,
    channel: l.channel,
    lifecycle: l.context.lifecycle,
    facts: {
      contactable: l.context.leadContext.contactable,
      availabilityConfirmed: false,
      optOutRecognised: false,
      bookingEnabled: Boolean(l.context.booking.bookingUrl) || l.context.booking.availabilityQueryable,
      ...facts,
    },
    confidence: null,
    ai: ai ?? { aiEnabled: aiEnabled(l.context), quoteAiCapability: false, authority: aiAuthorityOf(l.context.commerce?.authority) },
    // One actor per lead (commercial/locks.ts): this call, not the text assistant.
    holder: { kind: "VOICE", ref: l.call.id },
  };
}

/** The call's commercial lease for one action (a booking, a payment link). */
async function claimForCall(l: Loaded, kind: "BOOKING" | "PAYMENT_LINK", actionKey: string) {
  return claimCommercialAction({ businessId: l.call.business_id, leadId: l.call.lead_id, holder: "VOICE", holderRef: l.call.id, kind, actionKey });
}

const refused = (code: string, say: string, operation: string | null = null): PortOutcome => ({ ok: false, code, say, operation });

/* ============================================================ permissions */

/** The deterministic facts `voiceToolGate` decides with, from the same sources as a text turn. */
export async function voiceToolPermissions(call: VoiceCallLite): Promise<ToolPermissions> {
  const context = await assembleContext({ businessId: call.business_id, leadId: call.lead_id, conversationId: null, channel: "sms" });
  const settings = await db().from("voice_settings").select("transfer_mode, transfer_number_e164").eq("business_id", call.business_id).maybeSingle();
  const s = settings.data as { transfer_mode?: string | null; transfer_number_e164?: string | null } | null;
  const mode = s?.transfer_mode === "ON_REQUEST_OR_ESCALATION" || s?.transfer_mode === "NEVER" ? s.transfer_mode : "ON_REQUEST";
  if (!context) {
    return { aiEnabled: false, book: false, quote: false, sendQuote: false, checkout: false, transferMode: "NEVER", transferNumberSet: false, transferHuman: false, aiCall: false, hasEmail: false, smsLawful: false, bookingLink: false };
  }
  const access = await quoteAccess(context);
  const direct = context.commerce?.authority ?? DISABLED_AUTHORITY;
  const phone = context.lead.phone ?? null;
  const derived = deriveToolPermissions({
    aiEnabled: access.aiEnabled,
    quoteAiCapability: access.quoteAiCapability,
    authority: access.authority,
    directClose: { enabled: direct.enabled, motionAllows: motionAllowsDirectClose(context.sales.motion), approvedLinks: direct.approved_checkout_links.length },
    transfer: { mode, numberSet: Boolean(s?.transfer_number_e164) },
    hasEmail: Boolean(context.lead.email) && !context.lead.opted_out,
    smsLawful: Boolean(phone && phone.startsWith("+") && classifyDestination(phone) === "UK_MOBILE" && !context.lead.opted_out && context.leadContext.contactable),
    bookingLink: Boolean(context.business.bookingUrl),
  });
  // The deterministic verdict: end_call_summary may say "qualified" only when this does.
  return { ...derived, qualificationVerdict: context.lead.qualification_state ?? null, timezone: context.business.timezone };
}

/* ================================================================== tools */

export async function recordFact(businessId: string, a: VoiceToolArgs<"record_fact"> & { callId: string }): Promise<PortOutcome> {
  const call = await loadVoiceCall(businessId, a.callId);
  if (!call) return refused("NOT_FOUND", "");
  const now = new Date().toISOString();
  const text = `${a.dimension.replace(/[_.]/g, " ").toLowerCase()}: ${a.value}`;
  const signals = extractTextSignals(a.value, new Date());
  if (signals.length) {
    await writeIntentSignals(
      businessId,
      signals.map((h) =>
        buildSignalWrite({
          leadId: call.lead_id,
          type: h.type,
          strength: h.strength,
          confidence: h.confidence,
          source: "REPLY",
          sourceRef: `voice_call:${call.id}`,
          observedAt: now,
          reason: `On a call: ${h.reason}`,
          excerpt: h.excerpt,
          statedDate: h.statedDate,
          resumeAt: h.resumeAt,
        }),
      ),
    );
  }
  // A fact the lead confirmed back is written as an AI_ASSIST INFERRED fact
  // (resolved conflict 1: the AI never confirms). Unconfirmed words stay as
  // signals only; the deterministic engine decides what they mean.
  const dimension = factDimensionSchema.safeParse(a.dimension.toUpperCase());
  // A configured question with no dimension is keyed `Q.<question id>` in the
  // call's question plan (question-plan.ts): its confirmed answer is an
  // UNMAPPED fact against that question, for the engine to match.
  const questionId = /^Q\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(a.dimension)?.[1] ?? null;
  let factWritten = false;
  if (a.confirmed && ((dimension.success && dimension.data !== "UNMAPPED") || questionId)) {
    try {
      await writeQualificationFact(businessId, {
        lead_id: call.lead_id,
        service_id: null,
        dimension: questionId ? "UNMAPPED" : dimension.success ? dimension.data : "UNMAPPED",
        value: a.value.slice(0, 500),
        value_normalised: null,
        state: "INFERRED",
        source: "AI_ASSIST",
        source_ref: `voice_call:${call.id}`,
        question_id: questionId,
        question_intent_key: null,
        confidence: 0.9,
        observed_at: now,
        valid_until: null,
        verified_at: null,
        set_by: null,
      });
      factWritten = true;
    } catch {
      factWritten = false;
    }
  }
  await enqueueReassessment(businessId, call.lead_id, `voice_call:${call.id}`);
  return { ok: true, say: null, data: { recorded: text.slice(0, 200), fact_written: factWritten, signals: signals.length }, operation: "qualification.fact" };
}

export async function checkAvailability(businessId: string, a: VoiceToolArgs<"check_availability"> & { callId: string }): Promise<PortOutcome> {
  const l = await load(businessId, a.callId);
  if (!l) return refused("NOT_FOUND", "");
  const result = await getCalendarAvailability(toolContext(l), {
    date: a.date ?? null,
    dayPart: a.day_part ?? null,
    timezone: l.context.business.timezone,
    limit: 3,
    availability: {
      bookingMode: l.context.business.bookingMode,
      businessHours: l.context.booking.businessHours,
      appointmentDurationMinutes: l.context.booking.appointmentDurationMinutes,
      bookingBufferMinutes: l.context.booking.bookingBufferMinutes,
      calendarIntegrationId: l.context.booking.meetingType?.calendarIntegrationId ?? null,
    },
  });
  if (!result.ok) {
    return refused(result.code, "I cannot see the diary just now. Would a colleague calling you to arrange a time work?", "booking.availability");
  }
  const slots = result.data.slots.slice(0, 3).map((s) => ({ start: s.startsAt, end: s.endsAt, label: s.label }));
  if (!slots.length) return { ok: true, say: "I have nothing free in the next two weeks. Shall I ask a colleague to arrange a time?", data: { slots: [] }, operation: "booking.availability" };
  // Spoken, not screen, labels: "Wednesday 30 September at 10am or 2pm" (spoken-time.ts).
  const say = slots.length === 1 ? `I have ${spokenSlotLabel(slots[0].label)}. Does that work?` : `I have ${spokenSlotChoice(slots[0].label, slots[1].label)}. Does either work?`;
  return { ok: true, say, data: { slots }, operation: "booking.availability" };
}

async function offeredSlot(callId: string, startIso: string): Promise<{ start: string; end: string; label: string } | null> {
  const { data } = await db().from("voice_tool_calls").select("result").eq("voice_call_id", callId).eq("tool", "check_availability").eq("status", "OK");
  const want = Date.parse(startIso);
  for (const row of (data ?? []) as { result: { data?: { slots?: { start: string; end: string; label: string }[] } } }[]) {
    const hit = row.result?.data?.slots?.find((s) => Date.parse(s.start) === want);
    if (hit) return hit;
  }
  return null;
}

export async function bookMeeting(businessId: string, a: VoiceToolArgs<"book_meeting"> & { callId: string }): Promise<PortOutcome> {
  const slot = await offeredSlot(a.callId, a.start_iso);
  if (!slot) return refused("NOT_OFFERED", "Let me check the times again first.", "booking.create");
  const l = await load(businessId, a.callId);
  if (!l) return refused("NOT_FOUND", "");
  const claim = await claimForCall(l, "BOOKING", bookingActionKey(businessId, l.call.lead_id, slot.start));
  if (!claim.ok) return refused("LEAD_HELD", "A colleague is working on your booking right now and will confirm it with you.", "booking.create");
  const booked = await createBooking(toolContext(l, { availabilityConfirmed: true }), {
    startsAt: slot.start,
    endsAt: slot.end,
    slotLabel: slot.label,
    bufferMinutes: l.context.booking.bookingBufferMinutes,
    calendarIntegrationId: l.context.booking.meetingType?.calendarIntegrationId ?? null,
  });
  if (!booked.ok) {
    return refused(
      booked.code,
      booked.code === "SLOT_TAKEN" ? "That time has just gone. Shall I find another?" : "I could not confirm that time. A colleague will confirm it with you.",
      "booking.create",
    );
  }
  const say =
    booked.data.outcome === "confirmed"
      ? `You are booked for ${spokenSlotLabel(slot.label)}.${booked.data.invited ? " You will get a calendar invite by email." : ""}`
      : `I have asked for ${spokenSlotLabel(slot.label)}. A colleague will confirm it with you.`;
  return { ok: true, say, data: { booking_id: booked.data.bookingId, outcome: booked.data.outcome, label: slot.label }, operation: "booking.create" };
}

async function catalogueFor(businessId: string): Promise<{ items: QuoteCatalogueItem[]; currency: string } | null> {
  const settings = await loadQuoteSettings(businessId).catch(() => null);
  if (!settings) return null;
  const catalogue = await liveQuoteDeps(businessId).store.loadCatalogue(businessId, settings.currency).catch(() => null);
  const items = (catalogue?.items ?? []).map((item) => ({
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
  return { items, currency: settings.currency };
}

export async function calculateQuote(businessId: string, a: VoiceToolArgs<"calculate_quote"> & { callId: string }): Promise<PortOutcome> {
  const l = await load(businessId, a.callId);
  if (!l) return refused("NOT_FOUND", "");
  const catalogue = await catalogueFor(businessId);
  if (!catalogue) return refused("NOT_CONFIGURED", "A colleague will put the figures together for you.", "quote.calculate");
  const matched: QuoteCatalogueItem[] = [];
  const state = emptyQuotePathState();
  for (const want of a.items) {
    const hit = matchCatalogueItems(want.name, catalogue.items)[0];
    if (!hit) return refused("UNKNOWN_ITEM", "I will need a colleague to price that one for you.", "quote.calculate");
    if (!matched.includes(hit)) matched.push(hit);
    state.quantities[hit.id] = want.quantity;
  }
  const lines = quoteLinesFor(state, matched);
  const access = await quoteAccess(l.context);
  const result = await calculateQuoteForLead(toolContext(l, {}, access), { lines, key: `voice:${a.callId}:calc:${lines.map((x) => ("itemId" in x ? `${x.itemId}x${x.quantity}` : "")).join(",")}` });
  if (!result.ok) return refused(result.code, "A colleague will confirm the price with you.", "quote.calculate");
  const calc = result.data.calculation;
  if (!result.data.ok || !calc) return refused("NOT_PRICEABLE", "A colleague will confirm the price with you.", "quote.calculate");
  const t = calc.totals;
  const net = formatMinor(t.netMinor, calc.currency);
  const gross = formatMinor(t.grossMinor, calc.currency);
  const say = calc.vatRegistered && t.vatMinor > 0 ? `That comes to ${net} plus VAT, so ${gross} in total.` : `That comes to ${gross} in total.`;
  const quoteRef = `calc:${a.callId.slice(0, 8)}:${lines.map((x) => ("itemId" in x ? `${x.itemId}x${x.quantity}` : "")).join(",")}`.slice(0, 80);
  return {
    ok: true,
    say,
    data: { quote_ref: quoteRef, lines, total: gross, net, currency: calc.currency, approval_required: result.data.approval ? !("allowed" in result.data.approval && result.data.approval.allowed) : false },
    operation: "quote.calculate",
  };
}

export async function sendQuote(businessId: string, a: VoiceToolArgs<"send_quote"> & { callId: string }): Promise<PortOutcome> {
  const { data } = await db().from("voice_tool_calls").select("result").eq("voice_call_id", a.callId).eq("tool", "calculate_quote").eq("status", "OK");
  const calc = ((data ?? []) as { result: { data?: { quote_ref?: string; lines?: unknown[] } } }[]).map((r) => r.result?.data).find((d) => d?.quote_ref === a.quote_ref);
  if (!calc?.lines?.length) return refused("UNKNOWN_QUOTE", "Let me work out the figures first.", "quote.create");
  const l = await load(businessId, a.callId, a.channel === "sms" ? "sms" : "email");
  if (!l) return refused("NOT_FOUND", "");
  const opportunity = await latestLeadOpportunity(businessId, l.call.lead_id);
  if (!opportunity) return refused("NO_OPPORTUNITY", "A colleague will send the quote over to you.", "quote.create");
  const access = await quoteAccess(l.context);
  const tools = toolContext(l, {}, access);
  const drafted = await draftQuote(tools, {
    opportunityId: opportunity.id,
    lines: calc.lines as Parameters<typeof draftQuote>[1]["lines"],
    requestId: `voice:${a.callId}:${a.quote_ref}`,
    afterObjection: false,
    priorAiConcessions: 0,
    rationale: "Priced on a call from the lead's own request.",
  });
  if (!drafted.ok) return refused(drafted.code, "A colleague will send the quote over to you.", "quote.create");
  if (!drafted.data.revisionId) return refused("NO_REVISION", "A colleague will send the quote over to you.", "quote.create");
  if (drafted.data.approvalRequired) {
    await requestQuoteApproval(tools, { quoteId: drafted.data.quoteId, revisionId: drafted.data.revisionId, note: "Priced on a call; the workspace's policy needs a person to approve it before it goes out." });
    return { ok: true, say: "A colleague is checking the quote, then it will come straight to you.", data: { quote_id: drafted.data.quoteId, status: "PENDING_APPROVAL" }, operation: "quote.submit_for_approval" };
  }
  const sent = await sendQuoteToLead(tools, { quoteId: drafted.data.quoteId, revisionId: drafted.data.revisionId, hasEmail: Boolean(l.context.lead.email) });
  if (!sent.ok) return refused(sent.code, "A colleague will send the quote over to you.", "quote.send");
  return {
    ok: true,
    say: sent.data.emailed ? "I have emailed the quote to you." : "The quote is ready and a colleague will send you the link.",
    data: { quote_id: drafted.data.quoteId, status: sent.data.status, emailed: sent.data.emailed },
    operation: "quote.send",
  };
}

export async function sendCheckoutLink(businessId: string, a: VoiceToolArgs<"send_checkout_link"> & { callId: string }): Promise<PortOutcome> {
  const l = await load(businessId, a.callId, a.channel === "email" ? "email" : "sms");
  if (!l) return refused("NOT_FOUND", "");
  const authority = l.context.commerce?.authority ?? DISABLED_AUTHORITY;
  const wanted = a.item.toLowerCase();
  const link =
    authority.approved_checkout_links.find((c) => c.label.toLowerCase() === wanted) ??
    authority.approved_checkout_links.find((c) => c.label.toLowerCase().includes(wanted) || wanted.includes(c.label.toLowerCase())) ??
    (authority.approved_checkout_links.length === 1 ? authority.approved_checkout_links[0] : null);
  const opportunity = await latestLeadOpportunity(businessId, l.call.lead_id);
  const gate = checkoutGate({
    authority,
    motionAllowsDirectClose: motionAllowsDirectClose(l.context.sales.motion),
    linkId: link?.id ?? null,
    opportunityValueMinor: opportunity?.outcome === "OPEN" ? toMinor(opportunity.value) : null,
    contactable: l.context.leadContext.contactable,
  });
  if (!gate.allowed) return refused(gate.reason, "A colleague will send you the details to get started.", "checkout.propose");
  const sendKey = `voice-checkout:${a.callId}:${gate.link.id}`;
  const claim = await claimForCall(l, "PAYMENT_LINK", sendKey);
  if (!claim.ok) return refused("LEAD_HELD", "A colleague is working on this with you and will send the details.", "checkout.propose");
  const tracked = await trackCheckoutLink({ sendKey, link: gate.link });
  const body = `As promised on our call, here is the link to get started with ${gate.link.label} (${gate.link.price_text}):`;
  const sent = await proposeCheckout(toolContext(l), { body, sendKey, link: tracked, serviceId: null, motion: l.context.sales.motion });
  if (!sent.ok) return refused(sent.code, "I could not send that just now. A colleague will send it.", "checkout.propose");
  return {
    ok: true,
    say: `I have sent the link by ${a.channel === "email" ? "email" : "text"}. It is ${gate.link.price_text}.`,
    data: { link_id: gate.link.id, price_text: gate.link.price_text, message_id: sent.data.messageId },
    operation: "checkout.propose",
  };
}

/**
 * "Just email me" on a call (voice QA pass): the business's own booking link,
 * by text or email, through the text agent's sendBookingLink (the link is
 * appended by the runtime byte for byte; the send worker re-checks stop
 * conditions, suppression and quiet hours before it leaves). The words are
 * fixed, never the model's.
 */
export async function sendBookingLinkOnCall(businessId: string, a: VoiceToolArgs<"send_booking_link"> & { callId: string }): Promise<PortOutcome> {
  const l = await load(businessId, a.callId, a.channel === "email" ? "email" : "sms");
  if (!l) return refused("NOT_FOUND", "");
  if (!l.context.business.bookingUrl) return refused("NO_BOOKING_LINK", "I do not have a link to send, so a colleague will send you the details.", "booking.link");
  const sendKey = `voice-booking-link:${a.callId}:${a.channel}`;
  const body = `Thanks for your time on the phone just now. As promised, here is the link to pick a time that suits you:`;
  const sent = await sendBookingLink(toolContext(l), { body, sendKey });
  if (!sent.ok) return refused(sent.code, "I could not send that just now. A colleague will send it.", "booking.link");
  return {
    ok: true,
    say: `I have sent the link by ${a.channel === "email" ? "email" : "text"}.`,
    data: { message_id: sent.data.messageId, channel: a.channel },
    operation: "booking.link",
  };
}

function handoverSummary(l: Loaded, detail: string, sentiment: HandoverSummary["sentiment"] = "neutral"): HandoverSummary {
  return {
    intent: "HUMAN_REQUEST",
    service: l.context.leadContext.serviceName,
    qualificationStatus: l.context.lead.qualification_state,
    keyAnswers: l.context.qualification.answered.slice(0, 6),
    bookingIntent: false,
    unresolvedIssue: detail,
    sentiment,
    summary: `On an AI call: ${detail}`,
  };
}

export async function transferToHuman(businessId: string, a: VoiceToolArgs<"transfer_to_human"> & { callId: string }): Promise<PortOutcome> {
  const l = await load(businessId, a.callId);
  if (!l) return refused("NOT_FOUND", "");
  const reason = a.reason === "COMPLAINT" ? "COMPLAINT" : a.reason === "LEGAL_OR_CONTRACT" ? "POLICY" : "HUMAN_REQUESTED";
  const detail =
    a.reason === "ASKED_FOR_PERSON" ? "The lead asked to speak to a person." : a.reason === "LEGAL_OR_CONTRACT" ? "A legal or contract question." : a.reason === "COMPLAINT" ? "The lead raised a complaint." : "The call was stuck.";
  await requestHumanHandover(toolContext(l), { reason, summary: handoverSummary(l, detail, a.reason === "COMPLAINT" ? "negative" : "neutral") });
  return { ok: true, say: "I will put you through to a colleague now.", data: { transfer: true, next: "Call transfer_call now." }, operation: "handover.request" };
}

/**
 * AI call-backs booked earlier on THIS call (voice_tool_calls OK rows), still
 * waiting to be dialled, are cancelled: the lead corrected the time or opted
 * out, and must not be rung at the old time as well (backend QA 2026-09-28).
 */
async function supersedeCallbacks(businessId: string, callId: string, reason: string): Promise<void> {
  const { data } = await db()
    .from("voice_tool_calls")
    .select("result")
    .eq("business_id", businessId)
    .eq("voice_call_id", callId)
    .eq("tool", "schedule_callback")
    .eq("status", "OK");
  const ids = ((data ?? []) as { result: { data?: { callback_call_id?: unknown } } | null }[])
    .map((r) => r.result?.data?.callback_call_id)
    .filter((v): v is string => typeof v === "string");
  if (!ids.length) return;
  const deps = serverVoiceDeps();
  for (const id of new Set(ids)) {
    try {
      await cancelQueuedCall(deps, id, reason);
    } catch (error) {
      console.error("[voice] superseding a call-back failed", { callId: id, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function scheduleCallback(businessId: string, a: VoiceToolArgs<"schedule_callback"> & { callId: string }): Promise<PortOutcome> {
  const call = await loadVoiceCall(businessId, a.callId);
  if (!call) return refused("NOT_FOUND", "");
  const at = a.at_iso ? new Date(a.at_iso) : null;
  // The exact time, read back once (live call 2026-09-28: the lead's
  // correction was lost and the wrong time confirmed as "then").
  const tz = ((await db().from("businesses").select("timezone").eq("id", businessId).maybeSingle()).data as { timezone?: string | null } | null)?.timezone || "Europe/London";
  const spoken = at && Number.isFinite(at.getTime()) ? spokenWhen(at, new Date(), tz) : null;
  // A corrected time replaces the call-back booked a moment ago.
  await supersedeCallbacks(businessId, call.id, "CALLBACK_SUPERSEDED");
  const atIso = at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
  const note = a.note?.trim() || null;
  if (a.by === "AI" && at && Number.isFinite(at.getTime())) {
    const route = (["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION"] as const).find((r) => r === call.route) ?? "QUALIFICATION";
    const queued = await requestCall(serverVoiceDeps(), {
      businessId,
      leadId: call.lead_id,
      route,
      entryPoint: "CALLBACK",
      requestedBy: null,
      notBefore: at,
    });
    if (queued.ok) {
      return {
        ok: true,
        say: spoken ? `I will call you back at ${spoken}.` : "I will call you back then.",
        data: { callback_call_id: queued.callId, scheduled_for: queued.scheduledFor, at_iso: atIso, note },
        operation: "voice.request_call",
      };
    }
    // Not callable then (hours, caps): a person arranges it instead.
  }
  // In the workspace's own zone: the UTC slice read an hour early all summer.
  const when = atIso ? localWhen(atIso, tz) : "a time that suits them";
  await db().from("leads").update({ next_action: `Call back ${when}${a.note ? `: ${a.note}` : ""}`.slice(0, 500) }).eq("business_id", businessId).eq("id", call.lead_id);
  await queueNotification({
    businessId,
    type: "lead_attention",
    title: "Call-back requested on an AI call",
    body: `The lead asked to be called back at ${when}.`,
    linkUrl: `/app/leads/${call.lead_id}`,
    dedupeKey: `voice-callback:${call.id}`,
  });
  return {
    ok: true,
    say: spoken ? `A colleague will call you back at ${spoken}.` : a.note ? "A colleague will call you back then." : "A colleague will call you back.",
    data: { by: "PERSON", when, at_iso: atIso, note },
    operation: "lead.next_action",
  };
}

export async function optOut(businessId: string, a: VoiceToolArgs<"opt_out"> & { callId: string }): Promise<PortOutcome> {
  const call = await loadVoiceCall(businessId, a.callId);
  if (!call) return refused("NOT_FOUND", "");
  // The lead's number: the one we called, or the one they rang from.
  await recordVoiceSuppression({ businessId, phone: call.direction === "INBOUND" ? call.from_e164 : call.to_e164, callId: call.id });
  // Nothing booked earlier on this call is rung once they objected.
  await supersedeCallbacks(businessId, call.id, "OPTED_OUT_ON_CALL");
  if (a.scope === "ALL") {
    // The one global opt-out path (agent/tools.ts applySuppression): the ALL
    // suppression row, leads.opted_out, automation off, lead.opted_out event.
    // Every channel's send guard reads these before each send.
    const l = await load(businessId, a.callId);
    if (l) await applySuppression(toolContext(l, { optOutRecognised: true }), { reason: "opt_out", scope: "all" });
    // A call-back or "a colleague will email you" set earlier in THIS call is
    // void: nothing is sent or rung once they objected (owner decision 2026-09-28).
    await db()
      .from("leads")
      .update({ next_action: "Opted out on an AI call: no further contact." })
      .eq("business_id", businessId)
      .eq("id", call.lead_id);
  }
  return {
    ok: true,
    say: a.scope === "ALL" ? "Understood. We will not contact you again." : "Understood. We will not call you again.",
    data: { scope: a.scope },
    operation: "suppression.record",
  };
}

export async function logObjection(businessId: string, a: VoiceToolArgs<"log_objection"> & { callId: string }): Promise<PortOutcome> {
  const call = await loadVoiceCall(businessId, a.callId);
  if (!call) return refused("NOT_FOUND", "");
  const existing = await db().from("objection_events").select("id").eq("business_id", businessId).eq("voice_call_id", call.id).eq("objection_key", a.key).maybeSingle();
  if (!existing.data) {
    await db().from("objection_events").insert({
      business_id: businessId,
      lead_id: call.lead_id,
      channel: "VOICE",
      voice_call_id: call.id,
      objection_key: a.key,
      handled_outcome: a.handled,
      evidence_excerpt: a.excerpt?.slice(0, 500) ?? null,
      classifier: "voice/log_objection",
      confidence: 0.7,
      occurred_at: new Date().toISOString(),
    });
  }
  return { ok: true, say: null, data: { key: a.key, logged: !existing.data }, operation: "objection.log" };
}

export async function endCallSummary(businessId: string, a: VoiceToolArgs<"end_call_summary"> & { callId: string }): Promise<PortOutcome> {
  const call = await loadVoiceCall(businessId, a.callId);
  if (!call) return refused("NOT_FOUND", "");
  // Stored on the tool row (the summary itself); the post-call job reads it
  // as the agent's own summary and merges it into the lead's shared memory.
  return { ok: true, say: null, data: { summary: a.summary.slice(0, 1200), disposition: a.disposition, next_step: a.next_step ?? null }, operation: "voice.call_summary" };
}
