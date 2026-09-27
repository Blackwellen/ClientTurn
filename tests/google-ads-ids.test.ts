import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionIdFromResourceName } from "../src/lib/ingest/google-ads-ids.ts";

test("the poller's resource name and the webhook's lead_id resolve to one id", () => {
  assert.equal(
    submissionIdFromResourceName("customers/1234567890/leadFormSubmissionData/987654321"),
    "987654321",
  );
  assert.equal(submissionIdFromResourceName("987654321"), "987654321");
  assert.equal(submissionIdFromResourceName(" 987654321 "), "987654321");
});

test("a trailing slash or odd input never yields an empty id", () => {
  assert.equal(submissionIdFromResourceName("customers/1/leadFormSubmissionData/42/"), "42");
  assert.equal(submissionIdFromResourceName("abc"), "abc");
});
