/**
 * What last happened to a prospect, in the product's own words (V4 §12.6).
 *
 * The Prospects table's last column has to say "Email sent yesterday" rather
 * than a bare timestamp, because the whole point of the column is to tell
 * someone whether this record is waiting on them or on the recipient. A date
 * alone cannot do that.
 *
 * Pure: no `server-only`, no Supabase. The kind is resolved server-side from
 * real rows (messages, campaign membership, verification, promotion) and the
 * label is rendered from it here, so the two never drift.
 */

export const PROSPECT_ACTIVITY_KINDS = [
  "SOURCED",
  "ENRICHED",
  "VERIFIED",
  "SCORED",
  "INTENT_DETECTED",
  "ADDED_TO_CAMPAIGN",
  "APPROVED",
  "EMAIL_SENT",
  "REPLY_RECEIVED",
  "PROMOTED",
  "SUPPRESSED",
] as const;

export type ProspectActivityKind = (typeof PROSPECT_ACTIVITY_KINDS)[number];

export type ProspectActivity = {
  kind: ProspectActivityKind;
  at: string;
  /** Free text from the underlying row — a campaign name, a provider. Never
   *  invented: null when the source row carried nothing worth showing. */
  detail?: string | null;
};

const VERBS: Record<ProspectActivityKind, string> = {
  SOURCED: "Sourced",
  ENRICHED: "Enriched",
  VERIFIED: "Verified",
  SCORED: "Scored",
  INTENT_DETECTED: "Intent detected",
  ADDED_TO_CAMPAIGN: "Added to campaign",
  APPROVED: "Approved",
  EMAIL_SENT: "Email sent",
  REPLY_RECEIVED: "Replied",
  PROMOTED: "Promoted to lead",
  SUPPRESSED: "Suppressed",
};

export function activityVerb(kind: ProspectActivityKind): string {
  return VERBS[kind] ?? "Updated";
}

/**
 * "2h ago", "yesterday", "1 day ago" — the shape the reference uses.
 *
 * Deliberately different from `intentFreshness`, which reads in weeks and
 * months because an intent signal's age is measured against a freshness window.
 * A row's last activity is measured against a working day.
 */
export function shortAgo(value: string, now: Date = new Date()): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";

  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** The full cell: "Email sent yesterday", "Sourced 2h ago". */
export function prospectActivityLabel(
  activity: ProspectActivity | null,
  fallbackAt: string | null,
): string {
  if (!activity) {
    return fallbackAt ? `Sourced ${shortAgo(fallbackAt)}` : "—";
  }
  return `${activityVerb(activity.kind)} ${shortAgo(activity.at)}`;
}
