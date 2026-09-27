/**
 * Buying signals from the Companies House register.
 *
 * Pure: it takes the register's own JSON (company profile, officers list,
 * filing history) and decides what it evidences. The adapter in
 * `server/providers/companies-house.ts` does the fetching.
 *
 * Every signal here is a public, dated, official fact about a *company*.
 * Each carries its catalogue type (`intent-catalogue.ts`):
 *
 *   * CAPITAL_RAISED          a share allotment (SH01). Money went in. It does
 *                             NOT name a round: "Series A" needs the company's
 *                             own announcement.
 *   * NEW_DIRECTOR            a director or LLP member appointed.
 *   * SENIOR_HIRE_*           an appointed director whose stated occupation is
 *                             a C-level, VP or Head-of title.
 *   * LEADERSHIP_CHANGE       an appointment and a resignation in one window.
 *   * KEY_DEPARTURE           a director resigned.
 *   * NEWLY_INCORPORATED      incorporated inside the window.
 *   * REGISTERED_OFFICE_CHANGE the registered office moved (AD01) -- worded as
 *                             "possible move" because it is often an
 *                             accountant's address.
 *   * DEBT_FINANCE            a charge registered (MR01): secured borrowing.
 *   * ACQUISITION_MERGER      a company notified as a PSC (PSC02): possible
 *                             acquisition or group restructure.
 *   * REBRAND                 a change of name (NM01 / CERTNM).
 *   * ACCOUNTS_GROWTH         the latest accounts are a larger type than the
 *                             previous ones (micro -> small, dormant -> trading).
 *   * REGULATORY_DEADLINE     accounts or confirmation statement due soon or
 *                             overdue, from the profile.
 *   * COMPANY_ANNIVERSARY     a milestone anniversary of incorporation.
 *
 * ## Personal data
 *
 * The officers list names people. We do not keep the name: the evidence is
 * the role, the stated occupation *title* and the date, which is all
 * "leadership change at this company" needs, plus a link to the register
 * where anyone can read the rest.
 *
 * ## What is deliberately not here
 *
 * Turnover or headcount from accounts: that needs the iXBRL document parsed,
 * and micro-entity and filleted accounts omit both. The accounts *type* is
 * read instead, which says a size threshold was crossed and nothing more.
 */

import { recencyStrength, withinFreshness, type IntentEvidenceKind } from "./intent-evidence.ts";
import {
  effectiveWindowDays,
  intentType,
  type IntentTypeId,
  type RoleFunction,
} from "./intent-catalogue.ts";
import { roleFunctionForTitle, seniorityForTitle } from "./website-announcements.ts";

export const CH_PUBLIC_BASE = "https://find-and-update.company-information.service.gov.uk";

export type ChProfile = {
  company_number?: string;
  company_name?: string;
  date_of_creation?: string;
  company_status?: string;
  accounts?: { next_due?: string; overdue?: boolean };
  confirmation_statement?: { next_due?: string; overdue?: boolean };
};

export type ChOfficer = {
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
  /** Self-declared occupation. Only a job-title-shaped value is kept. */
  occupation?: string;
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
  intentType: IntentTypeId;
  roleFunction?: RoleFunction | null;
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

/** How far ahead a filing deadline counts as "soon". */
export const DEADLINE_AHEAD_DAYS = 60;
/** How far ahead, and behind, a milestone anniversary counts. */
export const ANNIVERSARY_AHEAD_DAYS = 90;
export const ANNIVERSARY_BEHIND_DAYS = 30;
const MILESTONE_YEARS = new Set([1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100]);

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : iso;
}

function roleLabel(role: string): string {
  return role.replace(/-/g, " ").replace(/^llp /, "LLP ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Which register facts were asked for. The adapter fetches only what is
 * needed. The first four are the original flags; the rest are optional so a
 * caller written before them asks for exactly what it did.
 */
export type RegisterWants = {
  funding: boolean;
  leadership: boolean;
  incorporation: boolean;
  officeMove: boolean;
  seniorAppointments?: boolean;
  leadershipChange?: boolean;
  departures?: boolean;
  debt?: boolean;
  ownership?: boolean;
  rename?: boolean;
  accountsGrowth?: boolean;
  deadlines?: boolean;
  anniversary?: boolean;
};

/** The register flags a set of catalogue types needs. */
export function registerWantsForTypes(types: Iterable<IntentTypeId>): RegisterWants {
  const set = new Set(types);
  return {
    funding: set.has("CAPITAL_RAISED"),
    leadership: set.has("NEW_DIRECTOR"),
    incorporation: set.has("NEWLY_INCORPORATED"),
    officeMove: set.has("REGISTERED_OFFICE_CHANGE"),
    seniorAppointments:
      set.has("SENIOR_HIRE_C_LEVEL") || set.has("SENIOR_HIRE_VP") || set.has("SENIOR_HIRE_HEAD_OF"),
    leadershipChange: set.has("LEADERSHIP_CHANGE"),
    departures: set.has("KEY_DEPARTURE"),
    debt: set.has("DEBT_FINANCE"),
    ownership: set.has("ACQUISITION_MERGER"),
    rename: set.has("REBRAND"),
    accountsGrowth: set.has("ACCOUNTS_GROWTH"),
    deadlines: set.has("REGULATORY_DEADLINE"),
    anniversary: set.has("COMPANY_ANNIVERSARY"),
  };
}

export function anyRegisterWant(wants: RegisterWants): boolean {
  return Object.values(wants).some(Boolean);
}

/** True when the profile must be fetched for these wants. */
export function needsProfile(wants: RegisterWants): boolean {
  return Boolean(
    wants.incorporation ||
      wants.leadership ||
      wants.seniorAppointments ||
      wants.leadershipChange ||
      wants.deadlines ||
      wants.anniversary,
  );
}

/** True when the officers list must be fetched for these wants. */
export function needsOfficers(wants: RegisterWants): boolean {
  return Boolean(wants.leadership || wants.seniorAppointments || wants.leadershipChange || wants.departures);
}

/**
 * The accounts type as a size tier. Higher is bigger. Null when the filing
 * does not say (older filings describe themselves differently).
 */
export function accountsTier(description: string | undefined): number | null {
  const value = (description ?? "").toLowerCase();
  if (!value.includes("accounts-type")) return null;
  if (value.includes("dormant")) return 0;
  if (value.includes("micro-entity")) return 1;
  if (value.includes("total-exemption") || value.includes("abridged") || value.endsWith("-small")) return 2;
  if (value.includes("medium")) return 3;
  if (value.endsWith("-full") || value.includes("group")) return 4;
  return null;
}

const TIER_LABEL = ["dormant", "micro-entity", "small", "medium", "full"];

/**
 * An occupation worth keeping: a recognisable senior job title. Anything
 * else ("Company Director", "Retired") says nothing and is not stored.
 */
function seniorOccupation(occupation: string | undefined): { title: string; seniority: "C_LEVEL" | "VP" | "HEAD"; fn: RoleFunction | null } | null {
  const title = (occupation ?? "").trim();
  if (!title || title.length > 80) return null;
  const seniority = seniorityForTitle(title);
  if (!seniority) return null;
  return { title, seniority, fn: roleFunctionForTitle(title) };
}

const SENIORITY_TYPE = {
  C_LEVEL: "SENIOR_HIRE_C_LEVEL",
  VP: "SENIOR_HIRE_VP",
  HEAD: "SENIOR_HIRE_HEAD_OF",
} as const;

export function registerSignals(input: {
  companyNumber: string;
  profile: ChProfile | null;
  officers: ChOfficer[];
  filings: ChFiling[];
  wants: RegisterWants;
  now: Date;
  freshnessDays: number;
  /** Only these senior types are reported. Defaults to all three. */
  seniorTypes?: IntentTypeId[];
}): RegisterSignal[] {
  const { companyNumber, now, freshnessDays, wants } = input;
  const base = `${CH_PUBLIC_BASE}/company/${encodeURIComponent(companyNumber)}`;
  const signals: RegisterSignal[] = [];
  const windowFor = (type: IntentTypeId) => effectiveWindowDays(type, freshnessDays);
  const strength = (type: IntentTypeId, hits: number, datedAt: string) =>
    recencyStrength({
      hits,
      datedAt,
      now,
      freshnessDays: windowFor(type),
      max: REGISTER_MAX_STRENGTH,
      base: REGISTER_BASE,
    });
  const push = (type: IntentTypeId, fields: Omit<RegisterSignal, "kind" | "intentType">) =>
    signals.push({ kind: intentType(type).evidenceKind, intentType: type, ...fields });
  const filingRef = (filing: ChFiling) =>
    `${base}/filing-history${filing.transaction_id ? `#${filing.transaction_id}` : ""}`;

  /* ---------------------------------------------------------- profile */

  if (wants.incorporation && input.profile?.date_of_creation) {
    const created = input.profile.date_of_creation;
    if (withinFreshness(created, now, windowFor("NEWLY_INCORPORATED"))) {
      push("NEWLY_INCORPORATED", {
        observedAt: new Date(created).toISOString(),
        snippet: `Incorporated on ${day(created)} (company ${companyNumber})`,
        reference: base,
        strength: strength("NEWLY_INCORPORATED", 1, created),
      });
    }
  }

  if (wants.deadlines && input.profile) {
    const due = [
      { label: "Accounts", entry: input.profile.accounts },
      { label: "Confirmation statement", entry: input.profile.confirmation_statement },
    ];
    for (const { label, entry } of due) {
      if (!entry?.next_due) continue;
      const dueAt = Date.parse(entry.next_due);
      if (!Number.isFinite(dueAt)) continue;
      const daysAhead = (dueAt - now.getTime()) / 86_400_000;
      if (!entry.overdue && (daysAhead < 0 || daysAhead > DEADLINE_AHEAD_DAYS)) continue;
      push("REGULATORY_DEADLINE", {
        // A current-state fact: observed now, and gone when the filing is made.
        observedAt: now.toISOString(),
        snippet: entry.overdue || daysAhead < 0
          ? `${label} overdue (was due ${day(entry.next_due)})`
          : `${label} due on ${day(entry.next_due)}`,
        reference: base,
        strength: Math.min(0.6, strength("REGULATORY_DEADLINE", 1, now.toISOString())),
      });
      break;
    }
  }

  if (wants.anniversary && input.profile?.date_of_creation) {
    const created = new Date(input.profile.date_of_creation);
    if (Number.isFinite(created.getTime())) {
      for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
        const years = year - created.getUTCFullYear();
        if (!MILESTONE_YEARS.has(years)) continue;
        const at = Date.UTC(year, created.getUTCMonth(), created.getUTCDate());
        const offset = (at - now.getTime()) / 86_400_000;
        if (offset > ANNIVERSARY_AHEAD_DAYS || offset < -ANNIVERSARY_BEHIND_DAYS) continue;
        const iso = new Date(at).toISOString();
        push("COMPANY_ANNIVERSARY", {
          observedAt: offset > 0 ? now.toISOString() : iso,
          snippet: `${years}-year anniversary of incorporation on ${day(iso)}`,
          reference: base,
          strength: Math.min(0.4, strength("COMPANY_ANNIVERSARY", 1, offset > 0 ? now.toISOString() : iso)),
        });
        break;
      }
    }
  }

  /* --------------------------------------------------------- officers */

  const founding = input.profile?.date_of_creation;
  const leadership = input.officers.filter((officer) =>
    LEADERSHIP_ROLES.has((officer.officer_role ?? "").toLowerCase()),
  );

  if (wants.leadership) {
    const appointed = leadership
      .filter(
        (officer) =>
          officer.appointed_on &&
          !officer.resigned_on &&
          withinFreshness(officer.appointed_on, now, windowFor("NEW_DIRECTOR")),
      )
      .sort((a, b) => Date.parse(b.appointed_on!) - Date.parse(a.appointed_on!));

    // An appointment on the incorporation date is the founding board, not a
    // change of leadership.
    const changes = appointed.filter((officer) => officer.appointed_on !== founding);

    if (changes.length > 0) {
      const latest = changes[0];
      const others = changes.length > 1 ? ` and ${changes.length - 1} other appointment${changes.length > 2 ? "s" : ""}` : "";
      push("NEW_DIRECTOR", {
        observedAt: new Date(latest.appointed_on!).toISOString(),
        snippet: `${roleLabel(latest.officer_role ?? "officer")} appointed on ${day(latest.appointed_on!)}${others}`,
        reference: `${base}/officers`,
        strength: strength("NEW_DIRECTOR", changes.length, latest.appointed_on!),
      });
    }
  }

  if (wants.seniorAppointments) {
    const allowed = new Set(input.seniorTypes ?? Object.values(SENIORITY_TYPE));
    const seen = new Set<string>();
    const senior = leadership
      .filter((officer) => officer.appointed_on && !officer.resigned_on && officer.appointed_on !== founding)
      .map((officer) => ({ officer, occupation: seniorOccupation(officer.occupation) }))
      .filter(({ officer, occupation }) =>
        occupation !== null &&
        allowed.has(SENIORITY_TYPE[occupation.seniority]) &&
        withinFreshness(officer.appointed_on, now, windowFor(SENIORITY_TYPE[occupation.seniority])),
      )
      .sort((a, b) => Date.parse(b.officer.appointed_on!) - Date.parse(a.officer.appointed_on!));
    for (const { officer, occupation } of senior) {
      const type = SENIORITY_TYPE[occupation!.seniority];
      const key = `${type}:${occupation!.fn ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push(type, {
        roleFunction: occupation!.fn,
        observedAt: new Date(officer.appointed_on!).toISOString(),
        snippet: `Director appointed on ${day(officer.appointed_on!)}, stated occupation ${occupation!.title}`,
        reference: `${base}/officers`,
        strength: strength(type, 1, officer.appointed_on!),
      });
    }
  }

  const resignations = leadership
    .filter(
      (officer) =>
        officer.resigned_on && withinFreshness(officer.resigned_on, now, windowFor("KEY_DEPARTURE")),
    )
    .sort((a, b) => Date.parse(b.resigned_on!) - Date.parse(a.resigned_on!));

  if (wants.departures && resignations.length > 0) {
    const latest = resignations[0];
    push("KEY_DEPARTURE", {
      observedAt: new Date(latest.resigned_on!).toISOString(),
      snippet: `${roleLabel(latest.officer_role ?? "officer")} resigned on ${day(latest.resigned_on!)}${resignations.length > 1 ? `, ${resignations.length} in the window` : ""}`,
      reference: `${base}/officers`,
      strength: Math.min(0.6, strength("KEY_DEPARTURE", resignations.length, latest.resigned_on!)),
    });
  }

  if (wants.leadershipChange) {
    const window = windowFor("LEADERSHIP_CHANGE");
    const out = resignations.filter((officer) => withinFreshness(officer.resigned_on, now, window));
    const inn = leadership.filter(
      (officer) =>
        officer.appointed_on &&
        officer.appointed_on !== founding &&
        withinFreshness(officer.appointed_on, now, window),
    );
    if (out.length > 0 && inn.length > 0) {
      const latestIn = inn.map((o) => o.appointed_on!).sort().at(-1)!;
      const latestOut = out.map((o) => o.resigned_on!).sort().at(-1)!;
      const latest = latestIn > latestOut ? latestIn : latestOut;
      push("LEADERSHIP_CHANGE", {
        observedAt: new Date(latest).toISOString(),
        snippet: `${out.length} director resignation${out.length === 1 ? "" : "s"} and ${inn.length} appointment${inn.length === 1 ? "" : "s"} since ${day(new Date(now.getTime() - window * 86_400_000).toISOString())}`,
        reference: `${base}/officers`,
        strength: strength("LEADERSHIP_CHANGE", out.length + inn.length, latest),
      });
    }
  }

  /* ---------------------------------------------------------- filings */

  const dated = input.filings
    .map((filing) => ({ ...filing, when: filing.action_date ?? filing.date ?? null }))
    .filter((filing): filing is typeof filing & { when: string } => Boolean(filing.when))
    .sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
  const recent = (type: IntentTypeId, match: (filingType: string) => boolean) =>
    dated.filter((filing) => match((filing.type ?? "").toUpperCase()) && withinFreshness(filing.when, now, windowFor(type)));

  if (wants.funding) {
    const allotments = recent("CAPITAL_RAISED", (type) => type === "SH01");
    if (allotments.length > 0) {
      const latest = allotments[0];
      push("CAPITAL_RAISED", {
        observedAt: new Date(latest.when).toISOString(),
        snippet: `Share allotment (SH01) dated ${day(latest.when)}${allotments.length > 1 ? `, ${allotments.length} in the window` : ""}`,
        reference: filingRef(latest),
        strength: strength("CAPITAL_RAISED", allotments.length, latest.when),
      });
    }
  }

  if (wants.officeMove) {
    const moves = recent("REGISTERED_OFFICE_CHANGE", (type) => type === "AD01");
    if (moves.length > 0) {
      const latest = moves[0];
      push("REGISTERED_OFFICE_CHANGE", {
        observedAt: new Date(latest.when).toISOString(),
        snippet: `Registered office address changed on ${day(latest.when)} (possible move or expansion)`,
        reference: filingRef(latest),
        // A registered-office change is often just an accountant's address,
        // so it counts for less than the other register facts.
        strength: Math.min(0.5, strength("REGISTERED_OFFICE_CHANGE", 1, latest.when)),
      });
    }
  }

  if (wants.debt) {
    const charges = recent("DEBT_FINANCE", (type) => type === "MR01");
    if (charges.length > 0) {
      const latest = charges[0];
      push("DEBT_FINANCE", {
        observedAt: new Date(latest.when).toISOString(),
        snippet: `Charge registered (MR01) on ${day(latest.when)}: secured borrowing`,
        reference: filingRef(latest),
        strength: Math.min(0.6, strength("DEBT_FINANCE", charges.length, latest.when)),
      });
    }
  }

  if (wants.ownership) {
    const psc = recent("ACQUISITION_MERGER", (type) => type === "PSC02");
    if (psc.length > 0) {
      const latest = psc[0];
      push("ACQUISITION_MERGER", {
        observedAt: new Date(latest.when).toISOString(),
        snippet: `A company was notified as a person with significant control (PSC02) on ${day(latest.when)}: possible acquisition or group restructure`,
        reference: filingRef(latest),
        strength: Math.min(0.6, strength("ACQUISITION_MERGER", 1, latest.when)),
      });
    }
  }

  if (wants.rename) {
    const names = recent("REBRAND", (type) => /^(NM0\d|CERTNM)$/.test(type));
    if (names.length > 0) {
      const latest = names[0];
      push("REBRAND", {
        observedAt: new Date(latest.when).toISOString(),
        snippet: `Change of company name filed on ${day(latest.when)}`,
        reference: filingRef(latest),
        strength: strength("REBRAND", 1, latest.when),
      });
    }
  }

  if (wants.accountsGrowth) {
    const accounts = dated.filter((filing) => (filing.type ?? "").toUpperCase() === "AA");
    const [latest, previous] = accounts
      .map((filing) => ({ filing, tier: accountsTier(filing.description) }))
      .filter((entry): entry is { filing: (typeof accounts)[number]; tier: number } => entry.tier !== null);
    if (
      latest &&
      previous &&
      latest.tier > previous.tier &&
      withinFreshness(latest.filing.when, now, windowFor("ACCOUNTS_GROWTH"))
    ) {
      push("ACCOUNTS_GROWTH", {
        observedAt: new Date(latest.filing.when).toISOString(),
        snippet: `Accounts filed ${day(latest.filing.when)} as ${TIER_LABEL[latest.tier]}, previously ${TIER_LABEL[previous.tier]}`,
        reference: filingRef(latest.filing),
        strength: Math.min(0.6, strength("ACCOUNTS_GROWTH", 1, latest.filing.when)),
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
  if (wants.debt) categories.push("mortgage");
  if (wants.ownership) categories.push("persons-with-significant-control");
  if (wants.rename) categories.push("change-of-name");
  if (wants.accountsGrowth) categories.push("accounts");
  return categories;
}
