/**
 * Data controls: the workspace's stated compliance position (Programme §14).
 *
 * Pure — no `server-only`, no Supabase — so the vocabulary can be rendered in
 * Settings and asserted in tests without a database, matching `policy/types.ts`
 * and `usage-metrics.ts`.
 *
 * This is what a workspace *says about itself*. The engine that decides whether
 * a particular contact may be messaged lives in `lib/policy` and is unchanged;
 * this supplies facts it previously had to do without.
 */

/* -------------------------------------------------------------- sourcing */

/**
 * Where prospect data is permitted to come from.
 *
 * Split into what is allowed and what is refused outright, because the
 * programme's §16 makes a point worth encoding: public availability is not
 * consent, and a source being technically reachable says nothing about whether
 * its licence permits marketing use.
 */
export const ALLOWED_SOURCE_KINDS = [
  "LICENSED_PROVIDER",
  "PUBLIC_CORPORATE_REGISTER",
  "BUSINESS_WEBSITE",
  "OPEN_GOVERNMENT_RECORD",
  "CUSTOMER_UPLOAD",
  "CONNECTED_CRM",
  "INBOUND_ENQUIRY",
] as const;

export type AllowedSourceKind = (typeof ALLOWED_SOURCE_KINDS)[number];

export const SOURCE_LABELS: Record<AllowedSourceKind, string> = {
  LICENSED_PROVIDER: "Licensed data providers",
  PUBLIC_CORPORATE_REGISTER: "Public corporate registers",
  BUSINESS_WEBSITE: "Business websites",
  OPEN_GOVERNMENT_RECORD: "Open government records",
  CUSTOMER_UPLOAD: "Data you upload yourself",
  CONNECTED_CRM: "Systems you have connected",
  INBOUND_ENQUIRY: "People who contacted you",
};

export const SOURCE_DESCRIPTIONS: Record<AllowedSourceKind, string> = {
  LICENSED_PROVIDER:
    "Commercial providers ClientTurn holds a licence with. Their terms decide what the data may be used for.",
  PUBLIC_CORPORATE_REGISTER:
    "Companies House and equivalents. Good for confirming a company exists; not by itself a basis for contacting a named person there.",
  BUSINESS_WEBSITE:
    "Contact details a business publishes about itself. Publication is not consent, and a stated objection to unsolicited contact is binding.",
  OPEN_GOVERNMENT_RECORD:
    "Procurement notices, licensing registers and similar. Check the licence permits commercial reuse.",
  CUSTOMER_UPLOAD:
    "Records you import. You are asserting you have a lawful basis for the data you bring.",
  CONNECTED_CRM: "Records synced from a system you already run.",
  INBOUND_ENQUIRY: "People who came to you. The strongest basis there is.",
};

/**
 * Sources that are never permitted, whatever a workspace would prefer.
 *
 * Stated in the product rather than left to a policy document, because a list
 * nobody sees is one that gets tested by someone assuming silence means yes.
 * These are not settings — there is no toggle — and this array exists to be
 * displayed.
 */
export const PROHIBITED_SOURCES = [
  "Breached or leaked databases",
  "Purchased lists with no record of where the data came from",
  "Harvested personal email addresses",
  "Harvested consumer phone numbers",
  "Scraping private or sign-in-only profiles",
  "Datasets whose licence forbids marketing or commercial reuse",
  "Any record whose origin cannot be established",
] as const;

/* ---------------------------------------------------------- lawful basis */

export const LAWFUL_BASES = [
  "UNSTATED",
  "CONSENT",
  "LEGITIMATE_INTERESTS",
  "EXISTING_CUSTOMER",
  "CONTRACTUAL_REQUEST",
  "OTHER",
] as const;

export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export const BASIS_LABELS: Record<LawfulBasis, string> = {
  UNSTATED: "Not yet stated",
  CONSENT: "Consent",
  LEGITIMATE_INTERESTS: "Legitimate interests",
  EXISTING_CUSTOMER: "Existing customer relationship",
  CONTRACTUAL_REQUEST: "Request in the course of a contract",
  OTHER: "Another basis",
};

export const BASIS_DESCRIPTIONS: Record<LawfulBasis, string> = {
  UNSTATED:
    "Until this is answered, ClientTurn treats every contact as needing a human decision.",
  CONSENT: "The person agreed to hear from you, and you can show when and how.",
  LEGITIMATE_INTERESTS:
    "You have assessed that your interest in contacting them does not override their rights. The assessment is yours to hold; ClientTurn records that you claim one.",
  EXISTING_CUSTOMER:
    "They bought something similar from you, and were offered a way to opt out at the time.",
  CONTRACTUAL_REQUEST: "They asked you for this as part of doing business together.",
  OTHER: "Something else, described in the note.",
};

export type ProspectType = "B2B" | "B2C" | "BOTH";

export const PROSPECT_TYPE_LABELS: Record<ProspectType, string> = {
  B2B: "Businesses only",
  B2C: "Individuals",
  BOTH: "Both",
};

/* ----------------------------------------------------------- the record */

export type DataControls = {
  legalName: string | null;
  registeredCountry: string | null;
  registeredAddress: string | null;
  privacyPolicyUrl: string | null;
  privacyContactEmail: string | null;
  dpoContact: string | null;
  prospectCountries: string[];
  prospectType: ProspectType;
  allowedSources: AllowedSourceKind[];
  marketingLawfulBasis: LawfulBasis;
  lawfulBasisNote: string | null;
  basisReviewedAt: string | null;
  retainUncontactedProspectsDays: number | null;
  retainInactiveLeadsDays: number | null;
  retainRawEventsDays: number | null;
  updatedAt: string | null;
};

export const EMPTY_DATA_CONTROLS: DataControls = {
  legalName: null,
  registeredCountry: null,
  registeredAddress: null,
  privacyPolicyUrl: null,
  privacyContactEmail: null,
  dpoContact: null,
  prospectCountries: [],
  prospectType: "B2B",
  allowedSources: [],
  marketingLawfulBasis: "UNSTATED",
  lawfulBasisNote: null,
  basisReviewedAt: null,
  retainUncontactedProspectsDays: null,
  retainInactiveLeadsDays: null,
  retainRawEventsDays: null,
  updatedAt: null,
};

/* ---------------------------------------------------------- readiness */

export type ComplianceGap = {
  code: string;
  /** What is missing, said to the person who has to fix it. */
  message: string;
  /** `BLOCKING` stops cold outreach; `ADVISORY` is worth doing. */
  severity: "BLOCKING" | "ADVISORY";
};

/**
 * What is missing before this workspace can run cold outreach honestly.
 *
 * Deliberately explicit about which gaps *block*. Cold outreach that cannot name
 * the sender, point at a privacy notice, or state a basis is not a marginal
 * compliance risk — it is mail that fails on its face, and shipping a product
 * that lets someone send it without warning would be the wrong default.
 *
 * Pure so the same list drives the Settings banner, the campaign launch check
 * and a test.
 */
export function complianceGaps(controls: DataControls): ComplianceGap[] {
  const gaps: ComplianceGap[] = [];

  if (!controls.legalName?.trim()) {
    gaps.push({
      code: "legal_name",
      message:
        "Marketing email has to say who is sending it. Add the legal name of the organisation.",
      severity: "BLOCKING",
    });
  }

  if (!controls.registeredAddress?.trim()) {
    gaps.push({
      code: "postal_address",
      message:
        "A postal address is required in marketing email in several of the markets ClientTurn supports.",
      severity: "BLOCKING",
    });
  }

  if (!controls.privacyPolicyUrl?.trim()) {
    gaps.push({
      code: "privacy_policy",
      message:
        "Add a link to your privacy notice, so people you contact can see how their data is handled.",
      severity: "BLOCKING",
    });
  }

  if (controls.marketingLawfulBasis === "UNSTATED") {
    gaps.push({
      code: "lawful_basis",
      message:
        "State the basis on which you contact people. Until then every contact needs a human decision.",
      severity: "BLOCKING",
    });
  }

  if (controls.allowedSources.length === 0) {
    gaps.push({
      code: "sources",
      message:
        "Choose which sources of prospect data you permit. Nothing is allowed until you do.",
      severity: "BLOCKING",
    });
  }

  if (controls.prospectCountries.length === 0) {
    gaps.push({
      code: "markets",
      message:
        "Name the countries you prospect into, so the right rules are applied instead of the most restrictive ones.",
      severity: "ADVISORY",
    });
  }

  if (
    controls.marketingLawfulBasis === "LEGITIMATE_INTERESTS" &&
    !controls.lawfulBasisNote?.trim()
  ) {
    gaps.push({
      code: "basis_note",
      message:
        "Legitimate interests rests on an assessment you have made. Summarise it here so it can be produced if asked.",
      severity: "ADVISORY",
    });
  }

  if (controls.retainRawEventsDays === null) {
    gaps.push({
      code: "retention",
      message:
        "Set how long raw inbound payloads are kept. Without a limit they accumulate indefinitely.",
      severity: "ADVISORY",
    });
  }

  return gaps;
}

export function isReadyForColdOutreach(controls: DataControls): boolean {
  return !complianceGaps(controls).some((gap) => gap.severity === "BLOCKING");
}
