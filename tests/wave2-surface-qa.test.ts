/**
 * Regression tests for the wave 2 surface QA of 2026-09-30 (Find Leads,
 * Follow-Up, Reactivation, Agents).
 *
 * Pure helpers are exercised directly. Where the defect was in a server-only
 * module (a server action, a query), the fix is asserted on the source, the
 * same way tests/find-leads-engagement-repairs.test.ts does: those modules
 * import `server-only` and cannot load under plain `node --test`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describeUnknownTokens, unknownTokens } from "../src/lib/messaging/merge-fields.ts";
import { validateSequence } from "../src/lib/follow-up/types.ts";
import { summariseWarmChannels } from "../src/lib/follow-up/channel-policy.ts";
import {
  autonomyDescription,
  autonomyOptionsFor,
  queueStatusLabel,
  queueSubjectHref,
  queueTypeLabel,
  readinessProblems,
} from "../src/lib/agents/types.ts";
import { audienceFilterSchema, DEFAULT_AUDIENCE_FILTER } from "../src/lib/campaigns/types.ts";
import { runStatusTone } from "../src/lib/find-leads/types.ts";
import { CATEGORY_TEMPLATES } from "../src/lib/intent/types.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("merge-field errors name the fix", () => {
  test("a single-brace real field is told to use double braces, not shown as {{{x}}}", () => {
    const unknown = unknownTokens("Hi {first_name}", "follow-up");
    assert.deepEqual(unknown, ["{first_name}"]);
    const message = describeUnknownTokens(unknown);
    assert.match(message, /double braces: \{first_name\} → \{\{first_name\}\}/);
    assert.doesNotMatch(message, /\{\{\{/);
  });

  test("a single-brace made-up field is reported unknown, with no fake suggestion", () => {
    const message = describeUnknownTokens(["{nickname}"]);
    assert.equal(message, "Unknown merge field: {nickname}");
  });

  test("a double-brace unknown field is shown as written", () => {
    assert.equal(describeUnknownTokens(["nickname"]), "Unknown merge field: {{nickname}}");
  });

  test("the sequence validator uses the same wording", () => {
    const issues = validateSequence(
      [{ key: "a", delaySeconds: 0, template: "Hi {first_name}", enabled: true, channel: "sms" }],
      { unknownTokensFor: (t) => unknownTokens(t, "follow-up"), whatsappEnabled: true },
    );
    assert.ok(issues.some((i) => /double braces/.test(i.message)));
    assert.ok(!issues.some((i) => /\{\{\{/.test(i.message)));
  });
});

describe("WhatsApp on the plan but not connected", () => {
  const step = { key: "w", delaySeconds: 0, template: "Hi {{first_name}}", enabled: true, channel: "whatsapp" };

  test("the sequence says connect it, once, not 'not on your plan' twice", () => {
    const issues = validateSequence([step], {
      unknownTokensFor: () => [],
      whatsappEnabled: false,
      whatsappOnPlan: true,
      available: { email: true, sms: true, whatsapp: false },
    });
    const whatsapp = issues.filter((i) => /WhatsApp/.test(i.message));
    assert.equal(whatsapp.length, 1);
    assert.match(whatsapp[0].message, /not connected yet/);
  });

  test("off the plan still says so", () => {
    const issues = validateSequence([step], {
      unknownTokensFor: () => [],
      whatsappEnabled: false,
      whatsappOnPlan: false,
    });
    assert.ok(issues.some((i) => /not on your plan/.test(i.message)));
  });

  test("the channel policy card distinguishes the two", () => {
    const base = {
      senderAvailable: true,
      senderIssue: null,
      policyAllows: { email: true, sms: true, whatsapp: true },
      smsConnected: true,
      whatsappEnabled: false,
      whatsappTemplateReady: false,
    };
    const connectFirst = summariseWarmChannels({ ...base, whatsappOnPlan: true }).find((r) => r.channel === "whatsapp");
    assert.equal(connectFirst?.verdict, "Not connected");
    const offPlan = summariseWarmChannels({ ...base, whatsappOnPlan: false }).find((r) => r.channel === "whatsapp");
    assert.equal(offPlan?.verdict, "Not on your plan");
    // Older callers without the flag keep the old reading.
    const legacy = summariseWarmChannels(base).find((r) => r.channel === "whatsapp");
    assert.equal(legacy?.verdict, "Not on your plan");
  });
});

describe("agent queue and approval copy", () => {
  test("queue statuses are words and rows link to their subject", () => {
    assert.equal(queueStatusLabel("PENDING"), "Queued");
    assert.equal(queueStatusLabel("BLOCKED"), "Waiting for you");
    assert.equal(queueSubjectHref("LEAD", "abc"), "/app/leads/abc");
    assert.equal(queueSubjectHref("PROSPECT", "p1"), "/app/find-leads?view=prospects&prospect=p1");
    assert.equal(queueSubjectHref("CAMPAIGN", "c1"), null);
    assert.equal(queueSubjectHref("LEAD", null), null);
    assert.equal(queueTypeLabel("BOOKING"), "Chase to its goal");
  });

  test("a closing or re-engagement agent is not described in prospect terms", () => {
    assert.doesNotMatch(autonomyDescription("REVIEW_ALL", "BOOKING"), /Find Leads|prospect/i);
    assert.doesNotMatch(autonomyDescription("AUTO", "REENGAGEMENT"), /prospect/i);
    assert.match(autonomyDescription("REVIEW_ALL", "SOURCING"), /Find Leads/);
    assert.deepEqual(autonomyOptionsFor("BOOKING"), ["REVIEW_ALL", "AUTO"]);
    assert.deepEqual(autonomyOptionsFor("COMBINED"), ["REVIEW_ALL", "REVIEW_NEW", "AUTO"]);
  });

  test("readiness no longer tells people to switch on the disabled paid data source", () => {
    const problems = readinessProblems({
      agentType: "SOURCING",
      enabledSources: ["WEBSITE"],
      searchStrategyId: "s",
    } as never);
    assert.ok(problems.every((p) => !/Business contact data/.test(p)));
  });
});

describe("reactivation audience from an imported list", () => {
  test("importedList defaults off and is accepted", () => {
    assert.equal(DEFAULT_AUDIENCE_FILTER.importedList, false);
    assert.equal(audienceFilterSchema.parse({}).importedList, false);
    assert.equal(audienceFilterSchema.parse({ importedList: true }).importedList, true);
  });

  test("the audience query skips the lead-age filter for an imported list", () => {
    assert.match(read("src/lib/campaigns/queries.ts"), /olderThanDays > 0 && !filter\.importedList/);
    const step = read("src/components/reactivation/wizard/audience-step.tsx");
    assert.match(step, /importedList: true/);
    assert.doesNotMatch(step, /olderThanDays: 1 \}/);
  });
});

describe("find leads", () => {
  test("a queued run reads neutral, not healthy", () => {
    assert.equal(runStatusTone("QUEUED"), "neutral");
  });

  test("intent starters are B2B", () => {
    assert.ok(CATEGORY_TEMPLATES.every((t) => !/construction|renovation/i.test(t.name)));
  });

  test("phone numbers are never looked up from a provider (resolved conflict 6)", () => {
    const action = read("src/lib/find-leads/prospect-actions.ts");
    assert.match(action, /channel: z\.literal\("EMAIL"\)/);
    const research = read("src/lib/find-leads/server/research.ts");
    assert.match(research, /if \(channel !== "EMAIL"\)/);
    assert.doesNotMatch(research, /phone_e164: phone/);
    assert.doesNotMatch(read("src/components/find-leads/prospect-drawer.tsx"), /channel="PHONE"/);
  });

  test("viewers cannot create, rename, archive or message search sessions", () => {
    const src = read("src/lib/find-leads/actions.ts");
    for (const fn of [
      "createSearchSessionAction",
      "sendSearchMessageAction",
      "updateSearchPlanAction",
      "renameSearchSessionAction",
      "archiveSearchSessionAction",
      "duplicateSearchSessionAction",
    ]) {
      const start = src.indexOf(`export async function ${fn}(`);
      assert.ok(start >= 0, fn);
      const body = src.slice(start, start + 1500);
      assert.match(body, /requireFindLeadsPlanner\(\)/, fn);
    }
    assert.match(src, /hasRole\(access\.workspace\.role, "member"\)/);
  });

  test("the paid data source is shown unavailable while paid enrichment is off", () => {
    assert.match(read("src/lib/agents/queries.ts"), /DATA_PROVIDER" && !paidEnrichmentEnabled\(\)/);
  });

  test("the campaign funnel only uses colour classes that have tokens", () => {
    const overview = read("src/components/find-leads/campaigns/detail/overview.tsx");
    assert.doesNotMatch(overview, /bg-(info|success|warning)-400/);
  });

  test("campaign targeting lists only searches with a plan", () => {
    assert.match(read("src/lib/outreach/campaigns/audience.ts"), /\.not\("latest_strategy_id", "is", null\)/);
  });
});

describe("role refusals are answers, not error pages", () => {
  test("InMail and intent actions return a message to a lower role", () => {
    const inmail = read("src/lib/outreach/inmail-actions.ts");
    assert.doesNotMatch(inmail, /await requireRole\("(member|viewer)"\);/);
    const intent = read("src/lib/intent/actions.ts");
    assert.doesNotMatch(intent, /await requireRole\("admin"\);/);
  });

  test("an agent action does not turn a lapsed session into 'you need admin access'", () => {
    const src = read("src/lib/agents/actions.ts");
    assert.match(src, /error\.message === "FORBIDDEN"\) return null;\s*throw error;/);
  });

  test("intent category toggle reports a missing category", () => {
    assert.match(read("src/lib/intent/actions.ts"), /That category could not be found/);
  });
});

describe("hydration: quiet-hours timezone labels come from the server", () => {
  test("the card takes server labels and the view passes them", () => {
    assert.match(read("src/components/follow-up/quiet-hours-card.tsx"), /timezoneLabels\?\.\[zone\]/);
    assert.match(read("src/components/follow-up/follow-up-view.tsx"), /timezoneLabels=\{Object\.fromEntries/);
  });
});

describe("server files never take plain values from a 'use client' module", () => {
  // A server component importing a constant from a "use client" file gets a
  // client reference, not the value. The Reactivation page read its view
  // cookie under the wrong key that way (and /admin/system broke the same way).
  const USE_CLIENT = /^["']use client["']/m;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  for (const dir of [
    "src/app/(app)/app/find-leads",
    "src/app/(app)/app/follow-up",
    "src/app/(app)/app/reactivation",
    "src/app/(app)/app/agents",
    "src/components/find-leads",
    "src/components/follow-up",
    "src/components/reactivation",
    "src/components/agents",
  ]) {
    walk(path.join(root, dir));
  }
  const resolve = (spec: string): string | null => {
    if (!spec.startsWith("@/")) return null;
    const base = path.join(root, "src", spec.slice(2));
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (existsSync(base + ext)) return base + ext;
    }
    return null;
  };

  test("only components cross the boundary", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (USE_CLIENT.test(src)) continue;
      for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const target = resolve(m[3]);
        if (!target || !USE_CLIENT.test(readFileSync(target, "utf8"))) continue;
        const names = m[2]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "))
          .map((n) => n.split(/\s+as\s+/)[0]);
        for (const name of names) {
          // A component is PascalCase; a constant (ALL_CAPS) or a function
          // value (camelCase) arrives as a reference, not the value.
          if (!/^[A-Z][a-z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) {
            offenders.push(`${path.relative(root, file)} imports ${name} from ${m[3]}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("the Reactivation view cookie key lives in a plain module", () => {
    assert.doesNotMatch(read("src/components/reactivation/view-cookie.ts"), /^["']use client["']/m);
    assert.match(read("src/app/(app)/app/reactivation/page.tsx"), /from "@\/components\/reactivation\/view-cookie"/);
  });
});
