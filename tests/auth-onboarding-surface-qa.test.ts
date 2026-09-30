/**
 * Regression tests for defects found in the auth, onboarding and trial-entry
 * surface QA (wave 4), 2026-09-30.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRecoverySession, RECOVERY_WINDOW_SECONDS } from "../src/lib/auth/recovery-session.ts";
import { partnerPath, PARTNER_HOME } from "../src/lib/affiliates/partner-path.ts";
import { passwordSchema } from "../src/lib/validation/auth.ts";

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function token(amr: unknown): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub: "u", aal: "aal1", amr })}.sig`;
}

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const at = (secondsAgo: number) => Math.floor(NOW / 1000) - secondsAgo;

describe("reset password only from the reset link's own session", () => {
  test("a password sign-in cannot set a new password without the old one", () => {
    assert.equal(isRecoverySession(token([{ method: "password", timestamp: at(60) }]), NOW), false);
    assert.equal(isRecoverySession(token([{ method: "oauth", timestamp: at(60) }]), NOW), false);
  });

  test("the reset link's session can, in both its PKCE and token-hash forms", () => {
    assert.equal(isRecoverySession(token([{ method: "recovery", timestamp: at(60) }]), NOW), true);
    assert.equal(isRecoverySession(token([{ method: "otp", timestamp: at(60) }]), NOW), true);
  });

  test("only for a while after the link is opened", () => {
    assert.equal(
      isRecoverySession(token([{ method: "recovery", timestamp: at(RECOVERY_WINDOW_SECONDS + 5) }]), NOW),
      false,
    );
  });

  test("the most recent method decides", () => {
    const amr = [
      { method: "recovery", timestamp: at(600) },
      { method: "password", timestamp: at(60) },
    ];
    assert.equal(isRecoverySession(token(amr), NOW), false);
  });

  test("garbage is never a recovery session", () => {
    for (const bad of [null, undefined, "", "abc", "a.b.c", token(null), token([]), token("recovery")]) {
      assert.equal(isRecoverySession(bad as string | null, NOW), false);
    }
  });

  test("updatePassword, the page and the form all use it", () => {
    assert.match(src("src/lib/auth/actions.ts"), /isRecoverySession\(session\?\.access_token\)/);
    assert.match(src("src/app/(auth)/reset-password/page.tsx"), /isRecoverySession/);
    assert.match(src("src/app/(auth)/reset-password/reset-password-form.tsx"), /isRecoverySession/);
  });
});

describe("partner sign-in redirect", () => {
  test("stays inside the partner portal", () => {
    assert.equal(partnerPath("/affiliates/app/links"), "/affiliates/app/links");
    assert.equal(partnerPath("/affiliates/app/payouts?tab=history"), "/affiliates/app/payouts?tab=history");
    assert.equal(partnerPath("/affiliates"), "/affiliates");
  });

  test("dot segments cannot climb into the customer app", () => {
    assert.equal(partnerPath("/affiliates/../app"), PARTNER_HOME);
    assert.equal(partnerPath("/affiliates/%2e%2e/app"), PARTNER_HOME);
  });

  test("never off-site, never a login loop", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/affiliates/login", "/app", "", undefined, null]) {
      assert.equal(partnerPath(bad as string | undefined), PARTNER_HOME, String(bad));
    }
  });
});

describe("one password rule for every door", () => {
  test("the checklist shows exactly the rule the server enforces", () => {
    const parts = src("src/app/(auth)/_components/auth-form-parts.tsx");
    const requirements = parts.slice(parts.indexOf("const REQUIREMENTS"), parts.indexOf("const RECOMMENDED"));
    // It used to list uppercase, lowercase and a special character as
    // requirements, which the server never enforced.
    assert.doesNotMatch(requirements, /uppercase|special character/i);
    assert.equal(passwordSchema.safeParse("abcdefg1").success, true);
    assert.equal(passwordSchema.safeParse("abcdefgh").success, false);
  });

  test("partner signup uses the same schema", () => {
    assert.match(src("src/lib/affiliates/signup-actions.ts"), /password: passwordSchema/);
  });
});

describe("onboarding test sends reach only the workspace", () => {
  const actions = src("src/lib/onboarding/actions.ts");

  test("the step 4 test message goes through the hardened Follow-Up path", () => {
    const fn = actions.slice(actions.indexOf("export async function sendFollowUpTestMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /sendFollowUpTest\(/);
    assert.doesNotMatch(body, /getMessagingProvider|provider\.send/);
  });

  test("the test lead refuses a stranger's number and is rate limited", () => {
    const fn = actions.slice(actions.indexOf("export async function runTestLead"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /isPermittedTestRecipient\("sms"/);
    assert.match(body, /checkRateLimit\("followup:test"/);
    assert.match(actions, /const testLeadSchema = z/);
  });

  test("'Test lead successful' needs the opening message to have gone out", () => {
    const provision = src("src/lib/onboarding/provision.ts");
    assert.match(provision, /passed: Boolean\(testLead\.data\) && testSent/);
  });
});

describe("two-factor on the first-run pages", () => {
  test("onboarding and start-trial enforce the workspace security policy", () => {
    assert.match(src("src/app/onboarding/page.tsx"), /await enforceWorkspaceSecurity\(workspace\.businessId\)/);
    assert.match(src("src/app/start-trial/page.tsx"), /await enforceWorkspaceSecurity\(workspace\.businessId\)/);
  });

  test("a customer trying the operator door is not signed out everywhere", () => {
    const admin = src("src/lib/admin/actions.ts");
    const fn = admin.slice(admin.indexOf("export async function adminSignIn"), admin.indexOf("export async function adminSignOut"));
    assert.match(fn, /signOut\(\{ scope: "local" \}\)/);
  });
});

describe("dead and misleading controls", () => {
  test("no 'keep me signed in' box that nothing reads", () => {
    assert.doesNotMatch(src("src/app/(auth)/login/login-form.tsx"), /name="keepSignedIn"/);
    assert.doesNotMatch(src("src/app/affiliates/login/login-form.tsx"), /name="keepSignedIn"/);
  });

  test("'Save & exit' leaves setup instead of bouncing back through /app", () => {
    const wizard = src("src/components/onboarding/wizard.tsx");
    const fn = wizard.slice(wizard.indexOf("async function handleSaveExit"), wizard.indexOf("function back()"));
    assert.doesNotMatch(fn, /router\.push\("\/app"\)/);
  });

  test("the setup checklist ignores the onboarding test lead and accepts handover", () => {
    const queries = src("src/lib/settings/queries.ts");
    const fn = queries.slice(queries.indexOf("export async function getGettingStarted"));
    assert.match(fn, /\.eq\("is_test", false\)/);
    assert.match(fn, /=== "handover"/);
  });

  test("the start-trial badge makes no popularity claim", () => {
    assert.doesNotMatch(src("src/components/billing/start-trial-picker.tsx"), /Most chosen|Most popular/);
  });
});
