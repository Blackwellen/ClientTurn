import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MERGE_FIELD_DEFINITIONS,
  fieldsForSurface,
  mergeField,
  renderPreview,
  renderTemplate,
  tokensIn,
  unknownTokens,
} from "../src/lib/messaging/merge-fields.ts";
import {
  estimateUsage,
  fallbackPreview,
  resolveFallback,
  summariseWarmChannels,
} from "../src/lib/follow-up/channel-policy.ts";
import {
  DEFAULT_STEP_DELAYS_DAYS,
  MERGE_FIELDS as COLD_MERGE_FIELDS,
  unknownMergeFields,
} from "../src/lib/outreach/campaign-draft.ts";
import {
  DEFAULT_ALLOCATION,
  MAX_OVERAGE_CAP_MINOR,
  allocationTotal,
  effectiveDailyCap,
  estimateSends,
  rebalance,
  validateAllocation,
  validateOverage,
} from "../src/lib/billing/usage-allocation.ts";
import {
  canOverwrite,
  isCurrentlyValid,
  isStale,
  precedenceOf,
} from "../src/lib/business-profile/precedence.ts";
import {
  COPILOT_TOOLS,
  copilotTool,
  roleAllows,
} from "../src/lib/copilot/types.ts";
import { attachmentError, supportContextSchema } from "../src/lib/support/types.ts";
import { validateSequence } from "../src/lib/follow-up/types.ts";

/* ============================================================ §19 merge fields */

describe("merge field registry", () => {
  test("the canonical registry carries every field the spec names", () => {
    for (const key of [
      "first_name",
      "business_name",
      "service_name",
      "booking_link",
      "business_phone",
      "company_name",
      "conversion_link",
    ]) {
      assert.ok(mergeField(key), `${key} should be in the registry`);
    }
  });

  test("fields are surface-scoped, so cold-only tokens are not offered to warm", () => {
    const warm = fieldsForSurface("follow-up").map((f) => f.key);
    assert.ok(!warm.includes("company_name"));
    assert.ok(!warm.includes("conversion_link"));

    const cold = fieldsForSurface("cold-outreach").map((f) => f.key);
    assert.ok(cold.includes("company_name"));
    assert.ok(cold.includes("conversion_link"));
  });

  test("a token valid on another surface is still unknown here", () => {
    assert.deepEqual(unknownTokens("Hi {{company_name}}", "follow-up"), [
      "company_name",
    ]);
    assert.deepEqual(unknownTokens("Hi {{company_name}}", "cold-outreach"), []);
  });

  test("tokens are matched case-insensitively and de-duplicated", () => {
    assert.deepEqual(
      tokensIn("{{First_Name}} and {{ first_name }}").sort(),
      ["first_name"],
    );
  });

  test("a field with a fallback resolves; one without reports missing", () => {
    const withFallback = renderTemplate("Hi {{first_name}}", {}, "follow-up");
    assert.equal(withFallback.ok, true);
    assert.equal(withFallback.ok && withFallback.text, "Hi there");

    const withoutFallback = renderTemplate(
      "Book here: {{booking_link}}",
      {},
      "follow-up",
    );
    assert.equal(withoutFallback.ok, false);
    assert.deepEqual(
      withoutFallback.ok ? [] : withoutFallback.missing,
      ["booking_link"],
    );
  });

  test("a broken placeholder never renders as a literal token on the send path", () => {
    const result = renderTemplate("{{booking_link}}", {}, "follow-up");
    assert.equal(result.ok, false, "must refuse rather than emit {{booking_link}}");
  });

  test("preview deliberately keeps unresolvable tokens visible", () => {
    const preview = renderPreview("Book: {{booking_link}}", {}, "follow-up");
    assert.match(preview, /\{\{booking_link\}\}/);
  });

  test("cold outreach derives its field list from the same registry", () => {
    assert.deepEqual(
      [...COLD_MERGE_FIELDS].sort(),
      fieldsForSurface("cold-outreach")
        .map((f) => f.key)
        .sort(),
    );
    assert.deepEqual(unknownMergeFields("{{nonsense}}"), ["nonsense"]);
  });

  test("every declared field belongs to at least one surface", () => {
    for (const field of MERGE_FIELD_DEFINITIONS) {
      assert.ok(field.surfaces.length > 0, `${field.key} has no surface`);
    }
  });
});

/* ========================================================= §19 channel policy */

const ALL_AVAILABLE = { email: true, sms: true, whatsapp: true };

describe("warm channel policy", () => {
  const base = {
    senderAvailable: true,
    senderIssue: null,
    policyAllows: { email: true, sms: true, whatsapp: true },
    smsConnected: true,
    whatsappEnabled: true,
    whatsappTemplateReady: true,
  };

  test("all four rows are reported, and social is always manual", () => {
    const rows = summariseWarmChannels(base);
    assert.equal(rows.length, 4);
    const social = rows.find((row) => row.channel === "social");
    assert.equal(social?.available, false);
    assert.match(social?.verdict ?? "", /manual/i);
  });

  test("email is unavailable without a sender, and says why", () => {
    const rows = summariseWarmChannels({
      ...base,
      senderAvailable: false,
      senderIssue: "No sending identity yet.",
    });
    const email = rows.find((row) => row.channel === "email");
    assert.equal(email?.available, false);
    assert.equal(email?.warning, "No sending identity yet.");
  });

  test("WhatsApp without an approved template is not offered", () => {
    const rows = summariseWarmChannels({ ...base, whatsappTemplateReady: false });
    assert.equal(
      rows.find((row) => row.channel === "whatsapp")?.available,
      false,
    );
  });

  test("a policy that forbids SMS overrides a connected provider", () => {
    const rows = summariseWarmChannels({
      ...base,
      policyAllows: { ...base.policyAllows, sms: false },
    });
    assert.equal(rows.find((row) => row.channel === "sms")?.available, false);
  });
});

describe("channel fallback", () => {
  test("an available channel needs no fallback", () => {
    assert.equal(resolveFallback("email", ALL_AVAILABLE, { fallbackEnabled: true }), null);
  });

  test("fallback off always raises an attention item, never a substitution", () => {
    const outcome = resolveFallback(
      "email",
      { email: false, sms: true, whatsapp: true },
      { fallbackEnabled: false },
    );
    assert.equal(outcome?.kind, "ATTENTION");
  });

  test("the chain is fixed: email falls back to SMS, never to WhatsApp", () => {
    const outcome = resolveFallback(
      "email",
      { email: false, sms: false, whatsapp: true },
      { fallbackEnabled: true },
    );
    assert.equal(outcome?.kind, "ATTENTION", "WhatsApp is not an email fallback");
  });

  test("SMS and WhatsApp both fall back to email", () => {
    for (const channel of ["sms", "whatsapp"] as const) {
      const outcome = resolveFallback(
        channel,
        { email: true, sms: false, whatsapp: false },
        { fallbackEnabled: true },
      );
      assert.equal(outcome?.kind, "FALLBACK");
      assert.equal(outcome?.kind === "FALLBACK" && outcome.to, "email");
    }
  });

  test("the same input always produces the same answer", () => {
    const available = { email: false, sms: true, whatsapp: true };
    const first = resolveFallback("email", available, { fallbackEnabled: true });
    const second = resolveFallback("email", available, { fallbackEnabled: true });
    assert.deepEqual(first, second);
  });

  test("the preview lists one line per distinct channel", () => {
    const lines = fallbackPreview(
      ["email", "email", "sms"],
      ALL_AVAILABLE,
      { fallbackEnabled: true },
    );
    assert.equal(lines.length, 2);
  });
});

describe("usage estimate", () => {
  test("disabled steps cost nothing", () => {
    const usage = estimateUsage([
      { channel: "email", enabled: true },
      { channel: "email", enabled: false },
    ]);
    assert.equal(usage.totalCredits, 1);
  });

  test("credits are totalled across channels", () => {
    const usage = estimateUsage([
      { channel: "email", enabled: true },
      { channel: "email", enabled: true },
      { channel: "sms", enabled: true },
      { channel: "whatsapp", enabled: true },
    ]);
    assert.equal(usage.totalCredits, 4);
    assert.equal(
      usage.perChannel.find((row) => row.channel === "email")?.messages,
      2,
    );
  });
});

/* ======================================================= §19 sequence validation */

describe("follow-up sequence validation", () => {
  const okStep = {
    key: "a",
    delaySeconds: 0,
    channel: "email",
    subject: "Thanks for your interest",
    template: "Hi {{first_name}}",
    enabled: true,
  };

  const options = {
    unknownTokensFor: (t: string) => unknownTokens(t, "follow-up"),
    whatsappEnabled: true,
  };

  test("a well-formed email step passes", () => {
    assert.deepEqual(validateSequence([okStep], options), []);
  });

  test("an email step with no subject is refused", () => {
    const issues = validateSequence([{ ...okStep, subject: "" }], options);
    assert.ok(issues.some((issue) => /subject/i.test(issue.message)));
  });

  test("an unresolvable token in the subject blocks publishing", () => {
    const issues = validateSequence(
      [{ ...okStep, subject: "Hi {{nonsense}}" }],
      options,
    );
    assert.ok(issues.some((issue) => /nonsense/.test(issue.message)));
  });

  test("a channel the workspace cannot use is a blocking issue", () => {
    const issues = validateSequence([okStep], {
      ...options,
      available: { email: false, sms: true, whatsapp: true },
    });
    assert.ok(issues.some((issue) => /not available/i.test(issue.message)));
  });

  test("WhatsApp off-plan is refused", () => {
    const issues = validateSequence(
      [{ ...okStep, channel: "whatsapp", subject: null }],
      { ...options, whatsappEnabled: false },
    );
    assert.ok(issues.some((issue) => /WhatsApp/.test(issue.message)));
  });

  test("a sequence with every step off would send nothing", () => {
    const issues = validateSequence([{ ...okStep, enabled: false }], options);
    assert.ok(issues.some((issue) => issue.key === "none-enabled"));
  });
});

/* ============================================================ §20 cold sequence */

describe("cold sequence defaults", () => {
  test("the default cadence is Day 0, 3, 7 and 14", () => {
    assert.deepEqual(DEFAULT_STEP_DELAYS_DAYS, [0, 3, 7, 14]);
  });
});

/* =========================================================== §27 usage allocation */

describe("communication allocation", () => {
  test("the default allocation totals 100%", () => {
    assert.equal(allocationTotal(DEFAULT_ALLOCATION), 100);
    assert.deepEqual(validateAllocation(DEFAULT_ALLOCATION), []);
  });

  test("an allocation that does not total 100 is rejected, not normalised", () => {
    const issues = validateAllocation({ email: 50, sms: 25, whatsapp: 15 });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /100%/);
  });

  test("rebalancing keeps the total at exactly 100 for every slider position", () => {
    let allocation = DEFAULT_ALLOCATION;
    for (let value = 0; value <= 100; value += 5) {
      allocation = rebalance(allocation, "email", value);
      assert.equal(
        allocationTotal(allocation),
        100,
        `total drifted at email=${value}`,
      );
      assert.equal(allocation.email, value);
    }
  });

  test("rebalancing from an all-zero remainder still lands on 100", () => {
    const result = rebalance({ email: 100, sms: 0, whatsapp: 0 }, "email", 40);
    assert.equal(allocationTotal(result), 100);
  });

  test("estimated sends reflect that SMS and WhatsApp consume more allowance", () => {
    const estimates = estimateSends({ email: 100, sms: 0, whatsapp: 0 }, 1000);
    const email = estimates.find((row) => row.channel === "email");
    assert.equal(email?.estimatedSends, 1000);

    const smsOnly = estimateSends({ email: 0, sms: 100, whatsapp: 0 }, 1000);
    const sms = smsOnly.find((row) => row.channel === "sms");
    assert.ok((sms?.estimatedSends ?? 0) < 1000);
  });
});

describe("daily caps", () => {
  test("a customer may lower a cap", () => {
    assert.equal(
      effectiveDailyCap({ channel: "email", requested: 100, planCap: 500 }),
      100,
    );
  });

  test("a request above the plan cap is clamped, not honoured", () => {
    assert.equal(
      effectiveDailyCap({ channel: "email", requested: 99999, planCap: 500 }),
      500,
    );
  });

  test("email is additionally bounded by what the mailboxes can carry", () => {
    assert.equal(
      effectiveDailyCap({
        channel: "email",
        requested: 500,
        planCap: 500,
        senderCapacity: 300,
      }),
      300,
    );
  });

  test("the platform ceiling binds even a generous plan", () => {
    assert.equal(
      effectiveDailyCap({ channel: "sms", requested: 50000, planCap: 50000 }),
      1000,
    );
  });
});

describe("overage", () => {
  test("overage off needs no cap and raises no issue", () => {
    assert.deepEqual(
      validateOverage({ enabled: false, capMinor: 0, accountMaxMinor: 50000 }),
      [],
    );
  });

  test("enabling overage with no cap is a contradiction and is refused", () => {
    const issues = validateOverage({
      enabled: true,
      capMinor: 0,
      accountMaxMinor: 50000,
    });
    assert.equal(issues.length, 1);
  });

  test("a cap above the account maximum is refused", () => {
    const issues = validateOverage({
      enabled: true,
      capMinor: 90000,
      accountMaxMinor: 50000,
    });
    assert.ok(issues.some((issue) => /maximum/i.test(issue.message)));
  });

  test("nothing may exceed the platform overage ceiling", () => {
    const issues = validateOverage({
      enabled: true,
      capMinor: MAX_OVERAGE_CAP_MINOR + 1,
      accountMaxMinor: Number.MAX_SAFE_INTEGER,
    });
    assert.ok(issues.length > 0);
  });
});

/* ======================================================== §26 fact precedence */

describe("business fact precedence", () => {
  const inference = {
    sourceType: "AI" as const,
    verifiedByUser: false,
    locked: false,
    confidence: 0.9,
  };
  const lockedUser = {
    sourceType: "USER" as const,
    verifiedByUser: true,
    locked: true,
    confidence: 1,
  };

  test("a locked user fact outranks everything", () => {
    assert.equal(precedenceOf(lockedUser).key, "LOCKED_USER");
    assert.ok(precedenceOf(lockedUser).rank > precedenceOf(inference).rank);
  });

  test("inference can never overwrite a locked fact, however confident", () => {
    const verdict = canOverwrite(lockedUser, { ...inference, confidence: 1 });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason, /locked/i);
  });

  test("a person may still change their own locked fact", () => {
    // This is the real shape `saveFact` produces for a typed edit: USER,
    // verified and locked. The lock must not lock the customer out.
    const verdict = canOverwrite(lockedUser, {
      sourceType: "USER",
      verifiedByUser: true,
      locked: true,
      confidence: 1,
    });
    assert.equal(verdict.allowed, true);
  });

  test("no non-person source can touch a locked fact", () => {
    for (const source of ["WEBSITE", "INTEGRATION", "PERFORMANCE", "AI"] as const) {
      const verdict = canOverwrite(lockedUser, {
        sourceType: source,
        verifiedByUser: true,
        locked: false,
        confidence: 1,
      });
      assert.equal(verdict.allowed, false, `${source} must not overwrite a lock`);
    }
  });

  test("a higher-precedence source wins", () => {
    const verdict = canOverwrite(inference, {
      sourceType: "WEBSITE",
      verifiedByUser: true,
      locked: false,
      confidence: 0.5,
    });
    assert.equal(verdict.allowed, true);
  });

  test("an equally-sourced value does not churn the record", () => {
    const verdict = canOverwrite(inference, { ...inference, confidence: 0.91 });
    assert.equal(verdict.allowed, false);
  });

  test("a materially more confident value from the same source does win", () => {
    const verdict = canOverwrite(
      { ...inference, confidence: 0.5 },
      { ...inference, confidence: 0.9 },
    );
    assert.equal(verdict.allowed, true);
  });

  test("a never-verified fact is stale; a locked one is not", () => {
    assert.equal(isStale({ ...inference, lastVerifiedAt: null }), true);
    assert.equal(isStale(lockedUser), false);
  });

  test("temporal validity expires a fact without anyone deleting it", () => {
    const past = new Date(Date.now() - 864e5).toISOString();
    assert.equal(isCurrentlyValid({ ...inference, validTo: past }), false);

    const future = new Date(Date.now() + 864e5).toISOString();
    assert.equal(isCurrentlyValid({ ...inference, validFrom: future }), false);
    assert.equal(isCurrentlyValid({ ...inference, validTo: future }), true);
  });
});

/* ============================================================== §28 copilot */

describe("copilot tool surface", () => {
  test("there is no SQL, HTTP or arbitrary-execution tool", () => {
    for (const tool of COPILOT_TOOLS) {
      assert.ok(
        !/sql|query|http|fetch|exec|eval/i.test(tool.name),
        `${tool.name} looks like an escape hatch`,
      );
    }
  });

  test("nothing can send outreach, enable overage or suppress a contact", () => {
    const forbidden = /send|overage|suppress|delete|budget/i;
    for (const tool of COPILOT_TOOLS) {
      assert.ok(!forbidden.test(tool.name), `${tool.name} is out of scope`);
    }
  });

  test("every high-impact write explains its effect before it runs", () => {
    for (const tool of COPILOT_TOOLS) {
      if (tool.requiresConfirmation) {
        assert.ok(tool.effect && tool.effect.length > 20, `${tool.name} has no effect text`);
      }
    }
  });

  test("campaign state changes and fact edits always need confirmation", () => {
    for (const name of [
      "pauseCampaign",
      "resumeCampaign",
      "updateBusinessFact",
      "startSourcingRun",
    ]) {
      assert.equal(
        copilotTool(name)?.requiresConfirmation,
        true,
        `${name} must ask first`,
      );
    }
  });

  test("no read tool requires confirmation", () => {
    for (const tool of COPILOT_TOOLS) {
      if (tool.kind === "READ") assert.equal(tool.requiresConfirmation, false);
    }
  });

  test("roles are inherited, never widened", () => {
    assert.equal(roleAllows("viewer", "admin"), false);
    assert.equal(roleAllows("member", "admin"), false);
    assert.equal(roleAllows("admin", "admin"), true);
    assert.equal(roleAllows("owner", "admin"), true);
    assert.equal(roleAllows("viewer", "viewer"), true);
  });

  test("a viewer cannot reach any write tool that changes a campaign", () => {
    const campaignWrites = COPILOT_TOOLS.filter(
      (tool) => tool.kind === "WRITE" && tool.name.includes("Campaign"),
    );
    assert.ok(campaignWrites.length > 0);
    for (const tool of campaignWrites) {
      assert.equal(roleAllows("viewer", tool.scope), false);
    }
  });
});

/* ============================================================== §23 support */

describe("support attachments and context", () => {
  test("an oversized file is refused", () => {
    assert.match(
      attachmentError({ name: "a.png", type: "image/png", size: 20 * 1024 * 1024 }) ?? "",
      /10MB/,
    );
  });

  test("an executable is refused whatever it claims to be", () => {
    assert.ok(
      attachmentError({ name: "payload.exe", type: "image/png", size: 1000 }),
    );
  });

  test("the allowed types are accepted", () => {
    for (const name of ["shot.png", "log.log", "export.csv", "report.pdf"]) {
      assert.equal(
        attachmentError({ name, type: "application/octet-stream", size: 1000 }),
        null,
        `${name} should be allowed`,
      );
    }
  });

  test("diagnostic context is an allow-list: extra keys are rejected", () => {
    const result = supportContextSchema.safeParse({
      route: "/app/leads",
      authToken: "secret",
    });
    assert.equal(result.success, false, "an unknown key must not be stored");
  });

  test("the permitted context keys parse cleanly", () => {
    const result = supportContextSchema.safeParse({
      route: "/app/leads",
      appVersion: "1.0.0",
      userAgent: "Mozilla/5.0",
      viewport: "1440x900",
      timezone: "Europe/London",
      correlationId: "abc123",
    });
    assert.equal(result.success, true);
  });
});
