import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStopConditions,
  isWithinQuietHours,
  nextPermittedSendTime,
  findUnknownMergeFields,
  renderTemplate,
} from "../src/lib/automation/scheduler.ts";

const activeLead = {
  status: "CONTACTED",
  optedOut: false,
  humanTakeover: false,
  automationActive: true,
  hasReplied: false,
};

const healthyChannel = {
  subscriptionActive: true,
  integrationHealthy: true,
  contactSuppressed: false,
};

describe("stop conditions", () => {
  test("a healthy active lead does not stop", () => {
    assert.equal(evaluateStopConditions(activeLead, healthyChannel), null);
  });

  test("any reply stops the sequence", () => {
    assert.equal(
      evaluateStopConditions({ ...activeLead, hasReplied: true }, healthyChannel),
      "replied",
    );
  });

  test("opt-out stops the sequence", () => {
    assert.equal(
      evaluateStopConditions({ ...activeLead, optedOut: true }, healthyChannel),
      "opted_out",
    );
  });

  test("booked stops the sequence", () => {
    assert.equal(
      evaluateStopConditions({ ...activeLead, status: "BOOKED" }, healthyChannel),
      "booked",
    );
  });

  test("human takeover stops the sequence", () => {
    assert.equal(
      evaluateStopConditions(
        { ...activeLead, humanTakeover: true },
        healthyChannel,
      ),
      "human_takeover",
    );
  });

  test("an inactive subscription stops the sequence", () => {
    assert.equal(
      evaluateStopConditions(activeLead, {
        ...healthyChannel,
        subscriptionActive: false,
      }),
      "subscription_inactive",
    );
  });

  test("a suppressed contact stops the sequence", () => {
    assert.equal(
      evaluateStopConditions(activeLead, {
        ...healthyChannel,
        contactSuppressed: true,
      }),
      "suppressed",
    );
  });
});

const quiet = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  timezone: "Europe/London",
};

describe("quiet hours", () => {
  test("22:00 UTC in January is inside the window", () => {
    assert.equal(
      isWithinQuietHours(new Date("2026-01-15T22:00:00Z"), quiet),
      true,
    );
  });

  test("13:00 UTC in January is outside the window", () => {
    assert.equal(
      isWithinQuietHours(new Date("2026-01-15T13:00:00Z"), quiet),
      false,
    );
  });

  test("06:00 UTC in January is inside the wrapped window", () => {
    assert.equal(
      isWithinQuietHours(new Date("2026-01-15T06:00:00Z"), quiet),
      true,
    );
  });

  test("disabled quiet hours never block", () => {
    assert.equal(
      isWithinQuietHours(new Date("2026-01-15T22:00:00Z"), {
        ...quiet,
        enabled: false,
      }),
      false,
    );
  });

  test("a send inside the window rolls forward, never backwards", () => {
    const at = new Date("2026-01-15T22:00:00Z");
    const next = nextPermittedSendTime(at, quiet);
    assert.ok(next.getTime() > at.getTime());
    assert.equal(isWithinQuietHours(next, quiet), false);
  });

  test("a send outside the window is untouched", () => {
    const at = new Date("2026-01-15T13:00:00Z");
    assert.equal(nextPermittedSendTime(at, quiet).getTime(), at.getTime());
  });

  test("rolling forward never exceeds 24 hours", () => {
    const at = new Date("2026-01-15T20:30:00Z");
    const next = nextPermittedSendTime(at, quiet);
    assert.ok(next.getTime() - at.getTime() < 24 * 3600 * 1000);
  });
});

describe("merge fields", () => {
  test("known tokens are accepted", () => {
    assert.deepEqual(
      findUnknownMergeFields("Hi {{first_name}}, {{business_name}} here."),
      [],
    );
  });

  test("unknown tokens are reported so publishing can be blocked", () => {
    assert.deepEqual(
      findUnknownMergeFields("Hi {{first_name}}, your {{quote_total}} is ready"),
      ["quote_total"],
    );
  });

  test("rendering substitutes known values", () => {
    assert.equal(
      renderTemplate("Hi {{first_name}} from {{business_name}}", {
        first_name: "Sarah",
        business_name: "Dorset Roofing",
      }),
      "Hi Sarah from Dorset Roofing",
    );
  });

  test("a missing value with a safe fallback previews as that fallback", () => {
    // The preview has to show what would actually send. `first_name` falls
    // back to "there", so rendering the raw token would misrepresent the
    // message the customer is about to approve.
    assert.equal(renderTemplate("Hi {{first_name}}", {}), "Hi there");
  });

  test("a missing value with no safe fallback keeps its token visible", () => {
    // `business_phone` has no fallback: there is no safe thing to say instead
    // of a phone number, so the token stays on screen as the editor's signal
    // that this one still needs a value.
    assert.equal(
      renderTemplate("Call us on {{business_phone}}", {}),
      "Call us on {{business_phone}}",
    );
  });

  test("an unknown token is never silently emptied", () => {
    assert.equal(renderTemplate("Hi {{nickname}}", {}), "Hi {{nickname}}");
  });
});
