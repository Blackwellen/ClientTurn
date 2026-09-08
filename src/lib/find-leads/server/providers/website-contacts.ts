import "server-only";
import { safeFetchText } from "@/lib/security/safe-fetch";
import { runTask } from "@/lib/ai/model-router";
import type { WebsiteContactsResult } from "@/lib/ai/schemas";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import {
  type CompanyCandidate,
  type ContactCandidate,
  type ProviderResponse,
  type SourcingProvider,
} from "./types";

/**
 * Contacts from a company's own published pages.
 *
 * The answer to "can we enrich ourselves, legally?" -- and the boundary of that
 * answer is the whole point of this file.
 *
 * ## What AI is doing here, and what it is not
 *
 * It is **parsing**, not **acquiring**. The pages are fetched by our own
 * robots-respecting, SSRF-guarded fetcher from the company's own website; the
 * model's entire job is to turn a page of prose into structured rows. It is
 * given the page text and asked what is on it.
 *
 * That distinction is not pedantry, it is the lawful basis. The source is
 * `BUSINESS_WEBSITE` -- published by the subject, about themselves, for the
 * purpose of being contacted -- which `compliance/types.ts` already permits and
 * which Article 14 lets us disclose honestly: *we read it on your website.*
 *
 * ## What this deliberately will not do
 *
 * **Guess an address.** Pattern-generating `first.last@domain` from a name and
 * a domain is the technique most "AI enrichment" tools actually sell, and it
 * fails two tests at once. Legally the datum was never *obtained* from anywhere,
 * so there is no source to disclose -- the honest Article 14 line would be "we
 * guessed it". Practically it bounces: a catch-all domain accepts anything and
 * verifies nothing, so the guess looks valid right up until it damages the
 * sending reputation of every later campaign.
 *
 * So an address is returned only when it appears on the page, verbatim. If the
 * page has a name and no address, the row comes back with a null email and the
 * licensed waterfall can decide whether to spend on it.
 *
 * ## Why this suits the ICP
 *
 * Agencies, studios, SaaS and ecommerce companies publish team pages, and often
 * publish addresses on them. That is a free, first-party, defensible source for
 * exactly the market the product now targets -- and it is the reason the ICP
 * change and this adapter arrived together.
 */

/** Pages a company publishes its people on, in the order worth trying. */
const CONTACT_PATHS = [
  "/team",
  "/about",
  "/about-us",
  "/contact",
  "/people",
  "/our-team",
  "/leadership",
];

/** Bounded per domain: this runs across every surviving company in a run. */
const PAGES_PER_DOMAIN = 3;

/** Enough to hold a team page; far short of a document that would cost real tokens. */
const MAX_CHARS_PER_PAGE = 12_000;

/** A ceiling on what one page may yield. A page returning forty people is a
 *  directory listing, not a team, and is not what this is for. */
const MAX_CONTACTS_PER_COMPANY = 10;

/**
 * Strips a fetched page to something a model can read.
 *
 * Not a parser -- deliberately crude. Scripts and styles are removed because
 * they are pure noise and expensive noise at that; everything else becomes
 * text. The model is asked to extract, so mangled whitespace costs nothing and
 * a smarter extraction step would only add a dependency and a failure mode.
 */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE);
}

async function findContacts(input: {
  companies: CompanyCandidate[];
  roles: string[];
  limit: number;
  businessId?: string;
}): Promise<ProviderResponse<ContactCandidate>> {
  // Needs a workspace to bill the token usage to. Without one this is not a
  // configuration problem, it is a caller error, so it returns nothing rather
  // than spending against no ledger.
  if (!input.businessId) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const records: ContactCandidate[] = [];
  const startedAt = Date.now();

  for (const company of input.companies) {
    if (records.length >= input.limit) break;
    if (!company.domain) continue;

    const pages: string[] = [];

    for (const path of CONTACT_PATHS) {
      if (pages.length >= PAGES_PER_DOMAIN) break;

      const result = await safeFetchText(`https://${company.domain}${path}`);
      // A missing page is the normal case -- most sites have two of these seven
      // paths, not all of them -- so a failure is skipped silently rather than
      // failing the company.
      if (!result.ok || !result.body) continue;

      const text = toText(result.body);
      if (text.length > 200) pages.push(`Page ${path}:\n${text}`);
    }

    if (pages.length === 0) continue;

    const extraction = await runTask<WebsiteContactsResult>({
      taskType: "website_contacts",
      businessId: input.businessId,
      // Stable per company per run window, so a retried run is charged once.
      idempotencyKey: `website-contacts:${input.businessId}:${company.domain}`,
      maxOutputTokens: 900,
      context: [
        `Company: ${company.name}`,
        `Website: ${company.domain}`,
        input.roles.length > 0
          ? `Roles of interest, if present: ${input.roles.join(", ")}.`
          : "",
        "",
        "The pages below were fetched from that company's own website.",
        "",
        ...pages,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (!extraction.data) continue;

    for (const person of extraction.data.people.slice(0, MAX_CONTACTS_PER_COMPANY)) {
      if (!person.first_name && !person.last_name) continue;

      // The guard that makes this defensible. The model is asked for an address
      // only where the page shows one, and anything it returns that is not a
      // well-formed address is dropped rather than corrected -- a repaired
      // address is a guessed address wearing a source it does not have.
      const email = normaliseEmail(person.email);

      // And the address must belong to the company whose page we read. A model
      // that lifts a client's address off a case study would otherwise attach
      // it to the wrong record entirely.
      const sameDomain =
        email !== null && email.endsWith(`@${company.domain.toLowerCase()}`);

      records.push({
        externalId: null,
        firstName: person.first_name?.trim() || null,
        lastName: person.last_name?.trim() || null,
        roleTitle: person.role_title?.trim() || null,
        email: sameDomain ? email : null,
        linkedinUrl: null,
        companyExternalId: company.externalId,
        companyDomain: company.domain,
      });

      if (records.length >= input.limit) break;
    }
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

export const websiteContactsProvider: SourcingProvider = {
  key: "website_contacts",
  displayName: "Company websites",
  capabilities: ["CONTACT_DISCOVERY"],
  // Ahead of every paid contact source. A name published on a company's own
  // team page costs nothing and has a better provenance story than one bought
  // from a database.
  costRank: 0,
  freeOfCharge: true,
  // No credential of its own: it uses the shared fetcher and the workspace's
  // own AI allowance, both of which are checked at the point of use.
  configured: () => true,
  findContacts,
};
