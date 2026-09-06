/**
 * Company and contact identity (V4 §60).
 *
 * Two rules shape everything here:
 *   1. An existing customer or lead ALWAYS takes precedence over creating a new
 *      cold prospect (§60.3). Sourcing must never re-discover the business's own
 *      customers and start cold-emailing them.
 *   2. A name-based match is grounds for REVIEW, never for a silent destructive
 *      merge. Only an exact normalised email, domain or registration ID is
 *      strong enough to merge on.
 *
 * Pure and unit-testable; the lookups live in `service.ts`.
 */

/** Public suffixes that are one label deeper than the usual `example.com`. */
const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br", "co.jp", "co.in",
  "com.sg", "co.kr",
]);

/** Free and disposable mailbox hosts. A prospect on one of these is a person,
 *  not a company domain, so it must never become a company's dedupe key. */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "ymail.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "msn.com", "protonmail.com", "proton.me",
  "gmx.com", "gmx.co.uk", "mail.com", "zoho.com", "yandex.com", "btinternet.com",
  "sky.com", "virginmedia.com", "talktalk.net", "blueyonder.co.uk", "ntlworld.com",
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "temp-mail.org", "dispostable.com", "maildrop.cc",
]);

/**
 * Mailbox names that belong to a function rather than a person. Cold outreach
 * to these is both lower value and higher complaint risk, so they are scored
 * down and flagged rather than treated as a discovered decision maker.
 */
const ROLE_MAILBOXES = new Set([
  "info", "hello", "contact", "enquiries", "enquiry", "admin", "office",
  "sales", "support", "help", "team", "mail", "post", "reception", "accounts",
  "billing", "finance", "hr", "jobs", "careers", "marketing", "press", "media",
  "noreply", "no-reply", "donotreply", "webmaster", "postmaster", "abuse",
]);

export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  // Reject anything with whitespace or a second @, rather than trying to repair it.
  if (/\s/.test(trimmed) || trimmed.split("@").length !== 2) return null;
  const [local, domain] = trimmed.split("@");
  if (!local || !domain || !domain.includes(".")) return null;
  return trimmed;
}

export function emailDomain(email: string | null | undefined): string | null {
  const normalised = normaliseEmail(email);
  return normalised ? normalised.split("@")[1] : null;
}

export function emailLocalPart(email: string | null | undefined): string | null {
  const normalised = normaliseEmail(email);
  return normalised ? normalised.split("@")[0] : null;
}

export function isGenericEmailDomain(domain: string | null | undefined): boolean {
  return domain ? GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase()) : false;
}

export function isDisposableEmailDomain(domain: string | null | undefined): boolean {
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain.toLowerCase()) : false;
}

/** True for info@, sales@ and friends — a shared inbox, not an individual. */
export function isRoleMailbox(email: string | null | undefined): boolean {
  const local = emailLocalPart(email);
  if (!local) return false;

  // The whole local part first, so hyphenated names in the list ("no-reply")
  // are matched before the separator split would break them apart.
  if (ROLE_MAILBOXES.has(local)) return true;

  // Then the leading segment, so `sales.uk@` and `info_team@` still match.
  const head = local.split(/[.\-_+]/)[0];
  return ROLE_MAILBOXES.has(head);
}

/**
 * Reduces a URL or host to its registrable domain: strips scheme, path, port,
 * `www.`, and keeps the public-suffix-aware last labels.
 */
export function normaliseDomain(value: string | null | undefined): string | null {
  if (!value) return null;

  let host = value.trim().toLowerCase();
  if (!host) return null;

  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0].split("?")[0].split("#")[0];
  host = host.split("@").pop() ?? host;
  host = host.split(":")[0];
  host = host.replace(/^www\./, "").replace(/\.$/, "");

  if (!host || !host.includes(".") || /\s/.test(host)) return null;

  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/** Company-name normalisation for the fallback key: drops legal suffixes,
 *  punctuation and case so "Acme Roofing Ltd." and "ACME ROOFING LIMITED" meet. */
const LEGAL_SUFFIXES = [
  "limited", "ltd", "llp", "lp", "plc", "inc", "incorporated", "corp",
  "corporation", "company", "co", "gmbh", "bv", "nv", "sa", "srl", "pty",
  "llc", "holdings", "group",
];

export function normaliseCompanyName(value: string | null | undefined): string | null {
  if (!value) return null;
  let name = value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;

  // Strip trailing legal suffixes, repeatedly ("Acme Ltd Group").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (name.endsWith(` ${suffix}`)) {
        name = name.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return name || null;
}

export function normalisePostcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.toUpperCase().replace(/\s+/g, "");
  return cleaned || null;
}

/**
 * The company dedupe key written to `prospect_companies.dedupe_key`.
 *
 * Domain is strongly preferred; the name+location fallback exists only so a
 * company with no website still gets a stable key rather than duplicating on
 * every run.
 */
export function companyDedupeKey(input: {
  domain?: string | null;
  website?: string | null;
  registrationId?: string | null;
  name?: string | null;
  postcode?: string | null;
  city?: string | null;
}): string {
  const domain = normaliseDomain(input.domain ?? input.website);
  if (domain && !isGenericEmailDomain(domain)) return `domain:${domain}`;

  const registration = input.registrationId?.trim().toUpperCase();
  if (registration) return `reg:${registration}`;

  const name = normaliseCompanyName(input.name);
  const place =
    normalisePostcode(input.postcode) ??
    (input.city ? input.city.trim().toLowerCase().replace(/\s+/g, "") : null);

  if (name && place) return `name:${name}|${place}`;
  if (name) return `name:${name}`;

  // Nothing identifying at all. A random key keeps the NOT NULL constraint
  // satisfied without collapsing unrelated companies into one row.
  return `unknown:${cryptoRandom()}`;
}

function cryptoRandom(): string {
  // globalThis.crypto is available in both the Node and Edge runtimes Next uses.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ------------------------------------------------------------ match verdicts */

export type MatchStrength = "EXACT" | "STRONG" | "WEAK" | "NONE";

export type DuplicateVerdict = {
  strength: MatchStrength;
  /** What the caller should do. MERGE is only ever returned for EXACT. */
  action: "MERGE" | "REVIEW" | "CREATE";
  reason: string;
};

/**
 * Decides how to treat a candidate against an existing record.
 *
 * The asymmetry is deliberate: an exact email match is safe to merge, a shared
 * domain plus the same person name is a review, and a bare name match is not
 * evidence at all.
 */
export function classifyContactMatch(
  candidate: { email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; companyDomain?: string | null },
  existing: { email?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null; companyDomain?: string | null },
): DuplicateVerdict {
  const candidateEmail = normaliseEmail(candidate.email);
  const existingEmail = normaliseEmail(existing.email);

  if (candidateEmail && existingEmail && candidateEmail === existingEmail) {
    return { strength: "EXACT", action: "MERGE", reason: "Same email address" };
  }

  if (candidate.phone && existing.phone && candidate.phone === existing.phone) {
    return { strength: "EXACT", action: "MERGE", reason: "Same phone number" };
  }

  const sameName =
    Boolean(candidate.firstName && candidate.lastName) &&
    candidate.firstName?.trim().toLowerCase() === existing.firstName?.trim().toLowerCase() &&
    candidate.lastName?.trim().toLowerCase() === existing.lastName?.trim().toLowerCase();

  const candidateDomain = normaliseDomain(candidate.companyDomain);
  const existingDomain = normaliseDomain(existing.companyDomain);
  const sameCompany = Boolean(candidateDomain && existingDomain && candidateDomain === existingDomain);

  if (sameName && sameCompany) {
    return {
      strength: "STRONG",
      action: "REVIEW",
      reason: "Same name at the same company, but a different contact address",
    };
  }

  if (sameName) {
    return { strength: "WEAK", action: "CREATE", reason: "Same name only" };
  }

  return { strength: "NONE", action: "CREATE", reason: "No match" };
}

/**
 * The free/cheap checks that run before any paid provider call (§59.2). Each
 * returned flag is a reason to stop spending on this candidate.
 */
export type CheapCheckResult = {
  flags: string[];
  /** True when the candidate should not proceed to paid enrichment at all. */
  reject: boolean;
};

export function cheapChecks(candidate: {
  email?: string | null;
  domain?: string | null;
  companyName?: string | null;
}): CheapCheckResult {
  const flags: string[] = [];
  const email = normaliseEmail(candidate.email);
  const domain = normaliseDomain(candidate.domain) ?? emailDomain(email);

  if (candidate.email && !email) flags.push("INVALID_EMAIL_SYNTAX");
  if (isDisposableEmailDomain(domain)) flags.push("DISPOSABLE_DOMAIN");
  if (isGenericEmailDomain(domain)) flags.push("GENERIC_MAILBOX_DOMAIN");
  if (email && isRoleMailbox(email)) flags.push("ROLE_MAILBOX");
  if (!candidate.companyName && !domain) flags.push("NO_COMPANY_IDENTITY");

  // A disposable address or an unusable syntax is worthless; a role mailbox or
  // a personal-domain contact is merely weaker, and is scored down instead.
  const reject =
    flags.includes("INVALID_EMAIL_SYNTAX") ||
    flags.includes("DISPOSABLE_DOMAIN") ||
    flags.includes("NO_COMPANY_IDENTITY");

  return { flags, reject };
}
