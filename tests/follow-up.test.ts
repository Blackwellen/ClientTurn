import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MERGE_FIELD_OPTIONS,
  formatStepDelay,
  joinDelay,
  nearestReminderOffset,
  parseFollowUpFilters,
  reminderOffsetLabel,
  splitDelay,
  testSendSchema,
  validateSequence,
  followUpHref,
} from "../src/lib/follow-up/types.ts";
import { findUnknownMergeFields } from "../src/lib/automation/scheduler.ts";

const opts = { unknownTokensFor: findUnknownMergeFields, whatsappEnabled: true };

function step(overrides: Partial<Parameters<typeof validateSequence>[0][number]> = {}) {
  return {
    key: "k1",
    delaySeconds: 0,
    template: "Hi {{first_name}}",
    enabled: true,
    channel: "sms",
    ...overrides,
  };
}

describe("follow-up view state", () => {
  test("defaults to the follow-up view", () => {
    assert.equal(parseFollowUpFilters({}).view, "follow-up");
  });

  test("an unknown view falls back rather than throwing", () => {
    assert.equal(parseFollowUpFilters({ view: "nonsense" }).view, "follow-up");
  });

  test("the qualification view is linkable", () => {
    assert.equal(parseFollowUpFilters({ view: "qualification" }).view, "qualification");
  });

  test("the default view carries no query param", () => {
    assert.equal(followUpHref({ view: "qualification" }, { view: "follow-up" }), "/app/follow-up");
  });

  test("unknown params are preserved across a patch", () => {
    const href = followUpHref({ sequence: "abc" }, { view: "qualification" });
    assert.ok(href.includes("sequence=abc"));
    assert.ok(href.includes("view=qualification"));
  });
});

describe("step delays", () => {
  test("zero reads as immediate", () => {
    assert.deepEqual(splitDelay(0), { value: 0, unit: "immediate" });
    assert.equal(formatStepDelay(0), "Immediately");
  });

  test("the largest whole unit wins", () => {
    assert.deepEqual(splitDelay(600), { value: 10, unit: "minute" });
    assert.deepEqual(splitDelay(7200), { value: 2, unit: "hour" });
    assert.deepEqual(splitDelay(259200), { value: 3, unit: "day" });
  });

  test("labels match the sequence rows", () => {
    assert.equal(formatStepDelay(600), "+ 10 minutes");
    assert.equal(formatStepDelay(7200), "+ 2 hours");
    assert.equal(formatStepDelay(86400), "+ 1 day");
    assert.equal(formatStepDelay(259200), "+ 3 days");
  });

  test("split and join round-trip", () => {
    for (const seconds of [0, 600, 7200, 86400, 259200]) {
      const { value, unit } = splitDelay(seconds);
      assert.equal(joinDelay(value, unit), seconds);
    }
  });

  test("a negative amount can never become a negative delay", () => {
    assert.equal(joinDelay(-5, "hour"), 0);
  });
});

describe("sequence validation", () => {
  test("a well-formed sequence has no issues", () => {
    assert.deepEqual(
      validateSequence([step(), step({ key: "k2", delaySeconds: 600 })], opts),
      [],
    );
  });

  test("an empty sequence is invalid", () => {
    assert.equal(validateSequence([], opts).length, 1);
  });

  test("a step with no message is invalid", () => {
    const issues = validateSequence([step({ template: "   " })], opts);
    assert.ok(issues.some((i) => i.message.includes("no message")));
  });

  test("an unknown merge field blocks the sequence", () => {
    const issues = validateSequence([step({ template: "Hi {{nickname}}" })], opts);
    assert.ok(issues.some((i) => i.message.includes("{{nickname}}")));
  });

  test("a second immediate step is flagged as a duplicate send", () => {
    const issues = validateSequence(
      [step(), step({ key: "k2", delaySeconds: 0 })],
      opts,
    );
    assert.ok(issues.some((i) => i.message.includes("same moment")));
  });

  test("a delay beyond the permitted range is rejected", () => {
    const issues = validateSequence([step({ delaySeconds: 99_999_999 })], opts);
    assert.ok(issues.some((i) => i.message.includes("permitted range")));
  });

  test("every step switched off is invalid", () => {
    const issues = validateSequence([step({ enabled: false })], opts);
    assert.ok(issues.some((i) => i.message.includes("switched off")));
  });

  test("a WhatsApp step is rejected when the plan does not include it", () => {
    const issues = validateSequence([step({ channel: "whatsapp" })], {
      ...opts,
      whatsappEnabled: false,
    });
    assert.ok(issues.some((i) => i.message.includes("WhatsApp")));
  });
});

describe("merge field picker", () => {
  test("only offers fields the send pipeline can resolve", () => {
    for (const field of MERGE_FIELD_OPTIONS) {
      assert.deepEqual(
        findUnknownMergeFields(field.token),
        [],
        `${field.token} is offered by the picker but would block publishing`,
      );
    }
  });
});

describe("booking reminder offsets", () => {
  test("a stored offset snaps onto an offered option", () => {
    assert.equal(nearestReminderOffset(1440), 1440);
    assert.equal(nearestReminderOffset(1400), 1440);
    assert.equal(nearestReminderOffset(10), 15);
  });

  test("labels read the way the card does", () => {
    assert.equal(reminderOffsetLabel(1440), "24 hours before");
    assert.equal(reminderOffsetLabel(60), "1 hour before");
  });
});

describe("test send validation", () => {
  test("a valid UK number and message passes", () => {
    assert.ok(
      testSendSchema.safeParse({
        channel: "sms",
        to: "+44 7700 900000",
        body: "Hi from {{business_name}}",
      }).success,
    );
  });

  test("a too-short number is rejected", () => {
    assert.equal(
      testSendSchema.safeParse({ channel: "sms", to: "123", body: "Hi" }).success,
      false,
    );
  });

  test("an address that is not a phone number is rejected", () => {
    assert.equal(
      testSendSchema.safeParse({
        channel: "sms",
        to: "someone@example.com",
        body: "Hi",
      }).success,
      false,
    );
  });

  test("an empty body is rejected", () => {
    assert.equal(
      testSendSchema.safeParse({ channel: "sms", to: "+447700900000", body: "  " })
        .success,
      false,
    );
  });

  test("an unsupported channel is rejected", () => {
    assert.equal(
      testSendSchema.safeParse({ channel: "email", to: "+447700900000", body: "Hi" })
        .success,
      false,
    );
  });
});
