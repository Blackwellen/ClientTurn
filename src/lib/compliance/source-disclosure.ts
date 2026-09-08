/**
 * Telling somebody where you got their details.
 *
 * Pure -- no `server-only`, no Supabase -- so the sentence that goes into a
 * stranger's inbox under the customer's name can be unit-tested, like the rest
 * of the outbound copy rules.
 *
 * ## Why this exists
 *
 * Where personal data was not obtained from the person themselves, UK GDPR
 * Article 14 requires telling them what you hold, why, and **where it came
 * from** -- at the latest when you first contact them. Every cold prospect in
 * this product is exactly that case.
 *
 * The obligation was previously met only in the abstract: `prospect_data_sources`
 * recorded the provider and, since the lawful-basis work, what it was supplied
 * under -- but nothing turned that into a sentence the recipient ever saw. The
 * data existed and the disclosure did not.
 *
 * ## The rule that shapes the wording
 *
 * The line is generated **from the recorded provenance**, never written by
 * hand and never composed by a model. That is deliberate:
 *
 *   * A hand-written line drifts from what actually happened the moment a run
 *     uses a different provider.
 *   * A model-written one could produce a plausible sentence naming a source
 *     that was never consulted -- a fabricated disclosure, which is worse than
 *     none, because it is a specific false statement about how somebody's data
 *     was obtained.
 *
 * So this is a lookup over recorded facts. If nothing is recorded it says so
 * rather than guessing, and `disclosureRequired` returns true so the caller can
 * refuse to send rather than sending an unexplained cold email.
 */

/** The provenance vocabulary, as `prospect_data_sources.source_type` holds it. */
export type ProvenanceType =
  | "WEBSITE"
  | "REGISTRY"
  | "LICENSED_PROVIDER"
  | "CRM"
  | "IMPORT"
  | "FIRST_PARTY"
  | "PUBLIC_FEED"
  | "MANUAL";

/**
 * How each source is described to the person whose data it is.
 *
 * Written for the recipient, not for a compliance officer: the test is whether
 * somebody who has never heard of the business can read it and know what
 * happened. "Licensed B2B data provider" fails that test; "a business contact
 * data provider we licence data from" passes it.
 */
const SOURCE_PHRASES: Record<ProvenanceType, string> = {
  WEBSITE: "your company's own website",
  REGISTRY: "the public company register",
  LICENSED_PROVIDER: "a business contact data provider we licence data from",
  CRM: "our own customer records",
  IMPORT: "records our customer supplied",
  FIRST_PARTY: "your own contact with us",
  PUBLIC_FEED: "a public government or industry record",
  MANUAL: "records entered by our team",
};

/**
 * Ordered by how directly the person would recognise it.
 *
 * A recipient who reads "we found you on your company's website" can verify
 * that instantly. Naming a licensed provider they have never heard of first
 * would be accurate and useless. Where a record has several sources the most
 * recognisable one leads, and the rest follow.
 */
const PRIORITY: ProvenanceType[] = [
  "FIRST_PARTY",
  "WEBSITE",
  "REGISTRY",
  "PUBLIC_FEED",
  "CRM",
  "IMPORT",
  "MANUAL",
  "LICENSED_PROVIDER",
];

export type DisclosureInput = {
  /** Distinct `source_type` values recorded against this prospect. */
  provenanceTypes: string[];
  /** The controller's own name, as stated in data controls. */
  legalName: string | null;
  /** Where the full notice lives. Required for a complete disclosure. */
  privacyPolicyUrl: string | null;
};

export type Disclosure = {
  /** The sentence to include, or null when one cannot honestly be built. */
  line: string | null;
  /**
   * True when a cold send must not go out.
   *
   * The two cases are different and both fatal: nothing recorded about where
   * the data came from, and no privacy notice to point at. Either leaves the
   * recipient unable to find out what is held about them.
   */
  blocked: boolean;
  /** What is missing, for the person who has to fix it. */
  gap: string | null;
};

export function buildSourceDisclosure(input: DisclosureInput): Disclosure {
  const known = input.provenanceTypes
    .map((type) => type.trim().toUpperCase())
    .filter((type): type is ProvenanceType => type in SOURCE_PHRASES);

  const distinct = [...new Set(known)];

  if (distinct.length === 0) {
    return {
      line: null,
      blocked: true,
      gap: "Nothing records where this prospect's details came from, so they cannot be told — and a cold email that cannot answer that question should not be sent.",
    };
  }

  if (!input.privacyPolicyUrl) {
    return {
      line: null,
      blocked: true,
      gap: "No privacy notice URL is set in Settings → Data controls. Article 14 requires somewhere for the recipient to read what is held about them.",
    };
  }

  const ordered = PRIORITY.filter((type) => distinct.includes(type));
  const phrases = ordered.map((type) => SOURCE_PHRASES[type]);

  const sources =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;

  const who = input.legalName?.trim() || "we";

  // One sentence, plain, and it names the source before it names the notice --
  // the source is the part a recipient actually wants, and burying it behind a
  // link is how a disclosure becomes a formality.
  return {
    line: `You're receiving this because ${who} found your business contact details via ${sources}. You can see what we hold and ask us to delete it at ${input.privacyPolicyUrl}.`,
    blocked: false,
    gap: null,
  };
}

/**
 * Whether this campaign type owes the disclosure at all.
 *
 * Only cold contact does. Somebody who enquired gave us their details
 * themselves, so Article 14 does not apply and a line explaining where we found
 * them would be both wrong and faintly alarming.
 */
export function disclosureRequired(campaignType: string): boolean {
  return campaignType === "COLD";
}
