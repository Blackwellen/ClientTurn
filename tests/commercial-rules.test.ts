import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEST_FIT_VERSION,
  buildFitCandidates,
  inSizeBands,
  liveFitFacts,
  postcodeInPrefix,
  recommendBestFit,
  renderRecommendation,
  type FitCandidate,
  type FitFact,
  type FitLead,
} from "../src/lib/commercial/best-fit.ts";
import {
  WHOLE_CATALOGUE,
  candidateInTarget,
  closingGoalsInTarget,
  describeTarget,
  itemInTarget,
  offTargetMentions,
  offTargetNames,
  offerTargetFromRow,
  offerTargetSchema,
  resolveTarget,
  serviceInTarget,
} from "../src/lib/agents/offer-target.ts";
import {
  competitorCardLines,
  competitorClaimFailures,
  competitorRules,
  competitorSchema,
  competitorTextProblems,
  detectCompetitorMentions,
  parseCompetitorRows,
  type Competitor,
} from "../src/lib/sales-library/competitors.ts";
import { validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import {
  buildOfferCard,
  COMPETITOR_SECTION,
  OFFER_CARD_TOKEN_BUDGET,
  RECOMMENDED_FIT_SECTION,
  type OfferCardInput,
} from "../src/lib/agent/offer-card.ts";
import { instagramReplyGate, META_APPROVAL_TRIGGER } from "../src/lib/agent/meta-gate.ts";
import { metaChannelCapability } from "../src/lib/social/meta-capability.ts";

/**
 * Commercial rules (0174): agent targeting, the deterministic best-fit
 * scorer, competitor positioning and its validator, and the Instagram
 * approval gate. Fakes only: no database, no model, no provider.
 */

/* ------------------------------------------------------------ fixtures */

const WEB = "11111111-1111-4111-8111-111111111111";
const SEO = "22222222-2222-4222-8222-222222222222";
const CARE = "33333333-3333-4333-8333-333333333333";
const ITEM_BASIC = "44444444-4444-4444-8444-444444444444";
const ITEM_PRO = "55555555-5555-4555-8555-555555555555";
const ITEM_AUDIT = "66666666-6666-4666-8666-666666666666";

const services = [
  { id: WEB, name: "Website design", offerProfile: { geography: { postcodePrefixes: ["LS", "BD"] } } },
  { id: SEO, name: "Search optimisation", offerProfile: { targetCustomer: { sizes: ["10-49", "50-249"] }, excludedCustomer: { sizes: ["1-9"] } } },
  { id: CARE, name: "Website care plan", offerProfile: {} },
];
const items = [
  { id: ITEM_BASIC, serviceId: WEB, name: "Basic site", unitPriceMinor: 250_000, currency: "GBP" },
  { id: ITEM_PRO, serviceId: WEB, name: "Pro site", unitPriceMinor: 900_000, currency: "GBP" },
  { id: ITEM_AUDIT, serviceId: SEO, name: "SEO audit", unitPriceMinor: 60_000, currency: "GBP" },
];
const candidates: FitCandidate[] = buildFitCandidates(services, items);

const fact = (dimension: string, value: string, valueNormalised: string | null, state: FitFact["state"] = "CONFIRMED", serviceId: string | null = null): FitFact => ({
  dimension,
  serviceId,
  value,
  valueNormalised,
  state,
});

const lead = (overrides: Partial<FitLead> = {}): FitLead => ({
  serviceId: null,
  openInterestServiceIds: [],
  postcode: null,
  facts: [],
  tags: [],
  icpGrade: null,
  ...overrides,
});

/* ------------------------------------------------------------ best fit */

describe("best fit: deterministic ranking", () => {
  test("candidates: every active offer and every sellable item, with the offer's cheapest price as its floor", () => {
    const web = candidates.find((c) => c.kind === "SERVICE" && c.id === WEB)!;
    assert.equal(web.priceFloorMinor, 250_000);
    assert.deepEqual(web.postcodePrefixes, ["LS", "BD"]);
    const pro = candidates.find((c) => c.id === ITEM_PRO)!;
    assert.deepEqual(pro.postcodePrefixes, ["LS", "BD"], "an item inherits its offer's area");
    assert.equal(candidates.find((c) => c.id === CARE)!.priceFloorMinor, null, "no items, no floor");
    const withAddOn = buildFitCandidates(services, [...items, { id: "77777777-7777-4777-8777-777777777777", serviceId: WEB, name: "Extra page", unitPriceMinor: 100, currency: "GBP", addOnOnly: true }]);
    assert.ok(!withAddOn.some((c) => c.name === "Extra page"), "add-on-only lines are never recommended");
  });

  test("the lead's own offer plus a fitting budget wins, and the one matching item is chosen over the offer", () => {
    const fit = recommendBestFit({
      candidates,
      lead: lead({ serviceId: WEB, facts: [fact("BUDGET", "about £5k", "gbp:5000")] }),
    });
    assert.equal(fit.status, "RECOMMENDED");
    assert.ok(fit.status === "RECOMMENDED");
    // Web (40+15) and Basic (40+15) tie; Pro is excluded (confirmed budget below its price).
    assert.equal(fit.top.id, ITEM_BASIC);
    assert.ok(fit.reasons.includes("LEAD_SERVICE"));
    assert.ok(fit.reasons.includes("BUDGET_FITS"));
    assert.ok(fit.reasons.includes("MOST_SPECIFIC"));
    const pro = fit.ranked.find((c) => c.id === ITEM_PRO)!;
    assert.equal(pro.eligible, false);
    assert.equal(pro.excludedBy, "BUDGET_BELOW_PRICE");
    assert.equal(fit.version, BEST_FIT_VERSION);
  });

  test("several items of one offer tie: the offer is recommended, not a guess between items", () => {
    const fit = recommendBestFit({ candidates, lead: lead({ serviceId: WEB }) });
    assert.ok(fit.status === "RECOMMENDED");
    assert.equal(fit.top.kind, "SERVICE");
    assert.equal(fit.top.id, WEB);
  });

  test("an inferred budget below the price is a caution, never an exclusion", () => {
    const fit = recommendBestFit({
      candidates,
      lead: lead({ serviceId: WEB, facts: [fact("BUDGET", "maybe 3k", "gbp:3000", "INFERRED")] }),
    });
    const pro = fit.ranked.find((c) => c.id === ITEM_PRO)!;
    assert.equal(pro.eligible, true);
    assert.ok(pro.reasons.includes("BUDGET_MAY_BE_LOW"));
  });

  test("a named product interest outranks the lead's original offer", () => {
    const fit = recommendBestFit({
      candidates,
      lead: lead({ serviceId: WEB, openInterestServiceIds: [SEO], facts: [fact("PRODUCT_INTEREST", "we need an SEO audit first", null)] }),
    });
    assert.ok(fit.status === "RECOMMENDED");
    // SEO audit: OPEN_INTEREST 30 + NAMED_INTEREST 25 = 55 beats Website design 40.
    assert.equal(fit.top.id, ITEM_AUDIT);
    assert.ok(fit.reasons.includes("NAMED_INTEREST"));
    assert.ok(fit.reasons.includes("OPEN_INTEREST"));
  });

  test("area and company size rules exclude, and the reason says which", () => {
    const outside = recommendBestFit({ candidates, lead: lead({ serviceId: WEB, postcode: "M1 1AE" }) });
    assert.equal(outside.ranked.find((c) => c.id === WEB)!.excludedBy, "REGION_EXCLUDED");
    const inside = recommendBestFit({ candidates, lead: lead({ serviceId: WEB, postcode: "LS1 4AP" }) });
    assert.ok(inside.status === "RECOMMENDED" && inside.reasons.includes("REGION_MATCH"));

    const tiny = recommendBestFit({ candidates, lead: lead({ serviceId: SEO, facts: [fact("COMPANY_SIZE", "5 people", "5")] }) });
    assert.equal(tiny.ranked.find((c) => c.id === SEO)!.excludedBy, "SIZE_EXCLUDED");
    const mid = recommendBestFit({ candidates, lead: lead({ serviceId: SEO, facts: [fact("COMPANY_SIZE", "20", "20")] }) });
    assert.ok(mid.status === "RECOMMENDED" && mid.reasons.includes("SIZE_MATCH"));
  });

  test("insufficient data: no stated need is said plainly, never guessed", () => {
    const fit = recommendBestFit({
      candidates,
      lead: lead({ postcode: "LS1 4AP", facts: [fact("BUDGET", "£50k", "gbp:50000")], icpGrade: "A" }),
    });
    assert.equal(fit.status, "INSUFFICIENT_DATA");
    assert.ok(fit.status === "INSUFFICIENT_DATA" && fit.reason === "NO_STATED_NEED");
    assert.ok(fit.leadNotes.includes("ICP_FIT_STRONG"));
    assert.match(renderRecommendation(fit)!, /Do not guess/);
  });

  test("insufficient data: a tie between two different offers is not broken by guessing", () => {
    const fit = recommendBestFit({ candidates, lead: lead({ openInterestServiceIds: [WEB, CARE] }) });
    assert.ok(fit.status === "INSUFFICIENT_DATA" && fit.reason === "TIED");
  });

  test("insufficient data: an empty catalogue and nothing eligible are distinct answers", () => {
    const none = recommendBestFit({ candidates: [], lead: lead({ serviceId: WEB }) });
    assert.ok(none.status === "INSUFFICIENT_DATA" && none.reason === "NO_CATALOGUE");
    assert.equal(renderRecommendation(none), null, "no catalogue, no card line");
    const blocked = recommendBestFit({ candidates, lead: lead({ serviceId: WEB }), inTarget: () => false });
    assert.ok(blocked.status === "INSUFFICIENT_DATA" && blocked.reason === "NONE_ELIGIBLE");
    assert.ok(blocked.ranked.every((c) => c.excludedBy === "OUT_OF_TARGET"));
  });

  test("the same input gives the same answer in the same order", () => {
    const input = { candidates, lead: lead({ serviceId: WEB, facts: [fact("BUDGET", "£5k", "gbp:5000")] }) };
    assert.deepEqual(recommendBestFit(input), recommendBestFit(input));
  });

  test("the card line names the offer and reason codes, never a price", () => {
    const fit = recommendBestFit({ candidates, lead: lead({ serviceId: WEB, facts: [fact("BUDGET", "£5k", "gbp:5000")] }) });
    const line = renderRecommendation(fit)!;
    assert.match(line, /Basic site/);
    assert.doesNotMatch(line, /£|\d{3}/);
  });

  test("only live, trustworthy facts are read", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const base = { dimension: "BUDGET", serviceId: null, value: "£5k", valueNormalised: "gbp:5000", confidence: 1, validUntil: null, supersededAt: null };
    const live = liveFitFacts(
      [
        { ...base, state: "CONFIRMED", source: "ANSWER" },
        { ...base, state: "REJECTED", source: "ANSWER" },
        { ...base, state: "INFERRED", source: "AI_ASSIST", confidence: 0.6 },
        { ...base, state: "CONFIRMED", source: "ANSWER", validUntil: "2026-01-01T00:00:00Z" },
        { ...base, state: "CONFIRMED", source: "ANSWER", supersededAt: "2026-09-01T00:00:00Z" },
      ],
      now,
    );
    assert.equal(live.length, 1);
  });

  test("postcode prefixes and size bands", () => {
    assert.equal(postcodeInPrefix("LS1", "LS"), true);
    assert.equal(postcodeInPrefix("L1", "LS"), false);
    assert.equal(postcodeInPrefix("S1", "S"), true);
    assert.equal(postcodeInPrefix("SW1", "S"), false);
    assert.equal(postcodeInPrefix("SW1A", "SW1"), true);
    assert.equal(postcodeInPrefix("SW10", "SW1"), false);
    assert.equal(inSizeBands(300, ["250+"]), true);
    assert.equal(inSizeBands(5, ["10-49"]), false);
    assert.equal(inSizeBands(5, ["small"]), null);
  });
});

/* ------------------------------------------------------------- targeting */

describe("agent targeting: what an agent sells", () => {
  const catalogueItems = items.map((i) => ({ id: i.id, serviceId: i.serviceId, name: i.name }));

  test("the default and every malformed row is the whole catalogue (pre-0174 behaviour)", () => {
    assert.deepEqual(offerTargetFromRow(null), WHOLE_CATALOGUE);
    assert.deepEqual(offerTargetFromRow({ offer_scope: "CATALOGUE" }), WHOLE_CATALOGUE);
    assert.deepEqual(offerTargetFromRow({ offer_scope: "SELECTED", target_service_ids: [], target_catalogue_item_ids: ["nope"] }), WHOLE_CATALOGUE);
    const legacy = offerTargetFromRow({ service_id: WEB });
    assert.equal(legacy.scope, "SELECTED");
    assert.deepEqual(legacy.serviceIds, [WEB], "the legacy one-offer agent keeps its meaning");
  });

  test("the schema refuses a selection of nothing", () => {
    assert.equal(offerTargetSchema.safeParse({ scope: "SELECTED", serviceIds: [], catalogueItemIds: [] }).success, false);
    assert.equal(offerTargetSchema.safeParse({ scope: "CATALOGUE" }).success, true);
    assert.equal(offerTargetSchema.safeParse({ scope: "SELECTED", serviceIds: ["not-a-uuid"] }).success, false);
  });

  test("choosing one item puts its offer on the card but not the offer's other items", () => {
    const resolved = resolveTarget({ scope: "SELECTED", serviceIds: [], catalogueItemIds: [ITEM_BASIC] }, catalogueItems);
    assert.equal(serviceInTarget(resolved, WEB), true);
    assert.equal(serviceInTarget(resolved, SEO), false);
    assert.equal(itemInTarget(resolved, { id: ITEM_BASIC, serviceId: WEB }), true);
    assert.equal(itemInTarget(resolved, { id: ITEM_PRO, serviceId: WEB }), false);
    assert.equal(candidateInTarget(resolved, { kind: "SERVICE", id: WEB, serviceId: WEB }), false, "never the whole offer");
  });

  test("the scorer never recommends outside the target", () => {
    const resolved = resolveTarget({ scope: "SELECTED", serviceIds: [SEO], catalogueItemIds: [] }, catalogueItems);
    const fit = recommendBestFit({
      candidates,
      lead: lead({ serviceId: WEB, openInterestServiceIds: [SEO] }),
      inTarget: (c) => candidateInTarget(resolved, c),
    });
    assert.ok(fit.status === "RECOMMENDED");
    assert.equal(fit.top.serviceId, SEO);
    assert.equal(fit.ranked.find((c) => c.id === WEB)!.excludedBy, "OUT_OF_TARGET");
  });

  test("the validator refuses a reply that pitches an out-of-target offer", () => {
    const resolved = resolveTarget({ scope: "SELECTED", serviceIds: [SEO], catalogueItemIds: [] }, catalogueItems);
    const names = offTargetNames(resolved, services, catalogueItems);
    assert.ok(names.includes("Website design"));
    assert.ok(names.includes("Pro site"));
    assert.ok(!names.includes("SEO audit"));
    assert.deepEqual(offTargetMentions("We could also do a Pro site for you.", names), ["Pro site"]);

    const result = validateResponse("We could also build you a Pro site. Want me to send times?", { ...facts(), offTargetNames: names });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "OFF_TARGET_OFFER"));
    const fine = validateResponse("Happy to walk you through the SEO audit. Does Tuesday suit?", { ...facts(), offTargetNames: names });
    assert.ok(fine.ok || !fine.failures.some((f) => f.code === "OFF_TARGET_OFFER"));
  });

  test("a name inside an in-target name is not refused", () => {
    const resolved = resolveTarget({ scope: "SELECTED", serviceIds: [], catalogueItemIds: [ITEM_AUDIT] }, catalogueItems);
    const names = offTargetNames(resolved, [{ id: "88888888-8888-4888-8888-888888888888", name: "SEO" }, ...services], catalogueItems);
    assert.ok(!names.includes("SEO"), "\"SEO\" is part of \"SEO audit\"");
  });

  test("the whole catalogue refuses nothing", () => {
    const resolved = resolveTarget(WHOLE_CATALOGUE, catalogueItems);
    assert.deepEqual(offTargetNames(resolved, services, catalogueItems), []);
  });

  test("the closing agent chases only in-target goals", () => {
    const resolved = resolveTarget({ scope: "SELECTED", serviceIds: [SEO], catalogueItemIds: [] }, catalogueItems);
    const goals = closingGoalsInTarget(
      [
        { serviceId: WEB, goal: "C_DIRECT_SALE" },
        { serviceId: SEO, goal: "B_BOOK_MEETING" },
        { serviceId: null, goal: "D_SIGNUP_TRIAL" },
      ],
      resolved,
    );
    assert.deepEqual(goals, ["B_BOOK_MEETING"]);
    assert.equal(closingGoalsInTarget([{ serviceId: null, goal: "D_SIGNUP_TRIAL" }], resolveTarget(WHOLE_CATALOGUE, [])).length, 1);
  });

  test("the closing tick reads the target and filters goals by it (enforced server-side)", () => {
    const source = readFileSync("src/lib/agents/ticks.ts", "utf8");
    assert.match(source, /loadAgentOfferTargetOrWhole\(agent\.business_id, agent\.id\)/);
    assert.match(source, /closingGoalsInTarget\(/);
    assert.doesNotMatch(source, /if \(agent\.service_id\) query/);
  });

  test("the conversation context filters the card and the published prices by the target", () => {
    const source = readFileSync("src/lib/agent/context.ts", "utf8");
    assert.match(source, /servicesInTarget\(services, rules\)/);
    assert.match(source, /servicesInTarget\(context\.workspace\.services, context\.commercialRules\)/);
  });

  test("describeTarget reads plainly", () => {
    assert.equal(describeTarget(WHOLE_CATALOGUE, services, catalogueItems), "Whole catalogue");
    assert.equal(describeTarget({ scope: "SELECTED", serviceIds: [SEO], catalogueItemIds: [ITEM_BASIC] }, services, catalogueItems), "Search optimisation, Basic site");
  });
});

/* ------------------------------------------------------------ competitors */

const acme: Competitor = competitorSchema.parse({
  id: "acme",
  name: "Acme Digital",
  aliases: ["Acme"],
  approvedPoints: ["Unlike Acme, onboarding is included in every plan."],
  neverSay: ["Acme is going bust"],
});

function facts(): ValidationFacts {
  return {
    channel: "email",
    businessName: "Northlight Studio",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
  };
}

describe("competitors: detection", () => {
  test("a mention is detected by name or alias, whole words only, case-insensitively", () => {
    assert.deepEqual(detectCompetitorMentions(["We're also talking to acme."], [acme]).map((c) => c.id), ["acme"]);
    assert.deepEqual(detectCompetitorMentions(["ACME DIGITAL quoted us"], [acme]).map((c) => c.id), ["acme"]);
    assert.deepEqual(detectCompetitorMentions(["The acmeist movement"], [acme]), []);
    assert.deepEqual(detectCompetitorMentions(["no competitor here"], [acme]), []);
    assert.deepEqual(detectCompetitorMentions(["acme"], [{ ...acme, enabled: false }]), [], "a switched-off competitor is not used");
  });

  test("the card carries only the mentioned competitor's approved points and never-say lines", () => {
    const lines = competitorCardLines([acme]);
    assert.deepEqual(lines.approved, ["Acme Digital: Unlike Acme, onboarding is included in every plan."]);
    assert.deepEqual(lines.neverSay, ["Acme Digital: Acme is going bust"]);
  });

  test("stored rows are validated; an invalid one is counted, never half-used", () => {
    const parsed = parseCompetitorRows([acme, { id: "Bad Slug", name: "x" }]);
    assert.equal(parsed.competitors.length, 1);
    assert.equal(parsed.invalid, 1);
  });

  test("an approved point may not be a put-down", () => {
    assert.match(competitorTextProblems({ ...acme, approvedPoints: ["Acme are cowboys."] })!, /put-downs/);
    assert.equal(competitorTextProblems(acme), null);
  });
});

describe("competitors: the validator guard", () => {
  const rules = competitorRules([acme]);

  test("an approved point, word for word, passes", () => {
    assert.deepEqual(competitorClaimFailures("Good question. Unlike Acme, onboarding is included in every plan.", rules), []);
  });

  test("a neutral mention passes", () => {
    assert.deepEqual(competitorClaimFailures("Happy to talk through how we compare with Acme on a call.", rules), []);
  });

  test("an invented comparison is blocked", () => {
    const failures = competitorClaimFailures("We're much faster than Acme and they charge hidden fees.", rules);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "UNAPPROVED_COMPETITOR_CLAIM");
    assert.match(failures[0].correction, /word for word/);
  });

  test("disparagement is blocked even alongside an approved point", () => {
    const failures = competitorClaimFailures("Unlike Acme, onboarding is included in every plan, and honestly Acme are cowboys.", rules);
    assert.ok(failures.some((f) => /Disparaged/.test(f.detail)));
  });

  test("a never-say line is blocked anywhere in the reply, with or without the name", () => {
    const failures = competitorClaimFailures("Between us, Acme is going bust.", rules);
    assert.ok(failures.some((f) => /never-say/.test(f.detail)));
  });

  test("with no approved points any comparison is refused", () => {
    const bare = competitorRules([{ ...acme, approvedPoints: [] }]);
    const failures = competitorClaimFailures("We are cheaper than Acme.", bare);
    assert.equal(failures.length, 1);
    assert.match(failures[0].correction, /no approved points/);
  });

  test("curly apostrophes do not hide a claim", () => {
    assert.equal(competitorClaimFailures("Acme can’t do this.", rules).length, 1);
  });

  test("validateResponse applies it, so a failure takes the retry then hand-over path", () => {
    const result = validateResponse("Honestly we beat Acme on everything.", { ...facts(), competitors: rules });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "UNAPPROVED_COMPETITOR_CLAIM"));
    const ok = validateResponse("Unlike Acme, onboarding is included in every plan. Want to see how it works?", { ...facts(), competitors: rules });
    assert.ok(ok.ok || !ok.failures.some((f) => f.code === "UNAPPROVED_COMPETITOR_CLAIM"));
  });

  test("the orchestrator hands every enabled competitor to the validator", () => {
    const source = readFileSync("src/lib/agent/orchestrator.ts", "utf8");
    assert.match(source, /competitors: competitorRules\(input\.context\.commercialRules\?\.competitors \?\? \[\]\)/);
    assert.match(source, /offTargetNames: input\.context\.commercialRules\?\.offTargetNames \?\? \[\]/);
  });
});

/* ------------------------------------------------------------ offer card */

function cardInput(overrides: Partial<OfferCardInput> = {}): OfferCardInput {
  return {
    businessName: "Northlight Studio",
    businessDescription: "A web design studio in Leeds.",
    aiTone: "friendly",
    replyLength: "short",
    outreach: {
      tone: null,
      valueProposition: "Websites that turn visitors into enquiries.",
      keyMessages: "Fixed scopes",
      proofPoints: "Shopify Partner",
      avoid: null,
      callToAction: null,
      claimRestrictions: null,
    },
    playbook: null,
    signature: null,
    services: [{ name: "Website design", description: "Custom sites", publicPriceText: "From £2,500" }],
    facts: [],
    now: new Date("2026-09-28T12:00:00Z"),
    ...overrides,
  };
}

describe("offer card: RECOMMENDED FIT, competitor points, scope", () => {
  test("lead-specific sections render after every stable one, so the prefix stays cacheable", () => {
    const plain = buildOfferCard(cardInput()).text;
    const withRules = buildOfferCard(
      cardInput({
        recommendation: "Basic site (LEAD_SERVICE, BUDGET_FITS).",
        competitors: competitorCardLines([acme]),
      }),
    ).text;
    assert.ok(withRules.startsWith(plain), "the stable card is an exact prefix");
    assert.ok(withRules.indexOf(RECOMMENDED_FIT_SECTION) > plain.length - 1);
    assert.ok(withRules.includes(COMPETITOR_SECTION));
    assert.ok(withRules.includes("Never criticise a competitor"));
  });

  test("no mention, no competitor lines", () => {
    const text = buildOfferCard(cardInput({ competitors: competitorCardLines([]) })).text;
    assert.ok(!text.includes(COMPETITOR_SECTION));
    assert.ok(!text.includes("NEVER SAY ABOUT COMPETITORS"));
  });

  test("the scope line appears only for a targeted agent", () => {
    assert.ok(!buildOfferCard(cardInput()).text.includes("SCOPE"));
    assert.ok(buildOfferCard(cardInput({ targetNote: "This conversation sells only: SEO audit." })).text.includes("SCOPE"));
  });

  test("the token budget is unchanged and still holds with every new section", () => {
    assert.equal(OFFER_CARD_TOKEN_BUDGET, 600);
    const busy = buildOfferCard(
      cardInput({
        targetNote: "This conversation sells only: SEO audit, Basic site. Never offer anything else.",
        recommendation: "Basic site (LEAD_SERVICE, BUDGET_FITS, REGION_MATCH).",
        competitors: competitorCardLines(
          Array.from({ length: 6 }, (_, i) => ({ ...acme, id: `c${i}`, name: `Rival ${i}`, approvedPoints: [`Unlike Rival ${i}, onboarding is included in every plan we sell.`, `Rival ${i} needs a twelve month contract; ours is monthly.`] })),
        ),
        examples: { good: ["Thanks for getting in touch, happy to help."], bad: ["Dear valued customer"] },
      }),
    );
    assert.ok(busy.tokens <= OFFER_CARD_TOKEN_BUDGET, `${busy.tokens} tokens`);
  });
});

/* -------------------------------------------------------- Instagram gate */

describe("Instagram without Meta approval: no reply composed or queued", () => {
  const connection = { connected: true, pageId: "p1", instagramUserId: "ig1" };

  test("instagram_manage_messages missing blocks the turn with a hand-over reason", () => {
    const capability = metaChannelCapability("instagram", { ...connection, scopes: ["instagram_basic", "pages_messaging"] });
    const gate = instagramReplyGate("instagram", capability);
    assert.equal(gate.blocked, true);
    assert.ok(gate.blocked && gate.missing.includes("instagram_manage_messages"));
    assert.ok(gate.blocked && /requires Meta approval/.test(gate.detail));
    assert.ok(gate.blocked && /No reply was written or queued/.test(gate.detail));
  });

  test("granted, unverified, or another channel: the turn goes on", () => {
    const ready = metaChannelCapability("instagram", { ...connection, scopes: ["instagram_basic", "instagram_manage_messages"] });
    assert.equal(instagramReplyGate("instagram", ready).blocked, false);
    const unverified = metaChannelCapability("instagram", { ...connection, scopes: null });
    assert.equal(instagramReplyGate("instagram", unverified).blocked, false);
    const missing = metaChannelCapability("instagram", { ...connection, scopes: ["instagram_basic"] });
    assert.equal(instagramReplyGate("messenger", missing).blocked, false);
    assert.equal(instagramReplyGate("sms", missing).blocked, false);
    assert.equal(instagramReplyGate("instagram", null).blocked, false);
  });

  test("the orchestrator gates before composing, hands over without sending, after binding verdicts", () => {
    const source = readFileSync("src/lib/agent/orchestrator.ts", "utf8");
    const gate = source.indexOf("instagramReplyGate(");
    const binding = source.indexOf("return handleBindingVerdict(input, input.binding.intent);");
    const nudge = source.indexOf("const checkoutNudge = checkoutNudgeOf(event);");
    assert.ok(gate > binding && gate < nudge, "after opt-out/complaint handling, before any composing branch");
    assert.match(source, /handover\(input, "POLICY", instagram\.detail, \{ acknowledged: true, trigger: META_APPROVAL_TRIGGER \}\)/);
    assert.equal(META_APPROVAL_TRIGGER, "META_APPROVAL_REQUIRED");
  });
});

/* -------------------------------------------------------------- the spine */

describe("commercial rules: registry and migration", () => {
  test("every new capability is a registry operation with a handler module", () => {
    const registry = readFileSync("src/lib/services/registry.ts", "utf8");
    for (const name of ["agent.set_offer_target", "competitor.list", "competitor.save", "competitor.remove", "lead.best_fit"]) {
      assert.ok(registry.includes(`name: "${name}"`), name);
    }
    const handlers = readFileSync("src/lib/services/operations/commercial-rules.ts", "utf8");
    for (const name of ["agent.set_offer_target", "competitor.list", "competitor.save", "competitor.remove", "lead.best_fit"]) {
      assert.ok(handlers.includes(`defineOperation("${name}"`), name);
    }
    assert.match(readFileSync("src/lib/services/index.ts", "utf8"), /import "\.\/operations\/commercial-rules";/);
  });

  test("0174 is additive, RLS-forced, member-read and service-role-written", () => {
    const sql = readFileSync("supabase/migrations/0174_commercial_rules.sql", "utf8");
    assert.match(sql, /^-- 0174_commercial_rules/);
    assert.match(sql, /business_id uuid not null references public\.businesses\(id\) on delete cascade/);
    assert.match(sql, /alter table public\.workspace_competitors enable row level security;/);
    assert.match(sql, /alter table public\.workspace_competitors force row level security;/);
    assert.match(sql, /revoke all on public\.workspace_competitors from anon, authenticated;/);
    assert.match(sql, /grant select on public\.workspace_competitors to authenticated;/);
    assert.match(sql, /using \(public\.is_business_member\(business_id\)\)/);
    assert.match(sql, /grant select \(offer_scope, target_service_ids, target_catalogue_item_ids\) on public\.agents to authenticated;/);
    assert.doesNotMatch(sql, /drop table|drop column|grant (insert|update|delete)/i);
  });

  test("no client file imports the service-role client or the server-only loaders", () => {
    for (const file of [
      "src/components/agents/offer-target-picker.tsx",
      "src/components/agents/agent-offer-target-form.tsx",
      "src/components/settings/ai-selling/competitors-card.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /^"use client";/);
      assert.doesNotMatch(source, /supabase\/admin|rules-queries|server-only/);
    }
  });
});
