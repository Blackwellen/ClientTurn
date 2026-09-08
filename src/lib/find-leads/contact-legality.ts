/**
 * Whether a contact detail a provider returned may lawfully be used for
 * unsolicited business outreach in the UK.
 *
 * Pure — no `server-only`, no Supabase, no network — because this is the module
 * whose reasoning has to survive being read aloud to a regulator, and reasoning
 * that cannot be unit-tested in isolation does not survive anything.
 *
 * `compliance/types.ts` already states that harvested personal email addresses
 * and harvested consumer phone numbers are never permitted. Until this module
 * existed that was a paragraph in a settings page with nothing enforcing it: a
 * Hunter domain-search or an Apollo lookup returned whatever it held, and a
 * personal Gmail address flowed through discovery, enrichment, verification and
 * into a cold sequence without one line of code objecting.
 *
 * ## The law this encodes
 *
 * Two regimes apply at once, and they answer different questions.
 *
 * **UK GDPR** governs whether there is a lawful basis to process the data at
 * all. For B2B prospecting that basis is legitimate interests, which requires a
 * balancing test — and the balance turns almost entirely on whether the person
 * would reasonably expect the contact. Someone whose work address is published
 * on their employer's website, contacted about their job, would. Someone whose
 * personal Gmail was scraped from a forum would not, and no amount of
 * unsubscribe machinery repairs that.
 *
 * **PECR** governs the act of sending, and draws a line UK GDPR does not: it
 * distinguishes a *corporate subscriber* from an *individual subscriber*.
 * Marketing email and calls to a corporate subscriber are permitted without
 * prior consent, subject to an opt-out. To an individual subscriber — which
 * includes sole traders and most partnerships — they are not.
 *
 * So the questions this module answers, in order:
 *
 *   1. Is this a business contact point or a personal one?
 *   2. If personal, is it refused outright, or is it a judgement for a human?
 *   3. Is the subscriber corporate or individual, so the sending rules can
 *      pick the right regime?
 *
 * ## What it deliberately does not do
 *
 * It does not screen against the TPS or CTPS. Those are live registers, the
 * screening is a paid lookup, and pretending to have done it here would be
 * worse than not claiming to: a `REVIEW` verdict on a phone number is the
 * honest output, and the register check belongs at the point of dialling.
 */

/* ------------------------------------------------------------------ verdict */

export type ContactVerdict =
  /** A business contact point. Ordinary cold outreach rules apply. */
  | "PERMITTED"
  /**
   * Not refused, but not something a machine should decide. A person looks at
   * it and either approves the contact or discards it.
   */
  | "REVIEW"
  /**
   * Refused. The record is not stored as a contactable endpoint at all — not
   * suppressed, not queued for review, simply not kept, because keeping it
   * would mean holding personal data with no lawful basis for having it.
   */
  | "REFUSED";

/** Whose the line is, in PECR's terms. Drives which sending rules apply. */
export type SubscriberType = "CORPORATE" | "INDIVIDUAL" | "UNKNOWN";

export type ContactAssessment = {
  verdict: ContactVerdict;
  subscriberType: SubscriberType;
  /**
   * Written for the customer, not for an engineer, because it is shown on the
   * prospect and is the thing that explains why a record they can see is one
   * they may not contact.
   */
  reason: string;
  /** Stable code for tests, audit rows and aggregate reporting. */
  code: ContactRefusalCode;
};

export type ContactRefusalCode =
  | "OK_BUSINESS_DOMAIN"
  | "OK_BUSINESS_LANDLINE"
  | "CONSUMER_MAILBOX"
  | "DISPOSABLE_MAILBOX"
  | "PERSONAL_MOBILE"
  | "PREMIUM_OR_UNROUTABLE"
  | "NO_PROVENANCE"
  | "MALFORMED";

/* ------------------------------------------------------------------- email */

/**
 * Consumer mailbox providers.
 *
 * An address here is somebody's personal mailbox. It is not made a business
 * address by the person happening to run a business — a sole trader using Gmail
 * for work is an individual subscriber, and PECR's corporate exemption does not
 * reach them.
 *
 * The list is deliberately not exhaustive and cannot be. It catches the
 * providers that account for the overwhelming majority of consumer mail; the
 * long tail is handled by `REVIEW`, not by pretending the list is complete.
 */
const CONSUMER_MAILBOX_DOMAINS = new Set([
  // Global
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aol.co.uk",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "fastmail.com",
  "hushmail.com",
  "tutanota.com",
  // UK ISP mailboxes — very common on home-service enquiries, and
  // unambiguously residential
  "btinternet.com",
  "btopenworld.com",
  "sky.com",
  "virginmedia.com",
  "blueyonder.co.uk",
  "ntlworld.com",
  "talktalk.net",
  "tiscali.co.uk",
  "plus.net",
  "plusnet.com",
  "orange.net",
  "o2.co.uk",
  "ee.co.uk",
  "virgin.net",
  "supanet.com",
  "madasafish.com",
  "freeserve.co.uk",
  "lineone.net",
  "which.net",
]);

/**
 * Throwaway-address providers.
 *
 * Refused for a different reason from a consumer mailbox: not because contacting
 * one is unlawful, but because it is not a contact point at all. Nobody reads
 * it, the message bounces or vanishes, and the bounce damages the sending
 * domain's reputation for every later campaign.
 */
const DISPOSABLE_MAILBOX_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "spam4.me",
  "tempmail.com",
  "moakt.com",
]);

/**
 * Role addresses.
 *
 * Kept, and worth saying why, because the instinct is to strip them. An
 * `info@` or `enquiries@` address is the *safest* thing in this whole module:
 * it is published by the business for exactly this purpose, it belongs to the
 * organisation rather than to a named person, and under PECR it is a corporate
 * subscriber's address. It is a weaker sales lead than a named decision maker,
 * which is a commercial judgement and not a legal one — so it is flagged for
 * scoring, never refused.
 */
const ROLE_LOCAL_PARTS = new Set([
  "info",
  "enquiries",
  "enquiry",
  "hello",
  "contact",
  "sales",
  "admin",
  "office",
  "accounts",
  "support",
  "help",
  "team",
  "mail",
  "post",
  "reception",
  "bookings",
  "service",
]);

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().trim();
  return local ? ROLE_LOCAL_PARTS.has(local) : false;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Assesses one email address.
 *
 * `hasProvenance` is not optional and has no default. A contact detail whose
 * origin nobody recorded cannot have its lawful basis demonstrated, and
 * "demonstrate" is the actual word in the accountability principle — so an
 * unprovenanced address is refused rather than quietly allowed by a parameter
 * somebody forgot to pass.
 */
export function assessEmail(
  email: string | null | undefined,
  hasProvenance: boolean,
): ContactAssessment {
  const value = (email ?? "").trim().toLowerCase();

  if (!value || !EMAIL_SHAPE.test(value)) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "MALFORMED",
      reason: "That is not a usable email address.",
    };
  }

  if (!hasProvenance) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "NO_PROVENANCE",
      reason:
        "Nothing records where this address came from, so there is no way to show it was obtained lawfully.",
    };
  }

  const domain = value.split("@")[1] ?? "";

  if (DISPOSABLE_MAILBOX_DOMAINS.has(domain)) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "DISPOSABLE_MAILBOX",
      reason:
        "This is a disposable address. Nobody reads it, and mail to it will bounce and damage your sending domain.",
    };
  }

  if (CONSUMER_MAILBOX_DOMAINS.has(domain)) {
    return {
      verdict: "REFUSED",
      subscriberType: "INDIVIDUAL",
      code: "CONSUMER_MAILBOX",
      reason:
        "This is a personal mailbox, not a business address. Cold marketing to an individual subscriber needs their consent, which nobody here has.",
    };
  }

  return {
    verdict: "PERMITTED",
    subscriberType: "CORPORATE",
    code: "OK_BUSINESS_DOMAIN",
    reason: isRoleAddress(value)
      ? "A business address the company publishes for enquiries."
      : "A business address on the company's own domain.",
  };
}

/* ------------------------------------------------------------------- phone */

/**
 * Assesses one UK phone number.
 *
 * The split that matters is mobile versus landline, and it is not the split
 * most people expect:
 *
 *   * **01, 02 and 03** are geographic and non-geographic business lines. A
 *     number a company publishes on its own website is a corporate subscriber's
 *     line, and PECR permits a marketing call to it subject to CTPS screening.
 *   * **07** is a mobile. It may belong to a company, but it very often belongs
 *     to a sole trader — an *individual* subscriber, where the corporate
 *     exemption does not apply and TPS screening is required. There is no way
 *     to tell which from the number alone, so this returns `REVIEW`. Guessing
 *     "corporate" here is the single most expensive wrong answer in the module.
 *   * **070, 076 (excluding 07624), 09 and 118** are personal-numbering,
 *     premium-rate or unroutable ranges. Nothing good is at the other end.
 */
export function assessPhone(
  phone: string | null | undefined,
  hasProvenance: boolean,
): ContactAssessment {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");

  if (!digits) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "MALFORMED",
      reason: "That is not a usable phone number.",
    };
  }

  if (!hasProvenance) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "NO_PROVENANCE",
      reason:
        "Nothing records where this number came from, so there is no way to show it was obtained lawfully.",
    };
  }

  // Normalised to the national form so one set of prefix rules covers +44,
  // 0044 and 07... alike.
  const national = digits
    .replace(/^\+44/, "0")
    .replace(/^0044/, "0")
    .replace(/^44(?=[1-9])/, "0");

  // The premium and unroutable ranges are checked BEFORE the UK shape gate.
  //
  // 118 directory-enquiry numbers are six digits and do not start with 0, so a
  // gate-first ordering sent every one of them down the "not a UK number"
  // branch and returned REVIEW -- which made the `118` alternative below
  // unreachable, and offered a person a number that charges several pounds a
  // minute to dial as something worth checking. Refusing outright is the only
  // correct answer for these ranges whatever their length.
  if (/^(09|070|118)/.test(national) || /^076(?!24)/.test(national)) {
    return {
      verdict: "REFUSED",
      subscriberType: "UNKNOWN",
      code: "PREMIUM_OR_UNROUTABLE",
      reason:
        "This is a premium-rate or personal-numbering range, not a business line.",
    };
  }

  if (!/^0\d{9,10}$/.test(national)) {
    // A non-UK number. Its own jurisdiction's rules apply and this module does
    // not know them, so it does not pretend to.
    return {
      verdict: "REVIEW",
      subscriberType: "UNKNOWN",
      code: "PERSONAL_MOBILE",
      reason:
        "This is not a UK number, so UK calling rules do not settle it. Check the rules where they are before calling.",
    };
  }

  if (/^07/.test(national)) {
    return {
      verdict: "REVIEW",
      subscriberType: "UNKNOWN",
      code: "PERSONAL_MOBILE",
      reason:
        "A mobile number. It may be a company line or a sole trader's personal phone, and only the second needs TPS screening — so a person should confirm which before it is called.",
    };
  }

  return {
    verdict: "PERMITTED",
    subscriberType: "CORPORATE",
    code: "OK_BUSINESS_LANDLINE",
    reason:
      "A business landline. Screen against the CTPS before calling, as you would any corporate number.",
  };
}

/* ------------------------------------------------------------------ record */

export type ContactSet = {
  email: string | null;
  phone: string | null;
};

export type ContactDecision = {
  /** The address that survived. Null where none did. */
  email: string | null;
  phone: string | null;
  emailAssessment: ContactAssessment | null;
  phoneAssessment: ContactAssessment | null;
  /** The strictest verdict across whatever was supplied. */
  verdict: ContactVerdict;
  subscriberType: SubscriberType;
  /** Every reason, so the prospect can show all of them rather than the first. */
  reasons: string[];
};

/**
 * The whole contact set for one prospect.
 *
 * A refused detail is dropped from the returned record rather than carried with
 * a flag. Carrying it would leave a personal address sitting in the database
 * with nothing but a boolean between it and a send, and the entire point is
 * that there is no lawful basis to hold it at all.
 *
 * The overall verdict is the strictest across the details that survived — a
 * prospect with a good business email and a mobile is `REVIEW`, not
 * `PERMITTED`, because the mobile is the thing somebody might call.
 */
export function assessContacts(
  contacts: ContactSet,
  hasProvenance: boolean,
): ContactDecision {
  const emailAssessment = contacts.email
    ? assessEmail(contacts.email, hasProvenance)
    : null;
  const phoneAssessment = contacts.phone
    ? assessPhone(contacts.phone, hasProvenance)
    : null;

  const kept = [emailAssessment, phoneAssessment].filter(
    (assessment): assessment is ContactAssessment =>
      assessment !== null && assessment.verdict !== "REFUSED",
  );

  const verdict: ContactVerdict =
    kept.length === 0
      ? "REFUSED"
      : kept.some((assessment) => assessment.verdict === "REVIEW")
        ? "REVIEW"
        : "PERMITTED";

  // INDIVIDUAL wins over CORPORATE, and UNKNOWN over both: the strictest rules
  // that could apply are the ones that do apply.
  const subscriberType: SubscriberType = kept.some(
    (assessment) => assessment.subscriberType === "INDIVIDUAL",
  )
    ? "INDIVIDUAL"
    : kept.some((assessment) => assessment.subscriberType === "UNKNOWN")
      ? "UNKNOWN"
      : kept.length > 0
        ? "CORPORATE"
        : "UNKNOWN";

  return {
    email:
      emailAssessment && emailAssessment.verdict !== "REFUSED"
        ? (contacts.email?.trim().toLowerCase() ?? null)
        : null,
    phone:
      phoneAssessment && phoneAssessment.verdict !== "REFUSED"
        ? (contacts.phone ?? null)
        : null,
    emailAssessment,
    phoneAssessment,
    verdict,
    subscriberType,
    reasons: [emailAssessment, phoneAssessment]
      .filter((assessment): assessment is ContactAssessment => assessment !== null)
      .map((assessment) => assessment.reason),
  };
}

/* ------------------------------------------------------------ provenance */

/**
 * The lawful basis a provider's data is supplied under.
 *
 * Recorded per source row alongside the provider name, because "where did this
 * come from" and "what were we permitted to do with it" are different
 * questions, and only the first one was being answered. A record whose basis is
 * `UNKNOWN` is the one worth stopping on -- `verdictForSources` already treats
 * absent provenance as UNKNOWN rather than permitted, and this makes the same
 * distinction available per field rather than per record.
 */
export type LawfulBasis =
  | "LICENSED_B2B"
  | "PUBLIC_REGISTER"
  | "PUBLISHED_BY_SUBJECT"
  | "FIRST_PARTY_ENGAGEMENT"
  | "CUSTOMER_ASSERTED"
  | "UNKNOWN";

/**
 * What each configured provider supplies data under.
 *
 * Stated here rather than inside each adapter so the whole position can be read
 * in one place -- and reviewed by someone who is not going to open fourteen
 * files. An adapter absent from this map yields `UNKNOWN`, which is the correct
 * answer for a source nobody has established terms for.
 */
export const PROVIDER_LAWFUL_BASIS: Record<string, LawfulBasis> = {
  apollo: "LICENSED_B2B",
  hunter: "LICENSED_B2B",
  clearbit: "LICENSED_B2B",
  linkedin_sales_navigator: "LICENSED_B2B",
  "google-places": "PUBLISHED_BY_SUBJECT",
  google_places: "PUBLISHED_BY_SUBJECT",
  website_intent: "PUBLISHED_BY_SUBJECT",
  "website-intent": "PUBLISHED_BY_SUBJECT",
  meta_ad_library: "PUBLIC_REGISTER",
  "meta-ad-library": "PUBLIC_REGISTER",
  tiktok_commercial_content: "PUBLIC_REGISTER",
  "tiktok-commercial-content": "PUBLIC_REGISTER",
  meta_engagement: "FIRST_PARTY_ENGAGEMENT",
  "meta-engagement": "FIRST_PARTY_ENGAGEMENT",
  linkedin_engagement: "FIRST_PARTY_ENGAGEMENT",
  "linkedin-engagement": "FIRST_PARTY_ENGAGEMENT",
  import: "CUSTOMER_ASSERTED",
  manual: "CUSTOMER_ASSERTED",
  user: "CUSTOMER_ASSERTED",
};

export function lawfulBasisFor(provider: string | null | undefined): LawfulBasis {
  if (!provider) return "UNKNOWN";
  return PROVIDER_LAWFUL_BASIS[provider.trim().toLowerCase()] ?? "UNKNOWN";
}

export const LAWFUL_BASIS_LABELS: Record<LawfulBasis, string> = {
  LICENSED_B2B: "Licensed business-contact data",
  PUBLIC_REGISTER: "A public register or transparency database",
  PUBLISHED_BY_SUBJECT: "Published by the business about itself",
  FIRST_PARTY_ENGAGEMENT: "Someone who engaged with you directly",
  CUSTOMER_ASSERTED: "Supplied by you, on a basis you hold",
  UNKNOWN: "Not established",
};
