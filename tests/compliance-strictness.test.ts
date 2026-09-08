import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyStrictness,
  openModeAvailable,
  type StrictnessInput,
} from "../src/lib/compliance/strictness.ts";
import {
  buildSourceDisclosure,
  disclosureRequired,
} from "../src/lib/compliance/source-disclosure.ts";

/**
 * The two rules that decide whether a stranger gets contacted, and whether they
 * are told how we found them.
 *
 * Both are pure, and both are the kind of rule that is easy to state in a
 * document and never enforce. The tests exist to make the enforcement the thing
 * that is true.
 */

function input(overrides: Partial<StrictnessInput> = {}): StrictnessInput {
  return {
    mode: "BALANCED",
    requireRegistryMatch: false,
    registry: "CONFIRMED_CORPORATE",
    emailOnCompanyDomain: true,
    hasEmail: true,
    fromFirstPartySource: true,
    packOutcome: "ALLOWED",
    ...overrides,
  };
}

/* ================================================== the one-way property */

describe("strictness can only ever tighten", () => {
  test("a blocked record stays blocked in every mode", () => {
    // The safety property the whole module rests on. `OPEN` widens what a
    // workspace will accept, never what the law allows.
    for (const mode of ["STRICT", "BALANCED", "OPEN"] as const) {
      const verdict = applyStrictness(input({ mode, packOutcome: "BLOCKED" }));
      assert.equal(verdict.outcome, "BLOCKED", `${mode} let a blocked record through`);
    }
  });

  test("OPEN cannot promote a review into a send", () => {
    const verdict = applyStrictness(
      input({ mode: "OPEN", packOutcome: "REVIEW_REQUIRED" }),
    );
    assert.equal(verdict.outcome, "REVIEW_REQUIRED");
  });

  test("OPEN adds nothing of its own to a clean record", () => {
    const verdict = applyStrictness(
      input({ mode: "OPEN", registry: "UNRESOLVED", emailOnCompanyDomain: false }),
    );
    assert.equal(verdict.outcome, "ALLOWED");
  });
});

/* ============================================================= the modes */

describe("STRICT", () => {
  test("allows a confirmed company with a work address", () => {
    assert.equal(applyStrictness(input({ mode: "STRICT" })).outcome, "ALLOWED");
  });

  test("refuses an unconfirmed company outright rather than queueing it", () => {
    // A workspace that chose STRICT asked not to be shown the doubtful ones.
    // Filling its review queue with them would be ignoring the instruction.
    const verdict = applyStrictness(input({ mode: "STRICT", registry: "UNRESOLVED" }));
    assert.equal(verdict.outcome, "BLOCKED");
    assert.match(verdict.reason ?? "", /confirmed on the register/i);
  });

  test("refuses an address that is not on the company's own domain", () => {
    const verdict = applyStrictness(
      input({ mode: "STRICT", emailOnCompanyDomain: false }),
    );
    assert.equal(verdict.outcome, "BLOCKED");
  });

  test("refuses a contact a database inferred", () => {
    const verdict = applyStrictness(
      input({ mode: "STRICT", fromFirstPartySource: false }),
    );
    assert.equal(verdict.outcome, "BLOCKED");
    assert.match(verdict.reason ?? "", /inferred/i);
  });
});

describe("BALANCED", () => {
  test("sends an unconfirmed company to a person rather than dropping it", () => {
    // The distinction that matters for the ICP: an unmatched trading name may
    // be an incorporated company registered under another name, or a sole
    // trader, who under PECR is an individual subscriber.
    const verdict = applyStrictness(input({ registry: "UNRESOLVED" }));
    assert.equal(verdict.outcome, "REVIEW_REQUIRED");
  });

  test("sends a non-company address to review", () => {
    const verdict = applyStrictness(input({ emailOnCompanyDomain: false }));
    assert.equal(verdict.outcome, "REVIEW_REQUIRED");
  });

  test("does not care where the contact came from", () => {
    // Only STRICT applies the first-party test. BALANCED is the behaviour the
    // product had before the setting existed, and must stay that way for a
    // workspace that never opens the screen.
    assert.equal(
      applyStrictness(input({ fromFirstPartySource: false })).outcome,
      "ALLOWED",
    );
  });
});

describe("requiring a register match", () => {
  test("blocks in STRICT and reviews elsewhere", () => {
    assert.equal(
      applyStrictness(
        input({ mode: "STRICT", requireRegistryMatch: true, registry: "UNRESOLVED" }),
      ).outcome,
      "BLOCKED",
    );
    assert.equal(
      applyStrictness(
        input({ mode: "OPEN", requireRegistryMatch: true, registry: "UNRESOLVED" }),
      ).outcome,
      "REVIEW_REQUIRED",
    );
  });

  test("is independent of the mode when the register did confirm", () => {
    assert.equal(
      applyStrictness(input({ mode: "OPEN", requireRegistryMatch: true })).outcome,
      "ALLOWED",
    );
  });
});

describe("a missing address", () => {
  test("is always at least a review", () => {
    assert.equal(applyStrictness(input({ hasEmail: false })).outcome, "REVIEW_REQUIRED");
    assert.equal(
      applyStrictness(input({ mode: "OPEN", hasEmail: false })).outcome,
      "REVIEW_REQUIRED",
    );
  });

  test("does not also trip the domain rule", () => {
    // With no address at all, "the address is not on the company domain" is a
    // confusing thing to tell somebody. The reason should be the missing one.
    const verdict = applyStrictness(input({ hasEmail: false, emailOnCompanyDomain: false }));
    assert.match(verdict.reason ?? "", /no usable email/i);
  });
});

describe("OPEN needs a stated basis", () => {
  test("is unavailable until a lawful basis is chosen", () => {
    // "Contact on the basis I stated" is incoherent when none is stated.
    assert.equal(openModeAvailable("UNSTATED"), false);
    assert.equal(openModeAvailable("LEGITIMATE_INTERESTS"), true);
  });
});

/* ====================================================== source disclosure */

describe("telling people where their details came from", () => {
  const base = {
    legalName: "Northgate Ltd",
    privacyPolicyUrl: "https://northgate.example/privacy",
  };

  test("names the source and points at the notice", () => {
    const result = buildSourceDisclosure({ ...base, provenanceTypes: ["WEBSITE"] });
    assert.equal(result.blocked, false);
    assert.match(result.line ?? "", /Northgate Ltd/);
    assert.match(result.line ?? "", /your company's own website/);
    assert.match(result.line ?? "", /northgate\.example\/privacy/);
  });

  test("blocks the send when nothing records where the data came from", () => {
    // A cold email that cannot answer that question should not go out. This is
    // the same discipline as refusing to send without an unsubscribe token.
    const result = buildSourceDisclosure({ ...base, provenanceTypes: [] });
    assert.equal(result.blocked, true);
    assert.equal(result.line, null);
    assert.match(result.gap ?? "", /where this prospect's details came from/i);
  });

  test("blocks the send when there is no privacy notice to point at", () => {
    const result = buildSourceDisclosure({
      ...base,
      privacyPolicyUrl: null,
      provenanceTypes: ["WEBSITE"],
    });
    assert.equal(result.blocked, true);
    assert.match(result.gap ?? "", /privacy notice/i);
  });

  test("an unrecognised provenance type counts as nothing recorded", () => {
    // Silently describing a source we cannot name would be worse than
    // refusing: the recipient would be told something untrue.
    const result = buildSourceDisclosure({
      ...base,
      provenanceTypes: ["SOMETHING_NEW"],
    });
    assert.equal(result.blocked, true);
  });

  test("leads with the source a recipient would recognise", () => {
    // "We found you on your own website" is verifiable instantly. Naming a
    // licensed provider they have never heard of first is accurate and useless.
    const result = buildSourceDisclosure({
      ...base,
      provenanceTypes: ["LICENSED_PROVIDER", "WEBSITE"],
    });
    const line = result.line ?? "";
    assert.ok(
      line.indexOf("your company's own website") < line.indexOf("data provider"),
      "the recognisable source should come first",
    );
  });

  test("reads as a sentence with several sources", () => {
    const result = buildSourceDisclosure({
      ...base,
      provenanceTypes: ["WEBSITE", "REGISTRY", "LICENSED_PROVIDER"],
    });
    assert.match(result.line ?? "", /website, the public company register and a business/);
  });

  test("duplicates collapse", () => {
    const result = buildSourceDisclosure({
      ...base,
      provenanceTypes: ["WEBSITE", "website", "WEBSITE"],
    });
    assert.equal((result.line ?? "").match(/own website/g)?.length, 1);
  });

  test("falls back to 'we' when no legal name is on file", () => {
    const result = buildSourceDisclosure({
      ...base,
      legalName: null,
      provenanceTypes: ["WEBSITE"],
    });
    // Still sendable: the sender signature carries the identity separately, and
    // an unnamed but honest disclosure beats none.
    assert.equal(result.blocked, false);
    assert.match(result.line ?? "", /because we found/);
  });

  test("only cold contact owes the disclosure", () => {
    // Somebody who enquired gave us their details themselves. Explaining where
    // we "found" them would be both wrong and faintly alarming.
    assert.equal(disclosureRequired("COLD"), true);
    assert.equal(disclosureRequired("WARM"), false);
    assert.equal(disclosureRequired("REACTIVATION"), false);
  });
});
