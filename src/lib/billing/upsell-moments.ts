/**
 * Upsell moments: WHEN to suggest an AI token pack, WhatsApp tokens or a
 * higher tier, and in what form. The analysis and the verdicts are in
 * docs/upsell-plan.md; this file is the rules.
 *
 * Owner (2026-09-27): "be careful as it can annoy customers". So:
 *
 *   * owner and admin only, never in a trial (it has its own prompt), never
 *     on a workspace that is not a working paid subscription;
 *   * never mid-task (composer, onboarding, checkout);
 *   * one suggestion per page, the most useful one;
 *   * banners and inline cards by default; a modal only for an immediate
 *     blocker (the AI is paused, a lead is waiting on WhatsApp), only on the
 *     Dashboard, at most one modal per user per 7 days and one per offer per
 *     30 days;
 *   * dismiss = snooze that moment for 30 days; a recent purchase of the same
 *     offer hides it for 30 days;
 *   * while a running-low / dunning / trial notice shows (allowance-alerts,
 *     limits-service `getBillingNotice`), only the blockers show, as banners,
 *     so the two never disagree;
 *   * an owner setting turns every suggestion off.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports, so the loader,
 * the UI and the tests decide the same thing. Every price and size comes from
 * the catalogue (plans.ts, tokens.ts, whatsapp-tokens.ts).
 */

import { recommendBundle } from "./allowance-alerts.ts";
import { upsellFor } from "./limits.ts";
import {
  MESSAGE_CREDIT_BUNDLES,
  PLANS,
  nextPlanFor,
  planThatUnlocks,
  type MessageCreditBundle,
  type PlanDefinition,
} from "./plans.ts";
import { TOKEN_PACKS, TOKEN_WARN_PERCENT, type TokenPack } from "./tokens.ts";
import { WHATSAPP_TOKENS_PER_MESSAGE } from "./whatsapp-tokens.ts";

/* -------------------------------------------------------------- the model */

export type UpsellOffer = "ai_token_pack" | "whatsapp_tokens" | "tier_upgrade";
export type UpsellSurface = "modal" | "banner" | "card";
export type UpsellEventKind = "impression" | "click" | "dismiss" | "purchase";

export const UPSELL_MOMENTS = [
  "ai_paused",
  "whatsapp_lead_waiting",
  "lead_cap_repeated",
  "lead_cap_approaching",
  "ai_tokens_low",
  "prospects_cap",
  "seats_full",
  "usage_projection",
  "bookings_milestone",
] as const;
export type UpsellMomentKey = (typeof UPSELL_MOMENTS)[number];

export function isUpsellMomentKey(value: string): value is UpsellMomentKey {
  return (UPSELL_MOMENTS as readonly string[]).includes(value);
}

/** Higher wins. Blockers first, the positive milestone last. */
export const MOMENT_PRIORITY: Record<UpsellMomentKey, number> = {
  ai_paused: 100,
  whatsapp_lead_waiting: 90,
  lead_cap_repeated: 70,
  lead_cap_approaching: 60,
  ai_tokens_low: 55,
  prospects_cap: 50,
  seats_full: 45,
  usage_projection: 40,
  bookings_milestone: 20,
};

/** Only these may ever be a modal: something is actually stopped. */
export const BLOCKER_MOMENTS: readonly UpsellMomentKey[] = ["ai_paused", "whatsapp_lead_waiting"];

export const MODAL_USER_WINDOW_DAYS = 7;
export const MODAL_OFFER_WINDOW_DAYS = 30;
export const SNOOZE_DAYS = 30;
export const PURCHASE_QUIET_DAYS = 30;
/** A purchase is credited to a click on the same offer within this window. */
export const ATTRIBUTION_DAYS = 7;
/** A WhatsApp request or message counts as "waiting" for this long. */
export const WHATSAPP_WAITING_DAYS = 7;
/** Lead cap thresholds. */
export const LEAD_WARN_PERCENT = 80;
export const LEAD_URGENT_PERCENT = 95;
/** A projection is not trusted before this many days of a period. */
export const PROJECTION_MIN_DAYS = 7;
export const BOOKING_MILESTONES = [10, 25, 50, 100] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Roles that may see a suggestion. Only the owner can pay. */
export function canSeeUpsells(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Where the suggestion would render. Mid-task surfaces get nothing. */
export type UpsellContext = "dashboard" | "lead" | "billing" | "composer" | "onboarding" | "checkout";
const MID_TASK: readonly UpsellContext[] = ["composer", "onboarding", "checkout"];

/* ------------------------------------------------------ WhatsApp request */

/**
 * Whether an inbound message asks to move to WhatsApp ("can I WhatsApp
 * you?", "are you on whatsapp", "message me on WA"). Deterministic and
 * deliberately narrow: a false positive is a needless suggestion.
 */
export function mentionsWhatsapp(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/\bwhats\s?app\b|\bwhatsapp(?:ed|ing)?\b/.test(lower)) return true;
  // "WA" alone is too ambiguous; only with a messaging verb around it.
  return /\b(?:on|via|over)\s+wa\b/.test(lower);
}

/* ------------------------------------------------------------ the facts */

export type UpsellHistoryEvent = {
  moment: string;
  offer: string;
  surface: string;
  event: UpsellEventKind | string;
  userId: string | null;
  createdAt: string;
};

export type UpsellFacts = {
  now: Date;
  context: UpsellContext;
  role: string;
  userId: string;
  /** Owner setting "Show me upgrade suggestions". Default on. */
  suggestionsEnabled: boolean;
  plan: string;
  /** Lifecycle state (lifecycle.ts). Only ACTIVE shows anything. */
  state: string;
  billingInterval: "month" | "year";
  /** A billing notice (running low, dunning, trial ending) is showing. */
  billingNoticeActive: boolean;
  periodStart: string;
  periodEnd: string | null;
  leads: { used: number; limit: number; previousPeriodUsed: number | null };
  aiTokens: { state: "HEALTHY" | "APPROACHING" | "CRITICAL" | "EXHAUSTED"; percentUsed: number } | null;
  seats: { used: number; limit: number };
  prospects: { used: number; limit: number } | null;
  whatsapp: {
    /** The plan allows the WhatsApp add-on. */
    planAllows: boolean;
    /** WhatsApp tokens left. */
    tokens: number;
    /** WhatsApp tokens used this period, for the pack recommendation. */
    usedThisPeriod: number;
    /** The most recent lead waiting on WhatsApp in the window, if any. */
    waitingLead: { id: string; name: string; at: string } | null;
  };
  bookingsThisPeriod: number;
  /** This user's (and the workspace's purchase) history, last 30+ days. */
  history: readonly UpsellHistoryEvent[];
};

/* -------------------------------------------------------- the decision */

export type UpsellCta =
  | { kind: "token_pack"; pack: TokenPack }
  | { kind: "whatsapp_pack"; bundle: MessageCreditBundle }
  | { kind: "upgrade"; plan: PlanDefinition; interval: "month" | "year" }
  | { kind: "contact_sales" };

export type UpsellMoment = {
  key: UpsellMomentKey;
  offer: UpsellOffer;
  surface: UpsellSurface;
  title: string;
  body: string;
  cta: UpsellCta;
  /** For a milestone: which one, so each is snoozed on its own. */
  variant?: string;
  leadId?: string;
};

export type UpsellDecision =
  | { show: true; moment: UpsellMoment; suppressed: UpsellMomentKey[] }
  | {
      show: false;
      reason: "setting_off" | "role" | "trial" | "not_active" | "mid_task" | "nothing_due";
      suppressed: UpsellMomentKey[];
    };

const NUMBER = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

function within(at: string, now: Date, days: number): boolean {
  const t = new Date(at).getTime();
  return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t < days * DAY_MS;
}

export function priceText(plan: PlanDefinition, interval: "month" | "year"): string {
  const price = interval === "year" ? plan.yearlyPrice : plan.monthlyPrice;
  return price == null ? "contact sales" : `${GBP.format(price)} a ${interval}`;
}

function tierCta(plan: string, interval: "month" | "year"): UpsellCta | null {
  const next = nextPlanFor(plan);
  if (!next) return null;
  if (next === "enterprise") return { kind: "contact_sales" };
  return { kind: "upgrade", plan: PLANS[next], interval };
}

function nextName(plan: string): string | null {
  const next = nextPlanFor(plan);
  return next ? PLANS[next].name : null;
}

/** The smallest WhatsApp token pack that covers this period's pace. */
export function recommendedWhatsappPack(input: {
  usedThisPeriod: number;
  remaining: number;
  periodStart: string;
  periodEnd: string | null;
  now: Date;
}): MessageCreditBundle | null {
  const start = new Date(input.periodStart).getTime();
  const end = input.periodEnd ? new Date(input.periodEnd).getTime() : start + 30 * DAY_MS;
  const elapsed = Math.max(1, (input.now.getTime() - start) / DAY_MS);
  const left = Math.max(0, (end - input.now.getTime()) / DAY_MS);
  const shortfall = Math.max(0, Math.ceil((input.usedThisPeriod / elapsed) * left - input.remaining));
  return recommendBundle({ channel: "whatsapp", shortfall, bundles: MESSAGE_CREDIT_BUNDLES });
}

/** Every moment whose trigger holds, before caps. Pure and ordered by priority. */
export function candidateMoments(facts: UpsellFacts): UpsellMoment[] {
  const out: UpsellMoment[] = [];
  const next = nextName(facts.plan);
  const tier = tierCta(facts.plan, facts.billingInterval);
  const tierPrice =
    tier?.kind === "upgrade" ? ` (${priceText(tier.plan, tier.interval)})` : "";

  // 1. AI paused / 2. AI running low: token packs.
  if (facts.aiTokens?.state === "EXHAUSTED") {
    out.push({
      key: "ai_paused",
      offer: "ai_token_pack",
      surface: "modal",
      title: "Your AI assistant is paused: its tokens are used up",
      body:
        "Follow-up and qualification rules keep running, but the assistant will not reply to leads until you add AI tokens or your allowance resets. A top up pack restores it straight away.",
      cta: { kind: "token_pack", pack: TOKEN_PACKS.top_up_medium },
    });
  } else if (facts.aiTokens && facts.aiTokens.percentUsed >= TOKEN_WARN_PERCENT) {
    out.push({
      key: "ai_tokens_low",
      offer: "ai_token_pack",
      surface: "banner",
      title: `AI tokens are ${facts.aiTokens.percentUsed}% used`,
      body:
        "When they run out the assistant pauses until your allowance resets. A top up pack keeps it replying; bought tokens never expire.",
      cta: { kind: "token_pack", pack: TOKEN_PACKS.top_up_small },
    });
  }

  // 3. A lead is waiting on WhatsApp and WhatsApp cannot be sent.
  const waiting = facts.whatsapp.waitingLead;
  if (waiting && within(waiting.at, facts.now, WHATSAPP_WAITING_DAYS)) {
    if (!facts.whatsapp.planAllows) {
      const unlock = planThatUnlocks("whatsapp");
      if (unlock && tier) {
        out.push({
          key: "whatsapp_lead_waiting",
          offer: "tier_upgrade",
          surface: "modal",
          leadId: waiting.id,
          title: `${waiting.name} wants to talk on WhatsApp`,
          body: `WhatsApp is available on ${unlock.name} and above, paid in WhatsApp tokens. Upgrade to reply to ${waiting.name} there.`,
          cta: tier,
        });
      }
    } else if (facts.whatsapp.tokens < WHATSAPP_TOKENS_PER_MESSAGE.SERVICE) {
      const bundle = recommendedWhatsappPack({
        usedThisPeriod: facts.whatsapp.usedThisPeriod,
        remaining: facts.whatsapp.tokens,
        periodStart: facts.periodStart,
        periodEnd: facts.periodEnd,
        now: facts.now,
      });
      if (bundle) {
        out.push({
          key: "whatsapp_lead_waiting",
          offer: "whatsapp_tokens",
          surface: "modal",
          leadId: waiting.id,
          title: `${waiting.name} wants to talk on WhatsApp`,
          body: `Your workspace has no WhatsApp tokens, so WhatsApp messages cannot go out. Add WhatsApp tokens to reply to ${waiting.name} there.`,
          cta: { kind: "whatsapp_pack", bundle },
        });
      }
    }
  }

  // 4 / 5. Lead cap. Only when the next tier genuinely raises it.
  const leadOffer = upsellFor({
    metric: "leads",
    plan: facts.plan,
    used: facts.leads.used,
    limit: facts.leads.limit,
  });
  const leadPercent = facts.leads.limit > 0 ? (facts.leads.used / facts.leads.limit) * 100 : 0;
  if (tier && leadOffer?.upgrade && leadPercent >= LEAD_WARN_PERCENT) {
    const repeated =
      facts.leads.previousPeriodUsed != null && facts.leads.previousPeriodUsed >= facts.leads.limit;
    const newLimit = NUMBER.format(leadOffer.upgrade.newLimit);
    out.push(
      repeated
        ? {
            key: "lead_cap_repeated",
            offer: "tier_upgrade",
            surface: "banner",
            title: `Two months at your lead cap`,
            body: `You reached ${NUMBER.format(facts.leads.limit)} new leads last period and are at ${Math.round(leadPercent)}% this one. ${next} includes ${newLimit} a month${tierPrice}. Leads are never dropped for a limit.`,
            cta: tier,
          }
        : {
            key: "lead_cap_approaching",
            offer: "tier_upgrade",
            surface: "banner",
            variant: leadPercent >= LEAD_URGENT_PERCENT ? "95" : "80",
            title: `${Math.round(leadPercent)}% of this period's ${NUMBER.format(facts.leads.limit)} new leads used`,
            body: `${next} includes ${newLimit} new leads a month${tierPrice}. Leads are never dropped for a limit.`,
            cta: tier,
          },
    );
  }

  // 7. Find Leads prospects allowance reached.
  if (tier && facts.prospects && facts.prospects.limit > 0 && facts.prospects.used >= facts.prospects.limit) {
    out.push({
      key: "prospects_cap",
      offer: "tier_upgrade",
      surface: "banner",
      title: "This period's verified prospects are used",
      body: `Find Leads stops sourcing until the next period. ${next ?? "A higher plan"} includes more verified prospects${tierPrice}.`,
      cta: tier,
    });
  }

  // 6. Seats full, only when the next tier adds seats.
  const seatOffer = upsellFor({ metric: "users", plan: facts.plan, used: facts.seats.used, limit: facts.seats.limit });
  if (tier && seatOffer?.upgrade && facts.seats.used >= facts.seats.limit) {
    out.push({
      key: "seats_full",
      offer: "tier_upgrade",
      surface: "banner",
      title: `All ${NUMBER.format(facts.seats.limit)} team seats are in use`,
      body: `${next} includes ${NUMBER.format(seatOffer.upgrade.newLimit)} users${tierPrice}.`,
      cta: tier,
    });
  }

  // 11. The trend projects over the cap, while usage is still under 80%.
  const start = new Date(facts.periodStart).getTime();
  const end = facts.periodEnd ? new Date(facts.periodEnd).getTime() : start + 30 * DAY_MS;
  const elapsed = (facts.now.getTime() - start) / DAY_MS;
  const length = Math.max(1, (end - start) / DAY_MS);
  if (tier && leadOffer === null && facts.leads.limit > 0 && elapsed >= PROJECTION_MIN_DAYS) {
    const projected = Math.round((facts.leads.used / elapsed) * length);
    const nextPlan = nextPlanFor(facts.plan);
    const nextLimit = nextPlan ? PLANS[nextPlan].leadLimit : 0;
    if (projected > facts.leads.limit && nextLimit > facts.leads.limit) {
      out.push({
        key: "usage_projection",
        offer: "tier_upgrade",
        surface: "banner",
        title: `On this pace you'll reach about ${NUMBER.format(projected)} new leads this period`,
        body: `Your plan includes ${NUMBER.format(facts.leads.limit)}. ${next} includes ${NUMBER.format(nextLimit)}${tierPrice}. Leads are never dropped for a limit.`,
        cta: tier,
      });
    }
  }

  // 9. A positive moment: a soft mention, never a push.
  const milestone = [...BOOKING_MILESTONES].reverse().find((m) => facts.bookingsThisPeriod >= m);
  if (milestone && tier) {
    out.push({
      key: "bookings_milestone",
      offer: "tier_upgrade",
      surface: "card",
      variant: String(milestone),
      title: `You booked ${NUMBER.format(milestone)} meetings this period`,
      body: next
        ? `Nice work. If volume keeps growing, ${next} gives you more leads, users and AI tokens.`
        : "Nice work.",
      cta: tier,
    });
  }

  return out.sort((a, b) => MOMENT_PRIORITY[b.key] - MOMENT_PRIORITY[a.key]);
}

/** Snooze identity: a milestone is snoozed per milestone, everything else per moment. */
export function momentId(moment: { key: string; variant?: string }): string {
  return moment.key === "bookings_milestone" && moment.variant ? `${moment.key}:${moment.variant}` : moment.key;
}

export function isSnoozed(momentKey: string, userId: string, history: readonly UpsellHistoryEvent[], now: Date): boolean {
  return history.some(
    (e) => e.event === "dismiss" && e.moment === momentKey && e.userId === userId && within(e.createdAt, now, SNOOZE_DAYS),
  );
}

export function recentlyPurchased(offer: UpsellOffer, history: readonly UpsellHistoryEvent[], now: Date): boolean {
  return history.some((e) => e.event === "purchase" && e.offer === offer && within(e.createdAt, now, PURCHASE_QUIET_DAYS));
}

/** Whether a modal is allowed for this offer and user right now. */
export function modalAllowed(offer: UpsellOffer, userId: string, history: readonly UpsellHistoryEvent[], now: Date): boolean {
  const modals = history.filter((e) => e.event === "impression" && e.surface === "modal" && e.userId === userId);
  if (modals.some((e) => within(e.createdAt, now, MODAL_USER_WINDOW_DAYS))) return false;
  if (modals.some((e) => e.offer === offer && within(e.createdAt, now, MODAL_OFFER_WINDOW_DAYS))) return false;
  return true;
}

export function decideUpsellMoment(facts: UpsellFacts): UpsellDecision {
  if (!facts.suggestionsEnabled) return { show: false, reason: "setting_off", suppressed: [] };
  if (!canSeeUpsells(facts.role)) return { show: false, reason: "role", suppressed: [] };
  if (facts.plan === "trial" || facts.state === "TRIALING") return { show: false, reason: "trial", suppressed: [] };
  if (facts.state !== "ACTIVE") return { show: false, reason: "not_active", suppressed: [] };
  if (MID_TASK.includes(facts.context)) return { show: false, reason: "mid_task", suppressed: [] };

  const suppressed: UpsellMomentKey[] = [];
  for (const candidate of candidateMoments(facts)) {
    const blocker = BLOCKER_MOMENTS.includes(candidate.key);
    const drop =
      isSnoozed(momentId(candidate), facts.userId, facts.history, facts.now) ||
      recentlyPurchased(candidate.offer, facts.history, facts.now) ||
      // One billing message at a time: a running-low / dunning notice owns
      // the moment, only a genuine blocker may sit alongside it.
      (facts.billingNoticeActive && !blocker) ||
      // The lead page: only that lead's WhatsApp wait and the AI pause.
      (facts.context === "lead" && !blocker);
    if (drop) {
      suppressed.push(candidate.key);
      continue;
    }

    let surface = candidate.surface;
    if (surface === "modal") {
      const modalHere = facts.context === "dashboard" && !facts.billingNoticeActive;
      if (!modalHere || !modalAllowed(candidate.offer, facts.userId, facts.history, facts.now)) surface = "banner";
    }
    // Inline cards live on the Dashboard only.
    if (surface === "card" && facts.context !== "dashboard") {
      suppressed.push(candidate.key);
      continue;
    }
    return { show: true, moment: { ...candidate, surface }, suppressed };
  }
  return { show: false, reason: "nothing_due", suppressed };
}

/* ------------------------------------------------------- impressions etc */

/** One impression per user, moment and surface per day is enough for analytics. */
export function shouldRecordImpression(input: {
  moment: string;
  surface: string;
  userId: string;
  history: readonly UpsellHistoryEvent[];
  now: Date;
}): boolean {
  return !input.history.some(
    (e) =>
      e.event === "impression" &&
      e.moment === input.moment &&
      e.surface === input.surface &&
      e.userId === input.userId &&
      within(e.createdAt, input.now, 1),
  );
}

/**
 * The click a purchase is credited to: the latest click on the same offer in
 * the last ATTRIBUTION_DAYS, or null (an organic purchase, not recorded as
 * an upsell conversion).
 */
export function attributePurchase(
  offer: UpsellOffer,
  history: readonly UpsellHistoryEvent[],
  now: Date,
): UpsellHistoryEvent | null {
  return (
    history
      .filter((e) => e.event === "click" && e.offer === offer && within(e.createdAt, now, ATTRIBUTION_DAYS))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
  );
}

/* ------------------------------------------------------- billing passive */

export type PassiveAddOns = {
  tokenPacks: TokenPack[];
  /** Empty when the plan does not allow WhatsApp. */
  whatsappPacks: MessageCreditBundle[];
  /** Plan that unlocks WhatsApp, when this one does not. */
  whatsappUnlockPlan: string | null;
  next: UpsellCta | null;
};

/** What the always-there Billing card lists. Nothing in a trial (no packs are sold). */
export function passiveAddOns(input: {
  plan: string;
  state: string;
  whatsappEnabled: boolean;
  billingInterval: "month" | "year";
  tokenPacks: readonly TokenPack[];
}): PassiveAddOns | null {
  if (input.plan === "trial" || input.state === "TRIALING") return null;
  return {
    tokenPacks: [...input.tokenPacks],
    whatsappPacks: input.whatsappEnabled ? MESSAGE_CREDIT_BUNDLES.filter((b) => b.channel === "whatsapp") : [],
    whatsappUnlockPlan: input.whatsappEnabled ? null : (planThatUnlocks("whatsapp")?.name ?? null),
    next: tierCta(input.plan, input.billingInterval),
  };
}
