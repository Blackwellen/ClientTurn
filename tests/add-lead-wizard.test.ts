import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSION_GOALS,
  LEAD_SOURCES,
  MIN_EVIDENCE,
  RELATIONSHIP_CHOICES,
  blockingDuplicates,
  classifyRelationship,
  companyKey,
  contactabilityCheckSchema,
  conversionDestination,
  createManualLeadSchema,
  evidenceRequired,
  followUpEligibility,
  hasBlockingSuppression,
  initialAddLeadState,
  isBlockingDuplicate,
  isDirty,
  isValidEmail,
  isValidPhone,
  normaliseCompany,
  normaliseEmail,
  normalisePhoneValue,
  normalisePostcode,
  parseEstimatedValue,
  permittedChannels,
  permittedMessagingChannels,
  routingReadiness,
  sourceDetailRequired,
  sourceProviderSlug,
  validateContactStep,
  validateEnquiryStep,
  validatePermissionStep,
  validateRouteStep,
  type ContactabilityAssessment,
  type DuplicateMatch,
  type RelationshipChoice,
} from "../src/lib/leads/add-lead/types.ts";

/* --------------------------------------------------------------- fixtures */

function assessment(
  overrides: Partial<ContactabilityAssessment> = {},
): ContactabilityAssessment {
  return {
    classification: "WARM",
    channels: {
      EMAIL: { permission: "PERMITTED", reason: "" },
      SMS: { permission: "PERMITTED", reason: "" },
      WHATSAPP: { permission: "REVIEW", reason: "" },
      PHONE: { permission: "PERMITTED", reason: "" },
    },
    suppression: [],
    prospectRedirect: false,
    evidenceRequirement: null,
    ...overrides,
  };
}

function duplicate(overrides: Partial<DuplicateMatch> = {}): DuplicateMatch {
  return {
    id: "lead-1",
    kind: "LEAD",
    name: "Jamie Taylor",
    company: "Riverside Roofing",
    emailMasked: "ja•••@riversideroofing.com",
    phoneMasked: "+44•••543",
    status: "NEW",
    createdAt: "2026-09-01T09:00:00.000Z",
    confidence: "EXACT_EMAIL",
    ...overrides,
  };
}

const EVIDENCE =
  "Introduced by existing customer Sarah Williams on 12 Apr 2025. Happy for email and phone contact.";

function contact(overrides = {}) {
  return {
    firstName: "Jamie",
    lastName: "Taylor",
    company: "Riverside Roofing",
    email: "jamie@riversideroofing.com",
    mobile: "07700900123",
    telephone: "",
    postcode: "BH2 6AA",
    address: "",
    ...overrides,
  };
}

function enquiry(overrides = {}) {
  return {
    serviceId: "8f2f2a1e-2b52-4f0c-8c8f-6f0c9b1a2d3e",
    enquiryText: "Leak near the chimney; wants an inspection this week.",
    source: "PHONE_CALL" as const,
    sourceDetail: "Inbound call from existing yard sign",
    estimatedValue: "2500",
    conversionGoal: "BOOK_SITE_VISIT" as const,
    notes: "Prefers a morning appointment.",
    ...overrides,
  };
}

/* ------------------------------------------------------------ normalisation */

describe("add lead — normalisation", () => {
  test("email is lower-cased and trimmed", () => {
    assert.equal(normaliseEmail("  Jamie@Example.COM "), "jamie@example.com");
    assert.equal(normaliseEmail("   "), null);
    assert.equal(normaliseEmail(null), null);
  });

  test("UK mobile numbers normalise to E.164", () => {
    assert.equal(normalisePhoneValue("07700 900123"), "+447700900123");
    assert.equal(normalisePhoneValue("+44 7700 900123"), "+447700900123");
    assert.equal(normalisePhoneValue(""), null);
  });

  test("postcodes are compacted then re-spaced", () => {
    assert.equal(normalisePostcode("bh26aa"), "BH2 6AA");
    assert.equal(normalisePostcode(" BH2  6AA "), "BH2 6AA");
    assert.equal(normalisePostcode(""), null);
  });

  test("company key ignores suffixes and punctuation", () => {
    assert.equal(companyKey("Riverside Roofing Ltd"), companyKey("riverside roofing"));
    assert.equal(companyKey("Riverside-Roofing, Limited"), "riversideroofing");
    assert.equal(companyKey("  "), null);
    assert.equal(normaliseCompany("  Riverside   Roofing "), "Riverside Roofing");
  });

  test("contact validity is checked, not assumed", () => {
    assert.equal(isValidEmail("jamie@riversideroofing.com"), true);
    assert.equal(isValidEmail("jamie@riverside"), false);
    assert.equal(isValidPhone("07700900123"), true);
    assert.equal(isValidPhone("12"), false);
  });

  test("an estimate is a bounded number or nothing", () => {
    assert.equal(parseEstimatedValue("2,500"), 2500);
    assert.equal(parseEstimatedValue("£2500.50"), 2500.5);
    assert.equal(parseEstimatedValue(""), null);
    assert.equal(parseEstimatedValue("-5"), null);
    assert.equal(parseEstimatedValue("99999999"), null);
  });
});

/* ------------------------------------------------------------------ step 1 */

describe("add lead — step 1 contact", () => {
  test("identity fields are required", () => {
    const errors = validateContactStep(contact({ firstName: "", lastName: "", company: "" }));
    assert.ok(errors.firstName);
    assert.ok(errors.lastName);
    assert.ok(errors.company);
  });

  test("at least one contact method is required", () => {
    const errors = validateContactStep(
      contact({ email: "", mobile: "", telephone: "" }),
    );
    assert.ok(errors.email);
    assert.ok(errors.mobile);
  });

  test("a telephone alone satisfies the contact-method floor", () => {
    const errors = validateContactStep(
      contact({ email: "", mobile: "", telephone: "01202 123456" }),
    );
    assert.equal(errors.email, undefined);
    assert.equal(errors.mobile, undefined);
  });

  test("malformed email and phone are rejected", () => {
    const errors = validateContactStep(
      contact({ email: "not-an-email", mobile: "12" }),
    );
    assert.ok(errors.email);
    assert.ok(errors.mobile);
  });

  test("a complete contact passes", () => {
    assert.deepEqual(validateContactStep(contact()), {});
  });
});

/* ------------------------------------------------------------ duplicates */

describe("add lead — duplicates", () => {
  test("exact email and phone matches block; softer signals do not", () => {
    assert.equal(isBlockingDuplicate(duplicate({ confidence: "EXACT_EMAIL" })), true);
    assert.equal(isBlockingDuplicate(duplicate({ confidence: "EXACT_PHONE" })), true);
    assert.equal(isBlockingDuplicate(duplicate({ confidence: "COMPANY_MATCH" })), false);
    assert.equal(isBlockingDuplicate(duplicate({ confidence: "NAME_COMPANY" })), false);
  });

  test("blockingDuplicates keeps only the hard matches", () => {
    const matches = [
      duplicate({ id: "a", confidence: "COMPANY_MATCH" }),
      duplicate({ id: "b", confidence: "EXACT_PHONE" }),
    ];
    assert.deepEqual(
      blockingDuplicates(matches).map((match) => match.id),
      ["b"],
    );
  });
});

/* ------------------------------------------------------------------ step 2 */

describe("add lead — step 2 enquiry", () => {
  test("service, enquiry text and goal are required", () => {
    const errors = validateEnquiryStep(
      enquiry({ serviceId: "", enquiryText: "", conversionGoal: "" }),
    );
    assert.ok(errors.serviceId);
    assert.ok(errors.enquiryText);
    assert.ok(errors.conversionGoal);
  });

  test("source detail is required only where the label alone says nothing", () => {
    assert.equal(sourceDetailRequired("REFERRAL"), true);
    assert.equal(sourceDetailRequired("OTHER"), true);
    assert.equal(sourceDetailRequired("PHONE_CALL"), false);

    const errors = validateEnquiryStep(
      enquiry({ source: "REFERRAL", sourceDetail: "" }),
    );
    assert.ok(errors.sourceDetail);
  });

  test("an unreasonable estimate is rejected", () => {
    assert.ok(validateEnquiryStep(enquiry({ estimatedValue: "abc" })).estimatedValue);
    assert.ok(
      validateEnquiryStep(enquiry({ estimatedValue: "5000000" })).estimatedValue,
    );
    assert.deepEqual(validateEnquiryStep(enquiry({ estimatedValue: "" })), {});
  });

  test("every source maps to a lead_sources provider slug", () => {
    for (const source of LEAD_SOURCES) {
      assert.match(sourceProviderSlug(source), /^[a-z_]+$/);
    }
  });

  test("every conversion goal derives a destination", () => {
    for (const goal of CONVERSION_GOALS) {
      const destination = conversionDestination(goal);
      assert.ok(destination.title.length > 0);
      assert.ok(destination.detail.length > 0);
    }
    assert.equal(
      conversionDestination("BOOK_SITE_VISIT").title,
      "Site visit → Booking / Handover",
    );
  });

  test("a complete enquiry passes", () => {
    assert.deepEqual(validateEnquiryStep(enquiry()), {});
  });
});

/* ------------------------------------------------------------------ step 3 */

describe("add lead — step 3 permission", () => {
  test("a found contact is always a prospect, never a warm lead", () => {
    assert.equal(classifyRelationship("FOUND_BY_US", EVIDENCE), "PROSPECT");
    assert.equal(classifyRelationship("FOUND_BY_US", ""), "PROSPECT");
  });

  test("relationships that need no evidence are warm outright", () => {
    assert.equal(classifyRelationship("THEY_CONTACTED_US", ""), "WARM");
    assert.equal(classifyRelationship("EXISTING_CUSTOMER", ""), "WARM");
  });

  test("evidence-bearing relationships fall back to review without it", () => {
    for (const choice of RELATIONSHIP_CHOICES) {
      if (!evidenceRequired(choice)) continue;
      assert.equal(classifyRelationship(choice, ""), "REVIEW", choice);
      assert.equal(classifyRelationship(choice, "x".repeat(MIN_EVIDENCE - 1)), "REVIEW");
    }
    assert.equal(classifyRelationship("REFERRAL", EVIDENCE), "WARM");
    assert.equal(classifyRelationship("EXPLICIT_MARKETING_CONSENT", EVIDENCE), "WARM");
  });

  test("“other” is always review, whatever is typed into the evidence box", () => {
    assert.equal(classifyRelationship("OTHER", EVIDENCE), "REVIEW");
  });

  test("the prospect answer cannot continue as a lead", () => {
    const errors = validatePermissionStep(
      { relationship: "FOUND_BY_US", evidence: EVIDENCE },
      assessment({ classification: "PROSPECT", prospectRedirect: true }),
    );
    assert.ok(errors.relationship);
  });

  test("a relationship must be chosen", () => {
    const errors = validatePermissionStep({ relationship: "", evidence: "" }, null);
    assert.ok(errors.relationship);
  });

  test("missing evidence blocks a referral", () => {
    const errors = validatePermissionStep(
      { relationship: "REFERRAL", evidence: "referred" },
      assessment(),
    );
    assert.ok(errors.evidence);
  });

  test("a blocking suppression stops the step; a warning does not", () => {
    const blocked = assessment({
      suppression: [
        { code: "opted_out", label: "Opted out", detail: "", tone: "danger" },
      ],
    });
    assert.equal(hasBlockingSuppression(blocked), true);
    assert.ok(
      validatePermissionStep({ relationship: "REFERRAL", evidence: EVIDENCE }, blocked)
        .suppression,
    );

    const warned = assessment({
      suppression: [
        { code: "cooldown", label: "Recently contacted", detail: "", tone: "warning" },
      ],
    });
    assert.equal(hasBlockingSuppression(warned), false);
    assert.deepEqual(
      validatePermissionStep({ relationship: "REFERRAL", evidence: EVIDENCE }, warned),
      {},
    );
  });

  test("permitted channels are read from the assessment, not assumed", () => {
    assert.deepEqual(permittedChannels(assessment()), ["EMAIL", "SMS", "PHONE"]);
    assert.deepEqual(permittedMessagingChannels(assessment()), ["EMAIL", "SMS"]);
    assert.deepEqual(permittedChannels(null), []);
  });
});

/* ------------------------------------------------------------------ step 4 */

describe("add lead — step 4 routing", () => {
  const routing = initialAddLeadState().routing;

  test("a manual attention flag needs a reason", () => {
    assert.ok(
      validateRouteStep({ ...routing, needsAttention: true, attentionReason: "" })
        .attentionReason,
    );
    assert.deepEqual(
      validateRouteStep({
        ...routing,
        needsAttention: true,
        attentionReason: "High value, urgent",
      }),
      {},
    );
  });

  test("only NEW and CONTACTED may be chosen as a starting status", () => {
    assert.deepEqual(validateRouteStep({ ...routing, initialStatus: "NEW" }), {});
    assert.ok(
      validateRouteStep({
        ...routing,
        // A hand-edited payload trying to open a lead in a later lifecycle state.
        initialStatus: "BOOKED" as never,
      }).initialStatus,
    );
  });

  test("follow-up needs both an automation and a permitted messaging channel", () => {
    assert.deepEqual(
      followUpEligibility(assessment(), { automationReady: true, reason: null }),
      { eligible: true, reason: null },
    );

    const noAutomation = followUpEligibility(assessment(), {
      automationReady: false,
      reason: "Your new-lead follow-up automation is paused.",
    });
    assert.equal(noAutomation.eligible, false);
    assert.match(noAutomation.reason ?? "", /paused/);

    const noChannel = followUpEligibility(
      assessment({
        channels: {
          EMAIL: { permission: "BLOCKED", reason: "" },
          SMS: { permission: "UNAVAILABLE", reason: "" },
          WHATSAPP: { permission: "REVIEW", reason: "" },
          PHONE: { permission: "PERMITTED", reason: "" },
        },
      }),
      { automationReady: true, reason: null },
    );
    // A voice call is not something the engine can send: phone-only is not
    // enough to start an automated follow-up.
    assert.equal(noChannel.eligible, false);

    assert.equal(
      followUpEligibility(null, { automationReady: true, reason: null }).eligible,
      false,
    );
  });

  test("routing readiness reports the real state of each check", () => {
    const clean = routingReadiness({
      duplicates: [],
      duplicateChecked: true,
      assessment: assessment(),
      followUp: { requested: true, eligible: true, reason: null },
    });
    assert.deepEqual(
      clean.map((item) => item.tone),
      ["success", "success", "success", "success"],
    );
    assert.equal(clean[2].label, "3 permitted channels");

    const messy = routingReadiness({
      duplicates: [duplicate()],
      duplicateChecked: true,
      assessment: assessment({ classification: "REVIEW" }),
      followUp: { requested: true, eligible: false, reason: "No channel." },
    });
    assert.equal(messy[0].tone, "danger");
    assert.equal(messy[0].label, "Duplicate found");
    assert.equal(messy[1].label, "Needs review");
    assert.equal(messy[3].label, "Follow-up unavailable");

    const unchecked = routingReadiness({
      duplicates: [],
      duplicateChecked: false,
      assessment: null,
      followUp: { requested: false, eligible: false, reason: null },
    });
    assert.equal(unchecked[0].label, "Duplicate check pending");
    assert.equal(unchecked[3].label, "Follow-up off");
  });
});

/* ------------------------------------------------------------ wire schemas */

describe("add lead — wire schemas", () => {
  const valid = {
    contact: contact(),
    enquiry: enquiry(),
    permission: { relationship: "REFERRAL" as RelationshipChoice, evidence: EVIDENCE },
    routing: initialAddLeadState().routing,
    acknowledgedDuplicates: false,
  };

  test("a complete payload parses", () => {
    assert.equal(createManualLeadSchema.safeParse(valid).success, true);
  });

  test("an unknown source is rejected", () => {
    const bad = { ...valid, enquiry: { ...valid.enquiry, source: "META" } };
    assert.equal(createManualLeadSchema.safeParse(bad).success, false);
  });

  test("a later lifecycle status is rejected on the wire", () => {
    const bad = {
      ...valid,
      routing: { ...valid.routing, initialStatus: "WON" },
    };
    assert.equal(createManualLeadSchema.safeParse(bad).success, false);
  });

  test("a non-uuid assignee is rejected on the wire", () => {
    const bad = { ...valid, routing: { ...valid.routing, assigneeId: "me" } };
    assert.equal(createManualLeadSchema.safeParse(bad).success, false);
  });

  test("an unknown relationship is rejected on the wire", () => {
    const bad = { ...valid, permission: { relationship: "TRUST_ME", evidence: "" } };
    assert.equal(createManualLeadSchema.safeParse(bad).success, false);
  });

  test("the contactability check only accepts known relationships", () => {
    assert.equal(
      contactabilityCheckSchema.safeParse({
        email: "",
        mobile: "07700900123",
        telephone: "",
        postcode: "BH2 6AA",
        relationship: "FOUND_BY_US",
        evidence: "",
      }).success,
      true,
    );
    assert.equal(
      contactabilityCheckSchema.safeParse({
        email: "",
        mobile: "",
        telephone: "",
        postcode: "",
        relationship: "MADE_IT_UP",
        evidence: "",
      }).success,
      false,
    );
  });
});

/* -------------------------------------------------------------- dirty state */

describe("add lead — dirty tracking", () => {
  test("an untouched wizard is clean", () => {
    assert.equal(isDirty(initialAddLeadState()), false);
  });

  test("one typed character makes it dirty", () => {
    const state = initialAddLeadState();
    state.contact.firstName = "J";
    assert.equal(isDirty(state), true);
  });
});
