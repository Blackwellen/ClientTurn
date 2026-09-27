/**
 * "Continue this conversation by SMS: upgrade now" -- the pure decisions.
 *
 * Owner request (2026-09-27): a trial workspace whose SMS allowance has run
 * out while a lead is texting back is offered an instant conversion (end the
 * Stripe trial today on the card already on file) rather than a new checkout.
 *
 * Pure -- no `server-only`, no Supabase, no Stripe -- so the page loader, the
 * client modal and the unit tests compute the same answer. The loader reads
 * the facts (trial-upgrade-service.ts); this file decides.
 *
 * ## When the prompt shows
 *
 * All of:
 *
 *   * the workspace is trialling (`plan === "trial"`, state TRIALING);
 *   * the viewer is an owner or admin (only an owner can pay; an admin is told
 *     who can);
 *   * the trial's SMS is used up, or would be by the next send: allowance left
 *     this period plus top-up credit is less than the units the next reply
 *     needs;
 *   * a lead is in a live SMS conversation: a held AI SMS reply exists for
 *     them, or they have texted in recently.
 *
 * It is derived from database state on every page load, so it is there when
 * the owner opens the app later, not only at the moment the send was refused.
 * Dismissal hides the modal for that lead for 24 hours; the banner stays.
 */

import { allowanceRemaining } from "./allowance-alerts.ts";
import { PLANS, type PlanId } from "./plans.ts";

/* ---------------------------------------------------------- the contract */

/**
 * The attention reason send-store writes when an AI SMS reply to a lead who
 * wrote in is refused because the SMS allowance and credit are used up (and
 * the reply could not be moved to email). Held replies are released only for
 * leads still flagged with exactly this reason.
 */
export const HELD_REPLY_ATTENTION_REASON = "sms_allowance_exhausted";

/** The policy error code on a held (BLOCKED) AI SMS reply. */
export const HELD_REPLY_ERROR_CODE = "policy:BLOCKED_MONTHLY_LIMIT";

/** Message origins that are the AI's replies to a lead. */
export const HELD_REPLY_ORIGINS = ["agent", "agent_handover"] as const;

/** An inbound SMS within this window counts as a live conversation. */
export const LIVE_CONVERSATION_DAYS = 7;

/** A held reply older than this is stale: the moment has passed, so it is not re-sent. */
export const HELD_REPLY_MAX_AGE_HOURS = 72;

/** How long "Not now" hides the modal for one lead. */
export const DISMISS_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export type MessageLike = {
  id: string;
  lead_id: string | null;
  channel: string;
  direction: string;
  status: string;
  origin: string;
  error_code: string | null;
  created_at: string;
};

/** Whether a message row is a held AI SMS reply, as send-store leaves one. */
export function isHeldSmsReply(message: MessageLike): boolean {
  return (
    message.direction === "outbound" &&
    message.channel === "sms" &&
    message.status === "BLOCKED" &&
    message.error_code === HELD_REPLY_ERROR_CODE &&
    (HELD_REPLY_ORIGINS as readonly string[]).includes(message.origin)
  );
}

/* ------------------------------------------------------------- decision */

export type SelfServePlan = "starter" | "growth" | "pro";

export type PromptCandidate = {
  leadId: string;
  leadName: string;
  /** The lead has texted in within LIVE_CONVERSATION_DAYS. */
  hasRecentInboundSms: boolean;
  /** An AI SMS reply to this lead is being held (BLOCKED at the limit). */
  hasHeldReply: boolean;
  /** SMS segments the held reply needs, when there is one. */
  heldReplyUnits?: number;
};

export type PromptInput = {
  plan: string;
  state: string;
  role: string;
  /** The trial's SMS allowance (`allowancesFor("trial").smsSegmentAllowance`). */
  allowance: number;
  /** `sms_outbound_segment` usage since the period start. */
  usedThisPeriod: number;
  /** SMS top-up credit left. */
  creditBalance: number;
  /** The most relevant lead in a live SMS conversation, if any. */
  candidate: PromptCandidate | null;
};

export type PromptDecision =
  | {
      show: true;
      leadId: string;
      leadName: string;
      /** Only an owner can pay; an admin sees the prompt without the button. */
      canUpgrade: boolean;
      reason: "held_reply" | "inbound_sms";
    }
  | {
      show: false;
      reason: "not_trial" | "role" | "allowance_left" | "no_live_conversation";
    };

export function canSeeTrialPrompt(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** SMS the workspace can still send: allowance left plus top-up credit. */
export function smsRemaining(input: {
  allowance: number;
  usedThisPeriod: number;
  creditBalance: number;
}): number {
  return allowanceRemaining({
    allowance: input.allowance,
    usedThisPeriod: input.usedThisPeriod,
    creditBalance: input.creditBalance,
  });
}

export function decideTrialUpgradePrompt(input: PromptInput): PromptDecision {
  if (input.plan !== "trial" || input.state !== "TRIALING") return { show: false, reason: "not_trial" };
  if (!canSeeTrialPrompt(input.role)) return { show: false, reason: "role" };

  const candidate = input.candidate;
  const nextUnits = Math.max(1, Math.ceil(candidate?.heldReplyUnits ?? 1));
  const remaining = smsRemaining(input);
  // "Used up, or would be by the next send."
  if (remaining >= nextUnits) return { show: false, reason: "allowance_left" };

  if (!candidate || !(candidate.hasHeldReply || candidate.hasRecentInboundSms)) {
    return { show: false, reason: "no_live_conversation" };
  }

  return {
    show: true,
    leadId: candidate.leadId,
    leadName: candidate.leadName,
    canUpgrade: input.role === "owner",
    reason: candidate.hasHeldReply ? "held_reply" : "inbound_sms",
  };
}

/**
 * The lead to prompt about, from what the loader found: a held reply beats a
 * bare inbound text (it is a message the lead is actually waiting for), and
 * the most recent wins within each. A `preferLeadId` (the lead page, the open
 * Inbox thread) wins when that lead qualifies at all.
 */
export function pickCandidate(
  candidates: readonly (PromptCandidate & { lastActivityAt: string })[],
  preferLeadId?: string | null,
): PromptCandidate | null {
  const live = candidates.filter((c) => c.hasHeldReply || c.hasRecentInboundSms);
  if (preferLeadId) {
    const preferred = live.find((c) => c.leadId === preferLeadId);
    if (preferred) return strip(preferred);
  }
  const sorted = [...live].sort((a, b) => {
    if (a.hasHeldReply !== b.hasHeldReply) return a.hasHeldReply ? -1 : 1;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
  return sorted[0] ? strip(sorted[0]) : null;
}

function strip(candidate: PromptCandidate & { lastActivityAt: string }): PromptCandidate {
  const { lastActivityAt: _ignored, ...rest } = candidate;
  void _ignored;
  return rest;
}

/* ------------------------------------------------------------- dismissal */

/** localStorage key: per user and per lead, so one dismissal is not global. */
export function dismissalKey(userId: string, leadId: string): string {
  return `ct:trial-sms-upgrade:dismissed:${userId}:${leadId}`;
}

/**
 * The cookie that mirrors a dismissal, so the server can honour it too: when
 * localStorage is blocked (private windows, strict browser settings) or empty
 * on another tab's first paint, the mount reads this and does not auto-open
 * the modal. Same value (epoch ms) and the same 24-hour rule as localStorage;
 * the cookie also expires on its own after DISMISS_HOURS.
 */
export function dismissalCookieName(userId: string, leadId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "");
  return `ct_tus_${safe(userId)}_${safe(leadId)}`;
}

/** `document.cookie` assignment for a dismissal at `now`. */
export function dismissalCookie(userId: string, leadId: string, now: number): string {
  return `${dismissalCookieName(userId, leadId)}=${now}; Max-Age=${DISMISS_HOURS * 3600}; Path=/; SameSite=Lax`;
}

/** Whether a stored dismissal (epoch ms as a string) still hides the modal. */
export function isDismissed(stored: string | null | undefined, now: number): boolean {
  if (!stored) return false;
  const at = Number(stored);
  if (!Number.isFinite(at) || at <= 0) return false;
  // A timestamp in the future is a clock change or tampering: not trusted.
  if (at > now) return false;
  return now - at < DISMISS_HOURS * HOUR_MS;
}

/* ------------------------------------------------------------ the offer */

export type BillingIntervalName = "month" | "year";

export type PlanOffer = {
  plan: SelfServePlan;
  name: string;
  interval: BillingIntervalName;
  /** Catalogue price in whole GBP for the interval. Stripe is authoritative. */
  price: number;
  smsSegmentAllowance: number;
  leadLimit: number;
  features: string[];
};

export const SELF_SERVE_PLANS: readonly SelfServePlan[] = ["starter", "growth", "pro"];

export function isSelfServePlan(plan: string): plan is SelfServePlan {
  return (SELF_SERVE_PLANS as readonly string[]).includes(plan);
}

/**
 * What the modal shows for a plan. The chosen-at-checkout tier is the
 * default; a trial on an unknown tier falls back to Starter.
 */
export function planOffer(plan: string, interval: string | null | undefined): PlanOffer {
  const id: SelfServePlan = isSelfServePlan(plan) ? plan : "starter";
  const definition = PLANS[id as Exclude<PlanId, "trial">];
  const yearly = interval === "year";
  return {
    plan: id,
    name: definition.name,
    interval: yearly ? "year" : "month",
    price: (yearly ? definition.yearlyPrice : definition.monthlyPrice) ?? 0,
    smsSegmentAllowance: definition.smsSegmentAllowance,
    leadLimit: definition.leadLimit,
    features: definition.features,
  };
}

/** "£99.00" from minor units, for the confirmation line. */
export function formatMinorGbp(amountMinor: number, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(
    amountMinor / 100,
  );
}

/* --------------------------------------------------- releasing held replies */

export type HeldReplyRow = MessageLike & { send_key: string | null };

export type LeadFlagRow = {
  id: string;
  human_takeover: boolean;
  attention_reason: string | null;
};

export type ReleasePlan = {
  /** Leads whose takeover/attention flag is cleared (never a lead kept with a person). */
  leadIds: string[];
  /** Held messages re-queued through the normal send path (one per lead). */
  messageIds: string[];
  /** Held messages left BLOCKED: superseded by a newer one, or stale. */
  skippedMessageIds: string[];
};

/**
 * Which held AI SMS replies to release after the trial converts.
 *
 *   * only leads still flagged `human_takeover` with the allowance-exhausted
 *     reason: a lead a person has since taken over for any other reason keeps
 *     their takeover, and their held reply stays held;
 *   * only the most recent held reply per lead: an earlier one was answering
 *     an earlier message, and sending both would read as a double text;
 *   * only replies younger than HELD_REPLY_MAX_AGE_HOURS: a days-old reply
 *     arriving now would be out of place, so a person picks the lead up;
 *   * never a lead who has had an outbound message SENT since the held reply
 *     (a person already answered them by hand).
 *
 * Every released message still goes through the full send gate again
 * (quiet hours, opt-out, suppression, the new plan's allowance).
 */
export function planHeldReplyRelease(input: {
  messages: readonly HeldReplyRow[];
  leads: readonly LeadFlagRow[];
  /** lead id -> latest SENT outbound message time, for the "already answered" rule. */
  lastSentAt?: Readonly<Record<string, string | null | undefined>>;
  now: Date;
}): ReleasePlan {
  const flagged = new Set(
    input.leads
      .filter((lead) => lead.human_takeover && lead.attention_reason === HELD_REPLY_ATTENTION_REASON)
      .map((lead) => lead.id),
  );

  const latestByLead = new Map<string, HeldReplyRow>();
  const skipped: string[] = [];
  for (const message of input.messages) {
    if (!isHeldSmsReply(message) || !message.lead_id || !flagged.has(message.lead_id)) {
      skipped.push(message.id);
      continue;
    }
    const current = latestByLead.get(message.lead_id);
    if (!current || new Date(message.created_at) > new Date(current.created_at)) {
      if (current) skipped.push(current.id);
      latestByLead.set(message.lead_id, message);
    } else {
      skipped.push(message.id);
    }
  }

  const messageIds: string[] = [];
  // A lead whose held reply is stale or already answered stays with a person:
  // they still owe the lead a reply, or have taken the conversation on.
  const keepWithPerson = new Set<string>();
  for (const [leadId, message] of latestByLead) {
    const ageMs = input.now.getTime() - new Date(message.created_at).getTime();
    const answeredSince = input.lastSentAt?.[leadId];
    const stale = ageMs > HELD_REPLY_MAX_AGE_HOURS * HOUR_MS;
    const answered = Boolean(answeredSince && new Date(answeredSince) > new Date(message.created_at));
    if (stale || answered) {
      skipped.push(message.id);
      keepWithPerson.add(leadId);
    } else {
      messageIds.push(message.id);
    }
  }

  // Every other lead flagged for this reason is handed back to the assistant:
  // the reason for the takeover (no SMS left) no longer holds.
  const leadIds = [...flagged].filter((id) => !keepWithPerson.has(id)).sort();
  return { leadIds, messageIds: messageIds.sort(), skippedMessageIds: skipped.sort() };
}

/**
 * The send key for a released message's job. Distinct from the original so
 * the queue's idempotency (`message.send:<key>`) does not swallow it, and
 * stable per conversion attempt so a retried release does not enqueue twice.
 */
export function releaseJobKey(sendKey: string | null, messageId: string, attempt: string): string {
  return `message.send:${sendKey ?? messageId}:trial-upgrade:${attempt}`;
}
