import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assembleContext } from "@/lib/agent/context";
import { aiAuthorityOf, DISABLED_AUTHORITY } from "@/lib/commercial/authority";
import { deriveToolPermissions } from "./tools/core";
import { can } from "@/lib/billing/capabilities";
import { motionAllowsDirectClose } from "@/lib/opportunities/stages";
import { planBookingRoute } from "@/lib/bookings/confirmation";
import { readCurrentAssessment } from "@/lib/qualification-intelligence/store-reads";
import { QUALIFICATION_CATALOGUE } from "@/lib/sales-library/qualification-dimensions";
import { getMaintenanceStatus } from "@/lib/maintenance/state";
import { outboundPauseUntil } from "@/lib/maintenance/schedule";
import { parseMemory } from "@/lib/opportunities/memory";
import { buildVoiceCallBrief, type BriefRoute, type CallBriefInput } from "./call-brief";
import { classifyDestination } from "./destinations";
import { identityAnswer } from "./identity";
import { mergeCallIntoMemory } from "./continuity";
import { renderClosingLine } from "./opener";
import type { CloseRoute } from "@/lib/agent/closing";
import type { BriefRequest, CallRow, ChannelFacts, VoiceRepo } from "./runtime-core";
import type { TextChannel } from "./channel-orchestration";
import { loadContactHistory } from "@/lib/reengagement/service";
import { queueOutboundMessage } from "@/lib/jobs/handlers/shared";

/**
 * Server wiring for voice phase P3: the call brief loader, the maintenance
 * hold, and the repo methods behind 0162 (the call plan, the agent's own
 * summary, continuity into the lead's memory, and the carrier id). Every
 * method tolerates a database without 0162 (an undefined column is not an
 * error to surface: the P2 behaviour simply continues).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function schemaLag(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205"));
}

const ROUTES: readonly BriefRoute[] = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"];

/* ================================================================== brief */

/**
 * The brief for one call, from the SAME context a text turn assembles
 * (agent/context.ts): the offer card, the motion, the business's objections,
 * what is known, the booking route, the commercial authority; plus the lead's
 * current next-best-action. Built into speech by `buildVoiceCallBrief`.
 */
export async function loadVoiceCallBrief(req: BriefRequest): Promise<{ version: string; dynamicVariables: Record<string, string> } | null> {
  const { call } = req;
  const conversation = await db()
    .from("conversations")
    .select("id")
    .eq("business_id", call.business_id)
    .eq("lead_id", call.lead_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const conversationId = (conversation.data as { id: string } | null)?.id ?? null;
  const context = await assembleContext({ businessId: call.business_id, leadId: call.lead_id, conversationId, channel: "sms" });
  if (!context) return null;
  const assessment = await readCurrentAssessment(call.business_id, call.lead_id).catch(() => null);

  const authority = aiAuthorityOf(context.commerce?.authority);
  const capability = await can(call.business_id, "quote_ai_enabled").catch(() => null);
  const access = { aiEnabled: context.business.aiAssistEnabled && context.business.agent.mode !== "OFF", quoteAiCapability: capability?.allowed === true, authority };
  const direct = context.commerce?.authority ?? DISABLED_AUTHORITY;

  const settings = await db().from("voice_settings").select("transfer_mode, transfer_number_e164").eq("business_id", call.business_id).maybeSingle();
  const s = settings.data as { transfer_mode?: string | null; transfer_number_e164?: string | null } | null;
  const mode = s?.transfer_mode === "ON_REQUEST_OR_ESCALATION" || s?.transfer_mode === "NEVER" ? s.transfer_mode : "ON_REQUEST";
  const phoneForGate = context.lead.phone ?? "";
  // The same pure derivation the tool endpoint gates with (voice/tools/core.ts).
  const perms = deriveToolPermissions({
    ...access,
    directClose: { enabled: direct.enabled, motionAllows: motionAllowsDirectClose(context.sales.motion), approvedLinks: direct.approved_checkout_links.length },
    transfer: { mode, numberSet: Boolean(s?.transfer_number_e164) },
    hasEmail: Boolean(context.lead.email) && !context.lead.opted_out,
    smsLawful: phoneForGate.startsWith("+") && classifyDestination(phoneForGate) === "UK_MOBILE" && !context.lead.opted_out,
  });
  const transferAvailable = perms.transferHuman && mode !== "NEVER" && perms.transferNumberSet;

  // Owner decision 2026-09-28: the call ends with the ClientTurn attribution
  // unless the workspace is white label (off by default).
  const whiteLabel = await can(call.business_id, "white_label_public_pages").catch(() => null);
  const closing = renderClosingLine({ callingAsName: req.identity.callingAsName, whiteLabel: whiteLabel?.allowed === true });

  const booking: CloseRoute = context.booking.availabilityQueryable
    ? "SLOTS"
    : context.booking.bookingUrl
      ? "LINK"
      : !context.booking.liveBooking && planBookingRoute({ bookingMode: context.business.bookingMode, calendarUsable: false }) === "pending"
        ? "ASK_PREFERRED_TIME"
        : "TEAM_FOLLOW_UP";

  const known = context.qualification.known.map((k) =>
    k.dimension ? `${QUALIFICATION_CATALOGUE[k.dimension].label}: ${k.value}` : `${k.questionText}: ${k.value}`,
  );
  const phone = context.lead.phone ?? "";
  const summary =
    context.conversation.summary ??
    (context.conversation.recentMessages.length
      ? context.conversation.recentMessages
          .slice(-4)
          .map((m) => `${m.role === "lead" ? "They" : "We"} said: ${m.body}`)
          .join(" ")
      : null);

  const input: CallBriefInput = {
    route: (ROUTES as readonly string[]).includes(call.route) ? (call.route as BriefRoute) : "QUALIFICATION",
    direction: call.direction,
    callingAsName: req.identity.callingAsName,
    personaName: req.identity.personaName ?? null,
    leadFirstName: context.lead.first_name ?? null,
    identityAnswer: identityAnswer(req.identity),
    openerSuffix: req.ctx.settings?.opener_suffix ?? null,
    motion: context.sales.motion,
    goal: assessment?.goal ?? null,
    nba: assessment?.nba ?? null,
    known,
    offerLines: context.offer.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 3 && !/^[A-Z][A-Z &/()-]+:?$/.test(line) && !/^(STYLE EXAMPLES|EXAMPLE)/i.test(line)),
    workspaceObjections: context.sales.objections ?? null,
    booking,
    permissions: { book: perms.book, quote: perms.quote, sendQuote: perms.sendQuote, checkout: perms.checkout, bookingLink: perms.bookingLink ?? false },
    transfer: { mode, available: transferAvailable },
    textFollowUpLawful: !context.lead.opted_out && (Boolean(context.lead.email) || (phone.startsWith("+") && classifyDestination(phone) === "UK_MOBILE")),
    conversationSummary: summary,
    closingLine: closing.text,
    recordingEnabled: call.recording_enabled,
  };
  const brief = buildVoiceCallBrief(input);
  return {
    version: brief.version,
    dynamicVariables: {
      ...brief.dynamicVariables,
      // Retell's built-in transfer_call reads this; empty = no transfer (setup script).
      transfer_number: transferAvailable ? (s?.transfer_number_e164 ?? "") : "",
      closing_version: closing.version,
    },
  };
}

/* ============================================================ maintenance */

/** Until when platform maintenance holds outbound AI calls (null = not held). */
export async function voiceMaintenancePauseUntil(): Promise<Date | null> {
  const status = await getMaintenanceStatus();
  return outboundPauseUntil(status, new Date());
}

/* ================================================================== repo */

const CALL_COLUMNS =
  "id, business_id, lead_id, direction, route, state, call_key, attempt_number, consent_basis, to_e164, from_e164, destination_class, recipient_timezone, calling_as_name, legal_entity_name, identification_contact, persona_name, opener_version, recording_enabled, provider, provider_call_id, carrier_call_sid, outcome, disconnection_reason, duration_sec, billed_sec, reserved_sec, voicemail_left, queued_at, started_at, answered_at, ended_at, created_at";

const LIVE = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];

const CHANNEL_OF: Record<string, TextChannel> = { sms: "SMS", whatsapp: "WHATSAPP", email: "EMAIL" };

export const p3Repo: Pick<
  VoiceRepo,
  | "voicemailAlreadyLeft"
  | "recordCallPlan"
  | "loadCallPlan"
  | "loadAgentSummary"
  | "recordCallMemory"
  | "findLiveCallsByNumbers"
  | "recordCarrierCallSid"
  | "loadChannelFacts"
  | "queueFollowUpText"
> = {
  async loadChannelFacts({ businessId, leadId, since }): Promise<ChannelFacts> {
    const now = new Date();
    const [history, sent, lead, whatsapp] = await Promise.all([
      loadContactHistory({ businessId, leadId, now, includeQueued: true }),
      db()
        .from("messages")
        .select("channel")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .eq("direction", "outbound")
        .gte("created_at", since.toISOString())
        .limit(20),
      db().from("leads").select("preferred_contact_channel").eq("business_id", businessId).eq("id", leadId).maybeSingle(),
      db()
        .from("messages")
        .select("created_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .eq("direction", "inbound")
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const lastWhatsappIn = ((whatsapp.data ?? []) as { created_at: string }[])[0]?.created_at ?? null;
    const pref = (lead.data as { preferred_contact_channel?: string | null } | null)?.preferred_contact_channel ?? null;
    return {
      automatedSentAt: history.automatedSentAt,
      touchesSinceEngagement: history.touchesSinceEngagement,
      intentState: history.intentState,
      preferredChannel: pref === "phone" || pref === "sms" || pref === "whatsapp" || pref === "email" ? pref : null,
      sentSinceLastCall: [
        ...new Set(((sent.data ?? []) as { channel: string }[]).map((r) => CHANNEL_OF[r.channel]).filter((c): c is TextChannel => Boolean(c))),
      ],
      // WhatsApp's customer-care window: a free-form message only within 24
      // hours of the lead's last WhatsApp message.
      whatsappWindowOpen: Boolean(lastWhatsappIn && now.getTime() - Date.parse(lastWhatsappIn) < 24 * 60 * 60_000),
    };
  },

  async queueFollowUpText({ businessId, leadId, channel, body, sendKey }) {
    // The ordinary send path: the send guard re-checks suppression, stop
    // conditions, quiet hours and maintenance immediately before sending,
    // and the text lands in the lead's conversation.
    const id = await queueOutboundMessage({
      businessId,
      leadId,
      channel: channel === "SMS" ? "sms" : channel === "WHATSAPP" ? "whatsapp" : "email",
      body,
      subject: channel === "EMAIL" ? "Sorry we missed you" : null,
      origin: "automation",
      sendKey,
    });
    return Boolean(id);
  },

  async voicemailAlreadyLeft(businessId, leadId, route) {
    const { data, error } = await db()
      .from("voice_calls")
      .select("id")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("route", route)
      .eq("voicemail_left", true)
      .limit(1);
    if (error) throw new Error(`voicemail check: ${error.message}`);
    return (data ?? []).length > 0;
  },

  async recordCallPlan(callId, plan) {
    const { error } = await db()
      .from("voice_calls")
      .update({ brief_version: plan.briefVersion, voicemail_script_version: plan.voicemailScriptVersion, premium_voice: Boolean(plan.premiumVoice) })
      .eq("id", callId);
    if (error && !schemaLag(error)) throw new Error(`call plan: ${error.message}`);
  },

  async loadCallPlan(callId) {
    const { data, error } = await db().from("voice_calls").select("brief_version, voicemail_script_version, premium_voice").eq("id", callId).maybeSingle();
    if (error) {
      if (schemaLag(error)) return null;
      throw new Error(`call plan read: ${error.message}`);
    }
    const row = data as { brief_version: string | null; voicemail_script_version: string | null; premium_voice: boolean | null } | null;
    return row ? { briefVersion: row.brief_version, voicemailScriptVersion: row.voicemail_script_version, premiumVoice: Boolean(row.premium_voice) } : null;
  },

  async loadAgentSummary(callId) {
    const { data, error } = await db()
      .from("voice_tool_calls")
      .select("result")
      .eq("voice_call_id", callId)
      .eq("tool", "end_call_summary")
      .eq("status", "OK")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const d = (data as { result?: { data?: { summary?: string; disposition?: string; next_step?: string | null } } } | null)?.result?.data;
    return d?.summary ? { summary: d.summary, disposition: d.disposition ?? "CONVERSATION", nextStep: d.next_step ?? null } : null;
  },

  async recordCallMemory({ businessId, leadId, note }) {
    const { data } = await db()
      .from("opportunities")
      .select("id, memory")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { id: string; memory: unknown } | null;
    if (!row) return; // no opportunity, no memory: the facts and next action still carry the call
    const merged = mergeCallIntoMemory(parseMemory(row.memory), note, new Date());
    await db().from("opportunities").update({ memory: merged }).eq("business_id", businessId).eq("id", row.id);
  },

  async findLiveCallsByNumbers({ fromE164, toE164, since }) {
    const { data, error } = await db()
      .from("voice_calls")
      .select(CALL_COLUMNS)
      .eq("from_e164", fromE164)
      .eq("to_e164", toE164)
      .in("state", LIVE)
      .gte("created_at", since.toISOString())
      .limit(3);
    if (error) throw new Error(`voice call pair lookup: ${error.message}`);
    return (data ?? []) as CallRow[];
  },

  async recordCarrierCallSid(callId, sid, source) {
    const withSource = await db().from("voice_calls").update({ carrier_call_sid: sid, carrier_call_sid_source: source }).eq("id", callId).is("carrier_call_sid", null);
    if (withSource.error && schemaLag(withSource.error)) {
      // Before 0162: the id is still recorded (the column is from 0150).
      await db().from("voice_calls").update({ carrier_call_sid: sid }).eq("id", callId).is("carrier_call_sid", null);
    }
  },
};
