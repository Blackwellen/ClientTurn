/**
 * Shared data-rights shapes and vocabularies. Pure, so client components,
 * server modules and tests can all import it.
 */

export const PRIVACY_REQUEST_TYPES = [
  "ACCESS",
  "ERASURE",
  "RECTIFICATION",
  "RESTRICTION",
  "OBJECTION",
  "COMPLAINT",
  "CONTEST_DECISION",
] as const;

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_TYPES)[number];

/** Written for the person making the request, not for an operator. */
export const PRIVACY_REQUEST_TYPE_COPY: Record<PrivacyRequestKind, { label: string; hint: string }> = {
  ACCESS: {
    label: "See the data held about me",
    hint: "A copy of your personal data, where it came from and how it is used.",
  },
  ERASURE: {
    label: "Erase my data",
    hint: "Your details are removed. A do-not-contact record is kept as a one-way hash so you are not contacted again.",
  },
  RECTIFICATION: {
    label: "Correct my data",
    hint: "Tell us what is wrong and what it should say.",
  },
  RESTRICTION: {
    label: "Restrict how my data is used",
    hint: "Your data is kept but not used to contact you while the issue is resolved.",
  },
  OBJECTION: {
    label: "Object to marketing or profiling",
    hint: "Stop using your data for direct marketing or for scoring.",
  },
  COMPLAINT: {
    label: "Make a data protection complaint",
    hint: "We acknowledge every complaint within 30 days.",
  },
  CONTEST_DECISION: {
    label: "Challenge an automated decision",
    hint: "Ask a person to review a decision made about you automatically, such as a qualification or score.",
  },
};

export const PRIVACY_REQUEST_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
export type PrivacyRequestState = (typeof PRIVACY_REQUEST_STATUSES)[number];

export type WorkspacePrivacyRequest = {
  id: string;
  reference: string;
  type: string;
  subjectEmail: string | null;
  subjectName: string | null;
  status: PrivacyRequestState;
  verificationStatus: string;
  source: string;
  receivedAt: string;
  acknowledgeBy: string | null;
  acknowledgedAt: string | null;
  dueAt: string | null;
  subjectLeadId: string | null;
  details: string | null;
};

export type RetentionPreview = {
  settings: {
    inactiveLeadsDays: number | null;
    uncontactedProspectsDays: number | null;
    rawEventsDays: number | null;
  };
  inactiveLeads: number;
  uncontactedProspects: number;
  rawEvents: number;
};

/** Days left on a clock, negative once overdue. Pure for the list view. */
export function daysUntil(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/* ---------------------------------------------------- routing public requests */

export type RoutingMatch = {
  businessId: string;
  /** How the record matched: the verified email, or a phone the person typed. */
  via: "EMAIL" | "PHONE";
  leadId: string | null;
};

export type RoutingTarget = {
  businessId: string;
  /** True when at least one match was on the verified email address. */
  emailMatched: boolean;
  /** The one lead to link, when exactly one lead matched in that workspace. */
  leadId: string | null;
};

/**
 * Which workspaces a verified public request goes to.
 *
 * One target per workspace however many rows matched. An email match outranks
 * a phone match because the email is what the person proved they own; a phone
 * they typed into a public form is a claim, and the workspace is told so.
 */
export function routingTargets(matches: RoutingMatch[]): RoutingTarget[] {
  const byBusiness = new Map<string, { email: boolean; leads: Set<string> }>();
  for (const match of matches) {
    const entry = byBusiness.get(match.businessId) ?? { email: false, leads: new Set<string>() };
    if (match.via === "EMAIL") entry.email = true;
    if (match.leadId) entry.leads.add(match.leadId);
    byBusiness.set(match.businessId, entry);
  }
  return [...byBusiness.entries()]
    .map(([businessId, entry]) => ({
      businessId,
      emailMatched: entry.email,
      leadId: entry.leads.size === 1 ? [...entry.leads][0] : null,
    }))
    .sort((a, b) => a.businessId.localeCompare(b.businessId));
}

/** The line that ties a workspace copy back to the public request. */
export function routedFromMarker(reference: string): string {
  return `Routed from ClientTurn public request ${reference}`;
}
