import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { brandMarkSrc } from "../src/lib/integrations/brand-marks.ts";
import {
  ADMIN_PROVIDER_ALIAS,
  INTERNAL_EVENT_SOURCES,
  isInternalEventSource,
} from "../src/lib/admin/provider-marks.ts";
import {
  resolveTikTokCredentials,
  twilioAccountSidProblem,
} from "../src/lib/admin/providers-shared.ts";
import { PROVIDERS } from "../src/lib/integrations/catalog.ts";
import { ADMIN_NAV, isActiveAdminRoute, titleForAdminPath } from "../src/lib/admin/nav.ts";
import {
  MAX_SAFE_RETRIES,
  formatEventId,
  isRetryable,
  jobEventStatus,
  messageEventStatus,
  parseEventId,
  retryBlockedReason,
  webhookEventStatus,
} from "../src/lib/admin/events-shared.ts";
import {
  areaForJobType,
  areaForProvider,
  fingerprintFor,
  normaliseMessage,
  referenceFor,
  severityForArea,
} from "../src/lib/admin/errors-shared.ts";
import {
  ACTION_REQUIRED_LABEL,
  ADMIN_RANGES,
  ADMIN_RANGE_COMPARISON,
  ADMIN_RANGE_LABEL,
  CONNECTION_HEALTH_LABEL,
  CONNECTION_HEALTH_TONE,
  CUSTOMER_FILTERS,
  CUSTOMER_FILTER_LABEL,
  ERROR_SEVERITIES,
  ERROR_SEVERITY_LABEL,
  ERROR_SEVERITY_TONE,
  ERROR_STATUSES,
  ERROR_STATUS_LABEL,
  EVENT_STATUSES,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  EVENT_TYPE_FILTERS,
  EVENT_TYPE_FILTER_LABEL,
  PROVIDER_STATUS_LABEL,
  PROVIDER_STATUS_TONE,
  QUEUE_STATUS_LABEL,
  QUEUE_STATUS_TONE,
} from "../src/lib/admin/types.ts";
import {
  domainFromWebsite,
  formatChange,
  formatMs,
  formatUptime,
  formatUsagePercent,
  initialsOf,
  jobLabel,
  providerLabel,
} from "../src/lib/admin/format.ts";

/* ------------------------------------------------------------------ shell */

describe("admin shell navigation", () => {
  // V4 section 46 adds Usage & Margins. The list is still asserted exactly:
  // the rule this test protects is that the rail only ever links to routes that
  // exist, so a destination appears here the moment its page ships and not
  // before.
  test("exposes exactly the destinations that have routes", () => {
    assert.deepEqual(
      ADMIN_NAV.map((item) => item.href),
      ["/admin", "/admin/customers", "/admin/economics", "/admin/system"],
    );
    assert.deepEqual(
      ADMIN_NAV.map((item) => item.label),
      ["Overview", "Customers", "Usage & Margins", "System"],
    );
  });

  test("no removed admin domain is linked", () => {
    const forbidden = [
      "/admin/providers",
      "/admin/webhooks",
      "/admin/errors",
      "/admin/jobs",
      "/admin/integrations",
      "/admin/analytics",
      "/admin/support",
      "/admin/billing",
      "/admin/settings",
      "/admin/usage",
    ];
    for (const href of ADMIN_NAV.map((item) => item.href)) {
      assert.ok(!forbidden.includes(href), `${href} should not be in the shell`);
    }
  });

  test("Overview is only active on the index route", () => {
    assert.equal(isActiveAdminRoute("/admin", "/admin"), true);
    assert.equal(isActiveAdminRoute("/admin/customers", "/admin"), false);
    assert.equal(isActiveAdminRoute("/admin/system", "/admin/system"), true);
  });

  test("the mobile title follows the route", () => {
    assert.equal(titleForAdminPath("/admin"), "Overview");
    assert.equal(titleForAdminPath("/admin/customers"), "Customers");
    assert.equal(titleForAdminPath("/admin/system"), "System");
  });
});

/* ------------------------------------------------------------ event model */

describe("operational event status model", () => {
  test("every status has a label and a tone", () => {
    for (const status of EVENT_STATUSES) {
      assert.ok(EVENT_STATUS_LABEL[status], `${status} has no label`);
      assert.ok(EVENT_STATUS_TONE[status], `${status} has no tone`);
    }
  });

  test("webhook statuses normalise into the shared enum", () => {
    assert.equal(webhookEventStatus("received"), "RECEIVED");
    assert.equal(webhookEventStatus("processing"), "PROCESSING");
    assert.equal(webhookEventStatus("processed"), "PROCESSED");
    assert.equal(webhookEventStatus("failed"), "FAILED");
    assert.equal(webhookEventStatus("ignored"), "IGNORED");
    assert.equal(webhookEventStatus("something-new"), "RECEIVED");
  });

  test("a failed job with retries left reads as retrying, not failed", () => {
    assert.equal(jobEventStatus("failed", 2, 5), "RETRYING");
    assert.equal(jobEventStatus("failed", 5, 5), "FAILED");
    assert.equal(jobEventStatus("dead", 5, 5), "DEAD_LETTERED");
    assert.equal(jobEventStatus("pending", 0, 5), "RECEIVED");
    assert.equal(jobEventStatus("pending", 1, 5), "RETRYING");
    assert.equal(jobEventStatus("running", 1, 5), "PROCESSING");
    assert.equal(jobEventStatus("completed", 1, 5), "PROCESSED");
  });

  test("message statuses normalise", () => {
    assert.equal(messageEventStatus("FAILED"), "FAILED");
    assert.equal(messageEventStatus("QUEUED"), "RECEIVED");
    assert.equal(messageEventStatus("SENT"), "PROCESSING");
    assert.equal(messageEventStatus("DELIVERED"), "PROCESSED");
  });
});

describe("safe retry rules", () => {
  test("only a failed webhook is replayable", () => {
    assert.equal(
      isRetryable({ source: "webhook", status: "FAILED", attempts: 1 }),
      true,
    );
    for (const status of ["PROCESSED", "PROCESSING", "RECEIVED", "IGNORED"] as const) {
      assert.equal(
        isRetryable({ source: "webhook", status, attempts: 1 }),
        false,
        `${status} must not be replayable`,
      );
    }
  });

  test("a failed or dead-lettered job is replayable", () => {
    assert.equal(isRetryable({ source: "job", status: "FAILED", attempts: 3 }), true);
    assert.equal(
      isRetryable({ source: "job", status: "DEAD_LETTERED", attempts: 3 }),
      true,
    );
    assert.equal(
      isRetryable({ source: "job", status: "RETRYING", attempts: 1 }),
      false,
    );
  });

  test("a message is never replayable from the admin console", () => {
    for (const status of EVENT_STATUSES) {
      assert.equal(
        isRetryable({ source: "message", status, attempts: 1 }),
        false,
        `messages must never be replayable (${status})`,
      );
    }
  });

  test("the operator attempt ceiling is enforced", () => {
    assert.equal(
      isRetryable({
        source: "webhook",
        status: "FAILED",
        attempts: MAX_SAFE_RETRIES - 1,
      }),
      true,
    );
    assert.equal(
      isRetryable({
        source: "webhook",
        status: "FAILED",
        attempts: MAX_SAFE_RETRIES,
      }),
      false,
    );
    assert.equal(
      isRetryable({
        source: "job",
        status: "DEAD_LETTERED",
        attempts: MAX_SAFE_RETRIES + 4,
      }),
      false,
    );
  });

  test("a blocked retry always explains itself, and a permitted one never does", () => {
    assert.equal(
      retryBlockedReason({ source: "webhook", status: "FAILED", attempts: 1 }),
      null,
    );
    for (const input of [
      { source: "message", status: "FAILED", attempts: 1 },
      { source: "webhook", status: "PROCESSED", attempts: 1 },
      { source: "job", status: "RETRYING", attempts: 1 },
      { source: "webhook", status: "FAILED", attempts: MAX_SAFE_RETRIES },
    ] as const) {
      const reason = retryBlockedReason(input);
      assert.ok(reason && reason.length > 20, `no explanation for ${JSON.stringify(input)}`);
    }
  });
});

describe("event identifiers", () => {
  const uuid = "3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0aa";

  test("round-trips a well-formed id", () => {
    assert.deepEqual(parseEventId(formatEventId("webhook", uuid)), {
      source: "webhook",
      rowId: uuid,
    });
    assert.deepEqual(parseEventId(`job:${uuid}`), { source: "job", rowId: uuid });
  });

  test("rejects anything that is not a known source and a uuid", () => {
    for (const bad of [
      "",
      uuid,
      `lead:${uuid}`,
      "webhook:not-a-uuid",
      "webhook:",
      `webhook:${uuid}' or 1=1--`,
      `webhook:${uuid.slice(0, 20)}`,
      "../../etc/passwd",
    ]) {
      assert.equal(parseEventId(bad), null, `${bad} must be rejected`);
    }
  });
});

/* ------------------------------------------------------------ error model */

describe("platform error grouping", () => {
  test("every severity and status has a label", () => {
    for (const severity of ERROR_SEVERITIES) {
      assert.ok(ERROR_SEVERITY_LABEL[severity]);
      assert.ok(ERROR_SEVERITY_TONE[severity]);
    }
    for (const status of ERROR_STATUSES) {
      assert.ok(ERROR_STATUS_LABEL[status]);
    }
  });

  test("varying details are normalised away so the same fault groups", () => {
    const a = normaliseMessage(
      "Delivery failed for lead 3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0aa after 3 attempts",
    );
    const b = normaliseMessage(
      "Delivery failed for lead 91b0f9a1-4a53-4c31-9a1a-3f7c1c62d0aa after 7 attempts",
    );
    assert.equal(a, b);
  });

  test("the fingerprint is stable, and separates workspaces", () => {
    const one = fingerprintFor("Billing", "Invoice payment failed", "ws-1");
    const same = fingerprintFor("Billing", "Invoice payment failed", "ws-1");
    const otherWorkspace = fingerprintFor("Billing", "Invoice payment failed", "ws-2");
    const otherArea = fingerprintFor("Jobs", "Invoice payment failed", "ws-1");

    assert.equal(one, same);
    assert.notEqual(one, otherWorkspace);
    assert.notEqual(one, otherArea);
    assert.match(one, /^[0-9a-f]{8}$/);
  });

  test("the reference is derived from the area and the fingerprint", () => {
    const fingerprint = fingerprintFor("Jobs", "Retry worker gave up", null);
    const reference = referenceFor("Jobs", fingerprint);
    assert.match(reference, /^JOB-\d{5}$/);
    assert.equal(reference, referenceFor("Jobs", fingerprint));
    assert.match(referenceFor("Database", fingerprint), /^DB-\d{5}$/);
    assert.match(referenceFor("Messaging / SMS", fingerprint), /^SMS-\d{5}$/);
  });

  test("job types and providers map to normalised areas", () => {
    assert.equal(areaForJobType("message.send"), "Messaging / SMS");
    assert.equal(areaForJobType("booking.sync"), "Calendly");
    assert.equal(areaForJobType("retention.cleanup"), "Database");
    assert.equal(areaForJobType("something.unmapped"), "Jobs");
    assert.equal(areaForProvider("stripe"), "Billing");
    assert.equal(areaForProvider("twilio_whatsapp"), "WhatsApp");
    assert.equal(areaForProvider("unknown_provider"), "Webhook");
  });

  test("severity follows the area and escalates on the failure text", () => {
    assert.equal(severityForArea("Webhook"), "LOW");
    assert.equal(severityForArea("Database"), "CRITICAL");
    // A deadlock is critical wherever it happens.
    assert.equal(
      severityForArea("Webhook", "Deadlock detected during lead import"),
      "CRITICAL",
    );
    // Exhausted retries raise a level rather than inventing one.
    assert.equal(severityForArea("Webhook", "Retry worker exceeded max attempts"), "MEDIUM");
    assert.equal(severityForArea("Jobs", "Retry worker exceeded max attempts"), "HIGH");
  });
});

/* ------------------------------------------------------------- vocabulary */

describe("admin vocabulary is complete", () => {
  test("every range, filter and status has copy", () => {
    for (const range of ADMIN_RANGES) {
      assert.ok(ADMIN_RANGE_LABEL[range]);
      assert.ok(ADMIN_RANGE_COMPARISON[range]);
    }
    for (const filter of CUSTOMER_FILTERS) {
      assert.ok(CUSTOMER_FILTER_LABEL[filter]);
    }
    for (const filter of EVENT_TYPE_FILTERS) {
      assert.ok(EVENT_TYPE_FILTER_LABEL[filter]);
    }
    for (const kind of Object.keys(ACTION_REQUIRED_LABEL)) {
      assert.ok(ACTION_REQUIRED_LABEL[kind as keyof typeof ACTION_REQUIRED_LABEL]);
    }
  });

  test("health vocabularies pair a label with a tone", () => {
    for (const key of Object.keys(CONNECTION_HEALTH_LABEL)) {
      const health = key as keyof typeof CONNECTION_HEALTH_LABEL;
      assert.ok(CONNECTION_HEALTH_LABEL[health]);
      assert.ok(CONNECTION_HEALTH_TONE[health]);
    }
    for (const key of Object.keys(PROVIDER_STATUS_LABEL)) {
      const status = key as keyof typeof PROVIDER_STATUS_LABEL;
      assert.ok(PROVIDER_STATUS_LABEL[status]);
      assert.ok(PROVIDER_STATUS_TONE[status]);
    }
    for (const key of Object.keys(QUEUE_STATUS_LABEL)) {
      const status = key as keyof typeof QUEUE_STATUS_LABEL;
      assert.ok(QUEUE_STATUS_LABEL[status]);
      assert.ok(QUEUE_STATUS_TONE[status]);
    }
  });
});

/* --------------------------------------------------------------- format */

describe("admin formatting", () => {
  test("an absent measurement renders as a dash rather than a zero", () => {
    assert.equal(formatMs(null), "—");
    assert.equal(formatUptime(null), "—");
    assert.equal(formatUsagePercent(null), "—");
    assert.equal(formatChange(null), "—");
  });

  test("real measurements are formatted for an operator", () => {
    assert.equal(formatMs(1240), "1,240 ms");
    assert.equal(formatUptime(0.9912), "99.12%");
    assert.equal(formatUsagePercent(0.37), "37%");
    assert.equal(formatChange(0.12), "+12%");
    assert.equal(formatChange(-0.65), "-65%");
    assert.equal(formatChange(0), "0%");
  });

  test("a domain is only shown when the workspace supplied one", () => {
    assert.equal(domainFromWebsite("https://www.riversideroofing.com/x"), "riversideroofing.com");
    assert.equal(domainFromWebsite("pinnaclebuilders.com"), "pinnaclebuilders.com");
    assert.equal(domainFromWebsite(null), null);
    assert.equal(domainFromWebsite("   "), null);
  });

  test("provider and job labels are human", () => {
    assert.equal(providerLabel("twilio_whatsapp"), "WhatsApp");
    assert.equal(providerLabel("google_calendar"), "Google Calendar");
    assert.equal(providerLabel("brand_new_provider"), "Brand new provider");
    assert.equal(jobLabel("lead_source.poll"), "Sync leads");
    assert.equal(jobLabel("some.new_job"), "Some new job");
  });

  test("initials fall back sensibly", () => {
    assert.equal(initialsOf("Emily Wilson"), "EW");
    assert.equal(initialsOf("Cher"), "CH");
    assert.equal(initialsOf("   "), "?");
  });
});

/* -------------------------------------------------------- provider marks */

describe("admin provider marks", () => {
  test("every aliased provider resolves to a brand mark on disk", () => {
    for (const [alias, provider] of Object.entries(ADMIN_PROVIDER_ALIAS)) {
      const src = brandMarkSrc(provider);
      assert.ok(src, `${alias} -> ${provider} has no brand mark`);
      const file = path.join(
        process.cwd(),
        "public",
        src.replace(/^\//, ""),
      );
      assert.ok(
        existsSync(file),
        `${alias} -> ${provider} points at a missing file: ${src}`,
      );
    }
  });

  test("marks are served locally, never from a third-party host", () => {
    for (const provider of Object.values(ADMIN_PROVIDER_ALIAS)) {
      assert.match(brandMarkSrc(provider) ?? "", /^\/brands\//);
    }
  });

  test("platform-internal sources are not treated as connectable providers", () => {
    for (const source of INTERNAL_EVENT_SOURCES) {
      assert.ok(isInternalEventSource(source));
      // A platform source must never claim a customer integration's mark.
      assert.equal(ADMIN_PROVIDER_ALIAS[source], undefined);
    }
    assert.equal(isInternalEventSource("meta"), false);
  });
});

/* ---------------------------------------------------- provider credentials */

describe("provider credential shapes", () => {
  test("an Account SID is accepted", () => {
    assert.equal(
      twilioAccountSidProblem("AC" + "0".repeat(32)),
      null,
    );
  });

  test("an API Key SID is named as the misconfiguration it is", () => {
    const problem = twilioAccountSidProblem("SK" + "0".repeat(32));
    assert.ok(problem, "an SK SID must be reported");
    assert.match(problem, /API Key SID/);
    assert.match(problem, /TWILIO_ACCOUNT_SID/);
  });

  test("an unrecognised SID shape is reported rather than sent to Twilio", () => {
    assert.ok(twilioAccountSidProblem("not-a-sid"));
  });

  test("an absent SID is not a shape problem — it is simply unconfigured", () => {
    assert.equal(twilioAccountSidProblem(undefined), null);
    assert.equal(twilioAccountSidProblem(""), null);
  });

  test("TikTok resolves either spelling, preferring the provider's own", () => {
    assert.deepEqual(
      resolveTikTokCredentials({
        TIKTOK_CLIENT_KEY: "ck",
        TIKTOK_CLIENT_SECRET: "cs",
      }),
      { clientKey: "ck", clientSecret: "cs" },
    );
    assert.deepEqual(
      resolveTikTokCredentials({
        TIKTOK_APP_ID: "legacy-id",
        TIKTOK_APP_SECRET: "legacy-secret",
      }),
      { clientKey: "legacy-id", clientSecret: "legacy-secret" },
    );
    // TikTok's own naming wins when a deployment carries both.
    assert.deepEqual(
      resolveTikTokCredentials({
        TIKTOK_CLIENT_KEY: "ck",
        TIKTOK_CLIENT_SECRET: "cs",
        TIKTOK_APP_ID: "legacy-id",
        TIKTOK_APP_SECRET: "legacy-secret",
      }),
      { clientKey: "ck", clientSecret: "cs" },
    );
    assert.deepEqual(resolveTikTokCredentials({}), {
      clientKey: undefined,
      clientSecret: undefined,
    });
  });
});

/* ------------------------------------------------- catalogue configurability */

describe("platform configurability", () => {
  test("an alternation entry is satisfied by either name", () => {
    const tiktok = PROVIDERS.find((row) => row.id === "tiktok_ads");
    assert.ok(tiktok);
    assert.ok(
      tiktok.requiredEnv.some((key) => key.includes("|")),
      "TikTok should accept either spelling",
    );
    for (const key of tiktok.requiredEnv) {
      // Every alternative must be a plausible env var name, not a stray value.
      for (const name of key.split("|")) {
        assert.match(name, /^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  test("every provider names at least one environment variable or none at all", () => {
    for (const provider of PROVIDERS) {
      for (const key of provider.requiredEnv) {
        assert.ok(key.length > 0, `${provider.id} has an empty requiredEnv entry`);
        for (const name of key.split("|")) {
          assert.match(
            name,
            /^[A-Z][A-Z0-9_]*$/,
            `${provider.id} lists a malformed env name: ${name}`,
          );
        }
      }
    }
  });
});
