import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  POLICY_OUTCOMES,
  decisionColumnFor,
  type PolicyDecision,
  type PolicyOutcome,
  type PolicyReasonCode,
} from "../src/lib/policy/types.ts";
import {
  ALLOWED_SOURCE_KINDS,
  PROVENANCE_TO_SOURCE,
  sourceKindFor,
  verdictForSources,
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


/* ------------------------------------------------------ source provenance */

describe("mapping recorded provenance onto permitted sources", () => {
  test("every provenance type the database allows has a mapping", () => {
    // These are the values `prospect_data_sources.source_type` permits. One
    // without a mapping would be judged NOT_PERMITTED forever, silently making
    // a whole class of prospect uncontactable.
    for (const type of [
      "WEBSITE",
      "REGISTRY",
      "LICENSED_PROVIDER",
      "CRM",
      "IMPORT",
      "FIRST_PARTY",
      "PUBLIC_FEED",
      "MANUAL",
    ]) {
      assert.ok(sourceKindFor(type), `${type} has no mapping`);
    }
  });

  test("every mapping targets a real source kind", () => {
    for (const [type, kind] of Object.entries(PROVENANCE_TO_SOURCE)) {
      assert.ok(
        (ALLOWED_SOURCE_KINDS as readonly string[]).includes(kind),
        `${type} maps to unknown kind ${kind}`,
      );
    }
  });

  test("an unrecognised provenance type is not a pass", () => {
    // Adding a source_type to the database must not silently widen what may be
    // contacted.
    assert.equal(sourceKindFor("SOMETHING_NEW"), null);
    assert.equal(
      verdictForSources(["SOMETHING_NEW"], [...ALLOWED_SOURCE_KINDS]),
      "NOT_PERMITTED",
    );
  });

  test("no recorded provenance is UNKNOWN, not permitted", () => {
    assert.equal(verdictForSources([], [...ALLOWED_SOURCE_KINDS]), "UNKNOWN");
  });

  test("a record is permitted only when every one of its sources is", () => {
    // One prohibited source taints the record. A prospect assembled partly
    // from a permitted register and partly from somewhere the workspace has
    // not allowed is not two-thirds contactable.
    assert.equal(
      verdictForSources(["REGISTRY", "WEBSITE"], ["PUBLIC_CORPORATE_REGISTER", "BUSINESS_WEBSITE"]),
      "PERMITTED",
    );
    assert.equal(
      verdictForSources(["REGISTRY", "WEBSITE"], ["PUBLIC_CORPORATE_REGISTER"]),
      "NOT_PERMITTED",
    );
  });

  test("a workspace permitting nothing permits nothing", () => {
    assert.equal(verdictForSources(["REGISTRY"], []), "NOT_PERMITTED");
  });
});

/* ------------------------------------------------ the evidence trail --- */

describe("a policy decision becomes evidence, not just state", () => {
  /**
   * `contactability_results` is upserted per (subject, channel, campaign type):
   * it answers "can we email this person today?" and is overwritten every time
   * it is asked. `compliance_decisions` is append-only: it answers "what did we
   * decide, on what basis, under which policy version, at the moment we sent
   * that message in March?" — which an upsert cannot answer, because answering
   * it requires the row not to have been overwritten since.
   *
   * Nothing wrote the second table. `policy/service.ts` said in its own comment
   * that the durable trail "lives in compliance_decisions", two admin surfaces
   * read it, and one of those is the **review queue** — the items the engine
   * could not decide alone. It could never receive an item, so a human-review
   * workflow silently did nothing.
   *
   * `decisionColumnFor` is the bridge between the engine's seven outcomes and
   * the five values a compliance officer sees in that queue. It is asserted
   * here because the distinctions it makes are the ones a report turns on.
   */
  function decision(
    outcome: PolicyOutcome,
    reasonCode: PolicyReasonCode,
  ): PolicyDecision {
    return { outcome, reasonCode, message: "", policyVersion: "test" };
  }

  test("an allowed send is APPROVED", () => {
    assert.equal(decisionColumnFor(decision("ALLOWED", "ALLOWED")), "APPROVED");
  });

  test("an opt-out is SUPPRESSED, not REJECTED", () => {
    // Different facts, and only one of them is a decision about the
    // recipient's wishes. A report that conflates them cannot answer "how many
    // people did we decline to contact because they asked us not to" — which
    // is the question a regulator asks first.
    assert.equal(
      decisionColumnFor(decision("BLOCKED", "BLOCKED_OPT_OUT")),
      "SUPPRESSED",
    );
    assert.notEqual(
      decisionColumnFor(decision("BLOCKED", "BLOCKED_OPT_OUT")),
      "REJECTED",
    );
  });

  test("a refusal on any other ground is REJECTED", () => {
    for (const reason of [
      "BLOCKED_NO_PERMISSION",
      "BLOCKED_COUNTRY_POLICY",
      "BLOCKED_SUBSCRIBER_TYPE",
      "BLOCKED_INVALID_CONTACT",
    ] as PolicyReasonCode[]) {
      assert.equal(decisionColumnFor(decision("BLOCKED", reason)), "REJECTED", reason);
    }
  });

  test("quiet hours is DEFERRED — the message is going, later", () => {
    // Recording a quiet-hours hold as a refusal would report a workspace that
    // respects the evening as one that keeps being blocked.
    assert.equal(
      decisionColumnFor(decision("BLOCKED", "BLOCKED_QUIET_HOURS")),
      "DEFERRED",
    );
  });

  test("every outcome needing a person is ESCALATED", () => {
    // This is what fills the review queue. If any of these mapped elsewhere,
    // the engine would stop and nobody would be told.
    for (const outcome of [
      "REVIEW_REQUIRED",
      "REQUIRE_CONSENT",
      "REQUIRE_PRIVACY_NOTICE",
      "REQUIRE_TEMPLATE",
      "REQUIRE_MANUAL_ACTION",
    ] as PolicyOutcome[]) {
      assert.equal(
        decisionColumnFor(decision(outcome, "REVIEW_REQUIRED")),
        "ESCALATED",
        outcome,
      );
    }
  });

  test("every outcome the engine can produce maps to a permitted column", () => {
    // The column carries a CHECK constraint. An unmapped outcome would be a
    // 23514 at send time, on the write that exists to prove the send was lawful.
    const permitted = new Set([
      "APPROVED",
      "REJECTED",
      "SUPPRESSED",
      "ESCALATED",
      "DEFERRED",
    ]);
    for (const outcome of POLICY_OUTCOMES) {
      assert.ok(
        permitted.has(decisionColumnFor(decision(outcome, "REVIEW_REQUIRED"))),
        `${outcome} maps outside the CHECK constraint`,
      );
    }
  });
});
