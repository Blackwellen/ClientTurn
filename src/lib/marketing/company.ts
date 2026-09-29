/**
 * Public-facing company identity.
 *
 * These values are the registered particulars of the operating company as
 * shown on the Companies House public register, and are relied on by the
 * marketing footer and every legal page to satisfy the disclosure duties in
 * the Companies Act 2006 (s.82 and s.1064) and regulation 6 of the Electronic
 * Commerce (EC Directive) Regulations 2002. Do not edit them to anything that
 * is not on the register.
 *
 * ClientTurn is a trading name — not a separate legal person. Every contract
 * formed through this site is with BLACKWELLEN LIMITED.
 */
export const COMPANY = {
  /** Trading name / product brand. */
  product: "ClientTurn",
  /** Registered name exactly as it appears on the register. */
  registeredName: "Blackwellen Limited",
  /** Companies House registered number (England and Wales). */
  companyNumber: "16482166",
  /** Registered office, as filed. */
  registeredAddress:
    "61 Bridge Street, Kington, Herefordshire, HR5 3DJ, United Kingdom",
  registeredAddressLines: [
    "Blackwellen Limited",
    "61 Bridge Street",
    "Kington",
    "Herefordshire",
    "HR5 3DJ",
    "United Kingdom",
  ],
  /** Jurisdiction of incorporation. */
  jurisdiction: "England and Wales",
  incorporatedOn: "29 May 2025",
  registerUrl:
    "https://find-and-update.company-information.service.gov.uk/company/16482166",

  /**
   * The only two mailboxes currently in service. Everything commercial,
   * technical and support-related goes to support@; anything that is a formal
   * legal notice, a data-protection request or a regulator enquiry goes to
   * legal@. Do not add addresses here that are not actually monitored.
   */
  supportEmail: "support@clientturn.com",
  legalEmail: "legal@clientturn.com",

  /**
   * Empty until the corresponding registration actually exists. Every surface
   * that renders these checks first, so the site can never publish a number we
   * do not hold.
   */
  vatNumber: "",
  /** ICO register of fee payers, verified 2026-09-29: Blackwellen Ltd, registered 29 May 2026, expires 28 May 2027 (renew before then). */
  icoRegistration: "ZC160806",
} as const;

/**
 * Date the legal pack was last substantively revised. 28 September 2026: the
 * privacy notice, cookie policy (optional `ct_ref`) and sub-processor list
 * (Google Places) all changed that day, while the headers still said
 * 5 September. The Terms of Service carry their own date (`TERMS_VERSION`).
 */
export const LEGAL_LAST_UPDATED = "28 September 2026";
/** Date the current version of the legal pack takes effect. */
export const LEGAL_EFFECTIVE_FROM = "28 September 2026";

/** The customer Data Processing Agreement (/dpa) is versioned on its own. */
export const DPA_VERSION = "1.0 — 28 September 2026";
export const DPA_EFFECTIVE_FROM = "28 September 2026";

/** One-line attribution used in the footer and at the head of each policy. */
export const COMPANY_LINE = `${COMPANY.registeredName} · Registered in ${COMPANY.jurisdiction} no. ${COMPANY.companyNumber} · ${COMPANY.registeredAddress}`;

export function hasRegisteredDetails() {
  return Boolean(COMPANY.registeredName && COMPANY.registeredAddress);
}
