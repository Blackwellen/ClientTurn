/**
 * Settings -> System check, and the lead page's "Why hasn't anything
 * happened?". Pure: relative imports only, no `server-only`, no Supabase, so
 * the rules are tested with fakes (tests/system-check.test.ts) and the same
 * report renders in the customer's Settings and, read-only, in Admin ->
 * Customers.
 *
 * Nothing here is a new rule. Every verdict comes from the function the
 * engine itself runs, and this module only translates it into a sentence and
 * a link to the setting that changes it:
 *
 *   - AI assistant       agentSettingsProblem / agentChannelAvailable (ai-settings/types)
 *   - text + follow-up   channelUsable (integrations/platform-channels),
 *                        isMailboxUsable (ai-settings/types),
 *                        isWithinQuietHours / nextPermittedSendTime (automation/scheduler),
 *                        the Usage & limits rows (billing/limits-service)
 *   - AI voice calls     assertVoiceAllowed's reasons, as the voice settings view
 *                        reports them, with ENTITLEMENT_MESSAGES (voice/dial-decision),
 *                        isWithinCallingHours / nextCallableAt (voice/calling-hours)
 *   - booking            isBookingConfigured (below; also getLeadCapabilities), aiMay "book"
 *   - lead sources       providerAvailability, metaTokenRenewal (integrations/catalog)
 *   - per lead           evaluateStopConditions (automation/scheduler, the send guard),
 *                        the policy engine's per-channel verdicts, ELIGIBILITY_MESSAGES
 */

import { agentChannelAvailable, agentSettingsProblem, isMailboxUsable, type AgentChannelValue, type AgentModeValue } from "../ai-settings/types.ts";
import { channelUsable, MESSAGING_CHANNEL_PROVIDERS, type IntegrationStatusRow } from "../integrations/platform-channels.ts";
import {
  metaTokenRenewal,
  providerAvailability,
  type ConnectionAvailability,
  type ProviderCardModel,
} from "../integrations/catalog.ts";
import {
  evaluateStopConditions,
  isWithinQuietHours,
  nextPermittedSendTime,
  type QuietHours,
  type StopReason,
} from "../automation/scheduler.ts";
import {
  DEFAULT_CALLING_HOURS,
  isWithinCallingHours,
  nextCallableAt,
  type CallingHoursConfig,
  type CallingHoursDenial,
} from "../voice/calling-hours.ts";
import { ELIGIBILITY_MESSAGES, ENTITLEMENT_MESSAGES } from "../voice/dial-decision.ts";

export * from "./types.ts";
import {
  ENGINE_IDS,
  ENGINE_TITLES,
  FIX,
  SYSTEM_CHECK_HREF,
  formatWhen,
  type CheckFix,
  type CheckRow,
  type CheckStatus,
  type EngineId,
  type EngineReport,
  type SystemCheckReport,
} from "./types.ts";

/* --------------------------------------------------------------- helpers */

export function rollup(rows: readonly CheckRow[]): CheckStatus {
  if (rows.some((row) => row.status === "ATTENTION")) return "ATTENTION";
  if (rows.some((row) => row.status === "UNKNOWN")) return "UNKNOWN";
  if (rows.length > 0 && rows.every((row) => row.status === "OFF")) return "OFF";
  return "READY";
}

export function engine(id: EngineId, rows: CheckRow[]): EngineReport {
  return { id, title: ENGINE_TITLES[id], status: rollup(rows), rows };
}

/** An engine whose facts could not be read: said plainly, never guessed. */
export function unknownEngine(id: EngineId): EngineReport {
  return engine(id, [
    {
      id: `${id}.unknown`,
      label: ENGINE_TITLES[id],
      status: "UNKNOWN",
      reason: "This couldn't be checked right now. Nothing has been changed; refresh in a minute.",
      fix: null,
    },
  ]);
}

export function buildReport(engines: EngineReport[], now: Date, timezone = "Europe/London"): SystemCheckReport {
  const counts: Record<CheckStatus, number> = { READY: 0, ATTENTION: 0, OFF: 0, UNKNOWN: 0 };
  for (const e of engines) counts[e.status] += 1;
  // Problems first, so the thing to fix is at the top of the page.
  const order: Record<CheckStatus, number> = { ATTENTION: 0, UNKNOWN: 1, READY: 2, OFF: 3 };
  const sorted = [...engines].sort((a, b) => order[a.status] - order[b.status] || ENGINE_IDS.indexOf(a.id) - ENGINE_IDS.indexOf(b.id));
  return { generatedAt: now.toISOString(), timezone, engines: sorted, counts };
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
}

/* ============================================================ AI assistant */

export type AiFacts = {
  /** business_settings.ai_assist_enabled. */
  enabled: boolean;
  /** The plan's AI allowance (entitlements.aiAssistAllowed). */
  planAllows: boolean;
  mode: AgentModeValue;
  channels: AgentChannelValue[];
  whatsappEnabled: boolean;
  emailConnected: boolean;
};

export function checkAi(f: AiFacts): EngineReport {
  const rows: CheckRow[] = [];
  if (!f.planAllows) {
    rows.push({
      id: "ai.plan",
      label: "AI on your plan",
      status: "OFF",
      reason: "The AI assistant isn't included on your current plan, so replies follow your fixed follow-up steps only and AI calls can't run.",
      fix: FIX.billing,
    });
    return engine("ai", rows);
  }
  rows.push(
    f.enabled
      ? { id: "ai.switch", label: "AI assistant switch", status: "READY", reason: "The AI assistant is switched on.", fix: null }
      : {
          id: "ai.switch",
          label: "AI assistant switch",
          status: "OFF",
          reason: "The AI assistant is switched off. Replies follow your fixed follow-up and qualification steps only, and AI voice calls can't do anything while it's off.",
          fix: FIX.aiAssistant,
        },
  );
  if (!f.enabled) return engine("ai", rows);

  const modeRow: CheckRow =
    f.mode === "AUTO_REPLY"
      ? { id: "ai.mode", label: "Mode", status: "READY", reason: "Reply automatically: it answers, qualifies and offers booking on its own.", fix: null }
      : f.mode === "SUGGEST_ONLY"
        ? { id: "ai.mode", label: "Mode", status: "READY", reason: "Suggest replies: it drafts each reply and nothing is sent until someone approves it.", fix: null }
        : {
            id: "ai.mode",
            label: "Mode",
            status: "OFF",
            reason: "Mode is Off, so the assistant doesn't reply to anyone and AI calls can't run. Choose Suggest replies or Reply automatically.",
            fix: FIX.aiAssistant,
          };
  rows.push(modeRow);

  if (f.mode !== "OFF") {
    const problem = agentSettingsProblem({ enabled: f.enabled, agentMode: f.mode, agentChannels: f.channels });
    const unavailable = f.channels.filter(
      (channel) => !agentChannelAvailable(channel, { whatsappEnabled: f.whatsappEnabled, emailConnected: f.emailConnected }),
    );
    const names = { sms: "SMS", whatsapp: "WhatsApp", email: "Email" } as const;
    if (problem) {
      rows.push({ id: "ai.channels", label: "Channels", status: "ATTENTION", reason: `${problem} Until then it has nowhere to reply.`, fix: FIX.aiAssistant });
    } else if (unavailable.length > 0) {
      rows.push({
        id: "ai.channels",
        label: "Channels",
        status: "ATTENTION",
        reason: `${unavailable.map((c) => names[c]).join(" and ")} ${unavailable.length === 1 ? "is" : "are"} ticked but can't send (${unavailable.includes("email") ? "no mailbox connected" : "not on your plan"}).`,
        fix: unavailable.includes("email") ? FIX.mailbox : FIX.billing,
      });
    } else {
      rows.push({ id: "ai.channels", label: "Channels", status: "READY", reason: `Working on ${f.channels.map((c) => names[c]).join(", ")}.`, fix: null });
    }
  }
  return engine("ai", rows);
}

/* ===================================================== text + follow-up */

export type LimitLevel = "ok" | "warning" | "reached";

export type MessagingFacts = {
  /** Outbound sending permitted now (false in a dunning pause or read-only). */
  sendingAllowed: boolean;
  /** The workspace's integration rows (provider_type, status). */
  integrations: IntegrationStatusRow[];
  smsPlatformReady: boolean;
  whatsappPlatformReady: boolean;
  whatsappOnPlan: boolean;
  /** The imap_smtp row, or null when no mailbox is connected. */
  mailbox: { status: string | null; lastErrorMessage: string | null } | null;
  quietHours: QuietHours;
  senders: { email: string; paused: boolean; pausedUntil: string | null; sentToday: number; dailySendCap: number }[];
  domains: { domain: string; healthState: string; bounceRate: number; complaintRate: number; spf?: string; dkim?: string; dmarc?: string }[];
  /** Usage & limits rows for sms / whatsapp / email (limits-service). */
  budgets: { key: string; label: string; level: LimitLevel; used: number; limit: number; credits: number | null }[];
};

/** domain_health_snapshots.health_state is HEALTHY | WATCH | WARNING | PAUSED (0029). */
const UNHEALTHY_DOMAIN = new Set(["WARNING", "PAUSED"]);
const FAILING_AUTH = new Set(["FAIL", "MISSING"]);

/** SPF / DKIM / DMARC checks that are failing or missing, as display labels. */
function failingAuth(d: { spf?: string; dkim?: string; dmarc?: string }): string[] {
  return (["spf", "dkim", "dmarc"] as const)
    .filter((key) => FAILING_AUTH.has((d[key] ?? "").toUpperCase()))
    .map((key) => key.toUpperCase());
}

export function checkMessaging(f: MessagingFacts, now: Date): EngineReport {
  const rows: CheckRow[] = [];
  if (!f.sendingAllowed) {
    rows.push({
      id: "messaging.sending",
      label: "Sending",
      status: "ATTENTION",
      reason: "Sending is paused by billing (a failed payment or an ended subscription). Leads are still captured; messages wait until billing is sorted.",
      fix: FIX.billing,
    });
  }

  const smsOk = channelUsable(f.integrations, MESSAGING_CHANNEL_PROVIDERS.sms, f.smsPlatformReady);
  rows.push(
    smsOk
      ? { id: "messaging.sms", label: "SMS", status: "READY", reason: "Texts can send.", fix: null }
      : { id: "messaging.sms", label: "SMS", status: "ATTENTION", reason: "SMS can't send: the SMS connection needs attention.", fix: FIX.connections },
  );

  if (!f.whatsappOnPlan) {
    rows.push({ id: "messaging.whatsapp", label: "WhatsApp", status: "OFF", reason: "WhatsApp isn't on your plan, so nothing is sent on WhatsApp.", fix: FIX.billing });
  } else {
    const waOk = channelUsable(f.integrations, MESSAGING_CHANNEL_PROVIDERS.whatsapp, f.whatsappPlatformReady);
    rows.push(
      waOk
        ? { id: "messaging.whatsapp", label: "WhatsApp", status: "READY", reason: "WhatsApp can send (templates outside the 24-hour reply window).", fix: null }
        : { id: "messaging.whatsapp", label: "WhatsApp", status: "ATTENTION", reason: "WhatsApp can't send: the WhatsApp connection needs attention.", fix: FIX.connections },
    );
  }

  if (!f.mailbox) {
    rows.push({
      id: "messaging.mailbox",
      label: "Email mailbox",
      status: "OFF",
      reason: "No mailbox connected. Email has no fallback sender, so email steps, email replies and cold email can't send until you connect one.",
      fix: FIX.mailbox,
    });
  } else if (!isMailboxUsable(f.mailbox)) {
    rows.push({
      id: "messaging.mailbox",
      label: "Email mailbox",
      status: "ATTENTION",
      reason: `Your mailbox can't send right now${f.mailbox.lastErrorMessage ? ` (${f.mailbox.lastErrorMessage})` : ""}. Reconnect it to resume email.`,
      fix: FIX.mailbox,
    });
  } else {
    rows.push({ id: "messaging.mailbox", label: "Email mailbox", status: "READY", reason: "Your mailbox is connected and can send.", fix: null });
  }

  if (!f.quietHours.enabled) {
    rows.push({ id: "messaging.quiet", label: "Quiet hours", status: "OFF", reason: "Quiet hours are off: automatic messages may send at any time of day.", fix: FIX.messaging });
  } else if (isWithinQuietHours(now, f.quietHours)) {
    const resume = nextPermittedSendTime(now, f.quietHours);
    rows.push({
      id: "messaging.quiet",
      label: "Quiet hours",
      status: "READY",
      reason: `It's quiet hours now (${f.quietHours.start}–${f.quietHours.end}). Automatic messages are held, not dropped, and go from ${formatWhen(resume, f.quietHours.timezone)}.`,
      fix: FIX.messaging,
    });
  } else {
    rows.push({
      id: "messaging.quiet",
      label: "Quiet hours",
      status: "READY",
      reason: `Outside quiet hours now. Messages are held between ${f.quietHours.start} and ${f.quietHours.end} (${f.quietHours.timezone}).`,
      fix: null,
    });
  }

  const paused = f.senders.filter((s) => s.paused);
  const capped = f.senders.filter((s) => !s.paused && s.dailySendCap > 0 && s.sentToday >= s.dailySendCap);
  const badDomains = f.domains.filter((d) => UNHEALTHY_DOMAIN.has(d.healthState.toUpperCase()));
  const unauthenticated = f.domains.filter((d) => failingAuth(d).length > 0);
  if (f.senders.length > 0 || f.domains.length > 0) {
    if (paused.length > 0 || badDomains.length > 0) {
      const parts: string[] = [];
      for (const s of paused) parts.push(`${s.email} is paused${s.pausedUntil ? ` until ${formatWhen(s.pausedUntil, f.quietHours.timezone)}` : ""}`);
      for (const d of badDomains) parts.push(`${d.domain} is ${d.healthState.toUpperCase() === "PAUSED" ? "paused" : "at warning"} on its health check (bounces ${(d.bounceRate * 100).toFixed(1)}%, complaints ${(d.complaintRate * 100).toFixed(2)}%)`);
      rows.push({ id: "messaging.senders", label: "Sender health", status: "ATTENTION", reason: `${parts.join("; ")}. Email from it is held to protect your reputation.`, fix: FIX.sendingDomains });
    } else if (capped.length > 0) {
      rows.push({
        id: "messaging.senders",
        label: "Sender health",
        status: "READY",
        reason: `${capped.map((s) => s.email).join(", ")} reached today's send cap; more email goes tomorrow.`,
        fix: FIX.sendingDomains,
      });
    } else if (unauthenticated.length > 0) {
      rows.push({
        id: "messaging.senders",
        label: "Sender health",
        status: "ATTENTION",
        reason: `${unauthenticated.map((d) => `${d.domain}: ${failingAuth(d).join(", ")} not passing`).join("; ")}. Email may land in spam until the DNS records are fixed.`,
        fix: FIX.sendingDomains,
      });
    } else {
      rows.push({ id: "messaging.senders", label: "Sender health", status: "READY", reason: "Senders and sending domains are healthy.", fix: null });
    }
  }

  for (const budget of f.budgets) {
    if (budget.level === "ok") continue;
    rows.push({
      id: `messaging.budget.${budget.key}`,
      label: `${budget.label} allowance`,
      status: "ATTENTION",
      reason:
        budget.level === "reached"
          ? `${budget.label} allowance used (${budget.used.toLocaleString("en-GB")} of ${budget.limit.toLocaleString("en-GB")})${budget.credits ? `; ${budget.credits.toLocaleString("en-GB")} top-up credit left` : " and no top-up credit"}. Further sends on it are refused.`
          : `${budget.label} allowance is running low (${budget.used.toLocaleString("en-GB")} of ${budget.limit.toLocaleString("en-GB")}).`,
      fix: FIX.credits,
    });
  }
  if (f.budgets.length > 0 && f.budgets.every((b) => b.level === "ok")) {
    rows.push({ id: "messaging.budget", label: "Message allowances", status: "READY", reason: "Message allowances have room this period.", fix: null });
  }
  return engine("messaging", rows);
}

/* ========================================================== AI voice calls */

/** The parts of `VoiceSettingsView` (services/operations/voice.ts) this reads. */
export type VoiceFacts = {
  entitlement: { allowed: boolean; locked: boolean; reasons: string[]; message: string | null };
  integration: { ready: boolean; missing: string[] };
  settings: { voiceEnabled: boolean; adminKillSwitch: boolean; callingHours: CallingHoursConfig | null };
  identity: { ready: boolean; problems: string[] };
  number: { state: string; stageLabel: string; e164: string | null; needsAttention: boolean; rejectionReason: string | null };
  minutes: { available: boolean; includedRemainingMin: number; packRemainingMin: number };
  timezone: string;
};

const HOURS_SENTENCE: Record<CallingHoursDenial, string> = {
  NO_WINDOW_TODAY: "Today has no calling window",
  SUNDAY: "It's Sunday and there's no Sunday calling window",
  BANK_HOLIDAY: "It's a UK bank holiday",
  BEFORE_WINDOW: "Today's calling window hasn't opened yet",
  AFTER_WINDOW: "Today's calling window has closed",
};

export function checkVoice(f: VoiceFacts, now: Date, audience: "customer" | "admin" = "customer"): EngineReport {
  const reasons = new Set(f.entitlement.reasons);
  const msg = (code: string, fallback: string) => ENTITLEMENT_MESSAGES[code] ?? fallback;

  if (f.entitlement.locked) {
    return engine("voice", [
      {
        id: "voice.plan",
        label: "AI calling on your plan",
        status: "OFF",
        reason: f.entitlement.message ?? "Voice is a paid add-on. Choose a paid plan with voice, or add a minute pack, to have the AI assistant call your leads.",
        fix: FIX.billing,
      },
    ]);
  }

  const rows: CheckRow[] = [];
  if (reasons.has("KILL_SWITCH_PLATFORM") || reasons.has("KILL_SWITCH_WORKSPACE") || f.settings.adminKillSwitch) {
    rows.push({
      id: "voice.paused",
      label: "Paused by ClientTurn",
      status: "ATTENTION",
      reason: msg(reasons.has("KILL_SWITCH_PLATFORM") ? "KILL_SWITCH_PLATFORM" : "KILL_SWITCH_WORKSPACE", "AI calling is paused by ClientTurn.") + " Contact support if you didn't expect this.",
      fix: FIX.help,
    });
  }

  rows.push(
    f.settings.voiceEnabled
      ? { id: "voice.switch", label: "Voice switched on", status: "READY", reason: "AI calling is switched on for this workspace.", fix: null }
      : { id: "voice.switch", label: "Voice switched on", status: "OFF", reason: "AI calling is switched off in Settings → Voice, so no calls are placed.", fix: FIX.voiceOverview },
  );

  rows.push(
    reasons.has("AI_ASSISTANT_OFF")
      ? {
          id: "voice.ai",
          label: "AI assistant",
          status: "ATTENTION",
          reason: msg("AI_ASSISTANT_OFF", "The AI assistant is off.") + " Every call tool needs the assistant on (Suggest replies or Reply automatically), so calls can't book, qualify or follow up.",
          fix: FIX.aiAssistant,
        }
      : { id: "voice.ai", label: "AI assistant", status: "READY", reason: "The AI assistant is on, so calls can qualify and book.", fix: null },
  );

  rows.push(
    reasons.has("IDENTITY_INCOMPLETE") || !f.identity.ready
      ? {
          id: "voice.identity",
          label: "Business identity",
          status: "ATTENTION",
          reason: "The caller identity isn't complete. By law every call must say who is calling and how to reach you, so no call is placed until it is.",
          fix: FIX.voiceIdentity,
        }
      : { id: "voice.identity", label: "Business identity", status: "READY", reason: "Caller identity is complete.", fix: null },
  );

  const numberActive = Boolean(f.number.e164) && !reasons.has("NO_NUMBER") && !f.number.needsAttention;
  rows.push(
    numberActive
      ? { id: "voice.number", label: "Number", status: "READY", reason: `Calls come from ${f.number.e164}.`, fix: null }
      : {
          id: "voice.number",
          label: "Number",
          status: "ATTENTION",
          reason: `${f.number.needsAttention ? "Your number needs attention" : "No active calling number yet"} (${f.number.stageLabel})${f.number.rejectionReason ? `: ${f.number.rejectionReason}` : ""}. Calls need your own UK number.`,
          fix: FIX.voiceNumber,
        },
  );

  const noMinutes = reasons.has("NO_MINUTES") || reasons.has("INSUFFICIENT_MINUTES") || !f.minutes.available;
  const minutesLeft = f.minutes.includedRemainingMin + f.minutes.packRemainingMin;
  rows.push(
    noMinutes
      ? { id: "voice.minutes", label: "Minutes", status: "ATTENTION", reason: msg(reasons.has("INSUFFICIENT_MINUTES") ? "INSUFFICIENT_MINUTES" : "NO_MINUTES", "No voice minutes left.") + " Calls wait until minutes are added.", fix: FIX.voiceBudget }
      : { id: "voice.minutes", label: "Minutes", status: "READY", reason: `${plural(Math.floor(minutesLeft), "minute")} left.`, fix: null },
  );

  const config = f.settings.callingHours ?? DEFAULT_CALLING_HOURS;
  const hours = isWithinCallingHours({ at: now, timezone: f.timezone, config });
  if (hours.allowed) {
    rows.push({ id: "voice.hours", label: "Calling hours now", status: "READY", reason: "Inside your calling hours now.", fix: null });
  } else {
    const next = nextCallableAt({ at: now, timezone: f.timezone, config });
    rows.push({
      id: "voice.hours",
      label: "Calling hours now",
      status: "OFF",
      reason: `${HOURS_SENTENCE[hours.reason]}, so calls are queued${next ? ` until ${formatWhen(next, f.timezone)}` : ""}. Each lead's own local time is checked again before dialling.`,
      fix: FIX.voiceHours,
    });
  }

  rows.push(
    f.integration.ready
      ? { id: "voice.service", label: "Calling service", status: "READY", reason: "The calling service (Retell) is connected.", fix: null }
      : {
          id: "voice.service",
          label: "Calling service",
          status: "ATTENTION",
          reason:
            audience === "admin" && f.integration.missing.length > 0
              ? `Calling isn't connected on this environment. Missing: ${f.integration.missing.join(", ")}.`
              : "Calling isn't connected on ClientTurn's side yet. There's nothing to change in your settings; contact support.",
          fix: audience === "admin" ? null : FIX.help,
        },
  );

  // Any remaining entitlement reason this list doesn't name gets its own row,
  // so a new denial in assertVoiceAllowed is never silently dropped.
  const covered = new Set(["KILL_SWITCH_PLATFORM", "KILL_SWITCH_WORKSPACE", "VOICE_DISABLED_IN_SETTINGS", "AI_ASSISTANT_OFF", "IDENTITY_INCOMPLETE", "NO_NUMBER", "NO_MINUTES", "INSUFFICIENT_MINUTES"]);
  for (const code of f.entitlement.reasons) {
    if (covered.has(code)) continue;
    rows.push({ id: `voice.entitlement.${code}`, label: "Voice plan", status: "ATTENTION", reason: msg(code, "Voice isn't available on this workspace."), fix: FIX.billing });
  }
  return engine("voice", rows);
}

/* ================================================================ booking */

/**
 * Whether qualified leads can be offered a booking: a booking link, or the
 * chosen calendar connected (HEALTHY or DEGRADED). The same rule the lead
 * page's "Book" action uses (leads/queries.ts getLeadCapabilities).
 */
export function isBookingConfigured(
  settings: { bookingMode: string | null | undefined; bookingUrl: string | null | undefined },
  connectedProviders: ReadonlySet<string>,
): boolean {
  return Boolean(settings.bookingUrl || (settings.bookingMode && connectedProviders.has(settings.bookingMode)));
}

export type BookingFacts = {
  bookingMode: string;
  bookingUrl: string | null;
  /** Calendar integrations with their status (calendly, google_calendar). */
  calendars: { provider: string; status: string }[];
  calendlyEventTypeChosen: boolean;
  aiMayBook: boolean;
  aiAssistantOn: boolean;
};

const CALENDAR_NAME: Record<string, string> = { calendly: "Calendly", google_calendar: "Google Calendar" };

export function checkBooking(f: BookingFacts): EngineReport {
  const rows: CheckRow[] = [];
  const healthy = new Set(f.calendars.filter((c) => c.status === "HEALTHY" || c.status === "DEGRADED").map((c) => c.provider));
  const configured = isBookingConfigured(f, healthy);
  const calendarMode = f.bookingMode === "calendly" || f.bookingMode === "google_calendar";

  if (calendarMode) {
    const name = CALENDAR_NAME[f.bookingMode];
    const row = f.calendars.find((c) => c.provider === f.bookingMode);
    if (healthy.has(f.bookingMode)) {
      rows.push({
        id: "booking.calendar",
        label: "Calendar",
        status: "READY",
        reason:
          f.bookingMode === "calendly" && !f.calendlyEventTypeChosen
            ? "Calendly is connected. No event type is chosen, so leads get your general Calendly link."
            : `${name} is connected; qualified leads are offered real times.`,
        fix: null,
      });
    } else {
      rows.push({
        id: "booking.calendar",
        label: "Calendar",
        status: "ATTENTION",
        reason: `Booking is set to ${name}, but ${name} ${row && row.status !== "DISCONNECTED" ? "needs reconnecting" : "isn't connected"}${f.bookingUrl ? ". Leads get your booking link meanwhile" : ", so no times can be offered"}.`,
        fix: FIX.connections,
      });
    }
  } else {
    rows.push(
      f.bookingUrl
        ? { id: "booking.calendar", label: "Booking link", status: "READY", reason: "Qualified leads are sent your booking link.", fix: null }
        : {
            id: "booking.calendar",
            label: "Booking link",
            status: "OFF",
            reason: "No calendar and no booking link: qualified leads are handed to you to book by hand. Connect Google Calendar or Calendly, or add a booking link, to have them book themselves.",
            fix: FIX.booking,
          },
    );
  }

  if (!f.aiMayBook) {
    rows.push({
      id: "booking.permission",
      label: "AI may book meetings",
      status: "OFF",
      reason: "\"Book meetings\" is off in What the AI may do, so the assistant never offers times or books; it passes booking to your team.",
      fix: FIX.aiPermissions,
    });
  } else if (!f.aiAssistantOn) {
    rows.push({
      id: "booking.permission",
      label: "AI may book meetings",
      status: "OFF",
      reason: "Booking is allowed, but the AI assistant is off, so only your fixed follow-up steps send the booking link.",
      fix: FIX.aiAssistant,
    });
  } else if (!configured) {
    rows.push({
      id: "booking.permission",
      label: "AI may book meetings",
      status: "ATTENTION",
      reason: "The assistant may book, but there's no working calendar or booking link to book into.",
      fix: FIX.booking,
    });
  } else {
    rows.push({ id: "booking.permission", label: "AI may book meetings", status: "READY", reason: "The assistant offers times and books the one the lead picks.", fix: null });
  }
  return engine("booking", rows);
}

/* ============================================================ lead sources */

export type SourceFacts = {
  /** One card per lead-source provider (meta, google_ads, linkedin_ads, tiktok_ads). */
  cards: ProviderCardModel[];
  metaTokenExpiresAt: string | null;
  /** Latest webhook event per provider for this workspace. */
  lastEvents: Record<string, { at: string; status: string; error: string | null } | undefined>;
  /** Inbound connectors (webhooks from forms, Zapier and apps). */
  connectors: { label: string; active: boolean; lastReceivedAt: string | null; lastFailureAt: string | null; lastFailureReason: string | null }[];
  openConnectorFailures: number;
  apiKeys: { active: number; lastUsedAt: string | null };
  timezone: string;
};

const SOURCE_REASON: Partial<Record<ConnectionAvailability, string>> = {
  RECONNECT_REQUIRED: "The connection has lost access and must be reconnected. New leads can't arrive until it is.",
  NEEDS_ATTENTION: "The connection is degraded; some leads may be delayed.",
  TESTING: "The connection is being tested.",
};

export function checkSources(f: SourceFacts, now: Date): EngineReport {
  const rows: CheckRow[] = [];
  for (const card of f.cards) {
    const name = card.definition.name;
    const availability = providerAvailability(card);
    const id = `sources.${card.definition.id}`;
    if (availability === "NOT_AVAILABLE" || availability === "PLAN_LOCKED") {
      rows.push({ id, label: name, status: "OFF", reason: card.block?.reason ?? "Not available yet.", fix: null });
      continue;
    }
    if (availability === "NOT_CONNECTED") {
      rows.push({ id, label: name, status: "OFF", reason: `Not connected, so no leads arrive from ${name}.`, fix: FIX.connections });
      continue;
    }
    const integration = card.integration;
    const event = f.lastEvents[card.definition.id];
    const lastAt = [integration?.lastSuccessAt, event?.at].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
    const lastSeen = lastAt ? `Last activity ${formatWhen(lastAt, f.timezone)}.` : "No leads received yet.";

    if (availability === "RECONNECT_REQUIRED" || availability === "NEEDS_ATTENTION") {
      rows.push({ id, label: name, status: "ATTENTION", reason: `${SOURCE_REASON[availability]} ${lastSeen}`, fix: FIX.connections });
      continue;
    }
    if (card.definition.id === "meta") {
      const renewal = metaTokenRenewal(f.metaTokenExpiresAt, now);
      if (renewal?.expired) {
        rows.push({ id, label: name, status: "ATTENTION", reason: `Meta's access expired. Reconnect Meta so new leads keep arriving. ${lastSeen}`, fix: FIX.connections });
        continue;
      }
      if (renewal?.warn) {
        rows.push({ id, label: name, status: "ATTENTION", reason: `Meta's access expires in ${plural(renewal.daysLeft, "day")}. Meta has no automatic renewal: reconnect before then. ${lastSeen}`, fix: FIX.connections });
        continue;
      }
    }
    const errorNewer =
      integration?.lastErrorAt && (!integration.lastSuccessAt || integration.lastErrorAt > integration.lastSuccessAt);
    if (errorNewer) {
      rows.push({
        id,
        label: name,
        status: "ATTENTION",
        reason: `The last check failed${integration?.lastErrorMessage ? `: ${integration.lastErrorMessage}` : ""}. ${lastSeen}`,
        fix: FIX.connections,
      });
      continue;
    }
    if (event && event.status.toLowerCase() === "failed") {
      rows.push({ id, label: name, status: "ATTENTION", reason: `The latest lead event could not be processed${event.error ? ` (${event.error})` : ""}. It is retried automatically.`, fix: FIX.connections });
      continue;
    }
    rows.push({ id, label: name, status: "READY", reason: `Connected. ${lastSeen}`, fix: null });
  }

  const active = f.connectors.filter((c) => c.active);
  if (active.length === 0) {
    rows.push({ id: "sources.webhooks", label: "Webhooks and apps", status: "OFF", reason: "No form, Zapier or app webhooks are set up.", fix: FIX.connections });
  } else {
    const failing = active.filter((c) => c.lastFailureAt && (!c.lastReceivedAt || c.lastFailureAt > c.lastReceivedAt));
    if (failing.length > 0 || f.openConnectorFailures > 0) {
      const first = failing[0];
      rows.push({
        id: "sources.webhooks",
        label: "Webhooks and apps",
        status: "ATTENTION",
        reason: `${f.openConnectorFailures > 0 ? `${f.openConnectorFailures.toLocaleString("en-GB")} ${f.openConnectorFailures === 1 ? "delivery" : "deliveries"} couldn't be turned into leads. ` : ""}${first ? `${first.label}: ${first.lastFailureReason ?? "the last delivery failed"}.` : ""}`.trim(),
        fix: FIX.connections,
      });
    } else {
      const last = active.map((c) => c.lastReceivedAt).filter((v): v is string => Boolean(v)).sort().at(-1);
      rows.push({
        id: "sources.webhooks",
        label: "Webhooks and apps",
        status: "READY",
        reason: `${plural(active.length, "webhook")} active. ${last ? `Last delivery ${formatWhen(last, f.timezone)}.` : "Nothing received yet."}`,
        fix: null,
      });
    }
  }

  rows.push(
    f.apiKeys.active > 0
      ? {
          id: "sources.api",
          label: "API",
          status: "READY",
          reason: `${plural(f.apiKeys.active, "API key")} active. ${f.apiKeys.lastUsedAt ? `Last used ${formatWhen(f.apiKeys.lastUsedAt, f.timezone)}.` : "Not used yet."}`,
          fix: null,
        }
      : { id: "sources.api", label: "API", status: "OFF", reason: "No API keys, so nothing can create leads through the API.", fix: FIX.developer },
  );
  return engine("sources", rows);
}

/* ============================================================== Find Leads */

export type FindLeadsFacts = {
  sourcingEnabled: boolean;
  searchRuns: { used: number; limit: number; allowed: boolean } | null;
  verifiedProspects: { used: number; limit: number; allowed: boolean } | null;
  /** capabilityAvailable() per capability the search needs. */
  companySearchAvailable: boolean;
  contactDiscoveryAvailable: boolean;
};

export function checkFindLeads(f: FindLeadsFacts): EngineReport {
  if (!f.sourcingEnabled) {
    return engine("find_leads", [
      { id: "find_leads.plan", label: "Find Leads on your plan", status: "OFF", reason: "Finding new prospects isn't included on your plan. Your existing leads and follow-up are unaffected.", fix: FIX.billing },
    ]);
  }
  const rows: CheckRow[] = [];
  const allowance = (id: string, label: string, a: FindLeadsFacts["searchRuns"], unit: string) => {
    if (!a) {
      rows.push({ id, label, status: "UNKNOWN", reason: `Your ${unit} allowance couldn't be read right now.`, fix: null });
    } else if (!a.allowed) {
      rows.push({ id, label, status: "ATTENTION", reason: `All ${a.limit.toLocaleString("en-GB")} ${unit} for this period are used, so new searches are refused until the period resets or you upgrade.`, fix: FIX.limits });
    } else {
      rows.push({ id, label, status: "READY", reason: `${a.used.toLocaleString("en-GB")} of ${a.limit.toLocaleString("en-GB")} ${unit} used this period.`, fix: null });
    }
  };
  allowance("find_leads.runs", "Search runs", f.searchRuns, "search runs");
  allowance("find_leads.prospects", "Verified prospects", f.verifiedProspects, "verified prospects");
  rows.push(
    f.companySearchAvailable
      ? { id: "find_leads.company", label: "Company search sources", status: "READY", reason: "Company search sources (such as Companies House and Google Places) are available.", fix: null }
      : { id: "find_leads.company", label: "Company search sources", status: "ATTENTION", reason: "No company search source is available on ClientTurn's side right now, so searches return nothing. This isn't a setting you can change; contact support.", fix: FIX.help },
  );
  rows.push(
    f.contactDiscoveryAvailable
      ? { id: "find_leads.contacts", label: "Contact sources", status: "READY", reason: "Contacts are found from companies' own websites (free, first-party).", fix: null }
      : { id: "find_leads.contacts", label: "Contact sources", status: "ATTENTION", reason: "No contact source is available right now, so companies are found without contacts. Contact support.", fix: FIX.help },
  );
  return engine("find_leads", rows);
}

/* ================================================================== agents */

export type AgentFacts = {
  agents: {
    id: string;
    name: string;
    status: string;
    statusReason: string | null;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    pendingReviewCount: number;
  }[];
  timezone: string;
};

export function checkAgents(f: AgentFacts): EngineReport {
  const live = f.agents.filter((a) => a.status !== "DRAFT" && a.status !== "STOPPED");
  if (live.length === 0) {
    return engine("agents", [{ id: "agents.none", label: "Agents", status: "OFF", reason: "No agents are running.", fix: FIX.agents }]);
  }
  const rows: CheckRow[] = live.map((a) => {
    const last = a.lastRunAt ? `Last run ${formatWhen(a.lastRunAt, f.timezone)}${a.lastRunStatus ? ` (${a.lastRunStatus.toLowerCase()})` : ""}.` : "Not run yet.";
    const href = { href: `/app/agents/${a.id}`, label: "Open agent" };
    if (a.status === "ERROR" || a.status === "NEEDS_ATTENTION") {
      return { id: `agents.${a.id}`, label: a.name, status: "ATTENTION", reason: `${a.statusReason ?? "It stopped on an error."} ${last}`, fix: href };
    }
    if (a.status === "PAUSED") return { id: `agents.${a.id}`, label: a.name, status: "OFF", reason: `Paused. ${last}`, fix: href };
    if (a.lastRunStatus === "FAILED" || a.lastRunStatus === "BLOCKED") {
      return { id: `agents.${a.id}`, label: a.name, status: "ATTENTION", reason: `Running, but the last run didn't finish${a.statusReason ? `: ${a.statusReason}` : ""}. ${last}`, fix: href };
    }
    return { id: `agents.${a.id}`, label: a.name, status: "READY", reason: `Running. ${last}`, fix: null };
  });
  const waiting = live.reduce((sum, a) => sum + (a.pendingReviewCount || 0), 0);
  if (waiting > 0) {
    rows.push({ id: "agents.approvals", label: "Approvals waiting", status: "ATTENTION", reason: `${plural(waiting, "item")} waiting for your approval. Nothing is contacted until you approve.`, fix: FIX.agents });
  }
  return engine("agents", rows);
}

/* ======================================================= quotes + payments */

export type PaymentFacts = {
  quotesAllowed: boolean;
  invoicePayMode: string;
  endpoints: { kind: string; active: boolean; hasSecret: boolean; lastReceivedAt: string | null; lastError: string | null }[] | null;
  paymentsToReview: number | null;
  timezone: string;
};

export function checkPayments(f: PaymentFacts): EngineReport {
  if (!f.quotesAllowed) {
    return engine("payments", [{ id: "payments.plan", label: "Quotes on your plan", status: "OFF", reason: "Quotes, e-signatures and invoicing are on every paid plan, not the trial.", fix: FIX.billing }]);
  }
  const rows: CheckRow[] = [];
  rows.push(
    f.invoicePayMode === "NONE"
      ? { id: "payments.paylink", label: "Pay now on invoices", status: "OFF", reason: "Invoices have no Pay now button; customers pay you however your invoice says.", fix: FIX.quotes }
      : { id: "payments.paylink", label: "Pay now on invoices", status: "READY", reason: f.invoicePayMode === "WORKSPACE_LINK" ? "Invoices link to your payment page." : "Each invoice carries its own payment link.", fix: null },
  );

  if (f.endpoints === null) {
    rows.push({ id: "payments.webhook", label: "Payment confirmations", status: "UNKNOWN", reason: "Payment webhooks couldn't be read right now.", fix: null });
  } else {
    const active = f.endpoints.filter((e) => e.active);
    if (active.length === 0) {
      rows.push({ id: "payments.webhook", label: "Payment confirmations", status: "OFF", reason: "No payment webhook, so payments aren't marked paid automatically; you confirm them by hand.", fix: FIX.payments });
    } else {
      const broken = active.find((e) => !e.hasSecret || e.lastError);
      if (broken) {
        rows.push({
          id: "payments.webhook",
          label: "Payment confirmations",
          status: "ATTENTION",
          reason: !broken.hasSecret ? "A payment webhook has no signing secret, so its deliveries can't be trusted and are refused." : `The last payment webhook failed: ${broken.lastError}.`,
          fix: FIX.payments,
        });
      } else {
        const last = active.map((e) => e.lastReceivedAt).filter((v): v is string => Boolean(v)).sort().at(-1);
        rows.push({ id: "payments.webhook", label: "Payment confirmations", status: "READY", reason: last ? `Healthy. Last payment event ${formatWhen(last, f.timezone)}.` : "Set up. No payment received yet.", fix: null });
      }
    }
  }

  if (f.paymentsToReview === null) {
    rows.push({ id: "payments.review", label: "Payments to review", status: "UNKNOWN", reason: "The review queue couldn't be read right now.", fix: null });
  } else if (f.paymentsToReview > 0) {
    rows.push({ id: "payments.review", label: "Payments to review", status: "ATTENTION", reason: `${plural(f.paymentsToReview, "payment")} couldn't be matched automatically and ${f.paymentsToReview === 1 ? "is" : "are"} waiting for a person.`, fix: FIX.paymentReview });
  }
  return engine("payments", rows);
}

/* ======================================================== plan + limits */

export type BillingFacts = {
  /** Lifecycle state (billing/lifecycle.ts). */
  state: string;
  planName: string;
  trialEndsAt: string | null;
  overLimit: { label: string; used: number; limit: number; action: string }[];
  /** Non-messaging Usage & limits rows at warning or reached. */
  limits: { key: string; label: string; level: LimitLevel; used: number; limit: number; atLimit: string }[];
  timezone: string;
};

export function checkBilling(f: BillingFacts): EngineReport {
  const rows: CheckRow[] = [];
  switch (f.state) {
    case "PAST_DUE_RESTRICTED":
      rows.push({ id: "billing.subscription", label: "Subscription", status: "ATTENTION", reason: "Your last payment failed, so sending, AI and voice calls are paused. Leads are still captured. Update your card to resume.", fix: FIX.billing });
      break;
    case "PAST_DUE_GRACE":
      rows.push({ id: "billing.subscription", label: "Subscription", status: "ATTENTION", reason: "Your last payment didn't go through. Everything still runs for now; update your card before sending pauses.", fix: FIX.billing });
      break;
    case "CANCELLED":
    case "TRIAL_EXPIRED":
    case "AWAITING_CARD":
      rows.push({
        id: "billing.subscription",
        label: "Subscription",
        status: "ATTENTION",
        reason:
          f.state === "AWAITING_CARD"
            ? "The workspace hasn't finished checkout, so nothing is sent and no AI runs until a plan is chosen."
            : "There's no active subscription, so the workspace is read-only: nothing is sent and no AI runs.",
        fix: FIX.billing,
      });
      break;
    case "TRIALING":
      rows.push({ id: "billing.subscription", label: "Subscription", status: "READY", reason: `Free trial${f.trialEndsAt ? ` until ${formatWhen(f.trialEndsAt, f.timezone)}` : ""}. Some features (such as live AI calls) start with a paid plan.`, fix: null });
      break;
    default:
      rows.push({ id: "billing.subscription", label: "Subscription", status: "READY", reason: `${f.planName} plan, active.`, fix: null });
  }
  for (const item of f.overLimit) {
    rows.push({ id: `billing.over.${item.label}`, label: item.label, status: "ATTENTION", reason: `${item.used.toLocaleString("en-GB")} of ${item.limit.toLocaleString("en-GB")}, over your plan's limit. ${item.action}`, fix: FIX.limits });
  }
  for (const limit of f.limits) {
    if (limit.level === "ok") continue;
    rows.push({
      id: `billing.limit.${limit.key}`,
      label: limit.label,
      status: "ATTENTION",
      reason: `${limit.used.toLocaleString("en-GB")} of ${limit.limit.toLocaleString("en-GB")} used this period${limit.level === "reached" ? `. ${limit.atLimit}` : ", running low."}`,
      fix: FIX.limits,
    });
  }
  return engine("billing", rows);
}

/* ======================================================== worker heartbeat */

export type WorkerFacts = {
  /** workerIsAlive() (ops/alerts.ts): the schedule fired and jobs complete. */
  alive: boolean;
  lastCompletedAt: string | null;
  /** This workspace's jobs pending more than 15 minutes past their time. */
  overdue: number;
  /** This workspace's jobs locked "running" for more than 15 minutes. */
  stuck: number;
  /** Dead-lettered in the last 7 days, with their types (and the latest error, admin only). */
  dead: { count: number; types: string[]; latestError: string | null };
  timezone: string;
  /** businesses.job_claims_paused: the worker skips this workspace entirely. */
  claimsPaused?: boolean;
};

export function checkWorker(f: WorkerFacts, audience: "customer" | "admin" = "customer"): EngineReport {
  const rows: CheckRow[] = [];
  rows.push(
    f.alive
      ? { id: "worker.heartbeat", label: "Worker", status: "READY", reason: `Running 24/7.${f.lastCompletedAt ? ` Last task for this workspace finished ${formatWhen(f.lastCompletedAt, f.timezone)}.` : ""}`, fix: null }
      : { id: "worker.heartbeat", label: "Worker", status: "ATTENTION", reason: "Background processing has missed its schedule. ClientTurn is alerted automatically; queued work resumes where it left off.", fix: audience === "admin" ? null : FIX.help },
  );
  if (f.claimsPaused) {
    // Paused on purpose (support hold or a demo workspace): an overdue count
    // here is expected, and "contact support" alone would not say why.
    rows.push({
      id: "worker.backlog",
      label: "Queued work",
      status: "ATTENTION",
      reason:
        audience === "admin"
          ? // Operators are the support team: "contact support" told them nothing.
            `Job claims are paused for this workspace (job_claims_paused), so the worker skips it: nothing is sent or processed${f.overdue > 0 ? ` and ${plural(f.overdue, "task")} ${f.overdue === 1 ? "is" : "are"} waiting` : ""}. Expected for the demo workspace and support holds; clearing the flag resumes the queue where it stopped.`
          : `Background work for this workspace is paused by ClientTurn, so nothing is sent or processed${f.overdue > 0 ? ` (${plural(f.overdue, "task")} waiting)` : ""}. Contact support to resume it.`,
      fix: audience === "admin" ? null : FIX.help,
    });
  } else if (f.overdue > 0 || f.stuck > 0) {
    rows.push({
      id: "worker.backlog",
      label: "Queued work",
      status: "ATTENTION",
      reason: `${f.overdue > 0 ? `${plural(f.overdue, "task")} overdue` : ""}${f.overdue > 0 && f.stuck > 0 ? " and " : ""}${f.stuck > 0 ? `${plural(f.stuck, "task")} stuck` : ""}. Stuck tasks are returned to the queue automatically within minutes.`,
      fix: audience === "admin" ? null : FIX.help,
    });
  } else {
    rows.push({ id: "worker.backlog", label: "Queued work", status: "READY", reason: "Nothing overdue or stuck.", fix: null });
  }
  if (f.dead.count > 0) {
    rows.push({
      id: "worker.dead",
      label: "Failed tasks",
      status: "ATTENTION",
      reason: `${plural(f.dead.count, "task")} failed permanently in the last 7 days (${f.dead.types.join(", ")}).${audience === "admin" && f.dead.latestError ? ` Latest error: ${f.dead.latestError}` : " Support can see the details."}`,
      fix: audience === "admin" ? null : FIX.help,
    });
  }
  return engine("worker", rows);
}

/* ================================================ per lead: why nothing happened */

export type LeadWhyFacts = {
  lead: {
    status: string;
    optedOut: boolean;
    humanTakeover: boolean;
    automationActive: boolean;
    firstRepliedAt: string | null;
    archived: boolean;
    anonymised: boolean;
  };
  sendingAllowed: boolean;
  quietHours: QuietHours;
  aiMode: AgentModeValue | "UNAVAILABLE";
  /** automation_runs for this lead, newest first. */
  runs: { state: string; nextRunAt: string | null; stoppedReason: string | null; stoppedAt: string | null }[];
  /** The policy engine's permission verdict per channel (lead.contactability); null if it couldn't run. */
  channels: { channel: string; decision: string; reason: string }[] | null;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  /** Recent refused / failed sends. */
  failedSends: { at: string; channel: string; error: string | null }[];
  /** Recent calls that did not connect, with their eligibility reasons. */
  failedCalls: { at: string; state: string; reasons: string[]; disconnection: string | null }[];
};

export type WhyTone = "info" | "warning" | "blocked";
export type WhyItem = { id: string; tone: WhyTone; title: string; detail: string; fix: CheckFix | null };
export type LeadWhy = { headline: string; items: WhyItem[]; next: { at: string; label: string } | null };

const STOP_COPY: Record<StopReason, { title: string; detail: string; tone: WhyTone; fix: CheckFix | null }> = {
  replied: { title: "They replied", detail: "Automatic follow-up stops the moment a lead replies, so a person (or the AI assistant) can answer them.", tone: "info", fix: null },
  booked: { title: "They booked", detail: "Follow-up stops once a meeting is booked. Booking reminders still go.", tone: "info", fix: null },
  won: { title: "Marked won", detail: "Nothing automatic is sent to a won lead.", tone: "info", fix: null },
  lost: { title: "Marked lost", detail: "Nothing automatic is sent to a lost lead.", tone: "info", fix: null },
  opted_out: { title: "They opted out", detail: "This lead asked not to be contacted. Nothing will be sent, by anyone or anything, and that can't be overridden.", tone: "blocked", fix: null },
  human_takeover: { title: "A person has taken over", detail: "Someone took over this conversation, so automation and the AI assistant stay quiet until it's handed back.", tone: "warning", fix: null },
  paused: { title: "Automation is paused for this lead", detail: "Automatic follow-up has been paused on this lead. Resume it from the lead's actions to carry on.", tone: "warning", fix: null },
  subscription_inactive: { title: "Sending is paused by billing", detail: "A failed payment or an ended subscription pauses sending. Leads are still captured.", tone: "blocked", fix: FIX.billing },
  integration_unavailable: { title: "The channel can't send", detail: "The connection for this channel needs attention.", tone: "blocked", fix: FIX.connections },
  suppressed: { title: "Every contact route is suppressed", detail: "This lead's addresses are on your suppression list (an opt-out, bounce or complaint).", tone: "blocked", fix: null },
};

const RUN_STOP_TEXT: Record<string, string> = {
  replied: "they replied",
  booked: "they booked",
  won: "the lead was won",
  lost: "the lead was lost",
  opted_out: "they opted out",
  human_takeover: "a person took over",
  paused: "automation was paused",
  subscription_inactive: "billing paused sending",
  integration_unavailable: "the channel couldn't send",
  suppressed: "their address is suppressed",
};

/**
 * A refused or failed call in words: the dial decision's own messages for its
 * eligibility and entitlement codes (voice/dial-decision.ts), which is what
 * voice_calls.eligibility_reasons and disconnection_reason carry.
 */
export function callRefusalText(call: { state: string; reasons: string[]; disconnection: string | null }): string {
  const codes = [...call.reasons, ...(call.disconnection ? [call.disconnection] : [])];
  const words = [...new Set(codes)].map(
    (code) => (ELIGIBILITY_MESSAGES as Record<string, string>)[code] ?? ENTITLEMENT_MESSAGES[code] ?? `${code.replace(/_/g, " ").toLowerCase()}.`,
  );
  return words.length > 0 ? words.join(" ") : `the call ended as ${call.state.toLowerCase()}.`;
}

export function explainLead(f: LeadWhyFacts, now: Date): LeadWhy {
  const items: WhyItem[] = [];
  const tz = f.quietHours.timezone;

  if (f.lead.anonymised) {
    return { headline: "This lead's personal data has been erased, so nothing can be sent.", items: [], next: null };
  }
  if (f.lead.archived) {
    items.push({ id: "archived", tone: "warning", title: "Archived", detail: "Archived leads get nothing automatic. Restore the lead to carry on.", fix: null });
  }

  const allBlocked = f.channels !== null && f.channels.length > 0 && f.channels.every((c) => c.decision === "BLOCKED");
  // The send guard's own stop rule, first match wins.
  const stop = evaluateStopConditions(
    {
      status: f.lead.status,
      optedOut: f.lead.optedOut,
      humanTakeover: f.lead.humanTakeover,
      automationActive: f.lead.automationActive,
      hasReplied: Boolean(f.lead.firstRepliedAt),
    },
    { subscriptionActive: f.sendingAllowed, integrationHealthy: true, contactSuppressed: allBlocked },
  );
  if (stop) {
    const copy = STOP_COPY[stop];
    items.push({ id: `stop.${stop}`, tone: copy.tone, title: copy.title, detail: copy.detail, fix: copy.fix });
  }

  if (f.channels === null) {
    items.push({ id: "channels.unknown", tone: "warning", title: "Contact permission couldn't be checked", detail: "Every send is still checked at the moment it goes.", fix: null });
  } else if (f.channels.length > 0 && !f.channels.some((c) => c.decision === "ALLOWED") && stop !== "opted_out") {
    items.push({
      id: "channels.none",
      tone: "blocked",
      title: "No lawful channel",
      detail: `There's no channel this lead may be contacted on right now: ${f.channels.map((c) => `${c.channel.toLowerCase()} (${c.reason})`).join("; ")}.`,
      fix: null,
    });
  }

  if (f.aiMode === "OFF" && Boolean(f.lead.firstRepliedAt) && !f.lead.humanTakeover) {
    items.push({ id: "ai.off", tone: "warning", title: "Their reply needs a person", detail: "The AI assistant is off, so replies aren't answered automatically. Answer from the Inbox, or switch the assistant on.", fix: FIX.aiAssistant });
  }

  const active = f.runs.find((r) => r.state === "ACTIVE" && r.nextRunAt);
  let next: LeadWhy["next"] = null;
  if (active?.nextRunAt && !stop) {
    const at = new Date(active.nextRunAt);
    const permitted = nextPermittedSendTime(at, f.quietHours);
    const label = permitted.getTime() !== at.getTime() ? "Next follow-up step (after quiet hours)" : "Next follow-up step";
    next = { at: permitted.toISOString(), label };
    if (at.getTime() <= now.getTime() - 15 * 60_000) {
      items.push({ id: "run.overdue", tone: "warning", title: "A follow-up step is overdue", detail: `It was due ${formatWhen(at, tz)}. It is re-checked and sent on the next worker pass; if this stays, see System check → Background processing.`, fix: { href: SYSTEM_CHECK_HREF, label: "Open System check" } });
    }
  } else if (!stop) {
    const stopped = f.runs.find((r) => r.state === "STOPPED" && r.stoppedReason);
    if (stopped?.stoppedReason) {
      items.push({
        id: "run.stopped",
        tone: "info",
        title: "Follow-up finished",
        detail: `The follow-up sequence stopped${stopped.stoppedAt ? ` on ${formatWhen(stopped.stoppedAt, tz)}` : ""} because ${RUN_STOP_TEXT[stopped.stoppedReason] ?? stopped.stoppedReason.replace(/_/g, " ")}.`,
        fix: null,
      });
    } else if (f.runs.length === 0 || f.runs.every((r) => r.state !== "ACTIVE")) {
      items.push({ id: "run.none", tone: "info", title: "No follow-up is scheduled", detail: "This lead isn't in an active follow-up sequence. Sequences start when a lead arrives and match your Follow-Up settings.", fix: FIX.followUp });
    }
  }

  if (isWithinQuietHours(now, f.quietHours)) {
    items.push({ id: "quiet", tone: "info", title: "It's quiet hours", detail: `Automatic messages are held until ${formatWhen(nextPermittedSendTime(now, f.quietHours), tz)}.`, fix: FIX.messaging });
  }

  if (f.lastOutboundAt && (!f.lastInboundAt || f.lastInboundAt < f.lastOutboundAt) && !stop) {
    items.push({ id: "waiting", tone: "info", title: "Waiting for their reply", detail: `Last message sent ${formatWhen(f.lastOutboundAt, tz)}; nothing back yet.`, fix: null });
  }

  for (const send of f.failedSends.slice(0, 3)) {
    items.push({ id: `send.${send.at}`, tone: "warning", title: `A ${send.channel.toLowerCase()} message didn't send`, detail: `${formatWhen(send.at, tz)}: ${send.error ?? "refused by the provider"}.`, fix: null });
  }
  for (const call of f.failedCalls.slice(0, 3)) {
    items.push({
      id: `call.${call.at}`,
      tone: "warning",
      title: "An AI call didn't go ahead",
      detail: `${formatWhen(call.at, tz)}: ${callRefusalText(call)}`,
      fix: null,
    });
  }

  const blocking = items.find((i) => i.tone === "blocked") ?? items.find((i) => i.tone === "warning" && i.id.startsWith("stop."));
  const headline = blocking
    ? `${blocking.title}.`
    : next
      ? `Nothing is wrong: the next step is scheduled for ${formatWhen(next.at, tz)}.`
      : items.length > 0
        ? items[0].title + "."
        : "Nothing is holding this lead up.";
  return { headline, items, next };
}
