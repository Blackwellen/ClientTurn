/**
 * The Companies House number a company publishes on its own website. Pure.
 *
 * ## Why this exists (2026-09-29)
 *
 * Google Places is discovery-only (B24): a Places company arrives with its
 * domain standing in as its name, because we may not keep the name Google
 * gave it. Companies House enrichment then searched the register for that
 * placeholder ("northwindstudio.co.uk"), and an exact-name match on a domain
 * never happens. So no Places-found company was ever confirmed as an
 * incorporated body, every one stayed UNKNOWN, and the UK pack correctly sent
 * every cold prospect at them to review: nothing Find Leads found could ever
 * be emailed.
 *
 * A UK company must show its registered number on its website (The Company,
 * Limited Liability Partnership and Business (Names and Trading Disclosures)
 * Regulations 2015, reg 24), usually in the footer of every page. Reading it
 * there is first-party, free, and far stronger than any name match: the number
 * is the register's own key, looked up directly.
 *
 * Deliberately conservative: a number only counts when it sits next to words
 * that say it is a company or registration number. A phone number, a VAT
 * number or an order reference in the same footer is not one.
 */

/** Register prefixes (England/Wales numbers are 8 digits with none). */
const PREFIXES = "SC|NI|OC|SO|NC|LP|SL|NL|FC|SF|NF|IP|SP|RS|IC|SI|GE|GN|GS|R0|CE|CS";

/** Label, optional filler of up to ~40 chars, then the number. */
const PATTERN = new RegExp(
  String.raw`\b(?:company|registration|registered|reg\.?)\b[^0-9\n]{0,48}?\b((?:${PREFIXES})\s?\d{5,6}|\d{6,8})\b`,
  "gi",
);

/** Words that mean the number next to them is something else. */
const NOT_A_COMPANY_NUMBER = /\b(vat|tel|telephone|phone|fax|mobile|charity|fca|firm reference|frn|sra|ico|order|invoice)\b/i;

/** Canonical form: prefix + 6 digits, or 8 digits zero-padded. */
export function normaliseCompanyNumber(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const prefixed = new RegExp(`^(${PREFIXES})(\\d{5,6})$`).exec(compact);
  if (prefixed) return `${prefixed[1]}${prefixed[2].padStart(6, "0")}`;
  if (/^\d{6,8}$/.test(compact)) return compact.padStart(8, "0");
  return null;
}

/**
 * Company numbers stated in a page's text, most likely first, deduplicated.
 * Empty when the page says nothing that is clearly a company number.
 */
export function companyNumbersFromText(text: string): string[] {
  const found: string[] = [];
  const flat = text.replace(/\s+/g, " ");
  for (const match of flat.matchAll(PATTERN)) {
    const window = match[0];
    // "Registered office: ... Tel 01202 123456" must not yield the phone number.
    const beforeNumber = window.slice(0, window.length - match[1].length);
    if (NOT_A_COMPANY_NUMBER.test(beforeNumber)) continue;
    const number = normaliseCompanyNumber(match[1]);
    if (number && !found.includes(number)) found.push(number);
  }
  return found;
}

/** True when a company's stored name is still the domain placeholder Places left. */
export function isDomainPlaceholderName(name: string | null | undefined, domain: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;
  if (domain && n === domain.trim().toLowerCase()) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n);
}
