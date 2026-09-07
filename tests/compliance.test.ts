import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_SOURCE_KINDS,
  BASIS_DESCRIPTIONS,
  BASIS_LABELS,
  EMPTY_DATA_CONTROLS,
  LAWFUL_BASES,
  PROHIBITED_SOURCES,
  SOURCE_DESCRIPTIONS,
  SOURCE_LABELS,
  complianceGaps,
  isReadyForColdOutreach,
  type DataControls,
} from "../src/lib/compliance/types.ts";

/**
 * Data controls decide whether a workspace is allowed to send cold outreach at
 * all, so the tests are written from the direction that matters: proving that a
 * workspace which has answered nothing is treated as permitting nothing, and
 * that no individual field can be left out and still produce a "ready" verdict.
 */

/** A workspace that has answered everything a cold send legally requires. */
const COMPLETE: DataControls = {
  ...EMPTY_DATA_CONTROLS,
  legalName: "Example Roofing Ltd",
  registeredCountry: "GB",
  registeredAddress: "1 Example Street, Bournemouth, BH1 1AA",
  privacyPolicyUrl: "https://example.co.uk/privacy",
  privacyContactEmail: "privacy@example.co.uk",
  prospectCountries: ["GB"],
  prospectType: "B2B",
  allowedSources: ["PUBLIC_CORPORATE_REGISTER", "BUSINESS_WEBSITE"],
  marketingLawfulBasis: "LEGITIMATE_INTERESTS",
  lawfulBasisNote: "Assessment recorded 2026-09-01; B2B only, opt-out honoured.",
  retainRawEventsDays: 30,
};

describe("a workspace that has answered nothing", () => {
  test("is not ready for cold outreach", () => {
    // The default has to be restrictive. A workspace that never opened Settings
    // must not be the least constrained one in the product.
    assert.equal(isReadyForColdOutreach(EMPTY_DATA_CONTROLS), false);
  });

  test("permits no data sources at all", () => {
    assert.deepEqual(EMPTY_DATA_CONTROLS.allowedSources, []);
  });

  test("states no lawful basis", () => {
    assert.equal(EMPTY_DATA_CONTROLS.marketingLawfulBasis, "UNSTATED");
  });

  test("is told every blocking thing that is missing", () => {
    const blocking = complianceGaps(EMPTY_DATA_CONTROLS)
      .filter((gap) => gap.severity === "BLOCKING")
      .map((gap) => gap.code);

    for (const required of [
      "legal_name",
      "postal_address",
      "privacy_policy",
      "lawful_basis",
      "sources",
    ]) {
      assert.ok(blocking.includes(required), `${required} should block`);
    }
  });
});

describe("a fully answered workspace", () => {
  test("is ready", () => {
    assert.equal(isReadyForColdOutreach(COMPLETE), true);
  });

  test("has no blocking gaps left", () => {
    const blocking = complianceGaps(COMPLETE).filter(
      (gap) => gap.severity === "BLOCKING",
    );
    assert.deepEqual(blocking, []);
  });
});

describe("each requirement blocks on its own", () => {
  // Removing any one of these must be enough to stop cold outreach. Tested
  // field by field because a check that only fires when several are missing
  // would pass a workspace with exactly one hole in it.
  const required: [string, Partial<DataControls>][] = [
    ["legal name", { legalName: null }],
    ["postal address", { registeredAddress: null }],
    ["privacy notice", { privacyPolicyUrl: null }],
    ["lawful basis", { marketingLawfulBasis: "UNSTATED" }],
    ["permitted sources", { allowedSources: [] }],
  ];

  for (const [name, patch] of required) {
    test(`missing ${name} blocks cold outreach`, () => {
      assert.equal(isReadyForColdOutreach({ ...COMPLETE, ...patch }), false);
    });
  }

  test("a blank legal name is not an answer", () => {
    // "   " is a value in the database and not a name in the world.
    assert.equal(isReadyForColdOutreach({ ...COMPLETE, legalName: "   " }), false);
  });
});

describe("advisory gaps", () => {
  test("no markets named is advice, not a block", () => {
    const controls = { ...COMPLETE, prospectCountries: [] };
    assert.equal(isReadyForColdOutreach(controls), true);
    assert.ok(
      complianceGaps(controls).some(
        (gap) => gap.code === "markets" && gap.severity === "ADVISORY",
      ),
    );
  });

  test("legitimate interests without a note is flagged", () => {
    // The basis rests on an assessment. Not having written it down does not
    // make the send unlawful, but it makes it unevidenced.
    const controls = { ...COMPLETE, lawfulBasisNote: null };
    assert.ok(
      complianceGaps(controls).some((gap) => gap.code === "basis_note"),
    );
  });

  test("consent needs no assessment note", () => {
    const controls: DataControls = {
      ...COMPLETE,
      marketingLawfulBasis: "CONSENT",
      lawfulBasisNote: null,
    };
    assert.equal(
      complianceGaps(controls).some((gap) => gap.code === "basis_note"),
      false,
    );
  });

  test("no retention limit on raw payloads is flagged", () => {
    const controls = { ...COMPLETE, retainRawEventsDays: null };
    assert.ok(complianceGaps(controls).some((gap) => gap.code === "retention"));
  });
});

describe("the vocabulary", () => {
  test("every source is labelled and explained", () => {
    for (const source of ALLOWED_SOURCE_KINDS) {
      assert.ok(SOURCE_LABELS[source], `${source} has no label`);
      assert.ok(
        SOURCE_DESCRIPTIONS[source]?.length > 30,
        `${source} needs an explanation someone can act on`,
      );
    }
  });

  test("every lawful basis is labelled and explained", () => {
    for (const basis of LAWFUL_BASES) {
      assert.ok(BASIS_LABELS[basis], `${basis} has no label`);
      assert.ok(BASIS_DESCRIPTIONS[basis], `${basis} has no explanation`);
    }
  });

  test("prohibited sources are stated, and are not selectable", () => {
    // They are displayed with no toggle. A rule nobody sees is one somebody
    // tests by assuming silence means yes.
    assert.ok(PROHIBITED_SOURCES.length >= 5);
    for (const prohibited of PROHIBITED_SOURCES) {
      assert.equal(
        (ALLOWED_SOURCE_KINDS as readonly string[]).includes(prohibited),
        false,
        `${prohibited} must never be an allowable source`,
      );
    }
  });

  test("public availability is not offered as a basis in itself", () => {
    // The single most common misunderstanding this section exists to prevent.
    assert.equal(
      (LAWFUL_BASES as readonly string[]).some((basis) =>
        /PUBLIC|AVAILABLE|SCRAPED/.test(basis),
      ),
      false,
    );
  });

  test("every gap message tells someone what to do", () => {
    for (const gap of complianceGaps(EMPTY_DATA_CONTROLS)) {
      assert.ok(gap.message.length > 30, `${gap.code}'s message is too terse`);
      assert.ok(
        ["BLOCKING", "ADVISORY"].includes(gap.severity),
        `${gap.code} has an unknown severity`,
      );
    }
  });
});
