/**
 * Question performance: the read model (design 08 §17, §B.15). Pure.
 *
 * Every outbound question the qualification engine planned carries its
 * question features on `messages.features` (MessageFeatures v2). Outcomes are
 * never copied onto the message; they are joined here, at read time, from the
 * lead's own later activity, so there is one source of truth for each:
 *
 *   response            an inbound message within 72 h of the question
 *   meaningful answer   a fact whose source_ref is that inbound message and
 *                       whose dimension is the one asked (CD-15 write-back)
 *   drop-off            no inbound message within 7 days
 *   progression         the lead qualified (threshold met) after the question
 *   booking / win       booked_at / won_at after the question
 *   opt-out             an UNSUBSCRIBE / COMPLAINT reply within 7 days
 *                       (a negative constraint, as in experiments.ts)
 *
 * Ranking never uses replies (§63, D10): rows are ordered by booking rate,
 * then progression, then meaningful answers. The response rate is shown for
 * diagnosis only. Any slice with fewer than LOW_SAMPLE_N questions carries a
 * low-sample flag (the v4-metrics convention) and its rates are shown with
 * Wilson intervals, never as a bare percentage.
 *
 * Workspace-level only: inputs are one workspace's rows.
 */

import { wilson, type Interval } from "../learning/experiments.ts";

export const RESPONSE_WINDOW_HOURS = 72;
export const DROP_OFF_DAYS = 7;
export const OPT_OUT_WINDOW_DAYS = 7;
export const LOW_SAMPLE_N = 30;

export const QUESTION_SLICES = [
  "intent",
  "dimension",
  "wordingFamily",
  "position",
  "channel",
  "intentState",
  "archetype",
  "offer",
  "industry",
] as const;
export type QuestionSlice = (typeof QUESTION_SLICES)[number];

/** One question the engine planned and sent. */
export type QuestionSend = {
  messageId: string;
  leadId: string;
  sentAt: string;
  channel: string;
  questionIntent: string | null;
  dimension: string | null;
  wordingFamily: string | null;
  questionPosition: number | null;
  intentState: string | null;
  offerId: string | null;
  archetype: string | null;
  /** SIC section or industry label of the lead's company, when known. */
  industry: string | null;
};

export type InboundReply = {
  messageId: string;
  leadId: string;
  at: string;
  /** messages.reply_classification, when set. */
  classification: string | null;
};

/** A fact written back from an inbound reply (lead_qualification_facts). */
export type FactEvidence = {
  leadId: string;
  /** The inbound message id (source_ref). */
  sourceRef: string | null;
  dimension: string;
};

export type LeadOutcome = {
  leadId: string;
  qualifiedAt: string | null;
  bookedAt: string | null;
  wonAt: string | null;
};

export type QuestionPerformanceRow = {
  slice: QuestionSlice;
  key: string;
  sent: number;
  lowSample: boolean;
  response: Interval;
  meaningfulAnswer: Interval;
  dropOff: Interval;
  progression: Interval;
  booking: Interval;
  win: Interval;
  optOut: Interval;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPT_OUT = new Set(["UNSUBSCRIBE", "COMPLAINT"]);

function sliceKey(send: QuestionSend, slice: QuestionSlice): string {
  const value = (() => {
    switch (slice) {
      case "intent":
        return send.questionIntent;
      case "dimension":
        return send.dimension;
      case "wordingFamily":
        return send.wordingFamily;
      case "position":
        return send.questionPosition === null ? null : send.questionPosition >= 5 ? "5+" : String(send.questionPosition);
      case "channel":
        return send.channel;
      case "intentState":
        return send.intentState;
      case "archetype":
        return send.archetype;
      case "offer":
        return send.offerId;
      case "industry":
        return send.industry;
    }
  })();
  return value ?? "(none)";
}

type Tally = { sent: number; response: number; meaningful: number; dropOff: number; progression: number; booking: number; win: number; optOut: number };

/** The per-question outcome flags, exported so a test can check the joins. */
export function questionOutcome(
  send: QuestionSend,
  replies: readonly InboundReply[],
  facts: readonly FactEvidence[],
  outcome: LeadOutcome | undefined,
): Omit<Tally, "sent"> {
  const sent = Date.parse(send.sentAt);
  const after = (at: string | null | undefined) => Boolean(at && Date.parse(at) >= sent);
  const within = (at: string, ms: number) => {
    const t = Date.parse(at);
    return t >= sent && t - sent <= ms;
  };
  const own = replies.filter((r) => r.leadId === send.leadId);
  const responses = own.filter((r) => within(r.at, RESPONSE_WINDOW_HOURS * HOUR));
  const responseIds = new Set(responses.map((r) => r.messageId));
  const meaningful = Boolean(
    send.dimension &&
      facts.some((f) => f.leadId === send.leadId && f.sourceRef !== null && responseIds.has(f.sourceRef) && f.dimension === send.dimension),
  );
  return {
    response: responses.length > 0 ? 1 : 0,
    meaningful: meaningful ? 1 : 0,
    dropOff: own.some((r) => within(r.at, DROP_OFF_DAYS * DAY)) ? 0 : 1,
    progression: after(outcome?.qualifiedAt) ? 1 : 0,
    booking: after(outcome?.bookedAt) ? 1 : 0,
    win: after(outcome?.wonAt) ? 1 : 0,
    optOut: own.some((r) => within(r.at, OPT_OUT_WINDOW_DAYS * DAY) && OPT_OUT.has(r.classification ?? "")) ? 1 : 0,
  };
}

/**
 * Question performance for one slice. Rows are ordered by booking rate, then
 * progression, then meaningful answers; never by response rate.
 */
export function computeQuestionPerformance(input: {
  slice: QuestionSlice;
  sends: readonly QuestionSend[];
  replies: readonly InboundReply[];
  facts: readonly FactEvidence[];
  outcomes: readonly LeadOutcome[];
}): QuestionPerformanceRow[] {
  const outcomes = new Map(input.outcomes.map((o) => [o.leadId, o]));
  const tallies = new Map<string, Tally>();
  for (const send of input.sends) {
    const key = sliceKey(send, input.slice);
    const t = tallies.get(key) ?? { sent: 0, response: 0, meaningful: 0, dropOff: 0, progression: 0, booking: 0, win: 0, optOut: 0 };
    const o = questionOutcome(send, input.replies, input.facts, outcomes.get(send.leadId));
    t.sent += 1;
    t.response += o.response;
    t.meaningful += o.meaningful;
    t.dropOff += o.dropOff;
    t.progression += o.progression;
    t.booking += o.booking;
    t.win += o.win;
    t.optOut += o.optOut;
    tallies.set(key, t);
  }

  const rows: QuestionPerformanceRow[] = [...tallies.entries()].map(([key, t]) => ({
    slice: input.slice,
    key,
    sent: t.sent,
    lowSample: t.sent < LOW_SAMPLE_N,
    response: wilson(t.response, t.sent),
    meaningfulAnswer: wilson(t.meaningful, t.sent),
    dropOff: wilson(t.dropOff, t.sent),
    progression: wilson(t.progression, t.sent),
    booking: wilson(t.booking, t.sent),
    win: wilson(t.win, t.sent),
    optOut: wilson(t.optOut, t.sent),
  }));

  return rows.sort(
    (a, b) =>
      Number(a.lowSample) - Number(b.lowSample) ||
      b.booking.rate - a.booking.rate ||
      b.progression.rate - a.progression.rate ||
      b.meaningfulAnswer.rate - a.meaningfulAnswer.rate ||
      b.sent - a.sent ||
      a.key.localeCompare(b.key),
  );
}

/** Reads the v2 question features off a messages.features jsonb (v1 rows -> null). */
export function questionFeaturesOf(raw: unknown): Omit<QuestionSend, "messageId" | "leadId" | "sentAt" | "channel" | "industry"> | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (!str(f.questionIntent)) return null;
  return {
    questionIntent: str(f.questionIntent),
    dimension: str(f.dimension),
    wordingFamily: str(f.wordingFamily),
    questionPosition: typeof f.questionPosition === "number" ? f.questionPosition : null,
    intentState: str(f.intentState),
    offerId: str(f.offerId),
    archetype: str(f.archetype),
  };
}
