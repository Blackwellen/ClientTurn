import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderTemplate, mergeValuesFor } from "../src/lib/outreach/templates.ts";

/**
 * Template rendering for cold outreach.
 *
 * These are the strings that go to a stranger under the customer's name, so
 * the failure modes that matter are not crashes — they are a message that
 * leaks a placeholder, or one that silently drops the personalisation and
 * greets somebody as nobody.
 */

describe("template rendering", () => {
  test("substitutes the fields we hold", () => {
    const body = renderTemplate("Hi {{first_name}} at {{company_name}},", {
      first_name: "Sam",
      company_name: "Ridge Facilities",
    });
    assert.equal(body, "Hi Sam at Ridge Facilities,");
  });

  test("an unknown placeholder is emptied, never left visible", () => {
    // "Hi {{nickname}}" arriving in a prospect's inbox is the single most
    // recognisable sign of automated mail. It must not be possible.
    const body = renderTemplate("Hi {{nickname}}, about {{company_name}}", {
      company_name: "Ridge",
    });
    assert.equal(body, "Hi , about Ridge");
    assert.ok(!body.includes("{{"), "a placeholder survived into the body");
  });

  test("whitespace and casing inside the braces still match", () => {
    assert.equal(
      renderTemplate("{{ First_Name }} and {{first_name}}", { first_name: "Sam" }),
      "Sam and Sam",
    );
  });

  test("templates are data, not code", () => {
    // No expression language: a template that looks like an expression is
    // treated as a literal placeholder and emptied.
    const body = renderTemplate("{{ 1 + 1 }}{{constructor}}", {});
    assert.equal(body, "{{ 1 + 1 }}");
  });

  test("a body with no placeholders is returned unchanged", () => {
    const text = "We repair flat roofs across Dorset.";
    assert.equal(renderTemplate(text, { first_name: "Sam" }), text);
  });
});

describe("merge values", () => {
  const base = {
    first_name: null,
    last_name: null,
    role_title: null,
    company: null,
  };

  test("a missing first name becomes a greeting that still reads", () => {
    const values = mergeValuesFor(base, "Blackwellen Roofing");
    assert.equal(values.first_name, "there");
    assert.equal(values.full_name, "there");
    // "Hi there" is a worse email than "Hi Sam", but it is a sendable one.
    assert.equal(renderTemplate("Hi {{first_name}},", values), "Hi there,");
  });

  test("a missing company falls back rather than emptying mid-sentence", () => {
    const values = mergeValuesFor(base, "Blackwellen Roofing");
    assert.equal(values.company_name, "your company");
  });

  test("names are used when present, and trimmed", () => {
    const values = mergeValuesFor(
      {
        first_name: " Sam ",
        last_name: "Okafor",
        role_title: " Facilities Manager ",
        company: { name: " Ridge Facilities " },
      },
      "Blackwellen Roofing",
    );
    assert.equal(values.first_name, "Sam");
    assert.equal(values.full_name, "Sam Okafor");
    assert.equal(values.role, "Facilities Manager");
    assert.equal(values.company_name, "Ridge Facilities");
  });

  test("the sending business name is always available to the template", () => {
    const values = mergeValuesFor(base, "Blackwellen Roofing");
    assert.equal(values.business_name, "Blackwellen Roofing");
  });
});
