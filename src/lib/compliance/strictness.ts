/**
 * How much doubt a workspace will tolerate about who it contacts.
 *
 * Pure -- no `server-only`, no Supabase -- so the rule that decides whether an
 * ambiguous prospect is refused, reviewed or contacted can be proven without a
 * database, like `channel-policy.ts` and `contact-legality.ts` before it.
 *
 * ## Why this is a setting and not a constant
 *
 * The jurisdiction pack answers what the *law* permits. This answers something
 * the law leaves open: what to do when a record is **not clearly either**.
 *
 * The case it exists for is specific. A prospect at "Northgate Studio", work
 * address on the company's own domain, and no Companies House match for that
 * trading name. Every individual check passes and the record is still
 * ambiguous, because an unmatched trading name may be an incorporated company
 * registered under a different name -- or a sole trader, who under PECR is an
 * individual subscriber needing consent a corporate one does not.
 *
 * A workspace prospecting into regulated sectors wants that refused. One
 * selling to small studios wants a person to look. Both are defensible, so the
 * product asks rather than choosing for them.
 *
 * ## What it can and cannot do
 *
 * It can only ever make the outcome **stricter or equal**, never looser. The
 * pack runs first and its refusals are final; `OPEN` widens a workspace's
 * tolerance for its own doubt, never the law's. That asymmetry is the whole
 * safety property of this module and is asserted directly in the tests.
 */

/** The register's verdict, or the absence of one. */
export type RegistryStatus = "CONFIRMED_CORPORATE" | "CONFIRMED_PARTNERSHIP" | "UNRESOLVED";

export const SOURCING_STRICTNESS = ["STRICT", "BALANCED", "OPEN"] as const;
export type SourcingStrictness = (typeof SOURCING_STRICTNESS)[number];

export const STRICTNESS_LABELS: Record<SourcingStrictness, string> = {
  STRICT: "Only confirmed companies",
  BALANCED: "Ask me about anything unclear",
  OPEN: "Contact on my stated basis",
};

export const STRICTNESS_DESCRIPTIONS: Record<SourcingStrictness, string> = {
  STRICT:
    "Contact only people the register confirms work at an incorporated company, with a work address on that company's own domain. Anything unresolved is dropped rather than queued — in this mode an unanswered question is an answer. Fewest prospects, strongest position.",
  BALANCED:
    "Anything unclear is held for you to decide, rather than contacted or discarded. This is how ClientTurn has always behaved; naming it just makes the choice visible.",
  OPEN:
    "Unresolved records may be contacted on the lawful basis you have stated above. Everything the jurisdiction rules refuse is still refused — this widens what you will accept, never what the law allows.",
};

/** What the caller already knows about one prospect. */
export type StrictnessInput = {
  mode: SourcingStrictness;
  /** True when the workspace requires a register match before contact. */
  requireRegistryMatch: boolean;
  registry: RegistryStatus;
  /**
   * Whether the address sits on the company's own domain. False for a consumer
   * mailbox, and for a work address at a domain that is not this company's.
   */
  emailOnCompanyDomain: boolean;
  /** True when no address was found at all. */
  hasEmail: boolean;
  /**
   * True when the contact came from a source that publishes about the person
   * themselves -- their employer's own site, a register, their own engagement
   * -- rather than from a database that inferred them.
   */
  fromFirstPartySource: boolean;
  /** What the jurisdiction pack decided. Never overridden upward. */
  packOutcome: "ALLOWED" | "REVIEW_REQUIRED" | "BLOCKED";
};

export type StrictnessVerdict = {
  outcome: "ALLOWED" | "REVIEW_REQUIRED" | "BLOCKED";
  /** Why, in a sentence shown on the prospect. Null when nothing narrowed it. */
  reason: string | null;
};

/** Rank so a decision can only ever move one way. */
const RANK = { ALLOWED: 0, REVIEW_REQUIRED: 1, BLOCKED: 2 } as const;

/**
 * The strictest of two outcomes.
 *
 * Every rule below narrows through this rather than assigning, which is what
 * makes "can only tighten" a property of the code rather than a claim about it.
 */
function tighten(
  current: StrictnessVerdict,
  outcome: StrictnessVerdict["outcome"],
  reason: string,
): StrictnessVerdict {
  if (RANK[outcome] <= RANK[current.outcome]) return current;
  return { outcome, reason };
}

export function applyStrictness(input: StrictnessInput): StrictnessVerdict {
  // The pack is the floor. A record it blocked is blocked whatever the
  // workspace would prefer, and `tighten` can never walk that back.
  let verdict: StrictnessVerdict = { outcome: input.packOutcome, reason: null };

  if (input.packOutcome === "BLOCKED") return verdict;

  // A register match, where the workspace has asked for one. Independent of the
  // mode: Companies House covers the UK only, so a workspace prospecting
  // abroad would find everything unresolved, and requiring a match has to be a
  // deliberate act rather than a consequence of choosing STRICT.
  if (input.requireRegistryMatch && input.registry === "UNRESOLVED") {
    verdict = tighten(
      verdict,
      input.mode === "STRICT" ? "BLOCKED" : "REVIEW_REQUIRED",
      "No match on the company register for this trading name, and this workspace requires one before contact.",
    );
  }

  if (!input.hasEmail) {
    verdict = tighten(
      verdict,
      "REVIEW_REQUIRED",
      "No usable email address was found for this person.",
    );
  }

  switch (input.mode) {
    case "STRICT": {
      // Everything unresolved is refused rather than queued. A workspace that
      // chose this asked not to be shown the doubtful ones, and filling its
      // review queue with them would be ignoring the instruction.
      if (input.registry !== "CONFIRMED_CORPORATE") {
        verdict = tighten(
          verdict,
          "BLOCKED",
          "Only people at companies confirmed on the register are contacted in this mode, and this company could not be confirmed.",
        );
      }
      if (input.hasEmail && !input.emailOnCompanyDomain) {
        verdict = tighten(
          verdict,
          "BLOCKED",
          "The address is not on the company's own domain, so it is not treated as a corporate contact in this mode.",
        );
      }
      if (!input.fromFirstPartySource) {
        verdict = tighten(
          verdict,
          "BLOCKED",
          "This contact was inferred by a data provider rather than published by the company itself, which this mode does not contact.",
        );
      }
      break;
    }

    case "BALANCED": {
      // Doubt reaches a person. This is what the product did before the setting
      // existed, so nothing changes for a workspace that never opens it.
      if (input.registry === "UNRESOLVED") {
        verdict = tighten(
          verdict,
          "REVIEW_REQUIRED",
          "This company is not confirmed on the register, so whether the corporate exemption applies is unclear. Worth a look before contacting them.",
        );
      }
      if (input.hasEmail && !input.emailOnCompanyDomain) {
        verdict = tighten(
          verdict,
          "REVIEW_REQUIRED",
          "The address is not on the company's own domain, so this may be a personal mailbox.",
        );
      }
      break;
    }

    case "OPEN": {
      // Deliberately adds nothing. The workspace has stated a lawful basis and
      // accepted the residual doubt; the pack's own refusals still stand
      // because `tighten` was never given a way to lower them.
      break;
    }
  }

  return verdict;
}

/**
 * Whether the workspace has said enough for `OPEN` to be a coherent choice.
 *
 * `OPEN` means "contact on the basis I stated". A workspace that has stated
 * `UNSTATED` has not stated one, so the mode would mean "contact on no basis at
 * all" -- which is not a position the product should let somebody select by
 * accident. The settings form uses this to disable the option and say why,
 * rather than accepting it and failing later.
 */
export function openModeAvailable(marketingLawfulBasis: string): boolean {
  return marketingLawfulBasis !== "UNSTATED";
}
