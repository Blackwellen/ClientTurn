import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { extract, extractCounts, extractRevenue } from "../src/lib/qualification-intelligence/extractors.ts";
import { interpret, type InterpretState } from "../src/lib/qualification-intelligence/interpret.ts";
import {
  evaluatePredicate,
  intentByKey,
  renderIntent,
  serviceTermsFor,
  verifyIntentFor,
  type FactValue,
} from "../src/lib/qualification-intelligence/question-intents.ts";
import { normaliseFactValue } from "../src/lib/qualification-intelligence/facts.ts";
import { evidencedHandoverReason, READY_TO_BUY_INTENT_STATES } from "../src/lib/qualification-intelligence/nba.ts";
import { INTENT_STATES, QI_CHANNELS, QI_DIMENSION_KEYS, type FactDimension } from "../src/lib/qualification-intelligence/types.ts";
import { repeatedQuestion, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { restatedAsk, runConversation, type GoldenConversation, type TurnRow } from "./golden-conversations/harness.ts";

/**
 * Defects found by reading the golden conversations' actual output by hand
 * (docs/revenue-engine/11-final-report.md §110, rows MI-1..MI-3), which the
 * automated suite passed. Every test here asserts on the rendered wording or
 * the decision itself, not only the action type.
 *
 *   MI-1  VERIFY templating doubled units and hedges ("around about 40 staff staff").
 *   MI-2  Questions on what the lead had already said, in substance.
 *   MI-3  "Turnover around 900k" was filed as BUDGET.
 *   MI-4  READY_TO_BUY hand-off label on a LOW-intent lead (ecommerce-02).
 *   MI-5  The validator accepted a word-for-word repeat of an earlier question.
 */

const NOW = "2026-09-24T09:00:00.000Z";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const state = (extra: Partial<InterpretState> = {}): InterpretState => ({ messageId: MESSAGE, now: NOW, ...extra });
const factFor = (i: ReturnType<typeof interpret>, dimension: string) => i.facts.find((f) => f.dimension === dimension);

const GOLDEN_DIR = path.join(process.cwd(), "tests", "golden-conversations");
const golden = (id: string): GoldenConversation => JSON.parse(readFileSync(path.join(GOLDEN_DIR, `${id}.json`), "utf8")) as GoldenConversation;
const rowsOf = (id: string): TurnRow[] => runConversation(golden(id));
const asks = (row: TurnRow) => row.nba.question_intent !== null && ["ASK", "ANSWER_AND_ASK", "CTA_BOOK"].includes(row.action);

/* ================================================================ MI-1 */

/** Realistic stored values: numbers with and without units, hedges, ranges, money, dates, text. */
const VALUES = [
  "40",
  "about 40 staff",
  "around about 40 staff",
  "roughly 40 people",
  "40 staff",
  "40-50 staff",
  "forty staff",
  "just me",
  "12 users",
  "about 12 people using it",
  "a sales team of 12 people",
  "about 2,000 orders",
  "2000 orders a month",
  "maybe 10 or so",
  "15ish",
  "£20k",
  "about £20k",
  "a budget of 20k",
  "the budget is around £20k",
  "20k a month",
  "£1,500 per month",
  "about 8 staff; turnover around 900k",
  "turnover around 900k",
  "next month",
  "in the spring",
  "not until the spring",
  "31 March",
  "2026-12-01",
  "As soon as possible really",
  "and we'd want someone in place within the next month",
  "LS6 2AB",
  "the postcode is LS6 2AB",
  "our current provider",
  "in-house",
  "no one",
  "Roof repair",
  "SEO",
  "Google Ads management",
  "accounts and tax",
  "We need a new website for our architecture practice",
  "Our IT support is awful",
  "I'm the MD",
  "yes",
];

const UNIT_WORDS = ["staff", "people", "users", "orders", "devices", "budget", "turnover", "timing", "postcode"];

function problemsWith(text: string): string[] {
  const problems: string[] = [];
  const repeated = /\b([A-Za-z0-9£,']+)\s+\1\b/i.exec(text);
  if (repeated) problems.push(`repeated word "${repeated[0]}"`);
  if (/\baround about\b|\b(around|about|roughly|approximately)\s+(around|about|roughly|approximately|approx)\b/i.test(text)) problems.push("doubled hedge");
  for (const unit of UNIT_WORDS) {
    const count = (text.match(new RegExp(`\\b${unit}\\b`, "gi")) ?? []).length;
    if (count > 1) problems.push(`"${unit}" ${count} times`);
  }
  if ((text.match(/\?/g) ?? []).length !== 1 || !text.trim().endsWith("?")) problems.push("not exactly one question");
  if (/\{[a-z_]+\}|undefined|null|NaN/.test(text)) problems.push("unfilled or broken placeholder");
  if (!/^[A-Z]/.test(text)) problems.push("does not start with a capital");
  return problems;
}

describe("MI-1: VERIFY wording never doubles a unit or a hedge", () => {
  test("the §110 case: a stored 'about 40 staff' renders naturally", () => {
    const verify = verifyIntentFor("COMPANY_SIZE", "about 40 staff", "40");
    assert.equal(renderIntent(verify, "sms"), "Just to check, is it around 40 staff?");
    assert.equal(renderIntent(verifyIntentFor("COMPANY_SIZE", "about 40 staff", null), "email"), "Just to check, is it around 40 staff?");
    assert.equal(renderIntent(verifyIntentFor("COMPANY_SIZE", "around about 40 staff", "40"), null), "Just to check, is it around 40 staff?");
  });

  test("shape by value: team size, budget, timing, provider, service, revenue, a sole trader", () => {
    const r = (dimension: (typeof QI_DIMENSION_KEYS)[number], value: string, normalised: string | null = null) =>
      renderIntent(verifyIntentFor(dimension, value, normalised), "email");
    assert.equal(r("TEAM_SIZE", "a sales team of 12 people", "12"), "Just to check, would it be around 12 people using it?");
    assert.equal(r("BUDGET", "a budget of about £20k"), "Just to check, is the budget still around £20k?");
    assert.equal(r("BUDGET", "roughly twenty grand", "gbp:20000"), "Just to check, is the budget still around £20k?");
    assert.equal(r("TIMING", "and we'd want someone in place within the next month"), "Last time you mentioned you'd want someone in place within the next month; is that still the timing?");
    assert.equal(r("CURRENT_SOLUTION", "our current provider", "EXTERNAL_PROVIDER"), "Is your provider still looking after this for you?");
    assert.equal(r("CURRENT_SOLUTION", "in-house", "IN_HOUSE"), "Just to check, is this still handled in-house?");
    assert.equal(r("SERVICE_NEEDED", "Roof repair"), "Just to check, it's roof repair you're after?", "no stray capital mid-sentence");
    assert.equal(r("SERVICE_NEEDED", "SEO"), "Just to check, it's SEO you're after?", "an acronym keeps its capitals");
    assert.equal(r("COMPANY_SIZE", "turnover around 900k", "revenue:gbp:900000"), "Just to check, is annual turnover around £900k?");
    assert.equal(r("COMPANY_SIZE", "just me", "1"), "Just to check, is it just you at the company?");
    assert.equal(r("LOCATION", "the postcode is ls6 2ab"), "Just to confirm, is the work at LS6 2AB?");
  });

  test("property: every dimension x every channel x realistic values", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const dimension of QI_DIMENSION_KEYS) {
      for (const value of VALUES) {
        const normalisedVariants = new Set<string | null>([null, normaliseFactValue(dimension as FactDimension, value)]);
        const count = extractCounts(value)[0]?.normalised;
        if (count) normalisedVariants.add(count);
        if (dimension === "COMPANY_SIZE" && /turnover/.test(value)) normalisedVariants.add(extractRevenue(value)?.normalised ?? null);
        for (const normalised of normalisedVariants) {
          const intent = verifyIntentFor(dimension, value, normalised);
          for (const channel of [...QI_CHANNELS, null]) {
            const text = renderIntent(intent, channel);
            checked += 1;
            const problems = problemsWith(text);
            if (problems.length > 0) failures.push(`${dimension} "${value}" (${normalised}) on ${channel}: "${text}" -> ${problems.join(", ")}`);
          }
        }
      }
    }
    assert.ok(checked > 5_000, `only ${checked} renderings checked`);
    assert.deepEqual(failures.slice(0, 20), [], `${failures.length} bad renderings`);
  });

  test("the property check itself catches the old wording", () => {
    assert.deepEqual(problemsWith("Just to check, is it around about 40 staff staff?").sort(), [
      "doubled hedge",
      'repeated word "staff staff"',
      '"staff" 2 times',
    ].sort());
    assert.ok(problemsWith("Just to check, is the budget still around a budget of 20k?").includes('"budget" 2 times'));
  });

  test("golden msp-01: no VERIFY of the headcount the lead gave two messages earlier", () => {
    const rows = rowsOf("msp-01-slow-support");
    for (const row of rows) {
      const text = row.nba.question_intent?.rendering ?? "";
      assert.ok(!/Just to check/.test(text), `T${row.turn}: "${text}"`);
      assert.deepEqual(problemsWith(text || "A?").filter((p) => p !== "not exactly one question"), []);
    }
    assert.equal(rows[0].dimensions.find((d) => d.dimension === "COMPANY_SIZE")?.status, "CONFIRMED", "'We're about 40 staff' is what the lead told us");
  });
});

/* ================================================================ MI-2 */

describe("MI-2: a stated fact is captured for its dimension", () => {
  test("a fault happening now answers the timing ('We've got a leak')", () => {
    const i = interpret("We've got a leak in the roof over the kitchen, can someone take a look?", state());
    const timing = factFor(i, "TIMING");
    assert.equal(timing?.state, "CONFIRMED");
    assert.equal(timing?.value_normalised, "3");
    // Negative controls: a past fault and a plan are not "now".
    assert.equal(factFor(interpret("We had a leak last year, it was fixed.", state()), "TIMING"), undefined);
    assert.notEqual(factFor(interpret("Thinking about a new roof at some point", state()), "TIMING")?.value_normalised, "3");
  });

  test("a season is a timeframe, and 'not until the spring' is a not-now", () => {
    const i = interpret("Thinking about a new roof but not until the spring", state());
    const timing = factFor(i, "TIMING");
    assert.ok(timing, "timing captured");
    assert.ok(Number(timing!.value_normalised) > 120, `spring from September is months away: ${timing!.value_normalised}`);
    const notNow = i.signals.find((s) => s.signal_type === "NOT_NOW");
    assert.ok(notNow?.resume_at && notNow.resume_at >= "2027-02-15", `resume ${notNow?.resume_at}`);
    // "not right now" is not "right now".
    assert.notEqual(extract("TIMELINE", "Honestly not right now, maybe in the spring", { now: NOW })?.normalised, "3");
  });

  test("a need for a tool is the use case, not a problem", () => {
    const i = interpret("We need something to route inbound leads to the right rep automatically.", state());
    assert.equal(factFor(i, "USE_CASE")?.state, "CONFIRMED");
    assert.match(factFor(i, "USE_CASE")!.value, /route inbound leads/);
    assert.equal(factFor(i, "PROBLEM"), undefined);
    // Control: a stated problem is still a problem.
    assert.ok(factFor(interpret("We need help with our slow checkout, customers keep dropping off.", state()), "PROBLEM"));
  });

  test("a named plan is the product interest", () => {
    const i = interpret("I'm interested in the standard fulfilment plan.", state());
    assert.equal(factFor(i, "PRODUCT_INTEREST")?.value, "standard fulfilment plan");
    assert.equal(factFor(i, "PRODUCT_INTEREST")?.state, "CONFIRMED");
    assert.equal(factFor(interpret("I'm interested in finding out more.", state()), "PRODUCT_INTEREST"), undefined);
  });

  test("an accountant's service options are read from the lead's words; other business types are not", () => {
    const reply = "We need someone to do our year end accounts and corporation tax.";
    const accounting = interpret(reply, state({ context: { serviceTerms: serviceTermsFor("ACCOUNTING") } }));
    assert.equal(factFor(accounting, "SERVICE_NEEDED")?.value, "accounts and tax");
    assert.equal(factFor(accounting, "SERVICE_NEEDED")?.state, "CONFIRMED");
    assert.equal(factFor(interpret(reply, state({ context: { serviceTerms: serviceTermsFor("MSP") } })), "SERVICE_NEEDED"), undefined);
    assert.equal(factFor(interpret("Payroll for 8 staff please", state({ context: { serviceTerms: serviceTermsFor("ACCOUNTING") } })), "SERVICE_NEEDED")?.value, "payroll");
  });

  test("a hedged count is CONFIRMED when self-stated, INFERRED when not", () => {
    assert.equal(factFor(interpret("We're about 40 staff.", state()), "COMPANY_SIZE")?.state, "CONFIRMED");
    assert.equal(factFor(interpret("They have about 40 staff there.", state()), "COMPANY_SIZE")?.state, "INFERRED");
  });
});

describe("MI-2: the five golden conversations no longer ask what the lead said", () => {
  test("roofer-01: after 'We've got a leak', no 'Is it leaking now?'; the postcode is asked instead", () => {
    const rows = rowsOf("roofer-01-leak-to-booking");
    for (const row of rows.slice(0, 2)) {
      assert.ok(!/leaking now/i.test(row.nba.question_intent?.rendering ?? ""), `T${row.turn}: ${row.nba.question_intent?.rendering}`);
      assert.notEqual(row.nba.question_intent?.dimension, "TIMING");
    }
    assert.equal(rows[0].nba.question_intent?.rendering, "What's the postcode for the job?");
  });

  test("roofer-03: 'not until the spring' waits until spring rather than asking the timing", () => {
    const [first] = rowsOf("roofer-03-not-now");
    assert.equal(first.action, "WAIT");
    assert.equal(first.nba.question_intent, null);
    assert.ok((first.nba.resume_at ?? "") >= "2027-02-15", `resume ${first.nba.resume_at}`);
  });

  test("accounting-01: no 'accounts, tax, payroll, or advisory?' after 'year end accounts and corporation tax'", () => {
    const rows = rowsOf("accounting-01-year-end");
    for (const row of rows) assert.ok(!/payroll, or advisory/i.test(row.nba.question_intent?.rendering ?? ""), `T${row.turn}: ${row.nba.question_intent?.rendering}`);
    assert.ok(rows[0].known.includes("SERVICE_NEEDED"));
  });

  test("saas-01: no 'What would you mainly want the platform to handle?' after the lead said what", () => {
    for (const row of rowsOf("saas-01-use-case-to-trial")) {
      assert.ok(!/mainly want/i.test(row.nba.question_intent?.rendering ?? ""), `T${row.turn}: ${row.nba.question_intent?.rendering}`);
    }
  });

  test("ecommerce-01: no 'Which product were you looking at?' after the lead named the plan", () => {
    const [first] = rowsOf("ecommerce-01-product-to-checkout");
    assert.ok(!/which product/i.test(first.nba.question_intent?.rendering ?? ""), first.nba.question_intent?.rendering);
    assert.ok(first.known.includes("PRODUCT_INTEREST"));
  });
});

describe("MI-2: the golden B9 invariant fails on the old behaviour", () => {
  // The questions the engine produced before the fix (§110), replayed through
  // the invariant the golden suite now applies to every turn.
  const OLD: { id: string; archetype: string; said: string[]; asked: { dimension: string; purpose: string; key: string } }[] = [
    { id: "roofer-01 T1", archetype: "ROOFER", said: ["We've got a leak in the roof over the kitchen, can someone take a look?"], asked: { dimension: "TIMING", purpose: "DISCOVER", key: "TIMING.ROOFER" } },
    { id: "roofer-03 T1", archetype: "ROOFER", said: ["Thinking about a new roof but not until the spring"], asked: { dimension: "TIMING", purpose: "DISCOVER", key: "TIMING.ROOFER" } },
    {
      id: "accounting-01 T2",
      archetype: "ACCOUNTING",
      said: ["We need someone to do our year end accounts and corporation tax.", "We're a limited company, about 8 staff, turnover around 900k."],
      asked: { dimension: "SERVICE_NEEDED", purpose: "DISCOVER", key: "SERVICE_NEEDED.ACCOUNTING" },
    },
    { id: "saas-01 T1", archetype: "B2B_SAAS", said: ["We need something to route inbound leads to the right rep automatically."], asked: { dimension: "USE_CASE", purpose: "DISCOVER", key: "USE_CASE.B2B_SAAS" } },
    { id: "ecommerce-01 T1", archetype: "ECOMMERCE", said: ["I'm interested in the standard fulfilment plan."], asked: { dimension: "PRODUCT_INTEREST", purpose: "DISCOVER", key: "PRODUCT_INTEREST.WHICH" } },
    {
      id: "msp-01 T3",
      archetype: "MSP",
      said: ["Our IT support is awful, tickets take days. We're about 40 staff.", "Mainly day to day support, and we'd want someone in place within the next month", "Can we book a call this week?"],
      asked: { dimension: "COMPANY_SIZE", purpose: "VERIFY", key: "COMPANY_SIZE.VERIFY" },
    },
  ];
  for (const old of OLD) {
    test(`${old.id}: ${old.asked.key} is a violation`, () => {
      assert.ok(restatedAsk(old.said, old.asked, old.archetype), `${old.id} passed B9`);
    });
  }

  test("controls: a stale VERIFY, a CLARIFY and an unstated dimension pass", () => {
    const said = ["We're about 40 staff."];
    assert.equal(restatedAsk(said, { dimension: "COMPANY_SIZE", purpose: "VERIFY", stale: true }, "MSP"), null);
    assert.equal(restatedAsk(said, { dimension: "COMPANY_SIZE", purpose: "CLARIFY" }, "MSP"), null);
    assert.equal(restatedAsk(said, { dimension: "TIMING", purpose: "DISCOVER" }, "MSP"), null);
  });
});

/* ================================================================ MI-3 */

describe("MI-3: turnover, revenue and ARR are company size, never BUDGET", () => {
  for (const reply of [
    "We're a limited company, about 8 staff, turnover around 900k.",
    "Our turnover is about £1.2m a year",
    "We turn over roughly 900k",
    "Revenue of £5m last year",
    "We're at £2m ARR and growing",
    "About 900k turnover",
  ]) {
    test(`not a budget: "${reply}"`, () => {
      assert.equal(extract("MONEY", reply), null);
      const i = interpret(reply, state());
      assert.equal(factFor(i, "BUDGET"), undefined);
      assert.ok(factFor(i, "COMPANY_SIZE"), "kept as company-size context");
    });
  }

  for (const [reply, amount] of [
    ["We have a budget of 900k", "900000"],
    ["The budget is around £20k", "20000"],
    ["Turnover around 900k, and the budget is about £20k", "20000"],
    ["We can spend £15k on this, our revenue is £3m", "15000"],
  ] as const) {
    test(`negative control, still a budget: "${reply}"`, () => {
      assert.equal(extract("MONEY", reply)?.normalised, amount);
      assert.equal(factFor(interpret(reply, state()), "BUDGET")?.value_normalised, amount);
    });
  }

  test("headcount and turnover in one reply: the headcount is the value, the turnover its context", () => {
    const size = factFor(interpret("We're a limited company, about 8 staff, turnover around 900k.", state()), "COMPANY_SIZE");
    assert.equal(size?.value_normalised, "8");
    assert.equal(size?.state, "CONFIRMED");
    assert.match(size!.value, /about 8 staff; turnover around 900k/);
  });

  test("a turnover alone is an INFERRED size proxy no headcount rule reads as people", () => {
    const size = factFor(interpret("Our turnover is around £900k.", state()), "COMPANY_SIZE");
    assert.equal(size?.state, "INFERRED");
    assert.equal(size?.value_normalised, "revenue:gbp:900000");
    const values = new Map<FactDimension, FactValue>([["COMPANY_SIZE", { status: "INFERRED", value: size!.value, normalised: size!.value_normalised }]]);
    assert.equal(evaluatePredicate({ op: "lt", dimension: "COMPANY_SIZE", value: 5 }, { values }), false);
    assert.equal(evaluatePredicate({ op: "gte", dimension: "COMPANY_SIZE", value: 5 }, { values }), false);
  });

  test("'how many staff?' answered with a turnover is not 900 staff", () => {
    const i = interpret("Our turnover is 900k", state({ currentIntent: intentByKey("COMPANY_SIZE.STAFF") }));
    const size = factFor(i, "COMPANY_SIZE");
    assert.notEqual(size?.value_normalised, "900");
    assert.notEqual(size?.state, "CONFIRMED");
  });

  test("golden accounting-01 T2 no longer knows a BUDGET", () => {
    const rows = rowsOf("accounting-01-year-end");
    assert.ok(!rows[1].known.includes("BUDGET"), rows[1].known.join(","));
    assert.equal(rows[1].interpretation.facts.find((f) => f.dimension === "COMPANY_SIZE")?.value_normalised, "8");
  });
});

/* ================================================================ MI-4 */

describe("MI-4: the hand-off label follows the intent evidence", () => {
  test("READY_TO_BUY only at HIGH, BOOKING_READY or PURCHASE_READY", () => {
    for (const s of INTENT_STATES) {
      const expected = (READY_TO_BUY_INTENT_STATES as readonly string[]).includes(s) ? "READY_TO_BUY" : "POLICY";
      assert.equal(evidencedHandoverReason("READY_TO_BUY", s), expected, s);
      assert.equal(evidencedHandoverReason("HIGH_VALUE", s), "HIGH_VALUE", "other reasons pass through");
    }
  });

  // Owner decision 2026-09-27: without direct close the AI keeps the
  // conversation and a colleague sends the order details (was ESCALATE
  // READY_TO_BUY / POLICY). The evidence rule is unchanged: below HIGH intent
  // nobody is asked to send order details to a lead who is not buying yet.
  test("golden ecommerce-02: a threshold met at LOW intent is a qualified lead, not a ready buyer", () => {
    const rows = rowsOf("ecommerce-02-volume");
    const last = rows[rows.length - 1];
    assert.equal(last.action, "INFORM");
    assert.equal(last.intent, "LOW");
    assert.equal(last.nba.handover_reason, null);
    assert.equal(last.nba.assist_reason, null);
    assert.match(last.nba.reason, /Intent is LOW \(\d+\), so this is a qualified lead, not a ready buyer\./);
  });

  test("control: a lead who says they want to go ahead gets the order details from a colleague", () => {
    const [first] = rowsOf("studio-03-ready-to-start");
    assert.equal(first.intent, "PURCHASE_READY");
    assert.equal(first.nba.handover_reason, null);
    assert.equal(first.nba.assist_reason, "SEND_ORDER_DETAILS");
  });

  test("no golden turn labels READY_TO_BUY below HIGH intent", () => {
    for (const file of ["ecommerce-02-volume", "saas-01-use-case-to-trial", "saas-02-integration-question", "studio-01-new-site", "studio-02-budget-forbidden", "studio-03-ready-to-start"]) {
      for (const row of rowsOf(file)) {
        if (row.nba.handover_reason === "READY_TO_BUY") {
          assert.ok((READY_TO_BUY_INTENT_STATES as readonly string[]).includes(row.intent), `${file} T${row.turn}: READY_TO_BUY at ${row.intent}`);
        }
      }
    }
  });
});

/* ================================================================ MI-5 */

describe("MI-5: the validator rejects a repeat of an earlier question", () => {
  const facts = (extra: Partial<ValidationFacts> = {}): ValidationFacts => ({
    channel: "email",
    businessName: "Acme Studio",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
    ...extra,
  });
  const PRIOR = ["Thanks for your enquiry. Would a short call next week help you decide?"];

  test("a word-for-word repeat is rejected with QA_REPEAT", () => {
    const result = validateResponse("Would a short call next week help you decide?", facts({ priorOutbound: PRIOR }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.failures.some((f) => f.code === "QA_REPEAT"));
  });

  test("a repeat behind an opener or with a word changed is still a repeat", () => {
    for (const draft of ["Great. Would a short call next week help you decide?", "Great, would a quick call next week help you decide?", "would a short call next week help you to decide?"]) {
      assert.ok(repeatedQuestion(draft, PRIOR), draft);
    }
  });

  test("a different question passes, and short questions that differ are not near-duplicates", () => {
    assert.equal(repeatedQuestion("Here is the booking link: which time suits you best?", PRIOR), null);
    assert.equal(repeatedQuestion("Which time suits you?", ["Which day suits you?"]), null);
    assert.equal(validateResponse("Great. Here is the booking link so you can pick a time that suits.", facts({ priorOutbound: PRIOR })).ok, true);
  });

  test("a VERIFY of a stale fact may come close in new words, never repeat verbatim", () => {
    const prior = ["Roughly how many staff work at the company?"];
    const near = "Roughly how many staff work at the company now?";
    assert.ok(repeatedQuestion(near, prior), "near-duplicate without the exemption");
    assert.equal(repeatedQuestion(near, prior, { allowNearDuplicate: true }), null);
    assert.ok(repeatedQuestion("Roughly how many staff work at the company?", prior, { allowNearDuplicate: true })?.exact);
    assert.equal(validateResponse(near, facts({ priorOutbound: prior, verifyingStaleFact: true })).ok, true);
    assert.equal(validateResponse(prior[0], facts({ priorOutbound: prior, verifyingStaleFact: true })).ok, false);
  });

  test("no history, no check (engine OFF paths are unchanged)", () => {
    assert.equal(validateResponse("Would a short call next week help you decide?", facts()).ok, true);
  });
});

/* ======================================================= golden sanity */

describe("golden outputs read by hand after the fixes (§110)", () => {
  test("no planned question anywhere in the corpus has doubled words or hedges", () => {
    const files = ["accounting-01-year-end", "msp-01-slow-support", "roofer-01-leak-to-booking", "roofer-02-asks-to-book-first", "roofer-04-manual-booking", "studio-02-budget-forbidden"];
    for (const file of files) {
      for (const row of rowsOf(file)) {
        if (!asks(row)) continue;
        assert.deepEqual(problemsWith(row.nba.question_intent!.rendering), [], `${file} T${row.turn}: ${row.nba.question_intent!.rendering}`);
      }
    }
  });
});
