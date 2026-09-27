import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { atZeroRoute } from "../src/lib/billing/at-zero.ts";

/**
 * SMS / WhatsApp allowance and credit used up, no overage (owner rule
 * 2026-09-27): automated steps and AI replies move to email where they can;
 * an AI reply that cannot is handed to a person; nothing else is re-routed.
 */
const base = { leadHasEmail: true, mailboxConnected: true, emailSuppressed: false, optedOut: false };

describe("at zero", () => {
  test("automated SMS steps move to email where the lead has one", () => {
    assert.equal(atZeroRoute({ ...base, origin: "automation" }), "email");
    assert.equal(atZeroRoute({ ...base, origin: "automation", leadHasEmail: false }), "none");
  });

  test("an AI reply goes by email with an address and a mailbox, otherwise to a person", () => {
    assert.equal(atZeroRoute({ ...base, origin: "agent" }), "email");
    assert.equal(atZeroRoute({ ...base, origin: "agent_handover" }), "email");
    assert.equal(atZeroRoute({ ...base, origin: "agent", leadHasEmail: false }), "handover");
    assert.equal(atZeroRoute({ ...base, origin: "agent", mailboxConnected: false }), "handover");
    assert.equal(atZeroRoute({ ...base, origin: "agent", emailSuppressed: true }), "handover");
  });

  test("an opted-out lead is neither emailed nor queued for a person", () => {
    assert.equal(atZeroRoute({ ...base, origin: "agent", optedOut: true }), "none");
    assert.equal(atZeroRoute({ ...base, origin: "automation", optedOut: true }), "none");
  });

  test("texts a person types, campaigns and system sends are simply refused", () => {
    for (const origin of ["manual", "campaign", "system"]) {
      assert.equal(atZeroRoute({ ...base, origin }), "none", origin);
    }
  });
});

describe("no credit purchases during a trial (owner, 2026-09-27)", async () => {
  const { readFileSync } = await import("node:fs");
  const { creditPurchaseAllowed, TRIAL_CREDIT_PURCHASE_REFUSAL } = await import("../src/lib/billing/plans.ts");

  test("the rule: a trial cannot buy packs, every paid plan can", () => {
    assert.equal(creditPurchaseAllowed("trial"), false);
    for (const plan of ["starter", "growth", "pro", "enterprise"]) {
      assert.equal(creditPurchaseAllowed(plan), true, plan);
    }
    assert.match(TRIAL_CREDIT_PURCHASE_REFUSAL, /Upgrade now/);
  });

  test("enforced server-side in createCreditCheckout, before any purchase row or Stripe call", () => {
    const checkout = readFileSync("src/lib/billing/checkout.ts", "utf8");
    const fn = checkout.slice(checkout.indexOf("export async function createCreditCheckout"));
    const guard = fn.indexOf("if (!creditPurchaseAllowed(plan))");
    assert.ok(guard > 0, "guard present");
    assert.ok(guard < fn.indexOf("message_credit_purchases"), "guard before the purchase row");
    assert.ok(guard < fn.indexOf("checkout.sessions.create"), "guard before Stripe");
  });

  test("the UI mirrors it: no Buy buttons in a trial", () => {
    const panel = readFileSync("src/components/settings/billing/limits-panel.tsx", "utf8");
    assert.match(panel, /\(trial \? \[\] : creditBundlesFor\(\{ whatsappEnabled \}\)\)/);
    const section = readFileSync("src/app/(app)/app/settings/_sections/billing-section.tsx", "utf8");
    assert.match(section, /trial=\{limits\.plan === "trial"\}/);
  });
});
