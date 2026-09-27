import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LEGACY_WHATSAPP_CREDIT_PRICE_PENCE,
  TOKENS_PER_LEGACY_WHATSAPP_CREDIT,
  WHATSAPP_TOKEN_NATURE,
  WHATSAPP_TOKEN_PACKS,
  WHATSAPP_TOKENS_PER_MESSAGE,
  legacyWhatsappCreditsToTokens,
  whatsappBillingCategory,
  whatsappCoverageText,
  whatsappTokenCoverage,
  whatsappTokensFor,
} from "../src/lib/billing/whatsapp-tokens.ts";
import {
  MESSAGE_CREDIT_BUNDLES,
  allowancesFor,
  creditBundlesFor,
  creditPurchaseAllowed,
} from "../src/lib/billing/plans.ts";
import { splitConsumption } from "../src/lib/billing/limits.ts";
import {
  allowanceAlertFor,
  crossedThreshold,
  type AllowanceAlertInput,
} from "../src/lib/billing/allowance-alerts.ts";
import {
  attributeUnusedCredit,
  refundReversalAmount,
  type TopUpPurchaseInput,
} from "../src/lib/billing/refundability.ts";
import {
  WHATSAPP_MIN_MARKUP_ON_COST,
  whatsappAllInCost,
  whatsappMessageEconomics,
} from "../src/lib/billing/unit-costs.ts";
import { whatsappPricing } from "../src/lib/admin/economics-model.ts";

/**
 * WhatsApp tokens (owner, 2026-09-27): "we must be competitive with WhatsApp
 * specialists", and bought as non-monetary TOKENS, never a £ balance. Each
 * message spends tokens by Meta category; unknown = marketing; migration 0148
 * converts old message credits at no loss; refunds reverse only unused tokens
 * (FIFO); alerts speak tokens and replies; nothing is sold in a trial.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const WHATSAPP_PACKS = MESSAGE_CREDIT_BUNDLES.filter((bundle) => bundle.channel === "whatsapp");

describe("category pricing", () => {
  test("a reply or utility template is 2 tokens, marketing 5", () => {
    assert.equal(whatsappTokensFor("SERVICE"), 2);
    assert.equal(whatsappTokensFor("UTILITY"), 2);
    assert.equal(whatsappTokensFor("AUTHENTICATION"), 2);
    assert.equal(whatsappTokensFor("MARKETING"), 5);
    assert.deepEqual(WHATSAPP_TOKENS_PER_MESSAGE, { SERVICE: 2, UTILITY: 2, AUTHENTICATION: 2, MARKETING: 5 });
  });

  test("no template is a free-form reply in the 24h window: service", () => {
    assert.equal(whatsappBillingCategory({ template: false }), "SERVICE");
    // A stray category on a non-template send does not make it dearer or cheaper.
    assert.equal(whatsappBillingCategory({ template: false, templateCategory: "MARKETING" }), "SERVICE");
  });

  test("a template is charged at its category", () => {
    assert.equal(whatsappBillingCategory({ template: true, templateCategory: "UTILITY" }), "UTILITY");
    assert.equal(whatsappBillingCategory({ template: true, templateCategory: " utility " }), "UTILITY");
    assert.equal(whatsappBillingCategory({ template: true, templateCategory: "MARKETING" }), "MARKETING");
    assert.equal(whatsappBillingCategory({ template: true, templateCategory: "AUTHENTICATION" }), "AUTHENTICATION");
  });

  test("an unknown or missing template category is charged at the marketing rate", () => {
    for (const odd of ["PROMOTIONAL", "", null, undefined, 42, "SERVICE"]) {
      const category = whatsappBillingCategory({ template: true, templateCategory: odd });
      assert.equal(category, "MARKETING", String(odd));
      assert.equal(whatsappTokensFor(category), 5);
    }
  });

  test("the owner's target prices: 4p a reply or utility template, 10p a marketing template", () => {
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      assert.equal(pack.priceGbp / pack.tokens, 0.02, "every pack is 2p a token");
      assert.ok(Math.abs(whatsappMessageEconomics(pack, "SERVICE").priceGbp - 0.04) < 1e-9);
      assert.ok(Math.abs(whatsappMessageEconomics(pack, "UTILITY").priceGbp - 0.04) < 1e-9);
      assert.ok(Math.abs(whatsappMessageEconomics(pack, "AUTHENTICATION").priceGbp - 0.04) < 1e-9);
      assert.ok(Math.abs(whatsappMessageEconomics(pack, "MARKETING").priceGbp - 0.1) < 1e-9);
    }
  });

  test("margins after Stripe on the Twilio route: ~39-40% on a reply, ~41-42% on marketing", () => {
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      const service = whatsappMessageEconomics(pack, "SERVICE").margin;
      const marketing = whatsappMessageEconomics(pack, "MARKETING").margin;
      assert.ok(service > 0.39 && service < 0.4, `${pack.tokens} service ${(service * 100).toFixed(1)}%`);
      assert.ok(marketing > 0.41 && marketing < 0.43, `${pack.tokens} marketing ${(marketing * 100).toFixed(1)}%`);
    }
  });

  test("every category and pack clears the floor: kept after Stripe >= cost + 25%", () => {
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      for (const category of ["SERVICE", "UTILITY", "AUTHENTICATION", "MARKETING"] as const) {
        const e = whatsappMessageEconomics(pack, category);
        assert.ok(e.markupOnCost >= WHATSAPP_MIN_MARKUP_ON_COST, `${pack.tokens} ${category}: ×${e.markupOnCost.toFixed(3)}`);
        assert.ok(e.markupOnCost >= 1.7, `${pack.tokens} ${category}: ×${e.markupOnCost.toFixed(3)}`);
      }
    }
    // Cost is the Twilio route, the dearer one: marketing > utility.
    assert.ok(whatsappAllInCost("MARKETING") > whatsappAllInCost("UTILITY"));
  });

  test("the admin economics model prices WhatsApp with the same tokens and costs", () => {
    const rows = whatsappPricing();
    assert.equal(rows.length, WHATSAPP_TOKEN_PACKS.length * 3);
    for (const row of rows) {
      const same = whatsappMessageEconomics(row.pack, row.category);
      assert.equal(row.tokens, whatsappTokensFor(row.category));
      assert.equal(row.priceGbp, same.priceGbp);
      assert.equal(row.costGbp, same.costGbp);
      assert.equal(row.aboveFloor, true);
    }
  });
});

describe("packs are tokens, never money", () => {
  test("the catalogue sells WhatsApp token packs of 1,000 / 2,000 / 5,000 for £20 / £40 / £100", () => {
    assert.deepEqual(
      WHATSAPP_PACKS.map((bundle) => [bundle.key, bundle.credits, bundle.priceGbp]),
      [
        ["whatsapp_tokens_1000", 1000, 20],
        ["whatsapp_tokens_2000", 2000, 40],
        ["whatsapp_tokens_5000", 5000, 100],
      ],
    );
  });

  test("each pack says roughly what it covers", () => {
    assert.deepEqual(whatsappTokenCoverage(1000), { replies: 500, marketing: 200 });
    assert.equal(whatsappCoverageText(1000), "about 500 conversation replies or 200 marketing messages");
    assert.equal(whatsappCoverageText(5000), "about 2,500 conversation replies or 1,000 marketing messages");
  });

  test("the nature of a token is stated plainly", () => {
    assert.match(WHATSAPP_TOKEN_NATURE, /no cash value/);
    assert.match(WHATSAPP_TOKEN_NATURE, /cannot be exchanged or transferred/);
    assert.match(WHATSAPP_TOKEN_NATURE, /non-refundable once any of its tokens are used/);
  });

  test("checkout and terms word WhatsApp as tokens, never as credit", () => {
    const checkout = read("src/lib/billing/checkout.ts");
    assert.match(checkout, /"WhatsApp tokens"/);
    assert.doesNotMatch(checkout, /WhatsApp message credits/);
    assert.match(checkout, /topUpCheckoutTerms\(site, bundle\.channel === "whatsapp" \? "whatsapp_tokens" : "credit"\)/);
    assert.match(checkout, /WhatsApp tokens have no cash value, cannot be exchanged or transferred/);
    const terms = read("src/app/(marketing)/terms/page.tsx");
    assert.match(terms, /9\.9 Top-up credit/);
    assert.match(terms, /WhatsApp tokens have no cash value/);
  });

  test("no customer surface still quotes 27p or WhatsApp credit", () => {
    for (const file of [
      "src/app/(marketing)/pricing/page.tsx",
      "src/components/marketing/public/pricing/comparison.tsx",
      "src/components/marketing/public/pricing/plan-grid.tsx",
      "src/components/settings/billing/limits-panel.tsx",
      "content/help/billing/top-up-credits.md",
      "content/help/billing/plans-and-pricing.md",
      "content/help/billing/usage-and-limits.md",
      "content/help/integrations/connecting-twilio-sms-and-whatsapp.md",
      "content/help/faq/faq.md",
    ]) {
      const text = read(file);
      assert.doesNotMatch(text, /27p|WhatsApp credit\b/, file);
    }
  });
});

describe("balance deduction", () => {
  test("a message is sent only when the balance covers its category's tokens", () => {
    const service = splitConsumption({ quantity: whatsappTokensFor("SERVICE"), allowance: 0, usedThisPeriod: 0, creditBalance: 4 });
    assert.deepEqual([service.allowed, service.fromCredits], [true, 2]);
    const marketing = splitConsumption({ quantity: whatsappTokensFor("MARKETING"), allowance: 0, usedThisPeriod: 0, creditBalance: 4 });
    assert.deepEqual([marketing.allowed, marketing.refusal, marketing.fromCredits], [false, "LIMIT_REACHED", 4]);
    const exact = splitConsumption({ quantity: 5, allowance: 0, usedThisPeriod: 0, creditBalance: 5 });
    assert.deepEqual([exact.allowed, exact.fromCredits], [true, 5]);
  });

  test("the gate and the meter price by category and the usage ledger still counts messages", () => {
    const service = read("src/lib/billing/limits-service.ts");
    assert.match(service, /whatsappTokensFor\(whatsappCategory\)/);
    assert.match(service, /quantity: channel === "whatsapp" \? 1 : units/);
    assert.match(service, /whatsapp_tokens: units/);
    const store = read("src/lib/jobs/handlers/send-store.ts");
    assert.match(store, /whatsappTemplateId: message\.channel === "whatsapp" \? \(message\.queuedTemplate\?\.templateId \?\? null\) : null/);
    assert.match(store, /whatsappTemplate: message\.template \? \{ category: message\.template\.category \} : null/);
  });
});

describe("existing WhatsApp credit converts to tokens at no loss (migration 0148)", () => {
  test("one old 27p credit is 14 tokens (28p), worth at least 27p at the pack rate", () => {
    assert.equal(TOKENS_PER_LEGACY_WHATSAPP_CREDIT, 14);
    const perTokenPence = (WHATSAPP_TOKEN_PACKS[0].priceGbp * 100) / WHATSAPP_TOKEN_PACKS[0].tokens;
    assert.ok(TOKENS_PER_LEGACY_WHATSAPP_CREDIT * perTokenPence >= LEGACY_WHATSAPP_CREDIT_PRICE_PENCE);
    // And the old credit still buys at least one message of the dearest kind.
    assert.ok(TOKENS_PER_LEGACY_WHATSAPP_CREDIT >= WHATSAPP_TOKENS_PER_MESSAGE.MARKETING);
    assert.equal(legacyWhatsappCreditsToTokens(250), 3500);
    assert.equal(legacyWhatsappCreditsToTokens(0), 0);
    assert.equal(legacyWhatsappCreditsToTokens(-3), 0);
  });

  test("the migration converts balances, purchases and the ledger once, at the same rate", () => {
    const sql = read("supabase/migrations/0148_whatsapp_tokens.sql");
    assert.match(sql, /^-- 0148_whatsapp_tokens/);
    assert.match(sql, new RegExp(`tokens_per_credit constant integer := ${TOKENS_PER_LEGACY_WHATSAPP_CREDIT};`));
    assert.match(sql, /on conflict \(key\) do nothing\s+returning key into applied/);
    assert.match(sql, /set balance = balance \* tokens_per_credit/);
    assert.match(sql, /set credits = credits \* tokens_per_credit,\s+credits_reversed = credits_reversed \* tokens_per_credit/);
    assert.match(sql, /set delta = delta \* tokens_per_credit,\s+balance_after = balance_after \* tokens_per_credit/);
    for (const statement of sql.match(/update public\.message_credit_\w+[\s\S]*?;/g) ?? []) {
      assert.match(statement, /where channel = 'whatsapp'/, statement);
    }
    assert.match(sql, /enable row level security/);
  });
});

describe("refund reversal in tokens", () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  const pack = (id: string, tokens: number, day: number, extra: Partial<TopUpPurchaseInput> = {}): TopUpPurchaseInput => ({
    id,
    credits: tokens,
    status: "PAID",
    createdAt: at(day),
    creditedAt: at(day),
    ...extra,
  });

  test("a converted legacy purchase and a new pack share one token pool, oldest first", () => {
    // 250 old credits -> 3,500 tokens (0148), then a 1,000-token pack.
    const purchases = [pack("legacy", legacyWhatsappCreditsToTokens(250), 1), pack("new", 1000, 5)];
    // 1,300 tokens left: the new pack is untouched, the legacy one is in use.
    const result = attributeUnusedCredit(purchases, 1300);
    assert.deepEqual(result.get("new"), { id: "new", state: "refundable", refundable: true, unused: 1000, used: 0 });
    assert.equal(result.get("legacy")?.state, "in_use");
    assert.equal(result.get("legacy")?.unused, 300);
  });

  test("a full refund of a pack with tokens used reverses only its unused tokens", () => {
    const purchases = [pack("p", 1000, 1)];
    const unused = attributeUnusedCredit(purchases, 600).get("p")!.unused;
    assert.equal(unused, 600);
    assert.equal(
      refundReversalAmount({ credits: 1000, amountMinor: 2000, amountRefundedMinor: 2000, unused, alreadyReversed: 0, pool: 600 }),
      600,
    );
  });

  test("a partial refund reverses a proportionate share of tokens, never more than unused, never below zero", () => {
    assert.equal(
      refundReversalAmount({ credits: 2000, amountMinor: 4000, amountRefundedMinor: 2000, unused: 2000, alreadyReversed: 0, pool: 2000 }),
      1000,
    );
    assert.equal(
      refundReversalAmount({ credits: 2000, amountMinor: 4000, amountRefundedMinor: 2000, unused: 300, alreadyReversed: 0, pool: 300 }),
      300,
    );
    // Replayed: nothing more.
    assert.equal(
      refundReversalAmount({ credits: 2000, amountMinor: 4000, amountRefundedMinor: 2000, unused: 1000, alreadyReversed: 1000, pool: 1000 }),
      0,
    );
  });

  test("the SQL reversal is unit-agnostic, so 0148 leaves it as 0142 defined it", () => {
    const sql = read("supabase/migrations/0142_top_up_refund_policy.sql");
    assert.match(sql, /floor\(p\.credits::numeric \* least\(greatest\(amount_refunded_minor, 0\), p\.amount_minor\) \/ p\.amount_minor\)/);
    assert.doesNotMatch(read("supabase/migrations/0148_whatsapp_tokens.sql"), /create or replace function public\.reverse_message_credit_purchase/);
  });
});

describe("running-low alerts in tokens", () => {
  function whatsapp(overrides: Partial<AllowanceAlertInput>): AllowanceAlertInput {
    return {
      channel: "whatsapp",
      trial: false,
      allowance: 0,
      usedThisPeriod: 0,
      creditBalance: 0,
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-11-01T00:00:00.000Z",
      now: new Date("2026-10-16T00:00:00.000Z"),
      bundles: creditBundlesFor({ whatsappEnabled: true }),
      ...overrides,
    };
  }

  test("remaining is tokens plus the replies they cover", () => {
    const alert = allowanceAlertFor(whatsapp({ usedThisPeriod: 900, creditBalance: 100 }))!;
    assert.equal(alert.threshold, 90);
    assert.equal(alert.remaining, 100);
    assert.match(alert.title, /100 WhatsApp tokens left/);
    assert.match(alert.body, /about 50 conversation replies or 20 marketing messages/);
    assert.doesNotMatch(alert.body, /£[0-9.]+ (left|remaining)|credit left/);
  });

  test("fewer tokens than one reply is run out", () => {
    assert.equal(crossedThreshold({ allowance: 0, usedThisPeriod: 998, creditBalance: 1, minPerSend: 2 }), 100);
    const alert = allowanceAlertFor(whatsapp({ usedThisPeriod: 998, creditBalance: 1 }))!;
    assert.equal(alert.threshold, 100);
    assert.equal(alert.tone, "danger");
    assert.equal(alert.title, "You've run out of WhatsApp");
    assert.match(alert.body, /no WhatsApp tokens left for another message/);
  });

  test("the recommended pack is in tokens, with coverage and its price", () => {
    // 1,200 tokens in 15 days = 80/day; 16 days left = 1,280 more, 80 on hand.
    const alert = allowanceAlertFor(whatsapp({ usedThisPeriod: 1200, creditBalance: 80 }))!;
    assert.equal(alert.recommended?.key, "whatsapp_tokens_2000");
    assert.match(alert.body, /Recommended: 2,000 WhatsApp tokens \(about 1,000 conversation replies or 400 marketing messages\) for £40/);
    assert.equal(alert.action.label, "Buy WhatsApp tokens");
    assert.equal(alert.action.href, "/app/settings?section=billing&bundle=whatsapp_tokens_2000#message-credits");
  });

  test("nothing bought and nothing used is not an alert", () => {
    assert.equal(allowanceAlertFor(whatsapp({})), null);
  });
});

describe("who can buy", () => {
  test("never in a trial", () => {
    assert.equal(creditPurchaseAllowed("trial"), false);
    assert.equal(allowancesFor("trial").whatsappEnabled, false);
    assert.equal(
      creditBundlesFor({ whatsappEnabled: allowancesFor("trial").whatsappEnabled }).some((b) => b.channel === "whatsapp"),
      false,
    );
    // Enforced server-side before any purchase row or Stripe session exists.
    const checkout = read("src/lib/billing/checkout.ts");
    const refuse = checkout.indexOf("if (!creditPurchaseAllowed(plan))");
    assert.ok(refuse > 0);
    assert.ok(refuse < checkout.indexOf('.from("message_credit_purchases")', refuse));
    assert.ok(refuse < checkout.indexOf("stripe.checkout.sessions.create", refuse));
  });

  test("Growth and above only", () => {
    assert.equal(creditBundlesFor({ whatsappEnabled: allowancesFor("starter").whatsappEnabled }).some((b) => b.channel === "whatsapp"), false);
    for (const plan of ["growth", "pro", "enterprise"]) {
      assert.equal(creditPurchaseAllowed(plan), true, plan);
      const packs = creditBundlesFor({ whatsappEnabled: allowancesFor(plan).whatsappEnabled }).filter((b) => b.channel === "whatsapp");
      assert.equal(packs.length, 3, plan);
    }
  });
});
