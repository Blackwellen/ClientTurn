/**
 * Buying signals from the Companies House register.
 *
 * Pure: it takes the register's own JSON (company profile, officers list,
 * filing history) and decides what it evidences. The adapter in
 * `server/providers/companies-house.ts` does the fetching.
 *
 * Every signal here is a public, dated, official fact about a *company*:
 *
 *   * FUNDING      a share allotment (SH01) -- new capital went in.
 *   * JOB_CHANGE   a director or LLP member appointed -- a leadership change.
 *   * NEW_COMPANY  incorporated inside the window.
 *   * EXPANSION    the registered office moved (AD01) -- possibly a move or
 *                  an expansion, and worded as "possible" to the customer.
 *
 * ## Personal data
 *
 * The officers list names people. We do not keep the name: the evidence is
 * the role and the appointment date, which is all "leadership change at this
 * company" needs, plus a link to the register where anyone can read the rest.
 *
 * ## What is deliberately not here
 *
 * "Accounts filed showing growth". Filing accounts is an annual statutory
 * obligation, so the filing itself says nothing; growth would need the iXBRL
 * document parsed for turnover or headcount, which many small companies do
 * not even file (micro-entity and filleted accounts omit both). Not cheaply
 * derivable, so not offered.
 */

import { recencyStrength, withinFreshness, type IntentEvidenceKind } from "./intent-evidence.ts";

export const CH_PUBLIC_BASE = "https://find-and-update.company-information.service.gov.uk";

export type ChProfile = {
  company_number?: string;
  company_name?: string;
  date_of_creation?: string;
  company_status?: string;
};

export type ChOfficer = {
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
};

export type ChFiling = {
  transaction_id?: string;
  date?: string;
  action_date?: string;
  type?: string;
  category?: string;
  description?: string;
};

export type RegisterSignal = {
  kind: IntentEvidenceKind;
  observedAt: string;
  snippet: string;
  /** A public register page anyone can open to check the fact. */
  reference: string;
  strength: number;
};

/** Roles whose appointment is a leadership change. Secretaries are not. */
const LEADERSHIP_ROLES = new Set([
  "director",
  "corporate-director",
  "nominee-director",
  "llp-member",
  "llp-designated-member",
  "corporate-llp-member",
  "corporate-llp-designated-member",
]);

/** Register facts are strong but not proof of a buying cycle. */
const REGISTER_MAX_STRENGTH = 0.8;
const REGISTER_BASE = 0.5;

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : iso;
}

function roleLabel(role: string): string {
  return role.replace(/-/g, " ").replace(/^llp /, "LLP ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Which register kinds were asked for. The adapter fetches only what is needed. */
export type RegisterWants = {
  funding: boolean;
  leadership: boolean;
  incorporation: boolean;
  officeMove: boolean;
};

export function registerSignals(input: {
  companyNumber: string;
  profile: ChProfile | null;
  officers: ChOfficer[];
  filings: ChFiling[];
  wants: RegisterWants;
  now: Date;
  freshnessDays: number;
}): RegisterSignal[] {
  const { companyNumber, now, freshnessDays } = input;
  const base = `${CH_PUBLIC_BASE}/company/${encodeURIComponent(companyNumber)}`;
  const signals: RegisterSignal[] = [];
  const strength = (hits: number, datedAt: string) =>
    recencyStrength({ hits, datedAt, now, freshnessDays, max: REGISTER_MAX_STRENGTH, base: REGISTER_BASE });

  if (input.wants.incorporation && input.profile?.date_of_creation) {
    const created = input.profile.date_of_creation;
    if (withinFreshness(created, now, freshnessDays)) {
      signals.push({
        kind: "NEW_COMPANY",
        observedAt: new Date(created).toISOString(),
        snippet: `Incorporated on ${day(created)} (company ${companyNumber})`,
        reference: base,
        strength: strength(1, created),
      });
    }
  }

  if (input.wants.leadership) {
    const appointed = input.officers
      .filter(
        (officer) =>
          officer.appointed_on &&
          !officer.resigned_on &&
          LEADERSHIP_ROLES.has((officer.officer_role ?? "").toLowerCase()) &&
          withinFreshness(officer.appointed_on, now, freshnessDays),
      )
      .sort((a, b) => Date.parse(b.appointed_on!) - Date.parse(a.appointed_on!));

    // An appointment on the incorporation date is the founding board, not a
    // change of leadership.
    const founding = input.profile?.date_of_creation;
    const changes = appointed.filter((officer) => officer.appointed_on !== founding);

    if (changes.length > 0) {
      const latest = changes[0];
      const others = changes.length > 1 ? ` and ${changes.length - 1} other appointment${changes.length > 2 ? "s" : ""}` : "";
      signals.push({
        kind: "JOB_CHANGE",
        observedAt: new Date(latest.appointed_on!).toISOString(),
        snippet: `${roleLabel(latest.officer_role ?? "officer")} appointed on ${day(latest.appointed_on!)}${others}`,
        reference: `${base}/officers`,
        strength: strength(changes.length, latest.appointed_on!),
      });
    }
  }

  const recentFilings = input.filings
    .map((filing) => ({ ...filing, when: filing.action_date ?? filing.date ?? null }))
    .filter((filing) => filing.when && withinFreshness(filing.when, now, freshnessDays))
    .sort((a, b) => Date.parse(b.when!) - Date.parse(a.when!));

  if (input.wants.funding) {
    const allotments = recentFilings.filter((filing) => (filing.type ?? "").toUpperCase() === "SH01");
    if (allotments.length > 0) {
      const latest = allotments[0];
      signals.push({
        kind: "FUNDING",
        observedAt: new Date(latest.when!).toISOString(),
        snippet: `Share allotment (SH01) dated ${day(latest.when!)}${allotments.length > 1 ? `, ${allotments.length} in the window` : ""}`,
        reference: `${base}/filing-history${latest.transaction_id ? `#${latest.transaction_id}` : ""}`,
        strength: strength(allotments.length, latest.when!),
      });
    }
  }

  if (input.wants.officeMove) {
    const moves = recentFilings.filter((filing) => (filing.type ?? "").toUpperCase() === "AD01");
    if (moves.length > 0) {
      const latest = moves[0];
      signals.push({
        kind: "EXPANSION",
        observedAt: new Date(latest.when!).toISOString(),
        snippet: `Registered office address changed on ${day(latest.when!)} (possible move or expansion)`,
        reference: `${base}/filing-history${latest.transaction_id ? `#${latest.transaction_id}` : ""}`,
        // A registered-office change is often just an accountant's address,
        // so it counts for less than the other register facts.
        strength: Math.min(0.5, strength(1, latest.when!)),
      });
    }
  }

  return signals;
}

/** Filing-history categories to ask for, so one call covers what is wanted. */
export function filingCategoriesFor(wants: RegisterWants): string[] {
  const categories: string[] = [];
  if (wants.funding) categories.push("capital");
  if (wants.officeMove) categories.push("address");
  return categories;
}
