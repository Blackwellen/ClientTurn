import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DISABLED_AUTHORITY,
  checkoutGate,
  checkoutLinkIn,
  checkoutMessage,
  claimsPurchase,
  commercialAuthoritySchema,
  discountOffers,
  parseAuthority,
  type CommercialAuthority,
} from "../src/lib/commercial/authority.ts";
import { validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { agentDecisionSchema, HANDOVER_REASONS } from "../src/lib/agent/types.ts";

const LINK = {
  id: "pro-monthly",
  label: "Pro plan",
  product: "Pro, monthly",
  url: "https://pay.example.com/pro",
  price_text: "£49 per month",
  currency: "GBP",
};

const ENABLED: CommercialAuthority = {
  enabled: true,
  approved_checkout_links: [LINK],
  max_discount_percent: 0,
  requires_human_above_value_minor: 500_000,
};

function facts(overrides: Partial<ValidationFacts> = {}): ValidationFacts {
  return {
    channel: "email",
    businessName: "Acme",
    publishedPriceText: [LINK.price_text],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [LINK.url],
    serviceAreaConfirmed: false,
    commercial: { enabled: true, maxDiscountPercent: 0, checkoutLinks: [LINK] },
    ...overrides,
  };
}

describe("commercial authority settings", () => {
  test("off by default and a malformed row is disabled", () => {
    assert.equal(DISABLED_AUTHORITY.enabled, false);
    assert.equal(parseAuthority(null).enabled, false);
    assert.equal(parseAuthority({ enabled: true, approved_checkout_links: "nope" }).enabled, false);
  });

  test("a stored row drops links that no longer validate", () => {
    const parsed = parseAuthority({
      enabled: true,
      approved_checkout_links: [LINK, { ...LINK, id: "bad", url: "http://insecure.example.com" }],
      max_discount_percent: 10,
    });
    assert.deepEqual(parsed.approved_checkout_links.map((l) => l.id), ["pro-monthly"]);
  });

  test("the settings schema refuses http links, duplicate ids and enabling with no links", () => {
    const base = { enabled: false, approved_checkout_links: [LINK], max_discount_percent: 0, requires_human_above_value_minor: null };
    assert.ok(commercialAuthoritySchema.safeParse(base).success);
    assert.ok(!commercialAuthoritySchema.safeParse({ ...base, approved_checkout_links: [{ ...LINK, url: "http://x.example.com" }] }).success);
    assert.ok(!commercialAuthoritySchema.safeParse({ ...base, approved_checkout_links: [LINK, LINK] }).success);
    assert.ok(!commercialAuthoritySchema.safeParse({ ...base, enabled: true, approved_checkout_links: [] }).success);
    assert.ok(!commercialAuthoritySchema.safeParse({ ...base, max_discount_percent: 120 }).success);
  });
});

describe("the checkout gate", () => {
  const ok = { authority: ENABLED, motionAllowsDirectClose: true, linkId: "pro-monthly", opportunityValueMinor: 10_000, contactable: true };

  test("allows an approved link on a direct-close motion", () => {
    const gate = checkoutGate(ok);
    assert.equal(gate.allowed, true);
  });

  test("refuses when disabled, on a meeting motion, an unknown link, above the ceiling, or not contactable", () => {
    assert.equal(checkoutGate({ ...ok, authority: DISABLED_AUTHORITY }).allowed, false);
    assert.equal(checkoutGate({ ...ok, motionAllowsDirectClose: false }).allowed, false);
    assert.equal(checkoutGate({ ...ok, linkId: "made-up" }).allowed, false);
    assert.equal(checkoutGate({ ...ok, linkId: null }).allowed, false);
    assert.equal(checkoutGate({ ...ok, opportunityValueMinor: 600_000 }).allowed, false);
    assert.equal(checkoutGate({ ...ok, contactable: false }).allowed, false);
  });

  test("the runtime appends the approved URL byte for byte", () => {
    assert.equal(checkoutMessage("Here you go.", LINK), `Here you go. ${LINK.url}`);
    assert.equal(checkoutMessage(`Here: ${LINK.url}`, LINK), `Here: ${LINK.url}`);
    assert.equal(checkoutLinkIn(`Here: ${LINK.url}.`, [LINK])?.id, "pro-monthly");
  });
});

describe("the validator enforces the authority", () => {
  test("an approved link with its approved price passes", () => {
    const result = validateResponse(checkoutMessage("The Pro plan is £49 per month.", LINK), facts());
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("any URL not on the list is rejected", () => {
    const result = validateResponse("Pay here: https://evil.example.com/pay", facts());
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_LINK"));
  });

  test("a price not matching the link's price text is rejected", () => {
    const result = validateResponse(checkoutMessage("The Pro plan is £39 per month.", LINK), facts());
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "CHECKOUT_PRICE_MISMATCH" || f.code === "UNSUPPORTED_PRICE_CLAIM"));
  });

  test("a discount above the authority is rejected, with or without a money amount", () => {
    for (const text of [
      "Happy to do 30% off if you sign today.",
      "I can give you a discount of 20% today.",
      "Take thirty percent off the first month.",
      "I can do it half price for you.",
      "I can offer a discount if you sign this week.",
    ]) {
      const result = validateResponse(text, facts());
      assert.equal(result.ok, false, text);
      assert.ok(!result.ok && result.failures.some((f) => f.code === "UNSUPPORTED_DISCOUNT"), text);
    }
  });

  test("a discount within the authority is allowed; above it is not", () => {
    const within = facts({ commercial: { enabled: true, maxDiscountPercent: 10, checkoutLinks: [LINK] } });
    assert.equal(validateResponse("I can take 10% off the first month.", within).ok, true);
    assert.equal(validateResponse("I can take 15% off the first month.", within).ok, false);
  });

  test("with no commercial authority at all, no discount is allowed", () => {
    assert.equal(validateResponse("Happy to do 5% off.", facts({ commercial: null })).ok, false);
  });

  test("a percentage that is not a discount is not treated as one", () => {
    assert.deepEqual(discountOffers("Around 90% of our clients renew each year."), []);
  });

  test("the agent never claims a purchase", () => {
    for (const text of [
      "Thanks for your purchase!",
      "Your order is confirmed.",
      "Payment received, you're all set.",
      "You've subscribed to the Pro plan.",
    ]) {
      assert.ok(claimsPurchase(text), text);
      const result = validateResponse(text, facts());
      assert.ok(!result.ok && result.failures.some((f) => f.code === "PURCHASE_CLAIM"), text);
    }
    assert.equal(claimsPurchase("You can complete the purchase at the link."), false);
  });
});

describe("agent vocabulary", () => {
  test("PROPOSE_CHECKOUT carries a link id, never a URL field", () => {
    const parsed = agentDecisionSchema.parse({
      intent: "BOOKING_REQUEST",
      confidence: 0.95,
      proposed_action: "PROPOSE_CHECKOUT",
      message: "Here is the Pro plan.",
      checkout_link_id: "pro-monthly",
    });
    assert.equal(parsed.proposed_action, "PROPOSE_CHECKOUT");
    assert.equal(parsed.checkout_link_id, "pro-monthly");
  });

  test("READY_TO_BUY and BUDGET_EXCEEDED are handover reasons", () => {
    assert.ok(HANDOVER_REASONS.includes("READY_TO_BUY"));
    assert.ok(HANDOVER_REASONS.includes("BUDGET_EXCEEDED"));
  });
});
