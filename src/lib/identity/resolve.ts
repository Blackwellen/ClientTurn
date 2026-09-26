/**
 * Identity resolution (design 03 §2). Pure: the caller loads the candidates,
 * this decides.
 *
 * Rules, tested in this order:
 *
 *   | Same (provider, providerRecordId)          | exact       | DUPLICATE          |
 *   | Same normalised email                      | strong      | MERGE              |
 *   | Same E.164 phone, email absent on one side | strong      | MERGE              |
 *   | Same phone, a *different* email            | conflicting | REVIEW, never merge|
 *   | Same name + company/domain, no shared      | weak        | NEW + candidate    |
 *   |   contact field                            |             |                    |
 *
 * Never silent: the decision always names the rule, and the service writes a
 * `merge_events` row for every merge. Prospects are matched too -- a prospect
 * already promoted to a lead routes to that lead; an unpromoted one is linked
 * to the lead this ingest creates, instead of leaving two records.
 *
 * Archived, test and parked-duplicate leads are the caller's to exclude: they
 * are not in the identity unique indexes either (0123).
 */

import { companyDomainOf, companyKey, normaliseName } from "../ingest/normalise.ts";

export type IdentityLead = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  createdAt: string;
};

export type IdentityProspect = IdentityLead & {
  promotedToLeadId: string | null;
};

export type IdentityProbe = {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
};

export type IdentityCandidates = {
  /** The lead a previous touch with the same (provider, providerRecordId) created. */
  providerRecordLeadId: string | null;
  leads: IdentityLead[];
  prospects: IdentityProspect[];
};

export type WeakCandidate = { kind: "LEAD" | "PROSPECT"; id: string };

export type IdentityDecision =
  | { kind: "DUPLICATE"; leadId: string; rule: "PROVIDER_RECORD"; confidence: 1 }
  | {
      kind: "MERGE";
      leadId: string;
      rule: "EMAIL" | "PHONE" | "PROSPECT_PROMOTION";
      confidence: number;
      /** Set when the matched lead holds a different phone than the one supplied. */
      notes: string[];
    }
  | {
      kind: "REVIEW";
      conflictLeadId: string;
      rule: "PHONE_CONFLICT";
      notes: string[];
    }
  | {
      kind: "NEW";
      /** An unpromoted prospect for the same person, to link after the insert. */
      linkProspectId: string | null;
      weak: WeakCandidate[];
    };

function oldestFirst<T extends { createdAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
}

function sameEmail(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function samePhone(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a === b);
}

function fullName(person: { firstName: string | null; lastName: string | null }): string | null {
  const first = normaliseName(person.firstName)?.toLowerCase() ?? null;
  const last = normaliseName(person.lastName)?.toLowerCase() ?? null;
  if (!first || !last) return null; // One name alone is far too weak.
  return `${first} ${last}`;
}

/**
 * Weak evidence: the same full name and the same company (by name key or by
 * a non-generic email domain), with no contact field in common. Never merged;
 * surfaced for a person as a merge candidate.
 */
export function isWeakMatch(probe: IdentityProbe, other: IdentityLead): boolean {
  const name = fullName(probe);
  if (!name || name !== fullName(other)) return false;

  // A shared contact field is strong (or conflicting) evidence, not weak.
  if (sameEmail(probe.email, other.email) || samePhone(probe.phone, other.phone)) return false;

  const probeCompany = companyKey(probe.companyName);
  const otherCompany = companyKey(other.companyName);
  if (probeCompany && otherCompany && probeCompany === otherCompany) return true;

  const probeDomain = companyDomainOf(probe.email);
  const otherDomain = companyDomainOf(other.email);
  return Boolean(probeDomain && otherDomain && probeDomain === otherDomain);
}

export function resolveIdentity(
  probe: IdentityProbe,
  candidates: IdentityCandidates,
): IdentityDecision {
  /* 1. the same submission --------------------------------------------- */
  if (candidates.providerRecordLeadId) {
    return {
      kind: "DUPLICATE",
      leadId: candidates.providerRecordLeadId,
      rule: "PROVIDER_RECORD",
      confidence: 1,
    };
  }

  const leads = oldestFirst(candidates.leads);

  /* 2. same email ---------------------------------------------------------- */
  if (probe.email) {
    const match = leads.find((lead) => sameEmail(lead.email, probe.email));
    if (match) {
      const notes =
        probe.phone && match.phone && match.phone !== probe.phone ? ["phone_differs_kept_existing"] : [];
      return { kind: "MERGE", leadId: match.id, rule: "EMAIL", confidence: 1, notes };
    }
  }

  /* 3 & 4. same phone -------------------------------------------------------- */
  if (probe.phone) {
    const match = leads.find((lead) => samePhone(lead.phone, probe.phone));
    if (match) {
      if (probe.email && match.email && !sameEmail(probe.email, match.email)) {
        // Same number, different person on paper: a shared office line, a
        // recycled mobile, a typo. A person decides.
        return {
          kind: "REVIEW",
          conflictLeadId: match.id,
          rule: "PHONE_CONFLICT",
          notes: ["same_phone_different_email"],
        };
      }
      return { kind: "MERGE", leadId: match.id, rule: "PHONE", confidence: 0.9, notes: [] };
    }
  }

  /* prospects: strong evidence only ------------------------------------------ */
  const prospects = oldestFirst(candidates.prospects);
  const strongProspect =
    (probe.email ? prospects.find((p) => sameEmail(p.email, probe.email)) : undefined) ??
    (probe.phone
      ? prospects.find(
          (p) => samePhone(p.phone, probe.phone) && !(probe.email && p.email && !sameEmail(p.email, probe.email)),
        )
      : undefined);

  if (strongProspect?.promotedToLeadId) {
    return {
      kind: "MERGE",
      leadId: strongProspect.promotedToLeadId,
      rule: "PROSPECT_PROMOTION",
      confidence: 0.9,
      notes: ["matched_promoted_prospect"],
    };
  }

  /* 5. weak ------------------------------------------------------------------- */
  const weak: WeakCandidate[] = [
    ...leads.filter((lead) => isWeakMatch(probe, lead)).map((lead) => ({ kind: "LEAD" as const, id: lead.id })),
    ...prospects
      .filter((p) => p.id !== strongProspect?.id && isWeakMatch(probe, p))
      .map((p) => ({ kind: "PROSPECT" as const, id: p.id })),
  ];

  return { kind: "NEW", linkProspectId: strongProspect?.id ?? null, weak };
}

/* ------------------------------------------------------------ merge patch */

/** Columns a merge may fill when blank. Never provenance. */
export const MERGEABLE_LEAD_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "phone_normalized",
  "company_name",
  "postcode",
  "service_id",
  "source_submitted_at",
] as const;
export type MergeableLeadField = (typeof MERGEABLE_LEAD_FIELDS)[number];

/**
 * Provenance: how and by whom the record first came to exist. A later touch
 * says how the person came *back*, which is the touch row's job -- it never
 * rewrites these.
 */
export const PROVENANCE_FIELDS = [
  "intake_method",
  "intake_detail",
  "created_via",
  "created_by_user_id",
  "relationship_type",
  "source_id",
  "external_id",
  "promoted_from_prospect_id",
  "sourcing_run_id",
  "source_campaign_id",
  "subscriber_type",
  "created_at",
] as const;

/**
 * Fill blanks only. Returns the patch and a before-snapshot of exactly the
 * fields it changes (for `merge_events`, so the merge can be reversed).
 * An incoming null never blanks a value, and a present value is never
 * replaced -- a different phone on an email match stays on the touch.
 */
export function mergePatch(
  existing: Partial<Record<MergeableLeadField, unknown>>,
  incoming: Partial<Record<MergeableLeadField, unknown>>,
): { patch: Partial<Record<MergeableLeadField, unknown>>; before: Partial<Record<MergeableLeadField, unknown>> } {
  const patch: Partial<Record<MergeableLeadField, unknown>> = {};
  const before: Partial<Record<MergeableLeadField, unknown>> = {};
  for (const field of MERGEABLE_LEAD_FIELDS) {
    const current = existing[field];
    const next = incoming[field];
    const blank = current === null || current === undefined || current === "";
    const present = next !== null && next !== undefined && next !== "";
    if (blank && present) {
      patch[field] = next;
      before[field] = current ?? null;
    }
  }
  return { patch, before };
}
