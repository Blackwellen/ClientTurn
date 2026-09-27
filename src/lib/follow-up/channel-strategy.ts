/**
 * Cost-aware channel choice for automated follow-up, and the per-lead SMS
 * limits that bound what one lead can cost (economics.md §3.6, §10).
 *
 * Pure -- no Supabase, no `server-only` -- so the worker, the settings form
 * and the tests all read the same rules.
 *
 * Why it exists. An SMS segment costs ClientTurn about 4.2p; an email sent
 * through the customer's own connected mailbox costs nothing. Speed to lead
 * is the product, so the FIRST touch stays instant and prefers SMS where the
 * lead gave a mobile. Later automated nudges to a lead who has NOT engaged
 * prefer email when the lead has an address and a mailbox is connected, and
 * only fall back to SMS when email is not available. A workspace that wants
 * SMS on every step says so with a setting; nothing is hard-coded.
 *
 * OWNER RULE (2026-09-27): cost cutting must never reduce the product's
 * ability to complete a sale. So budgeting applies to UNENGAGED automated
 * steps only:
 *  - a lead who has replied, or whose intent is MEDIUM or above, is ENGAGED:
 *    their steps stay on the configured channel and no follow-up SMS cap
 *    applies;
 *  - the agent's replies in a live conversation are never capped per lead;
 *    only an abuse ceiling (default 40 SMS segments per lead per 24 hours)
 *    applies, and reaching it hands the lead to a person rather than going
 *    silent.
 *
 * What this does NOT decide: whether this person may be contacted on this
 * channel right now. That is `ChannelPolicyService.evaluate()`, taken again
 * immediately before every send, together with quiet hours and every stop
 * condition (reply, NEGATIVE / NOT_NOW, booked, opted out). This module only
 * chooses which channel a step is *queued* on.
 */

export const FOLLOW_UP_CHANNEL_STRATEGIES = ["sms_first_then_email", "sms_every_step"] as const;

export type FollowUpChannelStrategy = (typeof FOLLOW_UP_CHANNEL_STRATEGIES)[number];

/** "SMS for the first message, email after". */
export const DEFAULT_FOLLOW_UP_CHANNEL_STRATEGY: FollowUpChannelStrategy = "sms_first_then_email";

export const FOLLOW_UP_CHANNEL_STRATEGY_LABEL: Record<FollowUpChannelStrategy, string> = {
  sms_first_then_email: "SMS for the first message, email after",
  sms_every_step: "SMS for every step",
};

export const FOLLOW_UP_CHANNEL_STRATEGY_HELP: Record<FollowUpChannelStrategy, string> = {
  sms_first_then_email:
    "The first message goes out instantly by SMS when the lead gave a mobile (email otherwise). Later nudges to a lead who has not replied go by email from your connected mailbox, and use SMS only when the lead has no usable email address. Once a lead replies or shows real interest, everything stays on their channel.",
  sms_every_step:
    "Every step goes out on the channel it is set to in the sequence. The default sequence is SMS, so each step uses your SMS allowance.",
};

export function parseFollowUpChannelStrategy(value: unknown): FollowUpChannelStrategy {
  return (FOLLOW_UP_CHANNEL_STRATEGIES as readonly string[]).includes(value as string)
    ? (value as FollowUpChannelStrategy)
    : DEFAULT_FOLLOW_UP_CHANNEL_STRATEGY;
}

/* ------------------------------------------------------------ engagement */

/** Intent states at or above MEDIUM (qualification-intelligence INTENT_STATES). */
export const ENGAGED_INTENT_STATES = ["MEDIUM", "HIGH", "BOOKING_READY", "PURCHASE_READY"] as const;

/**
 * An engaged lead is never cost-budgeted: they have replied, or the
 * qualification engine reads their intent as MEDIUM or above.
 */
export function isEngagedLead(input: { hasReplied: boolean; intentState: string | null | undefined }): boolean {
  if (input.hasReplied) return true;
  return (ENGAGED_INTENT_STATES as readonly string[]).includes(input.intentState ?? "");
}

/* ------------------------------------------------------------ SMS limits */

/**
 * Automated follow-up SMS per UNENGAGED lead per sequence run, in segments.
 * Three covers an instant first text plus two fallback texts for a lead with
 * no email address; with the default strategy most leads use one.
 */
export const DEFAULT_FOLLOW_UP_SMS_SEGMENTS_PER_LEAD = 3;

/**
 * Abuse ceiling on the agent's SMS replies to one lead, per rolling 24 hours.
 * Not a budget: a real conversation never meets it (a golden conversation is
 * about four segments). It stops a runaway loop or a lead spamming the agent,
 * and reaching it hands the lead to a person.
 */
export const DEFAULT_CONVERSATION_SMS_DAILY_CEILING = 40;

export const SMS_CAP_BOUNDS = {
  followUp: { min: 1, max: 20 },
  // The floor keeps a workspace from turning the abuse ceiling into a cap
  // that would cut a live conversation short.
  conversation: { min: 20, max: 200 },
} as const;

export function clampSmsCap(value: unknown, kind: keyof typeof SMS_CAP_BOUNDS): number {
  const fallback =
    kind === "followUp" ? DEFAULT_FOLLOW_UP_SMS_SEGMENTS_PER_LEAD : DEFAULT_CONVERSATION_SMS_DAILY_CEILING;
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  const { min, max } = SMS_CAP_BOUNDS[kind];
  return Math.min(max, Math.max(min, number));
}

/** Which per-lead SMS limit a send is counted against, or null when none applies. */
export type SmsCapKind = "follow_up" | "conversation";

export function smsCapKindFor(input: {
  origin: string;
  bookingReminder: boolean;
  /** An engaged lead's automated steps are not budgeted. */
  engaged?: boolean;
}): SmsCapKind | null {
  // A booking reminder is about an appointment the lead made: transactional,
  // and never the thing to ration.
  if (input.origin === "automation") {
    if (input.bookingReminder || input.engaged) return null;
    return "follow_up";
  }
  // The agent's replies: only the abuse ceiling, never a per-lead budget.
  if (input.origin === "agent" || input.origin === "agent_handover") return "conversation";
  // A person typing a reply, a reactivation campaign (which has its own
  // selected-contact budget) and system messages are not capped per lead.
  return null;
}

/** True when `units` more segments stay within the limit. */
export function perLeadSmsCapAllows(input: { usedSegments: number; units: number; cap: number }): boolean {
  return input.usedSegments + input.units <= input.cap;
}

/**
 * SMS kept back from automated first texts so live conversations are not
 * starved when a plan's included segments run low and there is no credit or
 * overage: 10% of the allowance on a paid plan, half of it in the trial
 * (where there is no overage at all). Automated SMS that would dip into the
 * reserve goes by email instead; the agent's replies may use it.
 */
export function conversationSmsReserve(input: { plan: string; allowance: number }): number {
  if (input.allowance <= 0) return 0;
  return input.plan === "trial" ? Math.floor(input.allowance / 2) : Math.ceil(input.allowance * 0.1);
}

/* ------------------------------------------------------- channel choice */

export type StepChannel = "sms" | "email" | "whatsapp";

export type StepChannelInput = {
  strategy: FollowUpChannelStrategy;
  /** The channel the step is configured with in the sequence. */
  configured: StepChannel;
  /** 0 for the first message of the run. */
  stepIndex: number;
  /** Booking reminders keep their configured channel. */
  bookingReminder: boolean;
  /** Replied, or intent MEDIUM or above: stays on the configured channel. */
  engaged: boolean;
  /** Workspace-level: policy permits it and the provider / mailbox is connected. */
  available: { sms: boolean; email: boolean };
  /** The lead has an address on the channel. */
  leadHas: { sms: boolean; email: boolean };
  /**
   * An SMS of about one segment still fits this lead's follow-up cap and the
   * workspace's SMS allowance (outside the conversation reserve), credit or
   * overage. Re-checked at send time.
   */
  smsAffordable: boolean;
};

/**
 * The lead's own stated preference (agent/channel-preference.ts, 0147
 * `leads.preferred_contact_channel`), when it names a channel an automated
 * step can use and that channel is usable for this lead. It outranks the
 * cost strategy and the configured channel: the lead told us where to reach
 * them. "phone" is a call preference and never re-routes a message. Consent,
 * suppression and quiet hours are still decided per send by the policy gate.
 */
export function preferredStepChannel<T>(
  preference: string | null | undefined,
  usable: (channel: StepChannel) => T | null,
): T | null {
  if (preference !== "sms" && preference !== "email" && preference !== "whatsapp") return null;
  return usable(preference);
}

/**
 * The channel a step is queued on under the workspace's strategy, or null to
 * leave the decision to the configured channel and the fallback setting.
 *
 * Only SMS steps to UNENGAGED leads are re-routed: a step the customer set to
 * email or WhatsApp is theirs, and a lead who has engaged stays on their
 * channel. Null never means "send nothing"; it means "this rule has no
 * opinion", and the existing resolution (configured channel, then the
 * deterministic fallback if switched on, then an attention item) applies.
 */
export function chooseStepChannel(input: StepChannelInput): StepChannel | null {
  if (input.strategy !== "sms_first_then_email") return null;
  if (input.bookingReminder || input.configured !== "sms" || input.engaged) return null;

  const smsUsable = input.available.sms && input.leadHas.sms && input.smsAffordable;
  const emailUsable = input.available.email && input.leadHas.email;

  if (input.stepIndex === 0) {
    // Speed to lead: the first touch is instant on SMS where we can, and on
    // email rather than not at all where we cannot.
    if (smsUsable) return "sms";
    if (emailUsable) return "email";
    return null;
  }

  if (emailUsable) return "email";
  if (smsUsable) return "sms";
  return null;
}

/**
 * The subject an SMS step carries when it is sent as an email. Merge fields
 * resolve with the same renderer as the body; `business_name` always has a
 * value, so this never pauses a run for a missing field.
 */
export const SMS_STEP_EMAIL_SUBJECT = "Your enquiry with {{business_name}}";

/* ------------------------------------------ cold re-engagement channel */

/**
 * Reactivation campaigns choose their channel per contact in one of two
 * modes. `cost_aware` (the default for new campaigns) is the same rule as the
 * follow-up strategy above: a lead who has NOT engaged gets email through the
 * customer's own mailbox when they have an address, and SMS only when email is
 * not available; a lead who has engaged (replied, or intent MEDIUM or above)
 * stays on SMS. `sms` sends SMS to everyone, as campaigns always used to.
 */
export const CAMPAIGN_CHANNEL_MODES = ["cost_aware", "sms"] as const;
export type CampaignChannelMode = (typeof CAMPAIGN_CHANNEL_MODES)[number];
export const DEFAULT_CAMPAIGN_CHANNEL_MODE: CampaignChannelMode = "cost_aware";

export const CAMPAIGN_CHANNEL_MODE_LABEL: Record<CampaignChannelMode, string> = {
  cost_aware: "Cost-aware: email first for leads who have not engaged",
  sms: "Always SMS",
};

export const CAMPAIGN_CHANNEL_MODE_HELP: Record<CampaignChannelMode, string> = {
  cost_aware:
    "Leads who have never replied get this message by email from your connected mailbox when they have an address, which costs no SMS credit. Leads who have replied or shown real interest still get SMS.",
  sms: "Every lead gets this message by SMS, which uses your SMS allowance for each one.",
};

/** A stored value read defensively; anything unknown keeps the old behaviour (SMS). */
export function parseCampaignChannelMode(value: unknown): CampaignChannelMode {
  return (CAMPAIGN_CHANNEL_MODES as readonly string[]).includes(value as string)
    ? (value as CampaignChannelMode)
    : "sms";
}

/**
 * The channel one automated re-engagement message goes on: a campaign contact
 * in cost-aware mode, an intent trigger, a win-back or a no-show message, or a
 * re-engagement agent's draft.
 *
 * Reuses `chooseStepChannel` for the unengaged case, as a later step of the
 * "SMS first, then email" strategy: email when usable, SMS otherwise. An
 * engaged lead stays on the channel they use (`preferred`), falling back to
 * whichever is usable. `forceSms` is the campaign's "Always SMS" choice.
 *
 * Null means nothing usable; the caller records why rather than guessing.
 * Whether this person may be contacted on the channel at all is still decided
 * by the policy gate immediately before the send.
 */
export function chooseCostAwareChannel(input: {
  engaged: boolean;
  /** The channel the lead last wrote to us on, when known. */
  preferred?: StepChannel | null;
  available: { sms: boolean; email: boolean };
  leadHas: { sms: boolean; email: boolean };
  forceSms?: boolean;
}): "sms" | "email" | null {
  const smsUsable = input.available.sms && input.leadHas.sms;
  const emailUsable = input.available.email && input.leadHas.email;

  if (input.forceSms) return smsUsable ? "sms" : null;

  if (input.engaged) {
    if (input.preferred === "email" && emailUsable) return "email";
    if (input.preferred === "sms" && smsUsable) return "sms";
    if (smsUsable) return "sms";
    return emailUsable ? "email" : null;
  }

  const chosen = chooseStepChannel({
    strategy: "sms_first_then_email",
    configured: "sms",
    stepIndex: 1,
    bookingReminder: false,
    engaged: false,
    available: input.available,
    leadHas: input.leadHas,
    smsAffordable: true,
  });
  return chosen === "sms" || chosen === "email" ? chosen : null;
}
