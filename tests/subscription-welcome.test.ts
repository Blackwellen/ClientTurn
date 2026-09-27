import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  shouldQueueWelcome,
  subscriptionWelcomeEmail,
  welcomeJobKey,
} from "../src/lib/email/subscription-welcome.ts";
import { PLANS } from "../src/lib/billing/plans.ts";
import { TOKEN_PACK_LIST, formatTokens } from "../src/lib/billing/tokens.ts";
import { WHATSAPP_TOKEN_PACKS, WHATSAPP_TOKENS_PER_MESSAGE } from "../src/lib/billing/whatsapp-tokens.ts";

/**
 * The subscription welcome email: rendered only, never sent (owner rule:
 * tests must not spend money, so there is no Resend call here).
 */

const SITE = "https://app.example.test";
const GBP = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);

function copyWithoutUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "");
}

describe("idempotency", () => {
  test("queued once: only when active on a paid plan and not already sent", () => {
    assert.equal(shouldQueueWelcome({ status: "ACTIVE", plan: "growth", alreadySent: false }), true);
    assert.equal(shouldQueueWelcome({ status: "ACTIVE", plan: "growth", alreadySent: true }), false);
    for (const status of ["TRIALING", "PAST_DUE", "CANCELLED", "INCOMPLETE"]) {
      assert.equal(shouldQueueWelcome({ status, plan: "growth", alreadySent: false }), false, status);
    }
    assert.equal(shouldQueueWelcome({ status: "ACTIVE", plan: "trial", alreadySent: false }), false);
  });

  test("the job key is per Stripe subscription, stable across retries", () => {
    assert.equal(welcomeJobKey("sub_1"), welcomeJobKey("sub_1"));
    assert.notEqual(welcomeJobKey("sub_1"), welcomeJobKey("sub_2"));
  });

  test("the sync checks the durable marker and the send counts against the system email cap", () => {
    const sync = readFileSync(path.join(process.cwd(), "src/lib/billing/subscription-sync.ts"), "utf8");
    assert.match(sync, /subscription_welcome_emails/);
    assert.match(sync, /welcomeJobKey\(input\.subscriptionId\)/);
    const handler = readFileSync(path.join(process.cwd(), "src/lib/jobs/handlers/notification-send.ts"), "utf8");
    const welcome = handler.slice(handler.indexOf("async function sendSubscriptionWelcome"));
    assert.match(welcome, /consumeSystemEmail/);
    assert.match(welcome, /\.eq\("role", "owner"\)/);
    const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/0149_upsell_moments.sql"), "utf8");
    assert.match(migration, /stripe_subscription_id text primary key/);
  });
});

describe("content", () => {
  test("Growth: plan inclusions, AI token packs and WhatsApp token packs from the catalogue", () => {
    const email = subscriptionWelcomeEmail({ plan: "growth", siteUrl: SITE, firstName: "Alex" });
    const plan = PLANS.growth;
    assert.match(email.subject, /Growth/);
    assert.match(email.text, new RegExp(plan.leadLimit.toLocaleString("en-GB")));
    assert.match(email.text, new RegExp(formatTokens(plan.aiTokenAllowance)));
    for (const pack of TOKEN_PACK_LIST) {
      assert.ok(email.text.includes(`${formatTokens(pack.tokens)} AI tokens for ${GBP(pack.amountMinor / 100)}`), pack.key);
    }
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      assert.ok(email.text.includes(`${pack.tokens.toLocaleString("en-GB")} WhatsApp tokens for ${GBP(pack.priceGbp)}`), String(pack.tokens));
    }
    assert.ok(email.text.includes(`uses ${WHATSAPP_TOKENS_PER_MESSAGE.SERVICE} WhatsApp tokens`));
    assert.ok(email.text.includes(`marketing template uses ${WHATSAPP_TOKENS_PER_MESSAGE.MARKETING}`));
  });

  test("Starter: WhatsApp is available on Growth and above, no packs offered", () => {
    const email = subscriptionWelcomeEmail({ plan: "starter", siteUrl: SITE });
    assert.match(email.text, /available on Growth and above/);
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      assert.ok(!email.text.includes(`${pack.tokens.toLocaleString("en-GB")} WhatsApp tokens for`));
    }
  });

  test("how to buy, the refund note and no overage", () => {
    const email = subscriptionWelcomeEmail({ plan: "pro", siteUrl: SITE });
    assert.ok(email.text.includes(`${SITE}/app/settings?section=billing`));
    assert.ok(email.html.includes(`${SITE}/app/settings?section=billing`));
    assert.match(email.text, /cannot be refunded once any of its tokens are used/);
    assert.match(email.text, /no overage/i);
  });

  test("house rules: no voice teaser, no dates, no emojis, no dashes, no WhatsApp 'credit'", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"]) {
      const email = subscriptionWelcomeEmail({ plan, siteUrl: SITE, firstName: "Alex" });
      for (const body of [email.subject, email.summary, copyWithoutUrls(email.text)]) {
        assert.doesNotMatch(body, /voice|coming soon|\bcall(s|ing)?\b/i, plan);
        assert.doesNotMatch(body, /\b20\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/, plan);
        assert.doesNotMatch(body, /[-–—]/, `${plan}: dash in "${body.match(/.{0,30}[-–—].{0,30}/)?.[0]}"`);
        assert.doesNotMatch(body, /\p{Extended_Pictographic}/u, plan);
        assert.doesNotMatch(body, /WhatsApp (credit|balance)|credit for WhatsApp/i, plan);
      }
    }
  });

  test("an HTML and a text version, mobile friendly, with names escaped", () => {
    const email = subscriptionWelcomeEmail({ plan: "growth", siteUrl: SITE, firstName: "<b>Al</b>" });
    assert.match(email.html, /<!doctype html>/);
    assert.match(email.html, /name="viewport"/);
    assert.match(email.html, /max-width:480px/);
    assert.match(email.html, /#B7F34A/);
    assert.ok(!email.html.includes("<b>Al</b>"));
    assert.ok(email.text.length > 200);
  });
});
