/**
 * Company facts from a CRM or list import: the contract renewal date, the
 * headcount and the technologies the customer's OWN data records about a
 * company. They feed the three catalogue types that only the customer's data
 * can supply (intent-catalogue.ts, source CUSTOMER_DATA):
 *
 *   * CONTRACT_RENEWAL_WINDOW  a renewal date inside the next
 *     `RENEWAL_WINDOW_DAYS` (a date already past, or further out, is kept
 *     on the row but is not a live signal);
 *   * HEADCOUNT_GROWTH         a headcount higher than the one already on
 *     the company record (a first headcount is a baseline, not growth);
 *   * TECH_ADOPTED             each technology the row names.
 *
 * Nothing is inferred beyond what the cell says, and each signal's evidence
 * says it came from "Your CRM or list". Pure: tested in
 * tests/company-facts.test.ts.
 */

import { z } from "zod";
import { strengthCap, INTENT_SOURCE_LABELS, type IntentTypeId } from "../find-leads/intent-catalogue.ts";
import { truncateSnippet, type IntentEvidence } from "../find-leads/intent-evidence.ts";

export const RENEWAL_WINDOW_DAYS = 120;
export const MAX_TECHNOLOGIES = 30;
export const MAX_HEADCOUNT = 10_000_000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31/02 and the like, which Date would roll into March.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A renewal date as the UK writes it. Accepts 2027-03-31, 31/03/2027,
 * 31-03-2027, 31.03.2027, 31/03/27, "31 March 2027", "March 2027" (the 1st)
 * and "Mar-27". Day-first always: 03/04/2027 is 3 April. Null when unreadable.
 */
export function parseRenewalDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(year, Number(m[2]), Number(m[1]));
  }
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3)) + 1;
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = text.match(/^([a-z]+)[\s-]+(\d{2}|\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return month ? iso(year, month, 1) : null;
  }
  return null;
}

/**
 * A headcount. "1,200" is 1200; a band ("51-200", "51 to 200") is its LOWER
 * bound and "200+" is 200, because growth measured from a band's top would
 * overstate it. Null when unreadable or out of range.
 */
export function parseHeadcount(value: string | null | undefined): number | null {
  const text = (value ?? "").trim().toLowerCase().replace(/,/g, "").replace(/employees?|staff|people/g, "").trim();
  if (!text) return null;
  const m = text.match(/^(\d+)\s*(?:\+|(?:-|–|to)\s*\d+)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 && n <= MAX_HEADCOUNT ? n : null;
}

/** A technology list: split on commas, semicolons, pipes and new lines; de-duplicated case-insensitively. */
export function parseTechnologies(value: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (value ?? "").split(/[,;|\n]+/)) {
    const name = part.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_TECHNOLOGIES) break;
  }
  return out;
}

export type CompanyFacts = {
  contractRenewalDate: string | null;
  headcount: number | null;
  technologies: string[];
};

/** The zod row shape for the three cells, as the import stores them. */
export const companyFactsSchema = z.object({
  contractRenewalDate: z.iso.date().nullable(),
  headcount: z.number().int().min(0).max(MAX_HEADCOUNT).nullable(),
  technologies: z.array(z.string().min(1).max(60)).max(MAX_TECHNOLOGIES),
});

export function readCompanyFacts(cells: {
  contractRenewalDate?: string | null;
  headcount?: string | null;
  technologies?: string | null;
}): CompanyFacts {
  return companyFactsSchema.parse({
    contractRenewalDate: parseRenewalDate(cells.contractRenewalDate),
    headcount: parseHeadcount(cells.headcount),
    technologies: parseTechnologies(cells.technologies),
  });
}

export function hasCompanyFacts(facts: CompanyFacts): boolean {
  return facts.contractRenewalDate !== null || facts.headcount !== null || facts.technologies.length > 0;
}

/** One signal in the shape the intent recorder takes (providers/types.ts IntentResult). */
export type CustomerDataSignal = {
  category: null;
  domain: string;
  observedAt: string;
  strength: number;
  sourceUrl: null;
  evidence: IntentEvidence;
};

const SOURCE = INTENT_SOURCE_LABELS.CUSTOMER_DATA;

function signal(domain: string, now: Date, intentType: IntentTypeId, kind: IntentEvidence["kind"], strength: number, snippet: string, reference: string): CustomerDataSignal {
  const observedAt = now.toISOString();
  return {
    category: null,
    domain,
    observedAt,
    strength: Math.min(strength, strengthCap(intentType, strength)),
    sourceUrl: null,
    evidence: { kind, source: SOURCE, reference, observedAt, snippet: truncateSnippet(snippet), intentType },
  };
}

/**
 * The live signals one row's facts produce. `previousHeadcount` is what the
 * company record held before this import; `reference` identifies the import
 * row, so the evidence can be traced back to the file.
 */
export function companyFactSignals(input: {
  facts: CompanyFacts;
  previousHeadcount: number | null;
  domain: string;
  reference: string;
  now: Date;
}): CustomerDataSignal[] {
  const out: CustomerDataSignal[] = [];
  const { facts, now } = input;

  if (facts.contractRenewalDate) {
    const days = Math.round((Date.parse(`${facts.contractRenewalDate}T00:00:00Z`) - now.getTime()) / 86_400_000);
    if (days >= 0 && days <= RENEWAL_WINDOW_DAYS) {
      out.push(
        signal(input.domain, now, "CONTRACT_RENEWAL_WINDOW", "TRIGGER_EVENT", 0.8,
          `Contract renews on ${facts.contractRenewalDate} (in ${days} day${days === 1 ? "" : "s"}), from your own data`, input.reference),
      );
    }
  }

  if (facts.headcount !== null && input.previousHeadcount !== null && input.previousHeadcount > 0 && facts.headcount > input.previousHeadcount) {
    const growth = (facts.headcount - input.previousHeadcount) / input.previousHeadcount;
    out.push(
      signal(input.domain, now, "HEADCOUNT_GROWTH", "GROWTH", Math.min(0.7, 0.3 + growth),
        `Headcount ${facts.headcount} in your data, up from ${input.previousHeadcount} (${Math.round(growth * 100)}%)`, input.reference),
    );
  }

  for (const technology of facts.technologies) {
    out.push(signal(input.domain, now, "TECH_ADOPTED", "TECHNOLOGY", 0.5, `Uses ${technology}, per your own data`, `${input.reference}:${technology.toLowerCase()}`));
  }
  return out;
}
