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

/* ------------------------------------------------------------------ social */

/**
 * The same Article 14 disclosure, short enough for a social first message.
 *
 * Article 14(3)(b): where the data is used to communicate with the person, the
 * information is due "at the latest at the time of the first communication".
 * A LinkedIn connection note, an Instagram or Facebook DM or a TikTok message
 * is a first communication exactly as a cold email is, so the obligation does
 * not wait for the email that may never come. Those surfaces are short (a
 * LinkedIn invitation note is capped at 300 characters, and the message still
 * has to say something), so this variant names the single most recognisable
 * source and the notice URL, and nothing else.
 *
 * Same rules as the email line: generated from recorded provenance, never
 * written by a model, and `blocked` when it cannot honestly be built.
 */
export const SOCIAL_DISCLOSURE_MAX = 160;

export function buildSocialSourceDisclosure(
  input: DisclosureInput & { maxLength?: number },
): Disclosure {
  const full = buildSourceDisclosure(input);
  if (full.blocked || !input.privacyPolicyUrl) return full;

  const known = input.provenanceTypes
    .map((type) => type.trim().toUpperCase())
    .filter((type): type is ProvenanceType => type in SOURCE_PHRASES);
  const first = PRIORITY.find((type) => known.includes(type));
  // `full` was not blocked, so at least one known source exists.
  const source = SOURCE_PHRASES[first!];
  const max = input.maxLength ?? SOCIAL_DISCLOSURE_MAX;
  const url = input.privacyPolicyUrl;

  const candidates = [
    `I found your details via ${source}. What we hold and how to opt out: ${url}`,
    `Found via ${source}. Your data and opting out: ${url}`,
    `Where we found you and how to opt out: ${url}`,
  ];
  const line = candidates.find((candidate) => candidate.length <= max);

  if (!line) {
    return {
      line: null,
      blocked: true,
      gap: `The privacy notice URL is too long to fit a ${max}-character social disclosure. Use a shorter URL in Settings → Data controls.`,
    };
  }
  return { line, blocked: false, gap: null };
}

/**
 * Whether a social message owes the disclosure: a first contact with someone
 * whose details were not given to us by them. A reply inside a conversation
 * the person started does not.
 */
export function socialDisclosureRequired(input: {
  isFirstContact: boolean;
  personInitiated: boolean;
}): boolean {
  return input.isFirstContact && !input.personInitiated;
}

/* --------------------------------------------------- when, and how to attach */

/**
 * Whether an email outreach step carries the Article 14 line.
 *
 * Article 14(3)(b) puts the information "at the latest at the time of the
 * first communication" (ICO, *When should we provide privacy information?*,
 * evidence register §2). Once it has been given it has been given: repeating
 * the same paragraph under every follow-up adds nothing the person does not
 * already have, and makes every chaser read like a legal notice. So it goes on
 * the first cold step actually delivered to this recipient, and not after.
 *
 * `stepsSent` is the count of steps delivered on this run, so a first step
 * that failed to send leaves it at 0 and the retry still carries the line.
 */
export function emailDisclosureDue(stepsSent: number): boolean {
  return stepsSent <= 0;
}

export type SocialDisclosurePlan =
  /** Nothing is owed: not a first contact, they started it, or we got their details from them. */
  | { kind: "NONE" }
  /** Append this line to the message. */
  | { kind: "APPEND"; line: string }
  /** Owed but cannot honestly be built. Hold the message and say why. */
  | { kind: "PARK"; gap: string };

/**
 * What a social first message owes, from recorded provenance.
 *
 * Only data that did **not** come from the person themselves triggers Article
 * 14. A commenter on the business's own post (`FIRST_PARTY`) gave us their
 * details by engaging, so nothing is owed. Anything else recorded against the
 * prospect -- a website, a licensed provider, a register -- is named, with the
 * first-party source left out so the line names where the third-party data
 * actually came from rather than the reassuring one.
 *
 * Nothing recorded at all is a PARK, never a NONE: an unknown source is not
 * evidence that the person supplied it.
 */
export function planSocialDisclosure(
  input: DisclosureInput & {
    isFirstContact: boolean;
    personInitiated: boolean;
    maxLength?: number;
  },
): SocialDisclosurePlan {
  if (
    !socialDisclosureRequired({
      isFirstContact: input.isFirstContact,
      personInitiated: input.personInitiated,
    })
  ) {
    return { kind: "NONE" };
  }

  const known = [
    ...new Set(
      input.provenanceTypes
        .map((type) => type.trim().toUpperCase())
        .filter((type): type is ProvenanceType => type in SOURCE_PHRASES),
    ),
  ];
  const thirdParty = known.filter((type) => type !== "FIRST_PARTY");

  if (known.length > 0 && thirdParty.length === 0) return { kind: "NONE" };

  const disclosure = buildSocialSourceDisclosure({
    provenanceTypes: thirdParty,
    legalName: input.legalName,
    privacyPolicyUrl: input.privacyPolicyUrl,
    maxLength: input.maxLength,
  });

  if (disclosure.blocked || !disclosure.line) {
    return {
      kind: "PARK",
      gap:
        disclosure.gap ??
        "The source disclosure could not be built, so this first message is being held.",
    };
  }
  return { kind: "APPEND", line: disclosure.line };
}

/**
 * The message with its disclosure attached, inside the platform's limit.
 *
 * The disclosure is never the part that gets cut -- it is the part that makes
 * the message lawful. The body is shortened at a word boundary instead.
 */
export function appendDisclosure(body: string, line: string, limit: number): string {
  const separator = "\n\n";
  const room = limit - line.length - separator.length;
  if (room <= 0) return line.slice(0, limit);
  let trimmed = body.trim();
  if (trimmed.length > room) {
    const cut = trimmed.slice(0, room);
    const lastSpace = cut.lastIndexOf(" ");
    trimmed = (lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
  }
  return trimmed ? `${trimmed}${separator}${line}` : line;
}
