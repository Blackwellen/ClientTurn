/**
 * Social outreach: what each platform actually allows (V4 §16, channel policy).
 *
 * Pure — no `server-only`, no Supabase — so the limits can be unit-tested and
 * shown in the UI from the same source the scheduler enforces them from.
 *
 * The shape of social outreach is different from email and the product has to
 * respect that rather than pretending it is a second mailbox. On LinkedIn you
 * cannot message a stranger: you send a **connection request**, and only once
 * it is accepted can you send a message. On Instagram and Facebook a message to
 * someone who does not follow you lands in Message Requests, where most people
 * never look — following first, and being followed back, is what makes the
 * message arrive.
 *
 * So the sequence is always: connect or follow → wait → message. The waiting
 * step is not a delay we invented; it is the platform's own gate, and modelling
 * it as a state machine is the only way the numbers a customer sees are honest.
 *
 * ## On limits
 *
 * Every platform throttles this, and exceeding the throttle gets the account
 * restricted — which costs the customer far more than a slow campaign. The
 * caps below are the conservative published/observed figures. They are
 * deliberately *defaults* rather than constants: platforms change them, and a
 * workspace whose account is warmed or whose tier is higher can be raised by an
 * admin. Nothing here can be raised by the optimizer.
 */

export const SOCIAL_PLATFORMS = ["LINKEDIN", "FACEBOOK", "INSTAGRAM", "TIKTOK"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Account tier. This is what decides how much a workspace can do, and it is the
 * single most common source of "why did my campaign stop" — so it is a first
 * class field rather than something inferred.
 */
export const SOCIAL_ACCOUNT_TIERS = [
  "FREE",
  "PREMIUM",
  "SALES_NAVIGATOR",
  "RECRUITER",
  "BUSINESS_PAGE",
] as const;
export type SocialAccountTier = (typeof SOCIAL_ACCOUNT_TIERS)[number];

export type SocialLimits = {
  /** Connection requests / follows per day. */
  dailyConnects: number;
  /** Connection requests / follows per week. LinkedIn enforces weekly, not daily. */
  weeklyConnects: number;
  /**
   * Personalised notes attached to a connection request, per month.
   *
   * The one people are caught out by. LinkedIn restricted free accounts to a
   * small monthly allowance of invitation notes — a free user can still send
   * plenty of invitations, just not personalised ones. Sending without a note
   * is allowed and unlimited within the connect cap, so the product degrades to
   * a bare invite rather than stopping.
   */
  monthlyNotes: number;
  /** Direct messages per day once connected / followed back. */
  dailyMessages: number;
  /**
   * InMail-style credits: messaging someone you are *not* connected to. Zero on
   * free, which is exactly why the connect step exists.
   */
  monthlyInMail: number;
};

/**
 * Conservative defaults per platform and tier.
 *
 * Where a platform publishes a figure it is used; where it does not, the widely
 * observed safe ceiling is used and set low. Being under a real limit costs a
 * customer some throughput; being over it costs them the account.
 */
export const DEFAULT_SOCIAL_LIMITS: Record<
  SocialPlatform,
  Partial<Record<SocialAccountTier, SocialLimits>>
> = {
  LINKEDIN: {
    FREE: {
      dailyConnects: 15,
      weeklyConnects: 100,
      // The restriction most people meet first.
      monthlyNotes: 5,
      dailyMessages: 25,
      monthlyInMail: 0,
    },
    PREMIUM: {
      dailyConnects: 20,
      weeklyConnects: 100,
      monthlyNotes: 999,
      dailyMessages: 40,
      monthlyInMail: 15,
    },
    SALES_NAVIGATOR: {
      dailyConnects: 25,
      weeklyConnects: 100,
      monthlyNotes: 999,
      dailyMessages: 50,
      monthlyInMail: 50,
    },
    RECRUITER: {
      dailyConnects: 25,
      weeklyConnects: 100,
      monthlyNotes: 999,
      dailyMessages: 50,
      monthlyInMail: 150,
    },
  },
  INSTAGRAM: {
    BUSINESS_PAGE: {
      dailyConnects: 50,
      weeklyConnects: 300,
      // Instagram has no invitation note; the first DM is the note.
      monthlyNotes: 0,
      dailyMessages: 40,
      monthlyInMail: 0,
    },
  },
  FACEBOOK: {
    BUSINESS_PAGE: {
      dailyConnects: 40,
      weeklyConnects: 250,
      monthlyNotes: 0,
      dailyMessages: 40,
      monthlyInMail: 0,
    },
  },
  TIKTOK: {
    BUSINESS_PAGE: {
      dailyConnects: 30,
      weeklyConnects: 200,
      monthlyNotes: 0,
      // The tightest of the four. TikTok only permits a direct message once the
      // account follows you back, and business messaging is not available in
      // every region — so the ceiling is low and the gate is absolute.
      dailyMessages: 20,
      monthlyInMail: 0,
    },
  },
};

export function limitsFor(
  platform: SocialPlatform,
  tier: SocialAccountTier,
): SocialLimits | null {
  return DEFAULT_SOCIAL_LIMITS[platform]?.[tier] ?? null;
}

/* -------------------------------------------------------------- the states */

/**
 * Where a prospect has reached on a social channel.
 *
 * `ACCEPTED` is the gate everything hangs on: before it, a message cannot be
 * sent at all on LinkedIn and will be buried in Message Requests on Meta. The
 * scheduler must never treat `INVITE_SENT` as permission to message.
 */
export const SOCIAL_STATES = [
  "NOT_CONNECTED",
  "INVITE_QUEUED",
  "INVITE_SENT",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "MESSAGED",
  "REPLIED",
  "BLOCKED",
] as const;
export type SocialState = (typeof SOCIAL_STATES)[number];

const STATE_LABELS: Record<SocialState, string> = {
  NOT_CONNECTED: "Not connected",
  INVITE_QUEUED: "Invite queued",
  INVITE_SENT: "Invite sent",
  ACCEPTED: "Connected",
  DECLINED: "Invite declined",
  WITHDRAWN: "Invite withdrawn",
  MESSAGED: "Messaged",
  REPLIED: "Replied",
  BLOCKED: "Blocked",
};

export function socialStateLabel(state: SocialState): string {
  return STATE_LABELS[state] ?? state;
}

export function socialStateTone(
  state: SocialState,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (state) {
    case "REPLIED":
    case "ACCEPTED":
      return "success";
    case "INVITE_SENT":
    case "MESSAGED":
      return "accent";
    case "INVITE_QUEUED":
      return "warning";
    case "DECLINED":
    case "BLOCKED":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Can a message be sent yet?
 *
 * The single most important rule in this file. A message before acceptance is
 * either impossible (LinkedIn) or invisible (Meta Message Requests), so
 * attempting it wastes the one shot the customer has at that person.
 */
export function canMessage(state: SocialState): boolean {
  return state === "ACCEPTED" || state === "MESSAGED" || state === "REPLIED";
}

/** Can an invite be sent? Only from a standing start, or after a withdrawal. */
export function canInvite(state: SocialState): boolean {
  return state === "NOT_CONNECTED" || state === "WITHDRAWN";
}

/**
 * A declined invite is terminal for the platform.
 *
 * LinkedIn hides "ignore" from the sender, but a withdrawn-and-resent invite to
 * someone who already declined is exactly the behaviour that gets an account
 * restricted. The product does not retry it.
 */
export function isTerminal(state: SocialState): boolean {
  return state === "DECLINED" || state === "BLOCKED";
}

export type SocialCapacity = {
  /** Remaining today and this week, after what has already been used. */
  connectsLeftToday: number;
  connectsLeftThisWeek: number;
  messagesLeftToday: number;
  notesLeftThisMonth: number;
  /** Null when nothing is blocking; otherwise the sentence to show. */
  blockedReason: string | null;
};

export type SocialUsage = {
  connectsToday: number;
  connectsThisWeek: number;
  messagesToday: number;
  notesThisMonth: number;
};

/**
 * What the account can still do right now.
 *
 * Returns remaining capacity on every axis rather than a boolean, because the
 * useful answer to "why is my campaign slow" is "you have 3 invites left today
 * and 0 notes left this month", not "blocked".
 */
export function socialCapacity(
  limits: SocialLimits,
  usage: SocialUsage,
): SocialCapacity {
  const connectsLeftToday = Math.max(0, limits.dailyConnects - usage.connectsToday);
  const connectsLeftThisWeek = Math.max(0, limits.weeklyConnects - usage.connectsThisWeek);
  const messagesLeftToday = Math.max(0, limits.dailyMessages - usage.messagesToday);
  const notesLeftThisMonth = Math.max(0, limits.monthlyNotes - usage.notesThisMonth);

  let blockedReason: string | null = null;
  if (connectsLeftThisWeek === 0) {
    blockedReason =
      "This account has used its connection requests for the week. It resets on a rolling 7-day window.";
  } else if (connectsLeftToday === 0) {
    blockedReason = "This account has used its connection requests for today.";
  }

  return {
    connectsLeftToday: Math.min(connectsLeftToday, connectsLeftThisWeek),
    connectsLeftThisWeek,
    messagesLeftToday,
    notesLeftThisMonth,
    blockedReason,
  };
}

/**
 * Should this invite carry a personalised note?
 *
 * A note roughly doubles acceptance, so it is worth using — but a free account
 * has very few, and burning them on low-grade prospects is the wrong trade. The
 * answer degrades to a bare invite rather than refusing to send, because an
 * invite without a note still works.
 */
export function shouldAttachNote(
  capacity: SocialCapacity,
  platform: SocialPlatform,
): { attach: boolean; reason: string | null } {
  if (platform !== "LINKEDIN") {
    // Only LinkedIn has an invitation note. On the others the first message is
    // the note, and it cannot be sent until the follow is reciprocated.
    return { attach: false, reason: "This platform has no invitation note." };
  }
  if (capacity.notesLeftThisMonth <= 0) {
    return {
      attach: false,
      reason:
        "No invitation notes left this month on this account — the invite will be sent without one, which is still allowed.",
    };
  }
  return { attach: true, reason: null };
}

/** Invitation notes are hard-capped by the platform, not by us. */
export const MAX_INVITE_NOTE_CHARS = 300;
export const MAX_SOCIAL_MESSAGE_CHARS = 1900;
