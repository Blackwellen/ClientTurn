import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aiPurchasedRemaining,
  attributeUnusedCredit,
  refundReversalAmount,
  REFUND_STATE_LABEL,
  TOP_UP_REFUND_NOTICE,
  type TopUpPurchaseInput,
} from "../src/lib/billing/refundability.ts";

/**
 * Owner policy 2026-09-27: top-up credit (SMS/WhatsApp bundles, AI token
 * packs) is non-refundable once usage begins. FIFO attribution, and a refund
 * reverses only the unused credit, never below zero, idempotently.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function purchase(id: string, credits: number, day: number, extra: Partial<TopUpPurchaseInput> = {}): TopUpPurchaseInput {
  const at = `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  return { id, credits, status: "PAID", createdAt: at, creditedAt: at, ...extra };
}

describe("FIFO refundability: the oldest purchase is consumed first", () => {
  const three = [purchase("a", 100, 1), purchase("b", 200, 5), purchase("c", 300, 10)];

  test("nothing used: every purchase is refundable", () => {
    const result = attributeUnusedCredit(three, 600);
    for (const id of ["a", "b", "c"]) {
      assert.equal(result.get(id)?.refundable, true);
      assert.equal(result.get(id)?.state, "refundable");
    }
    assert.equal(result.get("c")?.unused, 300);
  });

  test("partial use lands on the oldest purchase only", () => {
    // 40 of 600 used: all of it from "a".
    const result = attributeUnusedCredit(three, 560);
    assert.deepEqual(
      [result.get("a")?.state, result.get("a")?.unused, result.get("a")?.used],
      ["in_use", 60, 40],
    );
    assert.equal(result.get("b")?.refundable, true);
    assert.equal(result.get("c")?.refundable, true);
  });

  test("use spills from a fully used purchase into the next", () => {
    // 150 used: "a" fully used, "b" 50 used, "c" untouched.
    const result = attributeUnusedCredit(three, 450);
    assert.deepEqual([result.get("a")?.unused, result.get("a")?.used], [0, 100]);
    assert.deepEqual([result.get("b")?.unused, result.get("b")?.used, result.get("b")?.refundable], [150, 50, false]);
    assert.equal(result.get("c")?.refundable, true);
  });

  test("an empty pool: every purchase fully used, none refundable", () => {
    const result = attributeUnusedCredit(three, 0);
    for (const id of ["a", "b", "c"]) {
      assert.equal(result.get(id)?.refundable, false);
      assert.equal(result.get(id)?.unused, 0);
    }
  });

  test("order is by when the credit entered the pool, not by array order", () => {
    const shuffled = [three[2], three[0], three[1]];
    assert.deepEqual(attributeUnusedCredit(shuffled, 450), attributeUnusedCredit(three, 450));
  });

  test("a refunded purchase is shown refunded and only its net credit is attributed", () => {
    // "b" was refunded while unused; its 200 were reversed out of the pool.
    const withRefund = [
      purchase("a", 100, 1),
      purchase("b", 200, 5, { status: "REFUNDED", reversed: 200 }),
      purchase("c", 300, 10),
    ];
    const result = attributeUnusedCredit(withRefund, 380);
    assert.equal(result.get("b")?.state, "refunded");
    assert.equal(result.get("b")?.refundable, false);
    assert.equal(result.get("b")?.unused, 0);
    // 20 used, from the oldest ("a"); "c" untouched.
    assert.deepEqual([result.get("a")?.used, result.get("a")?.refundable], [20, false]);
    assert.equal(result.get("c")?.refundable, true);
  });

  test("uncredited and failed purchases never take pool credit", () => {
    const result = attributeUnusedCredit(
      [purchase("a", 100, 1), purchase("p", 500, 20, { creditedAt: null }), purchase("f", 50, 21, { status: "FAILED", creditedAt: null })],
      100,
    );
    assert.equal(result.get("a")?.refundable, true);
    assert.equal(result.get("p")?.state, "not_credited");
    assert.equal(result.get("f")?.refundable, false);
  });

  test("labels", () => {
    assert.equal(REFUND_STATE_LABEL.refundable, "Refundable");
    assert.equal(REFUND_STATE_LABEL.in_use, "Non-refundable (credit in use)");
    assert.equal(TOP_UP_REFUND_NOTICE, "Non-refundable once any credit is used.");
  });
});

describe("refund reversal: unused credit only, never below zero, idempotent", () => {
  const base = { credits: 1000, amountMinor: 2500, alreadyReversed: 0 };

  test("a full refund of an unused purchase reverses all of it", () => {
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 1000, pool: 1000 }), 1000);
  });

  test("a full refund of a partly used purchase reverses only the unused part", () => {
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 300, pool: 300 }), 300);
  });

  test("a fully used purchase reverses nothing", () => {
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 0, pool: 0 }), 0);
  });

  test("never more than the pool, so the balance never goes negative", () => {
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 1000, pool: 400 }), 400);
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 1000, pool: -5 }), 0);
  });

  test("a partial refund reverses a proportionate share, capped at unused", () => {
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 1250, unused: 1000, pool: 1000 }), 500);
    assert.equal(refundReversalAmount({ ...base, amountRefundedMinor: 1250, unused: 200, pool: 200 }), 200);
  });

  test("replaying the same cumulative refund reverses nothing more", () => {
    const first = refundReversalAmount({ ...base, amountRefundedMinor: 2500, unused: 1000, pool: 1000 });
    const replay = refundReversalAmount({
      ...base,
      amountRefundedMinor: 2500,
      alreadyReversed: first,
      unused: 0,
      pool: 0,
    });
    assert.equal(replay, 0);
  });

  test("a second partial refund reverses only the difference", () => {
    const first = refundReversalAmount({ ...base, amountRefundedMinor: 1000, unused: 1000, pool: 1000 });
    assert.equal(first, 400);
    const second = refundReversalAmount({
      ...base,
      amountRefundedMinor: 2500,
      alreadyReversed: first,
      unused: 600,
      pool: 600,
    });
    assert.equal(second, 600);
  });
});

describe("AI purchased pool: included tokens are used first", () => {
  test("inside the included grant, the purchased pool is untouched", () => {
    assert.equal(aiPurchasedRemaining({ includedTokens: 1000, purchasedTokens: 500, usedTokens: 400, reservedTokens: 0 }), 500);
  });
  test("past the included grant, purchased tokens are being spent", () => {
    assert.equal(aiPurchasedRemaining({ includedTokens: 1000, purchasedTokens: 500, usedTokens: 1200, reservedTokens: 0 }), 300);
  });
  test("reserved tokens count as in use; never below zero", () => {
    assert.equal(aiPurchasedRemaining({ includedTokens: 1000, purchasedTokens: 500, usedTokens: 1200, reservedTokens: 100 }), 200);
    assert.equal(aiPurchasedRemaining({ includedTokens: 1000, purchasedTokens: 500, usedTokens: 1700, reservedTokens: 0 }), 0);
  });
});

describe("the policy is wired end to end", () => {
  test("the notice sits next to the Buy buttons", () => {
    assert.match(read("src/components/settings/ai-token-meter.tsx"), /Non-refundable once any credit is used\./);
    // The panel renders the one constant (refundability.ts) under the Message
    // credits Buy buttons and under the upsell / recommended-pack buttons.
    const panel = read("src/components/settings/billing/limits-panel.tsx");
    assert.match(panel, /import \{[^}]*TOP_UP_REFUND_NOTICE[^}]*\} from "@\/lib\/billing\/refundability"/);
    assert.ok((panel.match(/\{TOP_UP_REFUND_NOTICE\}/g) ?? []).length >= 2);
  });

  test("the terms state the top-up clause", () => {
    const terms = read("src/app/(marketing)/terms/page.tsx");
    assert.match(terms, /9\.9 Top-up credit/);
    assert.match(terms, /prepaid and does not expire/);
    assert.match(terms, /once any credit\s+from a purchase has been used, that purchase is non-refundable/);
    assert.match(terms, /no cash value and cannot be transferred/);
  });

  test("top-up checkouts require the terms and record acceptance as top_up", () => {
    const checkout = read("src/lib/billing/checkout.ts");
    assert.match(checkout, /consent_collection: \{ terms_of_service: "required" \}/);
    assert.match(checkout, /Non-refundable once any credit is used\./);
    assert.match(read("src/lib/billing/token-actions.ts"), /topUpCheckoutTerms\(/);
    assert.match(read("src/lib/billing/terms-acceptance.ts"), /source: "top_up"/);
  });

  test("a refund queues the reversal job; the job and RPCs exist", () => {
    const route = read("src/app/api/webhooks/stripe/route.ts");
    assert.match(route, /"charge\.refunded"/);
    assert.match(route, /enqueue\(\s*"billing\.refund_reverse"/);
    assert.match(read("src/lib/billing/message-credits.ts"), /enqueue\(\s*"billing\.refund_reverse"/);
    assert.match(read("src/lib/jobs/register.ts"), /registerHandler\("billing\.refund_reverse"/);
    const sql = read("supabase/migrations/0142_top_up_refund_policy.sql");
    assert.match(sql, /function public\.reverse_message_credit_purchase/);
    assert.match(sql, /function public\.reverse_ai_token_purchase/);
    assert.match(sql, /'signup', 'checkout', 'top_up'/);
  });
});
