/**
 * Re-engagement outcome metrics, per loop (pure).
 *
 * What matters is what a loop produced, not how many people answered it:
 * meetings booked, sales won (and their value), and what it cost -- opt-outs
 * and complaints, SMS segments and AI tokens. Reply rate is reported, but it
 * is never used to rank a loop: a loop that gets replies and no meetings is
 * not working.
 *
 * Attribution is last touch within a window: an outcome (a booking, a win, a
 * reply, an opt-out) at time T is credited to the most recent automated touch
 * to that lead sent at or before T and no more than `attributionDays` earlier.
 * Each lead counts once per outcome per loop.
 *
 * Pure: no Supabase, no `server-only`.
 */

import { LOOP_KEYS, LOOP_LABEL, type LoopKey } from "./triggers.ts";

export const ATTRIBUTION_DAYS = 30;

export type LoopTouch = {
  loop: LoopKey;
  leadId: string;
  sentAt: string;
  channel: string;
  /** SMS segments this message used (0 for any other channel). */
  smsSegments: number;
  /** AI tokens spent composing it (agent turns, personalisation); 0 when none. */
  tokens: number;
  /** An email complaint recorded against this message. */
  complained?: boolean;
};

export type LeadOutcomeEvents = {
  leadId: string;
  /** Every meeting booked for the lead (created time), cancelled ones excluded. */
  bookedAt: string[];
  /** Deals won: when, and the value in major units. */
  won: { at: string; value: number }[];
  /** Inbound messages: when, and the reply classification. */
  inbound: { at: string; classification: string | null }[];
};

export type LoopOutcome = {
  loop: LoopKey;
  label: string;
  leadsReached: number;
  messagesSent: number;
  meetings: number;
  sales: number;
  salesValue: number;
  optOuts: number;
  complaints: number;
  replies: number;
  /** Replies / leads reached. Shown last; never used to rank. */
  replyRate: number | null;
  smsSegments: number;
  tokens: number;
};

const OPT_OUT = new Set(["UNSUBSCRIBE", "OPT_OUT", "STOP"]);
const COMPLAINT = new Set(["COMPLAINT"]);
const NOT_A_REPLY = new Set(["AUTO_RESPONSE", "BOUNCE"]);

/**
 * The loop credited with an outcome at `at` for one lead, or null when no
 * touch precedes it inside the window.
 */
export function attributeOutcome(
  touches: readonly { loop: LoopKey; sentAt: string }[],
  at: string,
  attributionDays = ATTRIBUTION_DAYS,
): LoopKey | null {
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return null;
  const windowMs = attributionDays * 86_400_000;
  let best: { loop: LoopKey; ms: number } | null = null;
  for (const touch of touches) {
    const ms = Date.parse(touch.sentAt);
    if (!Number.isFinite(ms) || ms > when || when - ms > windowMs) continue;
    if (!best || ms > best.ms) best = { loop: touch.loop, ms };
  }
  return best?.loop ?? null;
}

/**
 * Per-loop outcomes, ranked by what they produced: sales value, then sales,
 * then meetings, then fewest opt-outs. Loops with no touches in the period
 * are left out.
 */
export function computeLoopOutcomes(input: {
  touches: readonly LoopTouch[];
  leads: readonly LeadOutcomeEvents[];
  attributionDays?: number;
}): LoopOutcome[] {
  const days = input.attributionDays ?? ATTRIBUTION_DAYS;
  const rows = new Map<LoopKey, LoopOutcome & { reached: Set<string> }>();
  const row = (loop: LoopKey) => {
    let entry = rows.get(loop);
    if (!entry) {
      entry = {
        loop,
        label: LOOP_LABEL[loop],
        leadsReached: 0,
        messagesSent: 0,
        meetings: 0,
        sales: 0,
        salesValue: 0,
        optOuts: 0,
        complaints: 0,
        replies: 0,
        replyRate: null,
        smsSegments: 0,
        tokens: 0,
        reached: new Set<string>(),
      };
      rows.set(loop, entry);
    }
    return entry;
  };

  const byLead = new Map<string, LoopTouch[]>();
  for (const touch of input.touches) {
    const entry = row(touch.loop);
    entry.messagesSent += 1;
    entry.smsSegments += Math.max(0, touch.smsSegments);
    entry.tokens += Math.max(0, touch.tokens);
    if (touch.complained) entry.complaints += 1;
    entry.reached.add(touch.leadId);
    const list = byLead.get(touch.leadId) ?? [];
    list.push(touch);
    byLead.set(touch.leadId, list);
  }

  for (const lead of input.leads) {
    const touches = byLead.get(lead.leadId);
    if (!touches?.length) continue;
    // Each lead counts once per outcome per loop.
    const credited = { meetings: new Set<LoopKey>(), sales: new Set<LoopKey>(), replies: new Set<LoopKey>(), optOuts: new Set<LoopKey>(), complaints: new Set<LoopKey>() };

    for (const at of lead.bookedAt) {
      const loop = attributeOutcome(touches, at, days);
      if (loop && !credited.meetings.has(loop)) {
        credited.meetings.add(loop);
        row(loop).meetings += 1;
      }
    }
    for (const win of lead.won) {
      const loop = attributeOutcome(touches, win.at, days);
      if (!loop) continue;
      row(loop).salesValue += Math.max(0, Number(win.value) || 0);
      if (!credited.sales.has(loop)) {
        credited.sales.add(loop);
        row(loop).sales += 1;
      }
    }
    for (const message of lead.inbound) {
      const loop = attributeOutcome(touches, message.at, days);
      if (!loop) continue;
      const classification = (message.classification ?? "").toUpperCase();
      // An out-of-office or a bounce is not a person answering.
      if (NOT_A_REPLY.has(classification)) continue;
      if (OPT_OUT.has(classification)) {
        if (!credited.optOuts.has(loop)) {
          credited.optOuts.add(loop);
          row(loop).optOuts += 1;
        }
      } else if (COMPLAINT.has(classification)) {
        if (!credited.complaints.has(loop)) {
          credited.complaints.add(loop);
          row(loop).complaints += 1;
        }
      }
      if (!credited.replies.has(loop)) {
        credited.replies.add(loop);
        row(loop).replies += 1;
      }
    }
  }

  const out: LoopOutcome[] = [];
  for (const entry of rows.values()) {
    const { reached, ...rest } = entry;
    rest.leadsReached = reached.size;
    rest.replyRate = reached.size > 0 ? rest.replies / reached.size : null;
    rest.salesValue = Math.round(rest.salesValue * 100) / 100;
    out.push(rest);
  }

  // Ranked on outcomes. Reply rate deliberately plays no part.
  return out.sort(
    (a, b) =>
      b.salesValue - a.salesValue ||
      b.sales - a.sales ||
      b.meetings - a.meetings ||
      a.optOuts + a.complaints - (b.optOuts + b.complaints) ||
      LOOP_KEYS.indexOf(a.loop) - LOOP_KEYS.indexOf(b.loop),
  );
}

/** Meetings per 100 leads reached: the headline rate, if anything is. */
export function meetingsPer100(outcome: Pick<LoopOutcome, "meetings" | "leadsReached">): number | null {
  return outcome.leadsReached > 0 ? (outcome.meetings / outcome.leadsReached) * 100 : null;
}
