/**
 * Owner decisions from the customer-core QA (2026-09-30): viewers can't be
 * assigned leads (UI and every server path), and erasing a lead needs the
 * word ERASE typed in.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assignableMembers, type WorkspaceMember } from "../src/lib/leads/types.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const member = (userId: string, role: string): WorkspaceMember => ({ userId, name: userId, email: `${userId}@x.example`, role });

describe("assignment", () => {
  test("viewers are left out of the picker unless they already own the lead", () => {
    const members = [member("owner", "owner"), member("rep", "member"), member("watcher", "viewer")];
    assert.deepEqual(assignableMembers(members).map((m) => m.userId), ["owner", "rep"]);
    assert.deepEqual(assignableMembers(members, "watcher").map((m) => m.userId), ["owner", "rep", "watcher"]);
  });

  test("every server path that assigns refuses a viewer", () => {
    for (const path of ["src/lib/services/operations/leads.ts", "src/lib/leads/actions.ts", "src/lib/leads/add-lead/actions.ts"]) {
      assert.match(read(path), /role === "viewer"/, `${path} must refuse viewers`);
    }
  });

  test("every assignee picker uses assignableMembers", () => {
    for (const path of [
      "src/components/leads/add-lead/route-step.tsx",
      "src/components/leads/detail/lead-page-actions.tsx",
      "src/components/leads/lead-bulk-bar.tsx",
      "src/components/leads/lead-summary-section.tsx",
    ]) {
      const source = read(path);
      assert.match(source, /assignableMembers\(members/, path);
      assert.doesNotMatch(source, /\{members\.map\(/, `${path} still lists every member`);
    }
  });
});

describe("erase", () => {
  test("erase requires typing ERASE; the dialog blocks confirm until it matches", () => {
    assert.match(read("src/components/leads/lead-data-rights.tsx"), /confirmationPhrase=\{mode === "DELETE" \? "ERASE" : undefined\}/);
    const modal = read("src/components/ui/modal.tsx");
    assert.match(modal, /disabled=\{!phraseMatches\}/);
    assert.match(modal, /if \(!phraseMatches\) return;/);
  });
});

describe("dashboard figures (wave 4 findings)", () => {
  test("test leads' messages are left out of follow-up and failed-message figures", () => {
    const source = read("src/lib/dashboard/queries.ts");
    assert.match(source, /\.eq\("is_test", true\)/);
    assert.match(source, /\(messageResult\.data \?\? \[\]\) as MessageRow\[\]\)\.filter\(notTestLead\)/);
    assert.match(source, /failedMessages: \(\(failedResult\.data[^\n]*\.filter\(notTestLead\)\.length/);
  });

  test("a fractional AI ceiling is shown with pence, not rounded to £0", () => {
    assert.match(read("src/components/dashboard/revenue-control-section.tsx"), /Number\.isInteger\(budget\.data\.ceilingGbp\) \? 0 : 2/);
  });
});

describe("session device names", () => {
  test("the server Supabase client forwards the browser's User-Agent to Supabase Auth", () => {
    const source = read("src/lib/supabase/server.ts");
    assert.match(source, /\(await headers\(\)\)\.get\("user-agent"\)/);
    assert.match(source, /global: \{ headers: \{ "User-Agent": userAgent \} \}/);
    assert.match(source, /agent\.slice\(0, 512\)/, "length is capped");
  });
});

describe("two-factor panel", () => {
  test("the last authenticator can't be removed where two-factor is required", () => {
    const source = read("src/components/security/account-security-panel.tsx");
    assert.match(source, /const lastRequired = Boolean\(mfaRequiredNote\) && factors\.length === 1;/);
    assert.match(source, /disabled=\{lastRequired\}/);
  });
});

describe("job timings", () => {
  test("completing a job keeps locked_at (the attempt's start) so duration and lag are measurable", () => {
    const source = read("src/lib/jobs/queue.ts");
    const complete = source.slice(source.indexOf("export async function completeJob"), source.indexOf("export async function completeJob") + 900);
    assert.match(complete, /state: "completed"/);
    assert.doesNotMatch(complete, /locked_at: null/);
    assert.match(complete, /locked_by: null/);
  });
});

describe("outreach blocked reason", () => {
  test("a prospect held back at send time records the check's own reason", () => {
    const source = read("src/lib/outreach/dispatch.ts");
    assert.match(source, /recordBlocked\(input, run\.id, prospect\.id, verdict\.reasonCode, verdict\.reason\)/);
    assert.match(source, /recordBlocked\(input, run\.id, prospect\.id, decision\.reasonCode, decision\.message\)/);
    assert.match(source, /`Not sent: \$\{reason\.trim\(\)\}`/);
  });
});

describe("MRR, one definition (owner 2026-09-30)", async () => {
  const { mrrContribution } = await import("../src/lib/billing/revenue.ts");
  const base = { plan: "growth", interval: "month" as string | null, mrrMinor: null as number | null };

  test("only active or past-due subscriptions billed through Stripe count", () => {
    assert.deepEqual(mrrContribution({ ...base, status: "ACTIVE", stripeSubscriptionId: null }), { gbp: 0, source: "complimentary" });
    assert.deepEqual(mrrContribution({ ...base, status: "TRIALING", stripeSubscriptionId: "sub_1" }), { gbp: 0, source: "not_billing" });
    assert.deepEqual(mrrContribution({ ...base, status: "CANCELLED", stripeSubscriptionId: "sub_1" }), { gbp: 0, source: "not_billing" });
    assert.equal(mrrContribution({ ...base, status: "PAST_DUE", stripeSubscriptionId: "sub_1" }).gbp > 0, true);
  });

  test("the billed amount wins; list price only for a Stripe subscription with no paid invoice yet", () => {
    assert.deepEqual(
      mrrContribution({ ...base, status: "ACTIVE", stripeSubscriptionId: "sub_1", mrrMinor: 15920 }),
      { gbp: 159.2, source: "stripe_invoice" },
    );
    assert.equal(mrrContribution({ ...base, status: "ACTIVE", stripeSubscriptionId: "sub_1" }).source, "list_price");
  });

  test("every admin MRR total uses it", () => {
    for (const path of ["src/lib/admin/overview.ts", "src/lib/admin/billing.ts"]) {
      assert.match(read(path), /mrrContribution\(/, path);
    }
    assert.match(read("src/lib/admin/economics-live.ts"), /billed: Boolean\(row\.stripe_subscription_id\)/);
  });
});
