/**
 * Outcome features per outbound message (brief §61). Pure.
 *
 * What a message WAS, recorded on `messages.features` (0131) when it is
 * queued, so outcomes (a positive reply, a booking, a win, an opt-out) can be
 * compared across message families later. The outcome itself is never copied
 * here: it is joined from the lead and its replies at read time, so there is
 * one source of truth for it.
 *
 * Only structural facts: no message text, no personal data. Workspace-level:
 * nothing here is pooled across workspaces.
 */

import type { QuestionMessageFeatures } from "../qualification-intelligence/types.ts";

export type MessageFamily = "FOLLOW_UP" | "AGENT_REPLY" | "REACTIVATION";
export type CtaType = "BOOKING_LINK" | "LINK" | "QUESTION" | "NONE";
export type LengthBucket = "SHORT" | "MEDIUM" | "LONG";

/**
 * v2 (design 08 §B.15) adds the question-level features the qualification
 * engine planned (`QuestionMessageFeatures`): the question intent, its
 * dimension and wording family, its 1-based position in the conversation, the
 * intent state and goal at send time, the offer, the NBA action and the engine
 * version. All null on a message the engine did not plan. v1 rows (before
 * 2026-09-26) lack these keys; readers treat a missing key as null.
 */
export type MessageFeatures = QuestionMessageFeatures & {
  v: 2;
  family: MessageFamily;
  /** The step / template / campaign the copy came from. */
  templateId: string | null;
  cta: CtaType;
  length: LengthBucket;
  channel: string;
  step: number | null;
  /** Local hour 0-23 and weekday 0 (Sun) - 6 in the workspace's timezone. */
  hour: number;
  dow: number;
  archetype: string | null;
  motion: string | null;
  method: string | null;
  /** Lead grade A-D at send time, when scored. */
  scoreBand: string | null;
  experimentId: string | null;
  arm: string | null;
};

const BOOKING_HINT = /\b(calendly\.com|cal\.com|book|booking|schedule|appointment|meeting)\b/i;

export function ctaType(body: string): CtaType {
  const link = /https?:\/\/\S+/i.exec(body);
  if (link) return BOOKING_HINT.test(link[0]) || BOOKING_HINT.test(body) ? "BOOKING_LINK" : "LINK";
  if (/\?/.test(body)) return "QUESTION";
  return "NONE";
}

export function lengthBucket(body: string): LengthBucket {
  const n = body.trim().length;
  if (n < 160) return "SHORT";
  if (n < 400) return "MEDIUM";
  return "LONG";
}

/** Local hour and weekday. An invalid timezone falls back to UTC. */
export function localHourDow(at: Date, timeZone: string | null | undefined): { hour: number; dow: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || "UTC",
      hour: "numeric",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? at.getUTCHours());
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    return { hour: hour % 24, dow: dow >= 0 ? dow : at.getUTCDay() };
  } catch {
    return { hour: at.getUTCHours(), dow: at.getUTCDay() };
  }
}

export function buildMessageFeatures(input: {
  family: MessageFamily;
  body: string;
  channel: string;
  sendAt: Date;
  timeZone?: string | null;
  templateId?: string | null;
  step?: number | null;
  archetype?: string | null;
  motion?: string | null;
  method?: string | null;
  scoreBand?: string | null;
  experimentId?: string | null;
  arm?: string | null;
  /** Set when the qualification engine planned this message. */
  question?: Partial<QuestionMessageFeatures> | null;
}): MessageFeatures {
  const { hour, dow } = localHourDow(input.sendAt, input.timeZone);
  const q = input.question ?? {};
  return {
    v: 2,
    family: input.family,
    templateId: input.templateId ?? null,
    cta: ctaType(input.body),
    length: lengthBucket(input.body),
    channel: input.channel,
    step: input.step ?? null,
    hour,
    dow,
    archetype: input.archetype ?? null,
    motion: input.motion ?? null,
    method: input.method ?? null,
    scoreBand: input.scoreBand ?? null,
    experimentId: input.experimentId ?? null,
    arm: input.arm ?? null,
    questionIntent: q.questionIntent ?? null,
    dimension: q.dimension ?? null,
    wordingFamily: q.wordingFamily ?? null,
    questionPosition: q.questionPosition ?? null,
    intentState: q.intentState ?? null,
    goal: q.goal ?? null,
    offerId: q.offerId ?? null,
    nbaAction: q.nbaAction ?? null,
    strategyVersion: q.strategyVersion ?? null,
  };
}
