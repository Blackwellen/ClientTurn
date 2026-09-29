import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  aalFromAccessToken,
  AUDIT_RETENTION_DEFAULT_MONTHS,
  auditRetentionCapMonths,
  auditRetentionCutoff,
  canRemoveFactor,
  describeUserAgent,
  effectiveAuditRetentionMonths,
  evaluateAdminAccess,
  evaluateWorkspaceAccess,
  isActivityTrackedPath,
  isIdleExpired,
  parseAuditRetention,
  parseIdleTimeout,
  parseTotpCode,
  qrCodeDataUrl,
  readActivity,
  signActivity,
  signIdleExpiry,
  toAal,
  verifyIdleExpiry,
} from "../src/lib/auth/security-policy.ts";
import {
  AUDIT_PURGE_BATCH,
  AUDIT_PURGE_RUN_BUDGET,
  enforceAuditRetention,
  type AuditRetentionDeps,
} from "../src/lib/data-rights/audit-retention.ts";

/**
 * Enterprise security controls (2026-09-29): two-factor for platform admins
 * (mandatory) and workspaces (optional or owner-required), idle timeout,
 * sessions, audit-log retention (IR-09) and CI (IR-13). Pure rules plus
 * source checks of the wiring; no Supabase, no network.
 */

const read = (path: string) => readFileSync(path, "utf8");
const KEY = "test-signing-key";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-29T12:00:00Z");

const noPolicy = { requireMfa: false, idleTimeoutMinutes: null };

describe("two-factor access decisions", () => {
  test("an account with a factor must have used it this session", () => {
    assert.deepEqual(
      evaluateWorkspaceAccess({
        mfa: { verifiedFactorCount: 1, currentAal: "aal1" },
        policy: noPolicy,
        lastActivityMs: null,
        nowMs: NOW,
      }),
      { ok: false, reason: "mfa_verify" },
    );
    assert.deepEqual(
      evaluateWorkspaceAccess({
        mfa: { verifiedFactorCount: 1, currentAal: "aal2" },
        policy: noPolicy,
        lastActivityMs: null,
        nowMs: NOW,
      }),
      { ok: true },
    );
  });

  test("two-factor stays optional unless the workspace requires it", () => {
    const none = { verifiedFactorCount: 0, currentAal: "aal1" as const };
    assert.deepEqual(
      evaluateWorkspaceAccess({ mfa: none, policy: noPolicy, lastActivityMs: null, nowMs: NOW }),
      { ok: true },
    );
    assert.deepEqual(
      evaluateWorkspaceAccess({
        mfa: none,
        policy: { requireMfa: true, idleTimeoutMinutes: null },
        lastActivityMs: null,
        nowMs: NOW,
      }),
      { ok: false, reason: "mfa_setup" },
    );
  });

  test("platform admins: no factor = set up, factor unused = verify, AAL2 = in", () => {
    assert.equal(evaluateAdminAccess({ verifiedFactorCount: 0, currentAal: "aal1" }), "mfa_setup");
    // A password-only session never opens /admin, even with no factor yet.
    assert.equal(evaluateAdminAccess({ verifiedFactorCount: 0, currentAal: "aal2" }), "mfa_setup");
    assert.equal(evaluateAdminAccess({ verifiedFactorCount: 2, currentAal: "aal1" }), "mfa_verify");
    assert.equal(evaluateAdminAccess({ verifiedFactorCount: 1, currentAal: null }), "mfa_verify");
    assert.equal(evaluateAdminAccess({ verifiedFactorCount: 1, currentAal: "aal2" }), "ok");
  });

  test("the last factor of a platform admin, or of a member of a requiring workspace, cannot be removed", () => {
    assert.equal(canRemoveFactor({ verifiedFactorCount: 1, isPlatformAdmin: true, workspaceRequiresMfa: false }).ok, false);
    assert.equal(canRemoveFactor({ verifiedFactorCount: 1, isPlatformAdmin: false, workspaceRequiresMfa: true }).ok, false);
    assert.equal(canRemoveFactor({ verifiedFactorCount: 1, isPlatformAdmin: false, workspaceRequiresMfa: false }).ok, true);
    assert.equal(canRemoveFactor({ verifiedFactorCount: 2, isPlatformAdmin: true, workspaceRequiresMfa: true }).ok, true);
  });

  test("codes, levels and QR codes are parsed strictly", () => {
    assert.equal(parseTotpCode("123 456"), "123456");
    assert.equal(parseTotpCode("12345"), null);
    assert.equal(parseTotpCode("12345a"), null);
    assert.equal(parseTotpCode(123456), null);
    assert.equal(toAal("aal2"), "aal2");
    assert.equal(toAal("aal3"), null);
    const jwt = (claims: object) =>
      `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
    assert.equal(aalFromAccessToken(jwt({ aal: "aal2", sub: USER })), "aal2");
    assert.equal(aalFromAccessToken(jwt({ sub: USER })), null);
    assert.equal(aalFromAccessToken("not-a-jwt"), null);
    assert.equal(aalFromAccessToken(undefined), null);
    assert.equal(qrCodeDataUrl("data:image/svg+xml;utf-8,<svg/>"), "data:image/svg+xml;utf-8,<svg/>");
    assert.match(qrCodeDataUrl("<svg></svg>") ?? "", /^data:image\/svg\+xml;utf-8,%3Csvg/);
    assert.equal(qrCodeDataUrl("javascript:alert(1)"), null);
  });
});

describe("idle timeout", () => {
  test("only an owner-chosen timeout expires a session", () => {
    assert.equal(isIdleExpired(null, NOW - 10 * 3600_000, NOW), false);
    assert.equal(isIdleExpired(30, null, NOW), false);
    assert.equal(isIdleExpired(30, NOW - 29 * 60_000, NOW), false);
    assert.equal(isIdleExpired(30, NOW - 31 * 60_000, NOW), true);
    assert.deepEqual(
      evaluateWorkspaceAccess({
        mfa: { verifiedFactorCount: 0, currentAal: "aal1" },
        policy: { requireMfa: false, idleTimeoutMinutes: 15 },
        lastActivityMs: NOW - 16 * 60_000,
        nowMs: NOW,
      }),
      { ok: false, reason: "idle_timeout" },
    );
  });

  test("the activity cookie is signed and bound to the user", () => {
    const cookie = signActivity(USER, NOW, KEY);
    assert.equal(readActivity(cookie, USER, KEY), NOW);
    assert.equal(readActivity(cookie, OTHER, KEY), null, "another account's cookie is worthless");
    assert.equal(readActivity(cookie, USER, "other-key"), null);
    const [user, , sig] = cookie.split(".");
    assert.equal(readActivity(`${user}.${NOW + 3600_000}.${sig}`, USER, KEY), null, "a forged fresher time fails");
    assert.equal(readActivity("garbage", USER, KEY), null);
    assert.equal(readActivity(undefined, USER, KEY), null);
  });

  test("the idle sign-out hand-off is short-lived and per user", () => {
    const token = signIdleExpiry(USER, NOW, KEY);
    assert.equal(verifyIdleExpiry(token, USER, NOW + 60_000, KEY), true);
    assert.equal(verifyIdleExpiry(token, USER, NOW + 3 * 60_000, KEY), false);
    assert.equal(verifyIdleExpiry(token, OTHER, NOW, KEY), false);
    assert.equal(verifyIdleExpiry(null, USER, NOW, KEY), false);
  });

  test("only person-driven app and API paths count as activity", () => {
    assert.equal(isActivityTrackedPath("/app"), true);
    assert.equal(isActivityTrackedPath("/app/leads"), true);
    assert.equal(isActivityTrackedPath("/api/search"), true);
    for (const path of ["/api/cron/worker", "/api/webhooks/stripe", "/api/v1/leads", "/api/mcp", "/login", "/apple"]) {
      assert.equal(isActivityTrackedPath(path), false, path);
    }
  });

  test("owners may only pick listed timeouts", () => {
    assert.equal(parseIdleTimeout("off"), null);
    assert.equal(parseIdleTimeout(null), null);
    assert.equal(parseIdleTimeout(30), 30);
    assert.equal(parseIdleTimeout("45"), undefined);
  });
});

describe("audit-log retention (IR-09)", () => {
  test("12 months by default, owner choice capped by plan", () => {
    assert.equal(AUDIT_RETENTION_DEFAULT_MONTHS, 12);
    assert.equal(auditRetentionCapMonths("starter"), 12);
    assert.equal(auditRetentionCapMonths("pro"), 24);
    assert.equal(auditRetentionCapMonths("enterprise"), 84);
    assert.equal(auditRetentionCapMonths("unknown"), 12);
    assert.equal(effectiveAuditRetentionMonths(null, "pro"), 12);
    assert.equal(effectiveAuditRetentionMonths(84, "pro"), 24, "a downgrade caps retention");
    assert.equal(effectiveAuditRetentionMonths(6, "starter"), 6);
    assert.equal(parseAuditRetention(24, "growth"), undefined);
    assert.equal(parseAuditRetention(24, "pro"), 24);
    assert.equal(parseAuditRetention(7, "enterprise"), undefined);
    assert.equal(auditRetentionCutoff(12, new Date("2026-09-29T03:00:00Z")).toISOString(), "2025-09-29T03:00:00.000Z");
  });

  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const RUN_AT = new Date("2026-09-29T03:07:00Z");
  const monthsAgo = (m: number) => {
    const d = new Date(RUN_AT);
    d.setUTCMonth(d.getUTCMonth() - m);
    return d;
  };

  function world(rows: { businessId: string | null; at: Date }[], configured: Map<string, number> | null, plans: Record<string, string>) {
    const store = rows.map((row, index) => ({ id: index, ...row }));
    const calls: { businessId: string | null; before: Date; limit: number }[] = [];
    const deps: AuditRetentionDeps = {
      now: () => RUN_AT,
      async listWorkspaces(after, limit) {
        const ids = [A, B, C].filter((id) => after === null || id > after);
        return ids.slice(0, limit);
      },
      async listConfiguredMonths() {
        return configured;
      },
      async planOf(businessId) {
        return plans[businessId] ?? "starter";
      },
      async purgeBatch(businessId, before, limit) {
        calls.push({ businessId, before, limit });
        const doomed = store.filter((row) => row.businessId === businessId && row.at < before).slice(0, limit);
        for (const row of doomed) store.splice(store.indexOf(row), 1);
        return doomed.length;
      },
    };
    return { store, calls, deps };
  }

  test("deletes only rows past each workspace's retention; platform rows keep 12 months", async () => {
    const { store, deps } = world(
      [
        { businessId: A, at: monthsAgo(13) }, // default 12 -> deleted
        { businessId: A, at: monthsAgo(11) }, // kept
        { businessId: B, at: monthsAgo(20) }, // Pro, chose 24 -> kept
        { businessId: B, at: monthsAgo(25) }, // past 24 -> deleted
        { businessId: C, at: monthsAgo(30) }, // chose 84 on starter -> capped at 12 -> deleted
        { businessId: null, at: monthsAgo(13) }, // platform -> deleted
        { businessId: null, at: monthsAgo(2) }, // platform -> kept
      ],
      new Map([
        [B, 24],
        [C, 84],
      ]),
      { [B]: "pro", [C]: "starter" },
    );
    const run = await enforceAuditRetention(deps);
    assert.equal(run.skipped, false);
    assert.equal(run.deleted, 4);
    assert.equal(run.platformDeleted, 1);
    assert.deepEqual(
      store.map((row) => [row.businessId, row.at.toISOString()]),
      [
        [A, monthsAgo(11).toISOString()],
        [B, monthsAgo(20).toISOString()],
        [null, monthsAgo(2).toISOString()],
      ],
    );
    assert.deepEqual(
      run.perWorkspace.map((entry) => [entry.businessId, entry.months, entry.deleted]),
      [
        [A, 12, 1],
        [B, 24, 1],
        [C, 12, 1],
      ],
    );
  });

  test("deletes in bounded batches and stops at the run budget", async () => {
    const many = Array.from({ length: AUDIT_PURGE_RUN_BUDGET + 2500 }, () => ({ businessId: A, at: monthsAgo(14) }));
    const { calls, deps, store } = world(many, new Map(), {});
    const run = await enforceAuditRetention(deps);
    assert.equal(run.deleted, AUDIT_PURGE_RUN_BUDGET);
    assert.equal(run.budgetExhausted, true);
    assert.equal(store.length, 2500, "the rest drains tomorrow");
    assert.ok(calls.every((call) => call.limit <= AUDIT_PURGE_BATCH));
  });

  test("does nothing until migration 0180 is applied", async () => {
    const { deps, store } = world([{ businessId: A, at: monthsAgo(40) }], null, {});
    const run = await enforceAuditRetention(deps);
    assert.equal(run.skipped, true);
    assert.equal(store.length, 1);
  });
});

describe("wiring", () => {
  test("requireWorkspace enforces the workspace security policy", () => {
    const session = read("src/lib/auth/session.ts");
    assert.match(session, /await enforceWorkspaceSecurity\(workspace\.businessId\)/);
    assert.match(session, /export async function getSecureWorkspace/);
    for (const route of [
      "src/app/api/exports/audit/route.ts",
      "src/app/api/exports/leads/route.ts",
      "src/app/api/exports/prospects/route.ts",
      "src/app/api/search/route.ts",
    ]) {
      assert.doesNotMatch(read(route), /getActiveWorkspace\(/, `${route} bypasses the policy`);
    }
  });

  test("/admin requires AAL2 and step-up requires a fresh code", () => {
    const guard = read("src/lib/admin/guard.ts");
    assert.match(guard, /evaluateAdminAccess\(session\.mfa\) !== "ok"\) redirect\(ADMIN_MFA_PATH\)/);
    const actions = read("src/lib/admin/actions.ts");
    const signIn = actions.slice(actions.indexOf("export async function adminSignIn"), actions.indexOf("export async function adminSignOut"));
    assert.doesNotMatch(signIn, /grantStepUp\(/, "a password alone must not open step-up");
    const stepUp = actions.slice(actions.indexOf("export async function confirmStepUp"));
    assert.match(stepUp, /challengeAndVerify/);
    assert.match(stepUp, /passwordMatches\(/);
    // The cookie-bound client must not re-sign in (it would drop the session to AAL1).
    assert.doesNotMatch(stepUp.slice(0, stepUp.indexOf("grantStepUp")), /supabase\.auth\.signInWithPassword/);
  });

  test("the proxy strips a client-supplied activity header", () => {
    const proxy = read("src/lib/auth/activity-proxy.ts");
    assert.match(proxy, /headers\.delete\(PREV_ACTIVITY_HEADER\)/);
    assert.match(read("src/lib/supabase/proxy-session.ts"), /withActivity\(request, response, userId\)/);
  });

  test("the retention job is registered, laned and scheduled daily", () => {
    assert.match(read("src/lib/jobs/register.ts"), /registerHandler\("audit\.retention", handleAuditRetention\)/);
    assert.match(read("src/lib/jobs/lanes.ts"), /"audit\.retention": c\("BULK", "long"/);
    assert.match(read("src/app/api/cron/daily/route.ts"), /enqueue\("audit\.retention"/);
    assert.match(read("docs/CRON.md"), /`audit\.retention`/);
  });

  test("migration 0180: tenant table with forced RLS, SELECT-only browser grant, self-only sessions", () => {
    const sql = read("supabase/migrations/0180_security_controls.sql");
    assert.match(sql, /business_id uuid primary key references public\.businesses\(id\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /force row level security/);
    assert.match(sql, /revoke insert, update, delete, truncate, references, trigger\s+on public\.workspace_security_settings from authenticated/);
    assert.match(sql, /where s\.user_id = auth\.uid\(\)/);
    assert.match(sql, /grant execute on function public\.audit_log_purge_batch\(uuid, timestamptz, integer\) to service_role/);
    assert.match(sql, /from public, anon, authenticated/);
  });

  test("CI runs typecheck, lint, all tests and a production audit; Dependabot is weekly", () => {
    assert.ok(existsSync(".github/workflows/ci.yml"));
    const ci = read(".github/workflows/ci.yml");
    for (const step of ["npm run typecheck", "npm run lint", "npm test", "npm audit --omit=dev --audit-level=high"]) {
      assert.ok(ci.includes(step), step);
    }
    assert.match(ci, /pull_request:/);
    assert.match(ci, /branches: \[main\]/);
    assert.doesNotMatch(ci, /secrets\./, "CI needs no secrets");
    const dependabot = read(".github/dependabot.yml");
    assert.match(dependabot, /package-ecosystem: npm/);
    assert.match(dependabot, /interval: weekly/);
  });

  test("user agents are summarised for display", () => {
    assert.equal(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"),
      "Chrome on Windows",
    );
    assert.equal(describeUserAgent(null), "Unknown device");
  });
});
