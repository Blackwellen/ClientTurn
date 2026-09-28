import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { aiMay } from "@/lib/commercial/ai-permissions";
import { detectBuyingSignal } from "@/lib/agent/closing";
import { readCurrentAssessment } from "@/lib/qualification-intelligence/store-reads";
import { withCallRequested } from "./snapshot";
import { buildEntitlementSnapshot } from "./snapshot";
import { assertVoiceAllowed } from "./entitlement";
import { nextCallableAt, parseCallingHoursConfig, resolveRecipientTimezone } from "./calling-hours";
import { decideNextChannel, type ChannelDecision, type TextChannel } from "./channel-orchestration";
import { requestCall } from "./runtime-core";
import { serverVoiceDeps } from "./server-deps";
import { localParts } from "./calling-hours";

/**
 * "Can you give me a call?" on a text channel (voice P3, brief §71 V1).
 *
 * The orchestrator asks this before composing its reply. When the
 * deterministic channel choice says CALL, the lead's own words are recorded
 * as the CALL_REQUESTED consent (evidence: the message, its channel and
 * time), the call is requested through the ordinary runtime (every gate:
 * entitlement, canCallLead, calling hours, caps, maintenance), and the text
 * reply is ONE fixed line saying the call is coming. Anything else returns
 * `queued: false` and the text turn goes on exactly as before (it offers
 * bookable call times).
 *
 * AI-initiated, so it needs the owner's "Phone leads" permission (aiMay call).
 * Never throws: a failure here must not cost the lead their reply.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type TextToCallResult =
  | { queued: true; callId: string; scheduledFor: string; line: string; decision: ChannelDecision }
  | { queued: false; reason: string; decision: ChannelDecision | null };

const CHANNEL: Record<string, TextChannel> = { sms: "SMS", whatsapp: "WHATSAPP", email: "EMAIL" };

async function loadAuthority(businessId: string) {
  try {
    return await loadCommercialAuthoritySettings(businessId);
  } catch {
    return null;
  }
}

export async function planCallFromText(input: {
  businessId: string;
  leadId: string;
  channel: string;
  message: string;
}): Promise<TextToCallResult> {
  try {
    const authority = await loadAuthority(input.businessId);
    const aiMayCall = aiMay(aiAuthorityOf(authority), "call");
    if (!aiMayCall) return { queued: false, reason: "AI_MAY_NOT_CALL", decision: null };

    const deps = serverVoiceDeps();
    if (!deps.providers().voice) return { queued: false, reason: "PROVIDER_NOT_CONFIGURED", decision: null };
    const [facts, ctx, assessment] = await Promise.all([
      deps.repo.loadEntitlementFacts(input.businessId),
      deps.repo.loadDialContext(input.businessId, input.leadId, "BOOKING_CLOSE", null),
      readCurrentAssessment(input.businessId, input.leadId).catch(() => null),
    ]);
    if (!ctx.lead) return { queued: false, reason: "LEAD_NOT_FOUND", decision: null };
    const entitlement = assertVoiceAllowed(buildEntitlementSnapshot({ ...facts, platformKill: facts.platformKill || deps.config.platformKill }), { entryPoint: "OUTBOUND_DIAL" });

    const now = deps.now();
    const tz = resolveRecipientTimezone({ leadTimezone: ctx.lead.timezone, phoneE164: ctx.lead.phone, workspaceTimezone: ctx.workspaceTimezone });
    const hours = ctx.settings?.calling_hours ? parseCallingHoursConfig(ctx.settings.calling_hours) : null;
    const callableAt = tz.timezone
      ? nextCallableAt({ at: now, timezone: tz.timezone, config: hours?.ok ? hours.config : undefined, applyUkBankHolidays: (ctx.lead.phone ?? "").startsWith("+44") })
      : null;

    const replyChannel = CHANNEL[input.channel] ?? null;
    const decision = decideNextChannel({
      now,
      point: "TEXT_REPLY",
      lead: {
        consentBasis: "CALL_REQUESTED",
        askedForCallNow: true,
        replyChannel,
        preferredChannel: "phone",
        intentState: assessment?.intentState ?? null,
        buyingSignal: detectBuyingSignal(input.message),
        urgent: false,
      },
      voice: {
        usable: entitlement.allowed && Boolean(ctx.settings?.voice_enabled) && !ctx.voiceOptedOut && !ctx.suppressed,
        aiMayCall,
        nextCallableAt: callableAt,
        attemptsUsed: ctx.attempts.total,
        maxAttempts: ctx.settings?.max_attempts ?? 3,
      },
      channels: { SMS: replyChannel === "SMS", WHATSAPP: replyChannel === "WHATSAPP", EMAIL: replyChannel === "EMAIL" },
      sentSinceLastCall: [],
      frequency: { action: "allow" },
      retryCallAt: null,
    });
    if (decision.move !== "CALL" || !decision.route) return { queued: false, reason: decision.rule, decision };

    await recordCallRequestFromMessage(input.businessId, input.leadId, input.message, input.channel, now);
    const requested = await requestCall(deps, {
      businessId: input.businessId,
      leadId: input.leadId,
      route: decision.route,
      entryPoint: "OUTBOUND_DIAL",
      requestedBy: null,
      notBefore: decision.at,
    });
    if (!requested.ok) return { queued: false, reason: requested.reason, decision };

    const when = new Date(requested.scheduledFor);
    const soon = when.getTime() - now.getTime() < 10 * 60_000;
    const name = ctx.settings?.calling_as_name ?? "we";
    const line = soon
      ? `Of course. ${name === "we" ? "We" : `${name}'s AI assistant`} will call you in the next few minutes on the number you gave us.`
      : `Of course. ${name === "we" ? "We" : `${name}'s AI assistant`} will call you ${tz.timezone ? whenPhrase(when, now, tz.timezone) : "shortly"} on the number you gave us.`;
    return { queued: true, callId: requested.callId, scheduledFor: requested.scheduledFor, line, decision };
  } catch (error) {
    console.error("[voice] text-to-call failed; the text turn continues", { businessId: input.businessId, message: error instanceof Error ? error.message : String(error) });
    return { queued: false, reason: "ERROR", decision: null };
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "later today", "tomorrow morning", "on Monday afternoon": when the call comes, in their zone. */
function whenPhrase(at: Date, now: Date, timezone: string): string {
  const a = localParts(at, timezone);
  const n = localParts(now, timezone);
  const part = a.minuteOfDay < 12 * 60 ? "morning" : a.minuteOfDay < 17 * 60 ? "afternoon" : "evening";
  if (a.date === n.date) return "later today";
  const next = new Date(Date.parse(`${n.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (a.date === next) return `tomorrow ${part}`;
  return `on ${WEEKDAYS[a.weekday]} ${part}`;
}

/**
 * The lead's own written request is the CALL_REQUESTED evidence (PECR reg 19:
 * the subscriber asked to be called). Stored verbatim (capped) with where and
 * when it was said. The number must still be one the lead gave us: the
 * dial's canCallLead re-checks the phone source.
 */
async function recordCallRequestFromMessage(businessId: string, leadId: string, message: string, channel: string, at: Date): Promise<void> {
  const client = db();
  const wording = `The lead asked by ${channel} on ${at.toISOString()} to be called: "${message.trim().slice(0, 400)}"`;
  const perm = await client.from("contact_permissions").select("id, consent_scope").eq("business_id", businessId).eq("subject_type", "LEAD").eq("subject_id", leadId).maybeSingle();
  if (perm.data) {
    const p = perm.data as { id: string; consent_scope: unknown };
    await client
      .from("contact_permissions")
      .update({ consent_scope: withCallRequested(p.consent_scope), consent_captured_at: at.toISOString(), call_consent_wording: wording })
      .eq("id", p.id);
    return;
  }
  const lead = await client.from("leads").select("phone").eq("business_id", businessId).eq("id", leadId).maybeSingle();
  await client.from("contact_permissions").insert({
    business_id: businessId,
    subject_type: "LEAD",
    subject_id: leadId,
    relationship_type: "THEY_CONTACTED_US",
    consent_status: "GRANTED",
    consent_scope: ["CALL_REQUESTED"],
    consent_captured_at: at.toISOString(),
    call_consent_wording: wording,
    phone_e164: (lead.data as { phone: string | null } | null)?.phone ?? null,
  });
}
