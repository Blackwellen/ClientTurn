import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_PERMISSIONS,
  AI_PERMISSION_DEFAULTS,
  DEFAULT_AI_AUTHORITY,
  aiMay,
  normaliseAiAuthorityInput,
  parseAiAuthority,
  type AiAuthority,
  type AiPermission,
} from "../src/lib/commercial/ai-permissions.ts";
import { aiAuthorityOf, parseAuthority } from "../src/lib/commercial/authority.ts";
import { aiDiscountPolicy, DEFAULT_DISCOUNT_POLICY, evaluateDiscount } from "../src/lib/quotes/discount-policy.ts";
import {
  QUOTE_TOOLS,
  planConcession,
  quoteFigures,
  quoteStrategyBlock,
  quoteStrategyLines,
  quoteToolGate,
  validationFactsFor,
  type QuoteTool,
} from "../src/lib/agent/quote-flow.ts";
import { validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { applyQuoteDiscount } from "../src/lib/quotes/discount-core.ts";
import { createQuote, sendQuote, type QuoteActor } from "../src/lib/quotes/service-core.ts";
import { AGENT_QUOTE_OPERATIONS, serviceOperation } from "../src/lib/services/registry.ts";
import { requiresConfirmation } from "../src/lib/services/types.ts";
import { estimateTokens } from "../src/lib/agent/strategy.ts";
import { NBA_STRATEGY_BLOCK_MAX_TOKENS } from "../src/lib/qualification-intelligence/types.ts";
import { BUSINESS, CATALOGUE, OPPORTUNITY, createFakeDeps } from "./fixtures/quote-fakes.ts";

/**
 * Quote-to-cash in the AI sales agent (brief §7, §13-14, §53, §72-74):
 * the per-capability AI permissions and their least-privilege defaults, the
 * quote tool gate (AI on, quote_ai_enabled, the permission), the figure-leak
 * rule in the validator, and the discount matrix end to end through the
 * quote core with approval. No database, no model, no provider.
 */

const agent: QuoteActor = { kind: "AI", userId: null, role: "member" };

function authorityWith(on: Partial<Record<AiPermission, boolean>>, discount: Partial<AiAuthority["discount"]> = {}): AiAuthority {
  const parsed = parseAiAuthority({ ...AI_PERMISSION_DEFAULTS, ...on }, { ...DEFAULT_AI_AUTHORITY.discount, ...discount });
  return parsed;
}

const everything = Object.fromEntries(AI_PERMISSIONS.map((key) => [key, true])) as Record<AiPermission, boolean>;

/* =========================================================== permissions */

describe("what the AI may do (§74): least privilege", () => {
  test("only qualify and book are on by default", () => {
    const on = AI_PERMISSIONS.filter((key) => AI_PERMISSION_DEFAULTS[key]);
    assert.deepEqual(on, ["qualify", "book"]);
    assert.deepEqual(parseAiAuthority(null, null).capabilities, AI_PERMISSION_DEFAULTS);
    assert.equal(parseAiAuthority(null, null).discount.restraint, "NEVER");
  });

  test("a row without v2 columns (before 0160) reads as the defaults", () => {
    const authority = parseAuthority({ enabled: false, approved_checkout_links: [], max_discount_percent: 15 });
    const ai = aiAuthorityOf(authority);
    assert.equal(aiMay(ai, "create_quote"), false);
    assert.equal(aiMay(ai, "discount"), false, "a v1 maximum does not switch AI quote discounts on");
    assert.equal(aiMay(ai, "book"), true);
    assert.equal(aiMay(aiAuthorityOf(null), "qualify"), true);
  });

  test("stored values are read defensively: only a literal true turns a switch on", () => {
    const ai = parseAiAuthority({ create_quote: "yes", send_quote: 1, discount: true, unknown: true }, { restraint: "WHENEVER" });
    assert.equal(ai.capabilities.create_quote, false);
    assert.equal(ai.capabilities.send_quote, false);
    assert.equal(ai.capabilities.discount, false, "discount needs drafting");
    assert.equal(ai.discount.restraint, "NEVER", "an unknown restraint is the default");
  });

  test("sending, discounting and the steps after need drafting", () => {
    const ai = parseAiAuthority({ send_quote: true, discount: true, request_signature: true, send_payment_link: true }, null);
    for (const key of ["send_quote", "discount", "request_signature", "send_payment_link"] as const) assert.equal(ai.capabilities[key], false, key);
  });

  test("the settings save validates the discount policy and forces NEVER when discounts are off", () => {
    const off = normaliseAiAuthorityInput({ capabilities: { create_quote: true }, discount: { restraint: "PROACTIVE", maxPercent: 10 } });
    assert.ok(off.ok);
    if (off.ok) assert.equal(off.value.discount.restraint, "NEVER");
    const noMax = normaliseAiAuthorityInput({ capabilities: { create_quote: true, discount: true }, discount: { restraint: "PROACTIVE", maxPercent: 0 } });
    assert.equal(noMax.ok, false);
    const firstTooBig = normaliseAiAuthorityInput({
      capabilities: { create_quote: true, discount: true },
      discount: { restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, firstConcessionPercent: 15 },
    });
    assert.equal(firstTooBig.ok, false);
    const never = normaliseAiAuthorityInput({ capabilities: { create_quote: true, discount: true }, discount: { restraint: "NEVER" } });
    assert.equal(never.ok, false, "discount on with restraint NEVER is contradictory");
  });
});

/* ================================================================== gate */

describe("quote tool gate: AI on, quote_ai_enabled, the permission", () => {
  const permissionFor: Record<QuoteTool, AiPermission> = {
    calculate_quote: "create_quote",
    draft_quote: "create_quote",
    request_quote_approval: "create_quote",
    send_quote: "send_quote",
    propose_discount: "discount",
  };

  test("every tool is refused with the AI off, whatever else is on", () => {
    for (const tool of QUOTE_TOOLS) {
      const gate = quoteToolGate(tool, { aiEnabled: false, quoteAiCapability: true, authority: authorityWith(everything, { restraint: "PROACTIVE", maxPercent: 10 }) });
      assert.equal(gate.allowed, false, tool);
      if (!gate.allowed) assert.equal(gate.reason, "AI_OFF");
    }
  });

  test("every tool is refused without quote_ai_enabled (can())", () => {
    for (const tool of QUOTE_TOOLS) {
      const gate = quoteToolGate(tool, { aiEnabled: true, quoteAiCapability: false, authority: authorityWith(everything, { restraint: "PROACTIVE", maxPercent: 10 }) });
      assert.equal(gate.allowed, false, tool);
      if (!gate.allowed) assert.equal(gate.reason, "NOT_ON_PLAN");
    }
  });

  test("each tool needs exactly its own permission", () => {
    for (const tool of QUOTE_TOOLS) {
      const needed = permissionFor[tool];
      const without = authorityWith({ ...everything, [needed]: false }, { restraint: "PROACTIVE", maxPercent: 10 });
      const gate = quoteToolGate(tool, { aiEnabled: true, quoteAiCapability: true, authority: without });
      assert.equal(gate.allowed, false, `${tool} without ${needed}`);
      const withIt = quoteToolGate(tool, { aiEnabled: true, quoteAiCapability: true, authority: authorityWith(everything, { restraint: "PROACTIVE", maxPercent: 10 }) });
      assert.equal(withIt.allowed, true, `${tool} with everything`);
    }
  });

  test("the defaults allow no quote tool at all", () => {
    for (const tool of QUOTE_TOOLS) {
      assert.equal(quoteToolGate(tool, { aiEnabled: true, quoteAiCapability: true, authority: DEFAULT_AI_AUTHORITY }).allowed, false, tool);
    }
  });

  test("the tools go through the service registry as AGENT, never a separate implementation", () => {
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const called = [...source.matchAll(/runOperation<[^>]*>\(\s*"([a-z_.]+)"|runOperation\(\s*"([a-z_.]+)"/g)].map((m) => m[1] ?? m[2]);
    const quoteCalls = called.filter((name) => name.startsWith("quote."));
    assert.deepEqual([...new Set(quoteCalls)].sort(), [...AGENT_QUOTE_OPERATIONS].sort());
    assert.doesNotMatch(source, /from "@\/lib\/quotes\/service-core"(?!;\s*$)[^\n]*\b(createQuote|sendQuote|submitForApproval)\b/, "no direct core call");
    assert.match(source, /caller: "AGENT"/);
    for (const name of AGENT_QUOTE_OPERATIONS) {
      const callers = serviceOperation(name)!.callers;
      assert.ok(!callers || callers.includes("AGENT"), name);
    }
  });

  test("quote.send stays EXTERNAL: the agent sets confirmed only as the owner's standing permission, and only for send", () => {
    assert.ok(requiresConfirmation(serviceOperation("quote.send")!.risk));
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const confirmedCalls = [...source.matchAll(/agentServiceContext\(context, [^)]*, true\)/g)];
    assert.equal(confirmedCalls.length, 1, "exactly one confirmed agent call");
    const sendBlock = source.slice(source.indexOf("export async function sendQuoteToLead"), source.indexOf("export type DiscountOutcome"));
    assert.match(sendBlock, /agentServiceContext\(context, key, true\)/);
    assert.match(source, /confirmationSource: "standing_permission"/);
  });
});

/* ========================================================== policy mapping */

describe("the AI discount policy maps onto discount-policy.ts", () => {
  test("discount off is NEVER, whatever the limits say", () => {
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, authorityWith({ create_quote: true }, { restraint: "PROACTIVE", maxPercent: 20 }));
    assert.equal(policy.restraint, "NEVER");
    assert.equal(policy.aiMaxBps, 0);
  });

  test("limits, first step, margin floor and approval thresholds carry over", () => {
    const ai = authorityWith(
      { create_quote: true, discount: true },
      { restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, maxAmountMinor: 50_000, firstConcessionPercent: 5, marginFloorPercent: 40, approvalAbovePercent: 7.5, approvalAboveValueMinor: 1_000_000, approvalRole: "owner" },
    );
    const base = { ...DEFAULT_DISCOUNT_POLICY, marginFloorBps: 3000, approvalRules: [{ id: "quote-rule", valueAboveMinor: 2_000_000, role: "admin" as const }] };
    const policy = aiDiscountPolicy(base, ai, { requiresHumanAboveValueMinor: 900_000 });
    assert.equal(policy.restraint, "ONLY_AFTER_OBJECTION");
    assert.equal(policy.aiMaxBps, 1000);
    assert.equal(policy.aiMaxMinor, 50_000);
    assert.equal(policy.firstConcessionMaxBps, 500);
    assert.equal(policy.marginFloorBps, 4000, "the higher floor");
    const ids = policy.approvalRules.map((rule) => rule.id).sort();
    assert.deepEqual(ids, ["ai-discount-percent", "ai-quote-value", "authority-value-ceiling", "quote-rule"]);
    assert.equal(policy.approvalRules.find((r) => r.id === "ai-discount-percent")!.role, "owner");
  });
});

/* ======================================================== figure leak */

function calcFor(lines: { itemId: string; quantity: number }[], quoteDiscountBps?: number) {
  const result = calculateQuote({
    currency: "GBP",
    vatRegistered: true,
    catalogue: CATALOGUE,
    lines: lines.map((line, index) => ({ lineId: `l${index + 1}`, kind: "ITEM", itemId: line.itemId, quantity: line.quantity, optionIds: [] })),
    ...(quoteDiscountBps ? { quoteDiscount: { type: "PERCENT", bps: quoteDiscountBps, scope: "ALL" } } : {}),
  });
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join("; "));
  return result.quote;
}

function factsWith(quote: ReturnType<typeof validationFactsFor> | null, extra: Partial<ValidationFacts> = {}): ValidationFacts {
  return {
    channel: "email",
    businessName: "Northwind Studio",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
    quote,
    ...extra,
  };
}

const codes = (text: string, facts: ValidationFacts) => {
  const result = validateResponse(text, facts);
  return result.ok ? [] : result.failures.map((f) => f.code);
};

describe("validator: no figure leaks (§7)", () => {
  const calc = calcFor([{ itemId: "website", quantity: 1 }, { itemId: "consulting", quantity: 10 }]);
  const figures = quoteFigures(calc, { validUntil: "2026-10-27T00:00:00.000Z" });
  const facts = factsWith(validationFactsFor(figures));

  test("every figure the calculation produced may be stated, as written or without pence", () => {
    for (const figure of figures.figures) {
      assert.deepEqual(codes(`It comes to ${figure}.`, facts), [], figure);
      assert.deepEqual(codes(`It comes to ${figure.replace(/\.00$/, "")}.`, facts), [], `${figure} without pence`);
    }
  });

  test("a figure leak test: no other amount passes, near misses included", () => {
    const allowed = new Set(figures.figures.map((f) => f.replace(/[^\d.]/g, "").replace(/\.00$/, "")));
    const candidates = ["£1", "£99", "£120.50", "£5,999", "£6,000.01", "£7,440.00", "£1,440.10", "£244", "£7,4400", "£12,000"];
    for (const amount of candidates) {
      const digits = amount.replace(/[^\d.]/g, "").replace(/\.00$/, "");
      if (allowed.has(digits)) continue;
      assert.ok(codes(`That would be ${amount}.`, facts).includes("UNSUPPORTED_PRICE_CLAIM"), amount);
    }
    // In words, too.
    assert.ok(codes("It's about seven thousand pounds all in.", facts).includes("UNSUPPORTED_PRICE_CLAIM"));
  });

  test("with no calculation this turn, no figure passes at all", () => {
    for (const figure of figures.figures) {
      assert.ok(codes(`It comes to ${figure}.`, factsWith(null)).includes("UNSUPPORTED_PRICE_CLAIM"), figure);
    }
  });

  test("an approved checkout link's price text still passes, only with that link", () => {
    const link = { id: "team", label: "Team plan", product: "Team plan", url: "https://buy.stripe.com/test_team", price_text: "£49 per month", currency: "GBP" };
    const withLink = factsWith(null, { allowedUrls: [link.url], commercial: { enabled: true, maxDiscountPercent: 0, checkoutLinks: [link] } });
    assert.deepEqual(codes(`The Team plan is £49 per month: ${link.url}`, { ...withLink, publishedPriceText: [link.price_text] }), []);
  });

  test("VAT is never improvised", () => {
    assert.ok(codes("That's plus VAT.", factsWith(null)).includes("UNSUPPORTED_VAT_CLAIM"), "no quote: no VAT statement");
    const notRegistered = quoteFigures({ ...calc, vatRegistered: false });
    assert.ok(codes("There's no VAT on this.", factsWith(validationFactsFor(notRegistered))).includes("UNSUPPORTED_VAT_CLAIM"));
    assert.deepEqual(codes(`That's ${figures.figures[0]} including VAT at 20%.`, facts), []);
    assert.ok(codes("That's plus VAT at 17.5%.", facts).includes("UNSUPPORTED_VAT_CLAIM"));
  });

  test("discounts: only the quote's own, and a pending one only without a figure", () => {
    assert.ok(codes("I can do 10% off.", facts).includes("UNSUPPORTED_DISCOUNT"));
    const discounted = quoteFigures(calcFor([{ itemId: "website", quantity: 1 }], 500));
    const dFacts = factsWith(validationFactsFor(discounted));
    assert.deepEqual(codes(`I've taken 5% off, so it's now ${discounted.figures[0]}.`, dFacts), []);
    assert.ok(codes("I've taken 10% off.", dFacts).includes("UNSUPPORTED_DISCOUNT"));
    const review = factsWith(validationFactsFor(null, { discountUnderReview: true }));
    assert.deepEqual(codes("I've asked the team to look at a discount for you.", review), []);
    assert.ok(codes("I've asked the team about 5% off.", review).includes("UNSUPPORTED_DISCOUNT"));
  });

  test("delivery, start and completion dates are never promised", () => {
    for (const text of ["We can start on Monday.", "It'll be ready in two weeks.", "Delivered within 10 working days.", "We could launch by the end of the month."]) {
      assert.ok(codes(text, facts).includes("UNSUPPORTED_DELIVERY_CLAIM"), text);
    }
    assert.deepEqual(codes("The team will confirm the timeline with you.", facts), []);
  });

  test("the quote strategy lines name the figures verbatim and fit the token budget", () => {
    const lines = quoteStrategyLines({ kind: "DRAFTED", then: "SENT" }, figures);
    const block = quoteStrategyBlock(lines);
    for (const entry of figures.labelled.slice(0, 6)) assert.ok(block.includes(entry.value), entry.value);
    assert.ok(estimateTokens(block) <= NBA_STRATEGY_BLOCK_MAX_TOKENS, `${estimateTokens(block)} tokens`);
    const collect = quoteStrategyBlock(quoteStrategyLines({ kind: "COLLECT", input: { kind: "QUANTITY", itemId: "consulting" }, question: "So I can price it properly, how many hours would you need?" }, null));
    assert.doesNotMatch(collect, /£/);
    assert.ok(estimateTokens(collect) <= NBA_STRATEGY_BLOCK_MAX_TOKENS);
  });
});

/* ====================================================== discount matrix */

describe("discount matrix end to end, through the quote core", () => {
  const ai = (discount: Partial<AiAuthority["discount"]>) =>
    authorityWith({ create_quote: true, send_quote: true, discount: true }, discount);

  async function sentQuote(settings = {}) {
    const fake = createFakeDeps({ settings });
    const created = await createQuote(fake.deps, BUSINESS, agent, {
      opportunityId: OPPORTUNITY,
      lines: [{ lineId: "l1", kind: "ITEM", itemId: "website", quantity: 1, optionIds: [] }],
      requestId: "agent:conv-1:msg-1",
    });
    await sendQuote(fake.deps, BUSINESS, agent, { quoteId: created.quote.id, channel: "email" });
    return { ...fake, quoteId: created.quote.id, calc: created.revision!.calculation };
  }

  test("within limits after an objection: ALLOW, a new revision, no approval", async () => {
    const { deps, quoteId, calc, state } = await sentQuote();
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, firstConcessionPercent: 5 }));
    const concession = planConcession({ policy, calculation: calc, requestedPercent: null, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.decision.outcome, "ALLOW");
    assert.equal(concession.bps, 500);
    const applied = await applyQuoteDiscount(deps, BUSINESS, agent, {
      quoteId,
      discount: { type: "PERCENT", bps: concession.bps, scope: "ALL" },
      ai: { afterObjection: true, priorAiConcessions: 0, policy },
    });
    assert.equal(applied.revised, true, "a sent quote gets a new revision");
    assert.equal(applied.approval.required, false);
    assert.equal(applied.calculation.totals.netMinor, 475_000);
    assert.equal(state.quotes.get(quoteId)!.status, "DRAFT");
    const figures = quoteFigures(applied.calculation);
    assert.deepEqual(figures.discountPercents, [5]);
  });

  test("a bare ask under ONLY_AFTER_OBJECTION holds the price; PROACTIVE may concede", async () => {
    const { calc } = await sentQuote();
    const strict = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10 }));
    assert.equal(planConcession({ policy: strict, calculation: calc, requestedPercent: null, afterObjection: false, priorAiConcessions: 0 }).decision.outcome, "DENY");
    const proactive = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "PROACTIVE", maxPercent: 10 }));
    assert.equal(planConcession({ policy: proactive, calculation: calc, requestedPercent: null, afterObjection: false, priorAiConcessions: 0 }).decision.outcome, "ALLOW");
  });

  test("above the maximum: countered with the most allowed, never the ask", async () => {
    const { calc } = await sentQuote();
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, firstConcessionPercent: 5 }));
    const concession = planConcession({ policy, calculation: calc, requestedPercent: 25, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.countered, true);
    assert.equal(concession.bps, 500);
    assert.equal(concession.decision.outcome, "ALLOW");
  });

  test("outside the approval threshold: REQUIRE_APPROVAL, stored needing approval, never sendable until approved", async () => {
    const { deps, quoteId, calc } = await sentQuote();
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, approvalAbovePercent: 3 }));
    const concession = planConcession({ policy, calculation: calc, requestedPercent: 8, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.decision.outcome, "REQUIRE_APPROVAL");
    const applied = await applyQuoteDiscount(deps, BUSINESS, agent, {
      quoteId,
      discount: { type: "PERCENT", bps: concession.bps, scope: "ALL" },
      ai: { afterObjection: true, priorAiConcessions: 0, policy },
    });
    assert.equal(applied.approval.required, true);
    await assert.rejects(sendQuote(deps, BUSINESS, agent, { quoteId, channel: "email" }), /approval/i);
  });

  test("a second concession always goes to a person (two-step)", async () => {
    const { calc } = await sentQuote();
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "PROACTIVE", maxPercent: 10 }));
    assert.equal(planConcession({ policy, calculation: calc, requestedPercent: null, afterObjection: true, priorAiConcessions: 1 }).decision.outcome, "REQUIRE_APPROVAL");
  });

  test("the margin floor is the core's: the assistant's view has no cost, the core denies below it", async () => {
    const { deps, quoteId, calc } = await sentQuote();
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "PROACTIVE", maxPercent: 50, marginFloorPercent: 55 }));
    // The website costs £2,000 on £5,000: 60% margin. 20% off leaves 50%.
    const blind = { ...calc, margin: null };
    const concession = planConcession({ policy, calculation: blind, requestedPercent: 20, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.decision.outcome, "ALLOW", "pre-check without the cost cannot see the floor");
    await assert.rejects(
      applyQuoteDiscount(deps, BUSINESS, agent, { quoteId, discount: { type: "PERCENT", bps: 2000, scope: "ALL" }, ai: { afterObjection: true, priorAiConcessions: 0, policy } }),
      /margin/i,
    );
  });

  test("discounts off: evaluateDiscount denies every AI proposal", () => {
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, authorityWith({ create_quote: true }));
    const decision = evaluateDiscount(policy, { actor: { kind: "AI" }, baseMinor: 100_000, discountMinor: 1_000, valueAfterMinor: 99_000, marginAfterBps: null, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(decision.outcome, "DENY");
  });

  test("a dry run decides and writes nothing", async () => {
    const { deps, quoteId, state } = await sentQuote();
    const before = state.revisions.size;
    const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai({ restraint: "PROACTIVE", maxPercent: 10 }));
    const result = await applyQuoteDiscount(deps, BUSINESS, agent, { quoteId, discount: { type: "PERCENT", bps: 500, scope: "ALL" }, ai: { afterObjection: true, priorAiConcessions: 0, policy }, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(state.revisions.size, before);
  });
});
