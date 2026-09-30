import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { friendlyIssue, friendlyIssueMessage } from "../src/lib/validation/friendly-issue.ts";

/**
 * Settings actions returned Zod's developer text to the form (surface QA
 * 2026-09-30: "Too big: expected string to have <=80 characters" under the
 * service name). A schema's own message passes through; only Zod defaults are
 * rewritten, in words, with the field named.
 */
describe("friendlyIssue", () => {
  const schema = z.object({
    name: z.string().max(80),
    serviceAreaDescription: z.string(),
    average: z.number().min(0),
    custom: z.string().min(2, "Enter a service name"),
  });

  function first(input: unknown) {
    const parsed = schema.safeParse(input);
    assert.equal(parsed.success, false);
    return friendlyIssue(parsed.error!, "fallback");
  }

  const ok = { name: "a", serviceAreaDescription: "x", average: 1, custom: "ok" };

  test("too long string names the field and the limit", () => {
    assert.equal(first({ ...ok, name: "x".repeat(81) }), "Name must be 80 characters or fewer.");
  });

  test("missing field reads as a person would say it", () => {
    const { serviceAreaDescription: _omit, ...rest } = ok;
    void _omit;
    assert.equal(first(rest), "Service area description is missing or not valid.");
  });

  test("number below minimum", () => {
    assert.equal(first({ ...ok, average: -5 }), "Average must be 0 or more.");
  });

  test("a schema's own message is kept as written", () => {
    assert.equal(first({ ...ok, custom: "a" }), "Enter a service name");
  });

  test("no issue falls back", () => {
    assert.equal(friendlyIssueMessage(undefined, "Check the details."), "Check the details.");
  });

  test("never returns Zod's developer phrasing", () => {
    for (const bad of [{ ...ok, name: 5 }, { ...ok, name: "x".repeat(200) }, {}]) {
      const parsed = schema.safeParse(bad);
      const message = friendlyIssue(parsed.error!, "fallback");
      assert.doesNotMatch(message, /Too big|Too small|expected|Invalid input/);
    }
  });
});
