import { z } from "zod";
import { parseCsv } from "../campaigns/csv.ts";
import {
  emailDomain,
  isGenericEmailDomain,
  normaliseCompanyName,
  normaliseDomain,
} from "../prospects/dedupe.ts";

/**
 * The customer's own list, imported from a CSV: LinkedIn's export of their
 * own 1st-degree connections, or any list they own (a CRM export, an event
 * list, a spreadsheet).
 *
 * Pure: column mapping, row validation, domain resolution and the dedupe
 * keys. The write is the service operation `prospect.import_linkedin_list`,
 * which creates a prospect for every valid row straight away.
 *
 * ## What is and is not supported
 *
 * LinkedIn offers members a native export of their own connections (Settings
 * → Data privacy → Get a copy of your data → Connections.csv). That file is
 * the customer's own data, and it is supported. Sales Navigator has no native
 * export, and LinkedIn prohibits extensions that scrape it, so this module
 * does not describe, detect or encourage such files. We never hold LinkedIn
 * credentials, never drive a session, never fetch a LinkedIn page.
 *
 * A 1st-degree connection is a relationship, not consent to marketing. The
 * write records it as ACCEPTED_SOCIAL_CONNECTION, which the policy engine
 * already limits to a non-promotional opener for individual-type subscribers
 * (sole traders, partnerships, personal addresses). Any other list is recorded
 * as IMPORTED, which needs consent for individuals.
 *
 * ## What is kept and what is not
 *
 *   * **Phone numbers are discarded.** ClientTurn cold-contacts by email only;
 *     a number has no purpose here, so it is never stored (CLAUDE.md, resolved
 *     conflict 6). The column is named in the result so the customer can see it
 *     was dropped on purpose.
 *   * **Email**, where the file has one, is kept as the customer's own data
 *     (origin CRM_IMPORTED: "the customer's own CRM or import file"). It is
 *     unverified and goes through verification like any other address.
 *   * Everything else is what readIngestedList needs: name, title, company,
 *     company domain, profile URL, location.
 *
 * ## The company's website is not required
 *
 * Most exports carry no website column. The domain is resolved in a fixed
 * order, and the order is recorded on the prospect's provenance:
 *
 *   1. a website or domain column (`WEBSITE_COLUMN`);
 *   2. the domain of a work email in the row, never a freemail domain
 *      (`WORK_EMAIL`);
 *   3. the Companies House register, by exact name -- server-side, only when
 *      a key is configured. The register publishes no website, so this can
 *      confirm the company but never supplies a domain;
 *   4. otherwise none (`UNRESOLVED`). The prospect is still created, labelled
 *      "Website unknown", and a person can add the website later.
 */

export const MAX_LINKEDIN_IMPORT_ROWS = 5_000;

/**
 * What kind of list a file is. LINKEDIN_CONNECTIONS is LinkedIn's own export
 * of the member's 1st-degree connections; CUSTOMER_LIST is anything else the
 * customer owns.
 */
export const LINKEDIN_SURFACES = ["LINKEDIN_CONNECTIONS", "CUSTOMER_LIST"] as const;
export type LinkedinSurface = (typeof LINKEDIN_SURFACES)[number];

type Field =
  | "firstName"
  | "lastName"
  | "fullName"
  | "roleTitle"
  | "companyName"
  | "companyDomain"
  | "linkedinUrl"
  | "location"
  | "email";

/** Header spellings seen in LinkedIn's Connections export and common CRM exports. */
const HEADER_ALIASES: Record<Field, string[]> = {
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  fullName: ["fullname", "name", "leadname", "contactname"],
  roleTitle: ["title", "jobtitle", "position", "currenttitle", "currentposition", "role", "headline"],
  companyName: ["company", "companyname", "currentcompany", "organization", "organisation", "account", "accountname", "employer"],
  companyDomain: ["companydomain", "domain", "companywebsite", "website", "companyurl", "websiteurl", "corporatewebsite"],
  linkedinUrl: ["linkedinurl", "profileurl", "linkedinprofile", "linkedinprofileurl", "url", "linkedin", "personlinkedinurl"],
  location: ["location", "geography", "region", "city", "personlocation"],
  email: ["email", "emailaddress", "workemail", "businessemail", "professionalemail"],
};

/** Columns that are always dropped, and named as dropped. */
const DISCARD_PATTERN = /phone|mobile|tel(ephone)?|cell|whatsapp/;

function key(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ColumnMapping = Partial<Record<Field, number>>;

export function mapColumns(headers: string[]): {
  mapping: ColumnMapping;
  discarded: string[];
  unmapped: string[];
} {
  const mapping: ColumnMapping = {};
  const discarded: string[] = [];
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const normal = key(header);
    if (DISCARD_PATTERN.test(normal)) {
      discarded.push(header);
      return;
    }
    const field = (Object.keys(HEADER_ALIASES) as Field[]).find(
      (candidate) => mapping[candidate] === undefined && HEADER_ALIASES[candidate].includes(normal),
    );
    if (field) mapping[field] = index;
    else if (normal) unmapped.push(header);
  });

  return { mapping, discarded, unmapped };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const LINKEDIN_PROFILE = /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^\s]+$/i;

export const linkedinImportRowSchema = z
  .object({
    firstName: optionalText(80),
    lastName: optionalText(80),
    roleTitle: optionalText(160),
    companyName: optionalText(160),
    // Optional: see "The company's website is not required" above. A freemail
    // domain in a website column says nothing about the employer and is
    // dropped rather than trusted.
    companyDomain: z
      .string()
      .trim()
      .max(253)
      .transform((value) => {
        const domain = normaliseDomain(value);
        return domain && !isGenericEmailDomain(domain) ? domain : null;
      })
      .nullable(),
    linkedinUrl: z
      .string()
      .trim()
      .max(400)
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .refine((value) => value === null || LINKEDIN_PROFILE.test(value), "Not a LinkedIn profile URL"),
    location: optionalText(160),
    email: z
      .string()
      .trim()
      .max(160)
      .transform((value) => (value === "" ? null : value.toLowerCase()))
      .nullable()
      .refine((value) => value === null || z.email().safeParse(value).success, "Not an email address"),
  })
  .refine((row) => Boolean(row.firstName || row.lastName), "No name")
  .refine(
    (row) => Boolean(row.companyName || row.companyDomain || workEmailDomain(row.email)),
    "No company",
  );

export type LinkedinImportRow = z.infer<typeof linkedinImportRowSchema>;

/* ---------------------------------------------------- domain resolution */

export const DOMAIN_RESOLUTIONS = [
  "WEBSITE_COLUMN",
  "WORK_EMAIL",
  "UNRESOLVED",
] as const;
export type DomainResolution = (typeof DOMAIN_RESOLUTIONS)[number];

/** A work email's domain; null for a freemail (Gmail, Outlook, ...) address. */
export function workEmailDomain(email: string | null | undefined): string | null {
  const domain = normaliseDomain(emailDomain(email ?? ""));
  return domain && !isGenericEmailDomain(domain) ? domain : null;
}

/**
 * Steps 1 and 2 of the order above. Step 3 (the register) needs the network
 * and runs server-side on the rows this leaves UNRESOLVED.
 */
export function resolveImportDomain(row: {
  companyDomain: string | null;
  email: string | null;
}): { domain: string | null; resolution: DomainResolution } {
  if (row.companyDomain) return { domain: row.companyDomain, resolution: "WEBSITE_COLUMN" };
  const fromEmail = workEmailDomain(row.email);
  if (fromEmail) return { domain: fromEmail, resolution: "WORK_EMAIL" };
  return { domain: null, resolution: "UNRESOLVED" };
}

/* ----------------------------------------------------------- dedupe keys */

/**
 * A LinkedIn profile URL reduced to what identifies the person: host, query,
 * fragment and trailing slash removed, lower-cased. Null when there is none.
 */
export function profileKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(/linkedin\.com\/(in)\/([^/?#\s]+)/i);
  if (!match) return null;
  let slug = match[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape is compared as written.
  }
  return `${match[1].toLowerCase()}/${slug.toLowerCase()}`;
}

/**
 * The fallback identity: normalised name plus the company, by domain where
 * known and by normalised name otherwise.
 */
export function personCompanyKey(input: {
  firstName: string | null;
  lastName: string | null;
  companyDomain: string | null;
  companyName: string | null;
}): string | null {
  const name = [input.firstName, input.lastName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const company = input.companyDomain ?? normaliseCompanyName(input.companyName);
  return name && company ? `${name}|${company}` : null;
}

/**
 * The prospect's subscriber type from its email and the register.
 *
 * The strictest wins, as everywhere else: a personal address is INDIVIDUAL
 * whatever the register says; a register partnership is PARTNERSHIP (an
 * individual-type subscriber under PECR); CORPORATE only when the address
 * itself assessed as corporate. No email means UNKNOWN, which sends nothing
 * until resolved.
 */
export function importSubscriberType(
  emailType: "CORPORATE" | "INDIVIDUAL" | "UNKNOWN",
  registryType: "CORPORATE" | "PARTNERSHIP" | "UNKNOWN" | null,
): "CORPORATE" | "PARTNERSHIP" | "INDIVIDUAL" | "UNKNOWN" {
  if (emailType === "INDIVIDUAL") return "INDIVIDUAL";
  if (registryType === "PARTNERSHIP") return "PARTNERSHIP";
  return emailType;
}

export type LinkedinImportResult = {
  surface: LinkedinSurface;
  rows: (LinkedinImportRow & { row: number })[];
  errors: { row: number; message: string }[];
  /** Columns deliberately dropped (phone numbers). */
  discardedColumns: string[];
  unmappedColumns: string[];
  /** Set when the file cannot be read at all. */
  problem: string | null;
};

/**
 * Which kind of list a file is. LinkedIn's Connections export has a
 * "Connected On" column, which nothing else in this vocabulary uses; any
 * other file is recorded as the customer's own list, the honest default.
 */
export function detectSurface(headers: string[]): LinkedinSurface {
  return headers.some((header) => key(header) === "connectedon") ? "LINKEDIN_CONNECTIONS" : "CUSTOMER_LIST";
}

function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function parseLinkedinExport(
  csv: string,
  surfaceHint: LinkedinSurface | null = null,
): LinkedinImportResult {
  const empty = (problem: string): LinkedinImportResult => ({
    surface: surfaceHint ?? "CUSTOMER_LIST",
    rows: [],
    errors: [],
    discardedColumns: [],
    unmappedColumns: [],
    problem,
  });

  // LinkedIn's own Connections export starts with a few "Notes:" lines before
  // the header. Skip to the first line that looks like a header.
  const table = parseCsv(csv);
  const headerIndex = table.findIndex((cells) => {
    const { mapping } = mapColumns(cells);
    return (mapping.firstName !== undefined || mapping.fullName !== undefined) &&
      (mapping.companyName !== undefined || mapping.companyDomain !== undefined || mapping.email !== undefined);
  });
  if (headerIndex < 0) {
    return empty("No name and company columns were found. Export with first name, last name and company columns.");
  }

  const { mapping, discarded, unmapped } = mapColumns(table[headerIndex]);
  const body = table.slice(headerIndex + 1);
  if (body.length === 0) return empty("The file has a header but no rows.");
  if (body.length > MAX_LINKEDIN_IMPORT_ROWS) {
    return empty(`The file has ${body.length.toLocaleString("en-GB")} rows. Import at most ${MAX_LINKEDIN_IMPORT_ROWS.toLocaleString("en-GB")} at a time.`);
  }

  const cell = (cells: string[], field: Field) => {
    const index = mapping[field];
    return index === undefined ? "" : (cells[index] ?? "");
  };

  const rows: LinkedinImportResult["rows"] = [];
  const errors: LinkedinImportResult["errors"] = [];

  body.forEach((cells, offset) => {
    const row = headerIndex + offset + 2; // 1-based, counting the header line
    let first = cell(cells, "firstName");
    let last = cell(cells, "lastName");
    if (!first && !last && cell(cells, "fullName")) {
      ({ first, last } = splitFullName(cell(cells, "fullName")));
    }

    const parsed = linkedinImportRowSchema.safeParse({
      firstName: first,
      lastName: last,
      roleTitle: cell(cells, "roleTitle"),
      companyName: cell(cells, "companyName"),
      companyDomain: cell(cells, "companyDomain"),
      linkedinUrl: cell(cells, "linkedinUrl"),
      location: cell(cells, "location"),
      email: cell(cells, "email"),
    });

    if (parsed.success) rows.push({ ...parsed.data, row });
    else errors.push({ row, message: parsed.error.issues[0]?.message ?? "Invalid row" });
  });

  return {
    surface: surfaceHint ?? detectSurface(table[headerIndex]),
    rows,
    errors,
    discardedColumns: discarded,
    unmappedColumns: unmapped,
    problem: null,
  };
}
