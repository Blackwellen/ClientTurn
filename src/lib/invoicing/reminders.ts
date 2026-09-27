/**
 * Invoice reminder schedule. Dates are calendar days (YYYY-MM-DD, UTC
 * arithmetic, no time zone drift). Offsets are days relative to the due
 * date: negative = before due, 0 = on the day, positive = overdue.
 *
 *   - A reminder is never scheduled on or before the issue date.
 *   - Weekend dates move to the next Monday (business mail), and dates that
 *     collide after the move are merged.
 *   - Only OPEN / PARTIALLY_PAID invoices are reminded.
 *   - If the job was down and several reminders are due at once, only the
 *     LATEST due one is sent and the earlier ones are skipped: a customer
 *     never gets a burst. The send itself still goes through the frequency
 *     guard (0146) and quiet hours in the job.
 */

import type { InvoiceStatus } from "./types.ts";

export const DEFAULT_REMINDER_OFFSETS = [-3, 0, 3, 7, 14] as const;

export type ReminderKind = "BEFORE_DUE" | "ON_DUE" | "OVERDUE";
export type ReminderStep = { step: number; offsetDays: number; kind: ReminderKind; sendOn: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  if (!DATE.test(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function nextWeekday(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (day === 6) return addDays(date, 2);
  if (day === 0) return addDays(date, 1);
  return date;
}

export function computeReminderSchedule(input: {
  issueDate: string;
  dueDate: string;
  offsetsDays?: readonly number[];
  skipWeekends?: boolean;
}): ReminderStep[] {
  const offsets = [...new Set(input.offsetsDays ?? DEFAULT_REMINDER_OFFSETS)].sort((a, b) => a - b);
  const steps: ReminderStep[] = [];
  const used = new Set<string>();
  for (const offset of offsets) {
    let sendOn = addDays(input.dueDate, offset);
    if (input.skipWeekends !== false) sendOn = nextWeekday(sendOn);
    if (sendOn <= input.issueDate || used.has(sendOn)) continue;
    used.add(sendOn);
    steps.push({
      step: steps.length + 1,
      offsetDays: offset,
      kind: offset < 0 ? "BEFORE_DUE" : offset === 0 ? "ON_DUE" : "OVERDUE",
      sendOn,
    });
  }
  return steps;
}

export type ReminderDecision =
  | { send: true; step: ReminderStep; skipped: number[] }
  | { send: false; reason: "SETTLED" | "NOTHING_DUE" | "ALL_SENT" };

export function nextReminder(input: {
  schedule: readonly ReminderStep[];
  status: InvoiceStatus;
  sentSteps: readonly number[];
  today: string;
}): ReminderDecision {
  if (input.status !== "OPEN" && input.status !== "PARTIALLY_PAID") return { send: false, reason: "SETTLED" };
  const sent = new Set(input.sentSteps);
  const unsent = input.schedule.filter((step) => !sent.has(step.step));
  if (unsent.length === 0) return { send: false, reason: "ALL_SENT" };
  const due = unsent.filter((step) => step.sendOn <= input.today);
  if (due.length === 0) return { send: false, reason: "NOTHING_DUE" };
  const latest = due[due.length - 1];
  return { send: true, step: latest, skipped: due.slice(0, -1).map((step) => step.step) };
}

/** The invoice due date for a schedule row, from the acceptance date and payment terms. */
export function invoiceDueDate(input: {
  due: { type: "ON_ACCEPTANCE" } | { type: "ON_COMPLETION" } | { type: "DAYS_AFTER_ACCEPTANCE"; days: number };
  acceptedOn: string;
  /** For ON_COMPLETION: the date the work was marked complete. */
  completedOn?: string | null;
  /** Payment terms in days (quote_settings.payment_terms_days). */
  termsDays: number;
}): string | null {
  switch (input.due.type) {
    case "ON_ACCEPTANCE":
      return input.acceptedOn;
    case "DAYS_AFTER_ACCEPTANCE":
      return addDays(input.acceptedOn, input.due.days);
    case "ON_COMPLETION":
      return input.completedOn ? addDays(input.completedOn, input.termsDays) : null;
  }
}
