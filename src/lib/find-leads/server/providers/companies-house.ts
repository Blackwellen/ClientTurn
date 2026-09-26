import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  isRecognisedRegistryType,
  subscriberTypeForRegistryEntry,
} from "@/lib/policy/subscriber-classification";
import {
  filingCategoriesFor,
  registerSignals,
  type ChFiling,
  type ChOfficer,
  type ChProfile,
  type RegisterWants,
} from "../../companies-house-signals";
import {
  providerFailure,
  type CompanyCandidate,
  type IntentCompany,
  type IntentResult,
  type IntentWants,
  type ProviderResponse,
  type SourcingProvider,
} from "./types";

/**
 * Companies House: is this actually a company?
 *
 * The UK register, free, official, and the only source that can answer the one
 * question the compliance engine most needs and previously could not ask.
 *
 * ## The gap this closes
 *
 * `policy/types.ts` has distinguished `CORPORATE`, `SOLE_TRADER`, `PARTNERSHIP`
 * and `INDIVIDUAL` since the packs were written, and the packs treat them
 * differently for good reason: under PECR the corporate-subscriber exemption
 * from consent applies to incorporated bodies and LLPs, and **not** to sole
 * traders or unincorporated partnerships, who are treated as individuals.
 *
 * But nothing could ever produce those middle two values. `contact-legality`
 * returns only `CORPORATE | INDIVIDUAL | UNKNOWN`, derived from the *email
 * domain* — so a sole trader trading as "Northgate Roofing" from
 * `hello@northgateroofing.co.uk` was classified `CORPORATE`, and the pack's
 * careful distinction was unreachable from sourced data. The rule existed and
 * was unenforceable.
 *
 * A register match is what makes it answerable. It is also the cheapest
 * possible answer: the API is free, and a lookup costs one call against a
 * name we already hold.
 *
 * ## What a miss means, and what it does not
 *
 * **A miss is not proof of a sole trader.** A company can be absent from a
 * name search because it trades under a name that differs from its registered
 * one, which is extremely common — "Northgate Roofing" may be registered as
 * "N. Hartley Ltd". So a miss yields `UNKNOWN`, never `SOLE_TRADER`, and
 * `UNKNOWN` is the conservative value: the packs put it in
 * `reviewSubscriberTypes`, so it reaches a person rather than being contacted
 * on an assumption.
 *
 * A *hit* is strong evidence, and it is the direction that matters — it is what
 * lets a workspace assert the corporate exemption with something behind it.
 */

type CompanySearchItem = {
  company_number?: string;
  title?: string;
  company_status?: string;
  company_type?: string;
  address_snippet?: string;
  date_of_creation?: string;
};

function key(): string | undefined {
  return serverEnv.sourcing.companiesHouseApiKey;
}

// Which register types are corporate subscribers lives in
// `policy/subscriber-classification.ts`, so the rule is stated once and tested.

/** What a register lookup concluded about one trading name. */
export type RegistryVerdict = {
  /** The register's own subscriber classification, for `policy/types.ts`. */
  subscriberType: "CORPORATE" | "PARTNERSHIP" | "UNKNOWN";
  companyNumber: string | null;
  registeredName: string | null;
  status: string | null;
  companyType: string | null;
  /** A sentence for the prospect record. Written for a customer to read. */
  reason: string;
};

const UNRESOLVED: RegistryVerdict = {
  subscriberType: "UNKNOWN",
  companyNumber: null,
  registeredName: null,
  status: null,
  companyType: null,
  reason:
    "No match on the Companies House register for this trading name. That does not mean they are not a company — many trade under a name that differs from the registered one — so this is left for a person to confirm rather than assumed either way.",
};

/**
 * Normalises for comparison, not for display.
 *
 * Suffixes are stripped because "Northgate Roofing" and "Northgate Roofing
 * Limited" are the same company, and punctuation because "N.H. Ltd" and "NH
 * Ltd" are too. Deliberately conservative: this only decides whether a match is
 * close enough to trust, and a false match asserts a corporate exemption that
 * does not apply.
 */
function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(limited|ltd|plc|llp|llc|company|co|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Looks one trading name up on the register.
 *
 * Exported on its own because the compliance path needs it for a single
 * prospect, outside any sourcing run.
 */
export async function lookupCompany(name: string): Promise<RegistryVerdict> {
  const apiKey = key();
  if (!apiKey || !name.trim()) return UNRESOLVED;

  const result = await providerJson<{ items?: CompanySearchItem[] }>({
    url: `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`,
    headers: {
      // Companies House uses HTTP Basic with the key as the username and an
      // empty password.
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });

  if (!result.ok) return UNRESOLVED;

  const wanted = normaliseName(name);
  const match = (result.data.items ?? []).find(
    (item) => item.title && normaliseName(item.title) === wanted,
  );

  // Only an exact normalised match counts. Companies House search is fuzzy and
  // will happily return "Northgate Roofing Supplies Ltd" for "Northgate
  // Roofing" -- a different company, whose incorporation says nothing about
  // the one we are about to contact.
  if (!match?.company_number) return UNRESOLVED;

  const type = (match.company_type ?? "").toLowerCase();
  const status = match.company_status ?? null;

  if (!isRecognisedRegistryType(type)) {
    return {
      ...UNRESOLVED,
      companyNumber: match.company_number,
      registeredName: match.title ?? null,
      status,
      companyType: match.company_type ?? null,
      reason: `Found on the register as "${match.title}", but its type (${match.company_type}) is not one the corporate-subscriber exemption clearly covers, so it is left for a person to confirm.`,
    };
  }

  // A dissolved company is a real finding, not a near-miss: contacting one is
  // pointless, and the record should say so rather than reporting a clean
  // corporate match.
  if (status && status !== "active") {
    return {
      subscriberType: "UNKNOWN",
      companyNumber: match.company_number,
      registeredName: match.title ?? null,
      status,
      companyType: match.company_type ?? null,
      reason: `Found on the register as "${match.title}", but its status is "${status}" rather than active.`,
    };
  }

  return {
    subscriberType: subscriberTypeForRegistryEntry(type, match.company_number),
    companyNumber: match.company_number,
    registeredName: match.title ?? null,
    status,
    companyType: match.company_type ?? null,
    reason: `Confirmed on the Companies House register as "${match.title}" (${match.company_number}), an active ${match.company_type}.`,
  };
}

/**
 * Enriches companies with their register identity.
 *
 * `COMPANY_ENRICHMENT` rather than a capability of its own: what it adds is
 * facts about a company we already found, which is exactly what that capability
 * means. It is free, so it runs before any paid enricher in the waterfall.
 */
async function enrichCompanies(input: {
  companies: CompanyCandidate[];
}): Promise<ProviderResponse<CompanyCandidate>> {
  if (!key()) return unconfigured<CompanyCandidate>();

  const records: CompanyCandidate[] = [];
  const startedAt = Date.now();

  for (const company of input.companies) {
    if (!company.name) continue;

    const verdict = await lookupCompany(company.name);
    if (!verdict.companyNumber) continue;

    records.push({
      ...company,
      // The registered name is the legal identity and belongs on the record;
      // the trading name the customer recognises is kept as-is elsewhere.
      registrationId: verdict.companyNumber,
      registeredName: verdict.registeredName,
      subscriberType: verdict.subscriberType,
      registryReason: verdict.reason,
    } as CompanyCandidate);
  }

  if (records.length === 0 && input.companies.length > 0) {
    return providerFailure<CompanyCandidate>(
      "PROVIDER_BAD_RESPONSE",
      Date.now() - startedAt,
    );
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: Date.now() - startedAt,
    errorCode: null,
  };
}

/* ------------------------------------------------------------- intent */

const API = "https://api.company-information.service.gov.uk";

function authHeaders(apiKey: string): Record<string, string> {
  // HTTP Basic with the key as the username and an empty password.
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
}

/**
 * Register events as buying signals: share allotments (FUNDING), director
 * appointments (JOB_CHANGE), incorporation (NEW_COMPANY) and registered-office
 * changes (EXPANSION). What each means, and what is deliberately not kept, is
 * in `companies-house-signals.ts`.
 *
 * Only companies enrichment already matched to a company number are checked:
 * a signal on the wrong company is worse than none, and the name match that
 * produced the number is the conservative one above.
 *
 * At most three calls per company, and only the ones the plan asked for. The
 * register's published limit is 600 requests per five minutes per key; a
 * batch of 25 companies stays well inside it, and a 429 comes back as
 * PROVIDER_RATE_LIMIT through `providerJson`, which the router backs off on.
 */
async function fetchIntent(input: {
  domains: string[];
  freshnessDays: number;
  wants?: IntentWants;
  companies?: IntentCompany[];
}): Promise<ProviderResponse<IntentResult>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<IntentResult>();

  const kinds = new Set(input.wants?.kinds ?? []);
  const wants: RegisterWants = {
    funding: kinds.has("FUNDING"),
    leadership: kinds.has("JOB_CHANGE"),
    incorporation: kinds.has("NEW_COMPANY"),
    officeMove: kinds.has("EXPANSION"),
  };
  const empty = { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  if (!wants.funding && !wants.leadership && !wants.incorporation && !wants.officeMove) return empty;

  const wanted = new Set(input.domains);
  const targets = (input.companies ?? []).filter(
    (company): company is IntentCompany & { registrationId: string } =>
      wanted.has(company.domain) && Boolean(company.registrationId),
  );
  if (targets.length === 0) return empty;

  const started = Date.now();
  const now = new Date();
  const headers = authHeaders(apiKey);
  const records: IntentResult[] = [];
  const categories = filingCategoriesFor(wants);

  for (const company of targets) {
    const number = encodeURIComponent(company.registrationId);

    let profile: ChProfile | null = null;
    if (wants.incorporation || wants.leadership) {
      // The profile's creation date also tells a founding board from a change.
      const result = await providerJson<ChProfile>({ url: `${API}/company/${number}`, headers });
      if (!result.ok && result.code === "PROVIDER_RATE_LIMIT") {
        return providerFailure<IntentResult>(result.code, Date.now() - started);
      }
      if (result.ok) profile = result.data;
    }

    let officers: ChOfficer[] = [];
    if (wants.leadership) {
      const result = await providerJson<{ items?: ChOfficer[] }>({
        url: `${API}/company/${number}/officers?items_per_page=50&order_by=appointed_on`,
        headers,
      });
      if (!result.ok && result.code === "PROVIDER_RATE_LIMIT") {
        return providerFailure<IntentResult>(result.code, Date.now() - started);
      }
      // Only the role and the dates are read. Names are never copied out of
      // the response, so they cannot reach storage.
      if (result.ok) {
        officers = (result.data.items ?? []).map((item) => ({
          officer_role: item.officer_role,
          appointed_on: item.appointed_on,
          resigned_on: item.resigned_on,
        }));
      }
    }

    let filings: ChFiling[] = [];
    if (categories.length > 0) {
      const result = await providerJson<{ items?: ChFiling[] }>({
        url: `${API}/company/${number}/filing-history?items_per_page=50&category=${categories.join(",")}`,
        headers,
      });
      if (!result.ok && result.code === "PROVIDER_RATE_LIMIT") {
        return providerFailure<IntentResult>(result.code, Date.now() - started);
      }
      if (result.ok) filings = result.data.items ?? [];
    }

    for (const signal of registerSignals({
      companyNumber: company.registrationId,
      profile,
      officers,
      filings,
      wants,
      now,
      freshnessDays: input.freshnessDays,
    })) {
      records.push({
        category: null,
        domain: company.domain,
        observedAt: signal.observedAt,
        strength: signal.strength,
        sourceUrl: signal.reference,
        evidence: {
          kind: signal.kind,
          source: "Companies House",
          reference: signal.reference,
          observedAt: signal.observedAt,
          snippet: signal.snippet,
        },
      });
    }
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs: Date.now() - started,
    errorCode: null,
  };
}

export const companiesHouseProvider: SourcingProvider = {
  key: "companies_house",
  displayName: "Companies House",
  // INTENT as well: dated register events are the free, official source for
  // the FUNDING and JOB_CHANGE signal kinds.
  capabilities: ["COMPANY_ENRICHMENT", "INTENT"],
  // Free and official, so it runs before anything metered.
  costRank: 0,
  freeOfCharge: true,
  configured: () => Boolean(key()),
  enrichCompanies,
  fetchIntent,
};
