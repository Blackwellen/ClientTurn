import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRow,
  guessMapping,
  summarise,
  type ParsedRow,
  type RowContext,
} from "../src/lib/imports/classify.ts";

/**
 * The import classifier is what stops a purchased spreadsheet becoming a list
 * of "warm leads". These tests are written from that direction: they mostly
 * prove the classifier REFUSES to promote a row, because a false
 * IMPORT_AS_LEAD is a compliance incident and a false REVIEW is an
 * inconvenience.
 */

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    firstName: "Jane",
    lastName: "Doe",
    companyName: "Acme Roofing",
    email: "jane.doe@acme.co.uk",
    phone: null,
    postcode: null,
    roleTitle: null,
    relationshipType: null,
    sourceDetail: null,
    notes: null,
    ...overrides,
  };
}

function context(overrides: Partial<RowContext> = {}): RowContext {
  return {
    duplicateInFile: false,
    existingLeadId: null,
    existingProspectId: null,
    suppressed: false,
    defaultRelationship: null,
    ...overrides,
  };
}

describe("import classification", () => {
  /* ------------------------------------------------------ the core rule */

  test("a row with no stated relationship is never a lead", () => {
    const verdict = classifyRow(row(), context());
    assert.equal(verdict.classification, "REVIEW");
    assert.ok(verdict.flags.includes("UNKNOWN_RELATIONSHIP"));
  });

  test("'I found this company' becomes a prospect, never a lead", () => {
    const verdict = classifyRow(
      row({ relationshipType: "FOUND_BY_US" }),
      context(),
    );
    assert.equal(verdict.classification, "IMPORT_AS_PROSPECT");
  });

  test("an ambiguous relationship goes to review rather than being guessed", () => {
    for (const relationship of ["REFERRAL", "IMPORTED", "OTHER"] as const) {
      const verdict = classifyRow(row({ relationshipType: relationship }), context());
      assert.equal(
        verdict.classification,
        "REVIEW",
        `${relationship} must not be auto-classified`,
      );
    }
  });

  test("a genuinely warm relationship imports as a lead", () => {
    for (const relationship of [
      "THEY_CONTACTED_US",
      "EXISTING_CUSTOMER",
      "REQUESTED_INFORMATION",
      "EXPLICIT_MARKETING_CONSENT",
      "EXISTING_BUSINESS_RELATIONSHIP",
    ] as const) {
      const verdict = classifyRow(row({ relationshipType: relationship }), context());
      assert.equal(verdict.classification, "IMPORT_AS_LEAD", relationship);
    }
  });

  test("a file-level relationship applies when the row does not state one", () => {
    const verdict = classifyRow(
      row(),
      context({ defaultRelationship: "EXISTING_CUSTOMER" }),
    );
    assert.equal(verdict.classification, "IMPORT_AS_LEAD");
  });

  test("a row-level relationship overrides the file default", () => {
    const verdict = classifyRow(
      row({ relationshipType: "FOUND_BY_US" }),
      context({ defaultRelationship: "EXISTING_CUSTOMER" }),
    );
    assert.equal(verdict.classification, "IMPORT_AS_PROSPECT");
  });

  /* ------------------------------------------------------------- skips */

  test("a suppressed contact is skipped whatever the relationship claims", () => {
    const verdict = classifyRow(
      row({ relationshipType: "EXISTING_CUSTOMER" }),
      context({ suppressed: true }),
    );
    assert.equal(verdict.classification, "SKIP");
    assert.ok(verdict.flags.includes("SUPPRESSED_CONTACT"));
  });

  test("an existing lead is kept, never re-imported or demoted", () => {
    const verdict = classifyRow(
      row({ relationshipType: "FOUND_BY_US" }),
      context({ existingLeadId: "lead-1" }),
    );
    assert.equal(verdict.classification, "SKIP");
    assert.ok(verdict.flags.includes("EXISTING_LEAD"));
  });

  test("an existing prospect is kept", () => {
    const verdict = classifyRow(
      row({ relationshipType: "EXISTING_CUSTOMER" }),
      context({ existingProspectId: "prospect-1" }),
    );
    assert.equal(verdict.classification, "SKIP");
  });

  test("a disposable domain is skipped outright", () => {
    const verdict = classifyRow(
      row({ email: "someone@mailinator.com", relationshipType: "EXISTING_CUSTOMER" }),
      context(),
    );
    assert.equal(verdict.classification, "SKIP");
    assert.ok(verdict.flags.includes("DISPOSABLE_DOMAIN"));
  });

  test("a row with nothing identifying is skipped", () => {
    const verdict = classifyRow(
      row({ firstName: null, lastName: null, companyName: null, email: null, phone: null }),
      context(),
    );
    assert.equal(verdict.classification, "SKIP");
    assert.ok(verdict.flags.includes("MISSING_IDENTITY"));
  });

  test("a warm row with no way to reach them is a review, not a lead", () => {
    const verdict = classifyRow(
      row({ email: null, phone: null, relationshipType: "EXISTING_CUSTOMER" }),
      context(),
    );
    assert.equal(verdict.classification, "REVIEW");
  });

  /* ------------------------------------------------------------- flags */

  test("contact quality is flagged without disqualifying the row", () => {
    const roleMailbox = classifyRow(
      row({ email: "info@acme.co.uk", relationshipType: "EXISTING_CUSTOMER" }),
      context(),
    );
    assert.equal(roleMailbox.classification, "IMPORT_AS_LEAD");
    assert.ok(roleMailbox.flags.includes("ROLE_MAILBOX"));

    const personal = classifyRow(
      row({ email: "jane@gmail.com", relationshipType: "EXISTING_CUSTOMER" }),
      context(),
    );
    assert.equal(personal.classification, "IMPORT_AS_LEAD");
    assert.ok(personal.flags.includes("PERSONAL_EMAIL_DOMAIN"));
  });

  test("a duplicate inside the file is flagged", () => {
    const verdict = classifyRow(
      row({ relationshipType: "EXISTING_CUSTOMER" }),
      context({ duplicateInFile: true }),
    );
    assert.ok(verdict.flags.includes("DUPLICATE_IN_FILE"));
  });

  test("every verdict carries a human reason", () => {
    const verdicts = [
      classifyRow(row(), context()),
      classifyRow(row({ relationshipType: "FOUND_BY_US" }), context()),
      classifyRow(row(), context({ suppressed: true })),
    ];
    for (const verdict of verdicts) {
      assert.ok(verdict.reason.length > 10, "a verdict must explain itself");
    }
  });

  /* ----------------------------------------------------------- summary */

  test("summarise counts every classification", () => {
    const summary = summarise([
      classifyRow(row({ relationshipType: "EXISTING_CUSTOMER" }), context()),
      classifyRow(row({ relationshipType: "FOUND_BY_US" }), context()),
      classifyRow(row(), context()),
      classifyRow(row(), context({ suppressed: true })),
    ]);
    assert.deepEqual(summary, {
      IMPORT_AS_LEAD: 1,
      IMPORT_AS_PROSPECT: 1,
      REVIEW: 1,
      SKIP: 1,
    });
  });
});

/* ------------------------------------------------------------- mapping */

describe("column mapping", () => {
  test("recognises the header spellings real exports use", () => {
    const mapping = guessMapping([
      "First Name",
      "Surname",
      "Company Name",
      "E-Mail",
      "Mobile",
      "Post Code",
    ]);
    assert.equal(mapping.firstName, 0);
    assert.equal(mapping.lastName, 1);
    assert.equal(mapping.companyName, 2);
    assert.equal(mapping.email, 3);
    assert.equal(mapping.phone, 4);
    assert.equal(mapping.postcode, 5);
  });

  test("never maps two fields onto the same column", () => {
    const mapping = guessMapping(["email", "email", "notes"]);
    const used = Object.values(mapping);
    assert.equal(new Set(used).size, used.length);
  });

  test("leaves unknown headers unmapped rather than guessing", () => {
    const mapping = guessMapping(["wibble", "flim", "flam"]);
    assert.deepEqual(mapping, {});
  });
});
