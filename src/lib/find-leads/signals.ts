/**
 * Signals: the individual searches feeding an agent.
 *
 * Pure -- no `server-only`, no Supabase -- so the vocabulary and the health
 * judgement can be rendered by a client component and asserted without a
 * database.
 *
 * ## Why signals became rows
 *
 * The sourcing waterfall already ran these: a recently-funded search, a
 * competitor's followers, a job-change feed. They existed only as provider calls
 * inside a run, so a customer could see that 354 leads arrived and could not see
 * *which search produced them*, could not tell a productive one from a dead one,
 * and could not run one on demand.
 *
 * That is the difference between "the agent found some leads" and something a
 * person can manage. A signal returning nothing for a fortnight is worth turning
 * off; one returning ten good leads a day is worth running more often. Neither
 * decision is available if the only visible number is the total.
 */

export const SIGNAL_KINDS = [
  "ENGAGEMENT",
  "COMPETITOR",
  "JOB_CHANGE",
  "FUNDING",
  "HIRING",
  "KEYWORD",
  "ICP_TOP",
  "WEBSITE_SIGNAL",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** The subtitle under a signal's name. Written for a customer. */
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  ENGAGEMENT: "Engagement & interest",
  COMPETITOR: "Competitor's audience",
  JOB_CHANGE: "Recently changed jobs",
  FUNDING: "Recently raised funds",
  HIRING: "Currently hiring",
  KEYWORD: "Keyword match",
  ICP_TOP: "Best fit for your profile",
  WEBSITE_SIGNAL: "Something on their website",
};

export type Signal = {
  id: string;
  name: string;
  kind: SignalKind;
  query: string | null;
  active: boolean;
  leadsFound: number;
  leadsFoundThisWeek: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: string | null;
};

/**
 * How a signal is doing, as one word plus a reason.
 *
 * Deliberately three states rather than a number. "47 leads" means nothing
 * without knowing whether that is a week's work or a morning's; what a person
 * needs is whether to leave it alone, look at it, or turn it off.
 */
export type SignalHealth = {
  tone: "healthy" | "quiet" | "idle";
  label: string;
  detail: string;
};

/** A signal that has produced nothing in this many days is not working. */
const QUIET_AFTER_DAYS = 14;

export function signalHealth(signal: Signal, now: Date = new Date()): SignalHealth {
  if (!signal.active) {
    return {
      tone: "idle",
      label: "Paused",
      detail: "This signal is switched off and is not being run.",
    };
  }

  if (signal.leadsFoundThisWeek > 0) {
    return {
      tone: "healthy",
      label: "Producing",
      detail: `${signal.leadsFoundThisWeek} new lead${signal.leadsFoundThisWeek === 1 ? "" : "s"} this week.`,
    };
  }

  // Never run is not the same as run and found nothing, and telling somebody
  // their brand-new signal is unproductive would be simply wrong.
  if (!signal.lastRunAt) {
    return {
      tone: "idle",
      label: "Not run yet",
      detail: "This signal has not run yet. It will on the next scheduled pass.",
    };
  }

  const ageDays = (now.getTime() - new Date(signal.lastRunAt).getTime()) / 86_400_000;

  if (signal.leadsFound === 0 && ageDays >= QUIET_AFTER_DAYS) {
    return {
      tone: "quiet",
      label: "Nothing found",
      detail:
        signal.lastResult ??
        `Running for ${Math.round(ageDays)} days without finding anyone. Worth narrowing or turning off.`,
    };
  }

  return {
    tone: "quiet",
    label: "Quiet",
    detail:
      signal.lastResult ?? "Nothing new this week, but it has produced leads before.",
  };
}

/**
 * When the signal next runs, in words.
 *
 * Returns null rather than "unknown" when nothing is scheduled: a row with no
 * next run is one the customer should be able to launch by hand, and the button
 * says that better than a label would.
 */
export function nextRunLabel(nextRunAt: string | null, now: Date = new Date()): string | null {
  if (!nextRunAt) return null;

  const ms = new Date(nextRunAt).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "due now";

  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
