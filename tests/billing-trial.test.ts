import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DAY_MS,
  GRACE_FULL_ACCESS_DAYS,
  MAX_DUNNING_ATTEMPTS,
  accessFor,
  deriveEntitlements,
  dunningDecision,
  dunningNoticeFor,
  exhaustedAfter,
  lifecycleState,
  needsCheckout,
  trialOffer,
  type DunningLike,
  type SubscriptionRowLike,
} from "../src/lib/billing/lifecycle.ts";
import { attemptInvoiceCharge, dunningIdempotencyKey } from "../src/lib/billing/dunning-core.ts";
import { PLANS, TRIAL, TRIAL_DAYS, TRIAL_ENTITLEMENTS, allowancesFor } from "../src/lib/billing/plans.ts";
import { AI_TOKEN_ALLOWANCE } from "../src/lib/billing/tokens.ts";

const NOW = new Date("2026-09-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS).toISOString();

function row(over: Partial<SubscriptionRowLike> = {}): SubscriptionRowLike {
  return {
    plan: "growth",
    status: "ACTIVE",
    trial_ends_at: null,
    stripe_subscription_id: "sub_1",
    current_period_start: days(-10),
    current_period_end: days(20),
    lead_limit: PLANS.growth.leadLimit,
    user_limit: PLANS.growth.userLimit,
    whatsapp_enabled: true,
    campaigns_enabled: true,
    ai_assist_allowed: true,
    ...over,
  };
}

function dunning(over: Partial<DunningLike> = {}): DunningLike {
  return { status: "OPEN", first_failed_at: days(-1), attempts: 0, last_attempt_on: null, ...over };
}

describe("trial is defined once", () => {
  test("TRIAL is the single source and its aliases agree", () => {
    assert.equal(TRIAL_DAYS, TRIAL.days);
    assert.equal(TRIAL_ENTITLEMENTS, TRIAL);
    assert.equal(allowancesFor("trial").leadLimit, TRIAL.leadLimit);
    assert.equal(allowancesFor("trial").aiAssistAllowed, TRIAL.aiAssistAllowed);
  });

  test("AI allowance per plan derives from plans.ts", () => {
    assert.equal(AI_TOKEN_ALLOWANCE.trial, TRIAL.aiTokenAllowance);
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal(AI_TOKEN_ALLOWANCE[plan], PLANS[plan].aiTokenAllowance);
    }
  });

  test("the 0129 seed matches plans.ts for AI tokens, SMS and WhatsApp", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "0129_billing_trial_dunning_credits.sql"),
      "utf8",
    );
    const seeded = (plan: string, metric: string) => {
      const match = sql.match(new RegExp(`\\('${plan}',\\s*'${metric}',\\s*\\d+,\\s*(\\d+),`));
      assert.ok(match, `${plan}/${metric} seeded`);
      return Number(match[1]);
    };
    assert.equal(seeded("trial", "ai_tokens"), TRIAL.aiTokenAllowance);
    assert.equal(seeded("trial", "sms_outbound_segment"), TRIAL.smsSegmentAllowance);
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal(seeded(plan, "ai_tokens"), PLANS[plan].aiTokenAllowance);
      assert.equal(seeded(plan, "sms_outbound_segment"), PLANS[plan].smsSegmentAllowance);
      assert.equal(seeded(plan, "whatsapp_message"), PLANS[plan].whatsappMessageAllowance);
    }
  });
});

describe("trial state machine", () => {
  test("a workspace that has not been through Checkout is not usable", () => {
    assert.equal(lifecycleState(null, null, NOW), "AWAITING_CARD");
    const signup = row({ plan: "trial", status: "INCOMPLETE", stripe_subscription_id: null });
    assert.equal(lifecycleState(signup, null, NOW), "AWAITING_CARD");
    assert.equal(needsCheckout("AWAITING_CARD"), true);
    assert.equal(deriveEntitlements(signup, null, NOW).active, false);
  });

  test("a Stripe trial is usable, with trial limits whatever tier was chosen", () => {
    const trialing = row({ status: "TRIALING", trial_ends_at: days(10) });
    const e = deriveEntitlements(trialing, null, NOW);
    assert.equal(e.state, "TRIALING");
    assert.equal(e.active, true);
    assert.equal(e.plan, "trial");
    assert.equal(e.selectedPlan, "growth");
    assert.equal(e.leadLimit, TRIAL.leadLimit);
    assert.equal(e.whatsappEnabled, TRIAL.whatsappEnabled);
    assert.equal(e.aiAssistAllowed, TRIAL.aiAssistAllowed);
  });

  test("getEntitlements respects trial_ends_at for a legacy app-local trial", () => {
    const legacy = row({ plan: "trial", status: "TRIALING", stripe_subscription_id: null });
    assert.equal(lifecycleState({ ...legacy, trial_ends_at: days(2) }, null, NOW), "TRIALING");
    assert.equal(lifecycleState({ ...legacy, trial_ends_at: days(-1) }, null, NOW), "TRIAL_EXPIRED");
    assert.equal(lifecycleState({ ...legacy, trial_ends_at: null }, null, NOW), "TRIAL_EXPIRED");
    assert.equal(deriveEntitlements({ ...legacy, trial_ends_at: days(-1) }, null, NOW).active, false);
  });

  test("a Stripe trial whose conversion webhook was lost does not trial forever", () => {
    const stale = row({ status: "TRIALING", trial_ends_at: days(-4) });
    assert.equal(lifecycleState(stale, null, NOW), "TRIAL_EXPIRED");
    assert.equal(lifecycleState({ ...stale, trial_ends_at: days(-1) }, null, NOW), "TRIALING");
  });

  test("paid, cancelled and incomplete map to the right access", () => {
    assert.equal(accessFor(lifecycleState(row(), null, NOW)), "full");
    assert.equal(accessFor(lifecycleState(row({ status: "CANCELLED" }), null, NOW)), "read_only");
    assert.equal(lifecycleState(row({ status: "INCOMPLETE" }), null, NOW), "AWAITING_CARD");
  });

  test("trial offer: full trial once, remaining days for legacy, none after", () => {
    assert.deepEqual(trialOffer(null, NOW), { kind: "trial_days", days: TRIAL.days });
    assert.deepEqual(
      trialOffer(row({ status: "INCOMPLETE", stripe_subscription_id: null, plan: "trial" }), NOW),
      { kind: "trial_days", days: TRIAL.days },
    );
    assert.deepEqual(trialOffer(row({ status: "CANCELLED" }), NOW), { kind: "none", reason: "trial_used" });
    const legacy = row({ plan: "trial", status: "TRIALING", stripe_subscription_id: null });
    assert.deepEqual(trialOffer({ ...legacy, trial_ends_at: days(5.5) }, NOW), { kind: "trial_days", days: 6 });
    assert.deepEqual(trialOffer({ ...legacy, trial_ends_at: days(0.1) }, NOW), { kind: "trial_days", days: 1 });
    assert.deepEqual(trialOffer({ ...legacy, trial_ends_at: days(-2) }, NOW), {
      kind: "none",
      reason: "legacy_trial_expired",
    });
  });
});

describe("grace policy", () => {
  test("full access for the first three days, then sending and AI pause", () => {
    const pastDue = row({ status: "PAST_DUE" });
    for (let day = 0; day < GRACE_FULL_ACCESS_DAYS; day += 1) {
      const e = deriveEntitlements(pastDue, dunning({ first_failed_at: days(-day) }), NOW);
      assert.equal(e.state, "PAST_DUE_GRACE", `day ${day}`);
      assert.equal(e.active, true);
      assert.equal(e.sendingAllowed, true);
    }
    const paused = deriveEntitlements(pastDue, dunning({ first_failed_at: days(-GRACE_FULL_ACCESS_DAYS) }), NOW);
    assert.equal(paused.state, "PAST_DUE_RESTRICTED");
    assert.equal(paused.access, "restricted");
    assert.equal(paused.sendingAllowed, false);
    assert.equal(paused.aiAssistAllowed, false);
  });

  test("an exhausted dunning record reads as cancelled (read-only)", () => {
    const e = deriveEntitlements(row({ status: "PAST_DUE" }), dunning({ status: "EXHAUSTED" }), NOW);
    assert.equal(e.state, "CANCELLED");
    assert.equal(e.access, "read_only");
  });

  test("PAST_DUE with no dunning row yet is inside the grace window", () => {
    assert.equal(lifecycleState(row({ status: "PAST_DUE" }), null, NOW), "PAST_DUE_GRACE");
  });
});

describe("dunning schedule", () => {
  test("never retries on the day of the first failure (Stripe's own attempt is day 0)", () => {
    assert.deepEqual(dunningDecision(dunning({ first_failed_at: NOW.toISOString() }), NOW), {
      action: "wait",
      reason: "failed_today",
    });
  });

  test("retries once a day and is idempotent within the day", () => {
    const first = dunningDecision(dunning(), NOW);
    assert.deepEqual(first, { action: "retry", attemptNumber: 1 });
    const same = dunningDecision(dunning({ attempts: 1, last_attempt_on: "2026-09-26" }), NOW);
    assert.deepEqual(same, { action: "wait", reason: "already_attempted_today" });
    const next = dunningDecision(
      dunning({ attempts: 1, last_attempt_on: "2026-09-26" }),
      new Date(NOW.getTime() + DAY_MS),
    );
    assert.deepEqual(next, { action: "retry", attemptNumber: 2 });
  });

  test("simulated 30 days of failures: exactly 30 retries, then exhausted", () => {
    const record = dunning({ first_failed_at: NOW.toISOString() });
    let retries = 0;
    let outcome: string | null = null;
    for (let day = 0; day <= 40 && !outcome; day += 1) {
      const at = new Date(NOW.getTime() + day * DAY_MS);
      // A second run on the same day must never retry again.
      for (let run = 0; run < 2; run += 1) {
        const decision = dunningDecision(record, at);
        if (decision.action === "exhaust") {
          outcome = "exhausted";
          break;
        }
        if (decision.action !== "retry") continue;
        retries += 1;
        record.attempts += 1;
        record.last_attempt_on = at.toISOString().slice(0, 10);
        if (exhaustedAfter(record.attempts)) {
          outcome = "exhausted";
          break;
        }
      }
    }
    assert.equal(outcome, "exhausted");
    assert.equal(retries, MAX_DUNNING_ATTEMPTS);
  });

  test("stops immediately once paid", () => {
    const record = dunning({ first_failed_at: NOW.toISOString() });
    let retries = 0;
    for (let day = 1; day <= 30; day += 1) {
      const decision = dunningDecision(record, new Date(NOW.getTime() + day * DAY_MS));
      if (decision.action !== "retry") continue;
      retries += 1;
      record.attempts += 1;
      if (day === 4) record.status = "RECOVERED"; // the 4th retry succeeded
    }
    assert.equal(retries, 4);
    assert.deepEqual(dunningDecision(record, new Date(NOW.getTime() + 5 * DAY_MS)), {
      action: "stop",
      reason: "not_open",
    });
  });

  test("a window that elapsed while the job was not running is exhausted, not retried", () => {
    const decision = dunningDecision(dunning({ first_failed_at: days(-31), attempts: 3 }), NOW);
    assert.deepEqual(decision, { action: "exhaust", reason: "window_elapsed" });
  });

  test("notices: restricted on day 3, final warning from day 25", () => {
    assert.equal(dunningNoticeFor(new Date(days(-1)), NOW), null);
    assert.equal(dunningNoticeFor(new Date(days(-3)), NOW), "restricted");
    assert.equal(dunningNoticeFor(new Date(days(-25)), NOW), "final_warning");
  });
});

describe("one retry against Stripe (fake client)", () => {
  function fake(status: string, payResult: "paid" | "declined") {
    const calls: { id: string; key?: string }[] = [];
    return {
      calls,
      client: {
        invoices: {
          retrieve: async () => ({ id: "in_1", status }),
          pay: async (id: string, _params?: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
            calls.push({ id, key: options?.idempotencyKey });
            if (payResult === "declined") {
              throw Object.assign(new Error("Your card has insufficient funds."), { decline_code: "insufficient_funds" });
            }
            return { id, status: "paid" };
          },
        },
      },
    };
  }

  test("an already-paid invoice is not charged again", async () => {
    const f = fake("paid", "paid");
    assert.deepEqual(await attemptInvoiceCharge(f.client, "in_1", "2026-09-26"), { outcome: "paid", alreadyPaid: true });
    assert.equal(f.calls.length, 0);
  });

  test("a void invoice closes dunning without a charge", async () => {
    const f = fake("void", "paid");
    assert.deepEqual(await attemptInvoiceCharge(f.client, "in_1", "2026-09-26"), {
      outcome: "closed",
      invoiceStatus: "void",
    });
    assert.equal(f.calls.length, 0);
  });

  test("the charge carries a per-invoice, per-day idempotency key", async () => {
    const f = fake("open", "paid");
    await attemptInvoiceCharge(f.client, "in_1", "2026-09-26");
    assert.equal(f.calls[0].key, dunningIdempotencyKey("in_1", "2026-09-26"));
    assert.notEqual(dunningIdempotencyKey("in_1", "2026-09-26"), dunningIdempotencyKey("in_1", "2026-09-27"));
  });

  test("a decline is reported with its code, not thrown", async () => {
    const f = fake("open", "declined");
    const result = await attemptInvoiceCharge(f.client, "in_1", "2026-09-26");
    assert.equal(result.outcome, "failed");
    assert.equal(result.outcome === "failed" && result.declineCode, "insufficient_funds");
  });
});
