import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PLANS,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
} from "../src/lib/billing/plans.ts";
import { SOURCING_ALLOWANCES } from "../src/lib/billing/sourcing-allowances.ts";
import { WHATSAPP_TOKEN_PACKS } from "../src/lib/billing/whatsapp-tokens.ts";
import {
  AUTO_ENROLMENT,
  DEFAULT_INPUTS,
  DEFAULT_UNANSWERED_ATTEMPT_MINUTES,
  EMPLOYER_NI,
  SMS_BUNDLES_AS_PACKS,
  VOICE_PACKS_AS_PACKS,
  WORKSPACE_VOICE_MINUTES_PER_MONTH,
  calculate,
  capacitySuggestion,
  cheapestPackCombo,
  clientTurnSide,
  employerNi,
  employerPension,
  formatGbp,
  inputsFromQuery,
  inputsToQuery,
  matchSdrCalls,
  planAllowances,
  planMonthlyPrice,
  productiveDaysPerYear,
  rampFactor,
  sdrCost,
  sdrMonthlyActivity,
  summaryText,
  type CalculatorInputs,
} from "../src/lib/marketing/sdr-calculator.ts";

/**
 * /sdr-cost-calculator: the pure model (golden values) and the page's honesty
 * rules. The UK figures are the 2026/27 gov.uk values checked on 2026-09-28;
 * if HMRC or DWP change them, these tests are where the change is recorded.
 */

const inputs = (patch: Partial<CalculatorInputs> = {}): CalculatorInputs => ({
  ...DEFAULT_INPUTS,
  voicePacks: {},
  whatsappPacks: {},
  ...patch,
});

/* ---------------------------------------------------------- UK figures --- */

describe("UK employment figures (2026/27)", () => {
  test("the constants are the verified gov.uk values", () => {
    assert.equal(EMPLOYER_NI.rate, 0.15);
    assert.equal(EMPLOYER_NI.secondaryThresholdAnnual, 5_000);
    assert.equal(AUTO_ENROLMENT.employerMinimumRate, 0.03);
    assert.equal(AUTO_ENROLMENT.earningsTrigger, 10_000);
    assert.equal(AUTO_ENROLMENT.qualifyingLower, 6_240);
    assert.equal(AUTO_ENROLMENT.qualifyingUpper, 50_270);
  });

  test("employer NI at and around the secondary threshold", () => {
    assert.equal(employerNi(0), 0);
    assert.equal(employerNi(4_999), 0);
    assert.equal(employerNi(5_000), 0);
    assert.equal(employerNi(5_001), 0.15);
    assert.equal(employerNi(30_000), 3_750);
    assert.equal(employerNi(100_000), 14_250);
  });

  test("auto-enrolment pension at the trigger and both qualifying limits", () => {
    assert.equal(employerPension(0), 0);
    assert.equal(employerPension(6_240), 0);
    assert.equal(employerPension(10_000), 0, "at the trigger, not above it");
    assert.equal(employerPension(10_001), 112.83);
    assert.equal(employerPension(30_000), 712.8);
    assert.equal(employerPension(50_270), 1_320.9);
    assert.equal(employerPension(50_271), 1_320.9, "capped at the upper limit");
    assert.equal(employerPension(1_000_000), 1_320.9);
  });

  test("productive days and ramp-up", () => {
    assert.equal(productiveDaysPerYear(28, 6), 226);
    assert.equal(productiveDaysPerYear(200, 200), 0, "never negative");
    assert.equal(rampFactor(3, 50), 0.875);
    assert.equal(rampFactor(0, 0), 1);
    assert.equal(rampFactor(12, 0), 0);
    assert.equal(rampFactor(99, 0), 0, "clamped to a year");
  });
});

/* ----------------------------------------------------------- SDR side --- */

describe("the SDR's fully loaded cost and activity", () => {
  test("defaults: £30,000 salary", () => {
    const cost = sdrCost(inputs());
    assert.deepEqual(cost, {
      salary: 30_000,
      employerNi: 3_750,
      pension: 712.8,
      recruitment: 4_500,
      tools: 3_000,
      management: 3_000,
      equipment: 1_800,
      annual: 46_762.8,
      monthly: 3_896.9,
    });
  });

  test("NI and pension toggles remove their lines", () => {
    const cost = sdrCost(inputs({ employerNi: false, pension: false }));
    assert.equal(cost.employerNi, 0);
    assert.equal(cost.pension, 0);
    assert.equal(cost.annual, 46_762.8 - 3_750 - 712.8);
  });

  test("a month of activity at 60 calls a day", () => {
    const month = sdrMonthlyActivity(inputs());
    assert.equal(month.productiveDays, 18.8);
    assert.equal(month.calls, 1_130);
    assert.equal(month.emails, 753);
    assert.equal(month.messages, 377);
    assert.equal(month.leadsSourced, 471);
    // The owner's reference: 60 calls x 21 days = 1,260, before holiday and sickness.
    assert.equal(sdrMonthlyActivity(inputs({ holidayDays: 0, sickDays: 8 })).calls, 1_260);
  });

  test("zero inputs give zero outcomes and no cost per meeting", () => {
    const result = calculate(
      inputs({ salary: 0, callsPerDay: 0, emailsPerDay: 0, messagesPerDay: 0, leadsPerDay: 0 }),
    );
    assert.equal(result.sdr.cost.employerNi, 0);
    assert.equal(result.sdr.cost.pension, 0);
    assert.equal(result.sdr.outcomes.meetings, 0);
    assert.equal(result.sdr.costPerMeeting, null);
    assert.equal(result.sdr.costPerSale, null);
  });

  test("huge and invalid inputs are clamped, never NaN", () => {
    const result = calculate(
      inputs({ salary: 1e12, callsPerDay: 1e9, callConnectPct: 500, sickDays: Number.NaN }),
    );
    assert.equal(result.inputs.salary, 250_000);
    assert.equal(result.inputs.callsPerDay, 300);
    assert.equal(result.inputs.callConnectPct, 100);
    assert.equal(result.inputs.sickDays, 0);
    assert.ok(Number.isFinite(result.sdr.cost.annual));
    assert.ok(Number.isFinite(result.sdr.outcomes.meetings));
  });
});

/* ---------------------------------------------------- ClientTurn side --- */

describe("ClientTurn is read from the plan catalogue", () => {
  test("prices come from PLANS and VOICE_ADDON", () => {
    assert.equal(planMonthlyPrice("starter"), PLANS.starter.monthlyPrice);
    assert.equal(planMonthlyPrice("growth"), PLANS.growth.monthlyPrice);
    assert.equal(planMonthlyPrice("pro"), PLANS.pro.monthlyPrice);
    assert.equal(planMonthlyPrice("pro_voice"), (PLANS.pro.monthlyPrice as number) + VOICE_ADDON.monthlyPriceGbp);
    assert.equal(planMonthlyPrice("enterprise"), null);
  });

  test("allowances come from PLANS and SOURCING_ALLOWANCES", () => {
    for (const plan of ["starter", "growth", "pro"] as const) {
      const a = planAllowances(plan);
      assert.equal(a.emailSends, SOURCING_ALLOWANCES[plan].emailSends);
      assert.equal(a.verifiedProspects, SOURCING_ALLOWANCES[plan].verifiedProspects);
      assert.equal(a.leadsProcessed, PLANS[plan].leadLimit);
      assert.equal(a.smsSegments, PLANS[plan].smsSegmentAllowance);
      assert.equal(a.includedVoiceMinutes, 0);
    }
    assert.equal(planAllowances("pro_voice").includedVoiceMinutes, VOICE_ADDON.includedMinutes);
    assert.equal(planAllowances("pro_voice").includesNumber, true);
  });

  test("packs on any plan, plus the number where the plan has none", () => {
    const [p100, p250] = VOICE_MINUTE_PACKS;
    const growth = clientTurnSide(inputs({ plan: "growth", voicePacks: { [p100.key]: 2, [p250.key]: 1 } }));
    assert.equal(growth.voiceMinutes, 450);
    assert.equal(growth.callsCovered, 90);
    assert.equal(growth.monthly, (PLANS.growth.monthlyPrice as number) + 2 * p100.priceGbp + p250.priceGbp + VOICE_NUMBER_MONTHLY_GBP);

    const proVoice = clientTurnSide(inputs({ plan: "pro_voice", voicePacks: { [p100.key]: 1 } }));
    assert.equal(proVoice.voiceMinutes, VOICE_ADDON.includedMinutes + 100);
    assert.equal(proVoice.breakdown.number, 0, "Pro with Voice includes the number");
  });

  test("WhatsApp tokens only count from Growth up", () => {
    const [pack] = WHATSAPP_TOKEN_PACKS;
    const starter = clientTurnSide(inputs({ plan: "starter", whatsappPacks: { [pack.tokens]: 1 } }));
    assert.equal(starter.whatsappBlocked, true);
    assert.equal(starter.monthly, PLANS.starter.monthlyPrice);
    const growth = clientTurnSide(inputs({ plan: "growth", whatsappPacks: { [pack.tokens]: 1 } }));
    assert.equal(growth.whatsappMessages, 200, "1,000 tokens at 5 a marketing message");
    assert.equal(growth.monthly, (PLANS.growth.monthlyPrice as number) + pack.priceGbp);
  });

  test("Enterprise has no invented price", () => {
    const result = calculate(inputs({ plan: "enterprise" }));
    assert.equal(result.clientTurn.monthly, null);
    assert.equal(result.clientTurn.costPerMeeting, null);
    assert.equal(result.savingMonthly, null);
    assert.match(summaryText(result), /contact sales/);
  });

  test("by default ClientTurn runs the SDR's volume, capped at the allowance", () => {
    const sdr = sdrMonthlyActivity(inputs());
    const like = clientTurnSide(inputs());
    assert.equal(like.activity.emails, sdr.emails);
    assert.equal(like.activity.leadsSourced, Math.min(sdr.leadsSourced, SOURCING_ALLOWANCES.growth.verifiedProspects));
    const full = clientTurnSide(inputs({ volume: "allowance" }));
    assert.equal(full.activity.emails, SOURCING_ALLOWANCES.growth.emailSends);
  });

  test("the same conversion rates apply to both sides", () => {
    // At equal volume and no ramp-up, email and message meetings are identical.
    const equal = calculate(inputs({ callsPerDay: 0, rampMonths: 0, leadsPerDay: 0 }));
    assert.equal(equal.clientTurn.outcomes.meetings, equal.sdr.outcomes.meetings);
  });

  test("default golden result", () => {
    const result = calculate(inputs());
    assert.equal(result.clientTurn.monthly, 199);
    assert.equal(result.sdr.cost.monthly, 3_896.9);
    assert.equal(result.savingMonthly, 3_697.9);
    assert.equal(result.savingAnnual, 46_762.8 - 199 * 12);
  });
});

/* ------------------------------------------------------- pack maths --- */

describe("cheapest pack combinations", () => {
  test("voice packs: golden values", () => {
    const combo = (need: number) => {
      const c = cheapestPackCombo(VOICE_PACKS_AS_PACKS, need);
      return [c.counts, c.units, c.priceGbp];
    };
    assert.deepEqual(combo(0), [{}, 0, 0]);
    assert.deepEqual(combo(-5), [{}, 0, 0]);
    assert.deepEqual(combo(1), [{ voice_100: 1 }, 100, 49]);
    assert.deepEqual(combo(150), [{ voice_100: 2 }, 200, 98]);
    assert.deepEqual(combo(250), [{ voice_250: 1 }, 250, 115]);
    assert.deepEqual(combo(300), [{ voice_100: 3 }, 300, 147]);
    assert.deepEqual(combo(749), [{ voice_250: 1, voice_500: 1 }, 750, 340]);
    assert.deepEqual(combo(1_000), [{ voice_1000: 1 }, 1_000, 449]);
    assert.deepEqual(combo(1_200), [{ voice_100: 2, voice_1000: 1 }, 1_200, 547]);
    assert.deepEqual(combo(5_000), [{ voice_1000: 5 }, 5_000, 2_245]);
    assert.deepEqual(combo(123_456), [{ voice_1000: 123, voice_500: 1 }, 123_500, 55_452]);
  });

  test("never cheaper to buy a different cover (brute force up to 3,000 minutes)", () => {
    const packs = VOICE_PACKS_AS_PACKS;
    for (let need = 50; need <= 3_000; need += 50) {
      let best = Infinity;
      for (let a = 0; a <= 30; a++)
        for (let b = 0; b <= 12; b++)
          for (let c = 0; c <= 6; c++)
            for (let d = 0; d <= 3; d++) {
              const units = a * 100 + b * 250 + c * 500 + d * 1000;
              if (units < need) continue;
              best = Math.min(best, a * 49 + b * 115 + c * 225 + d * 449);
            }
      assert.equal(cheapestPackCombo(packs, need).priceGbp, best, `need ${need}`);
    }
  });

  test("SMS bundles use the same maths", () => {
    const c = cheapestPackCombo(SMS_BUNDLES_AS_PACKS, 120);
    assert.equal(c.units, 200);
    assert.equal(c.priceGbp, 48);
  });
});

/* ----------------------------------------------- match my SDR's calls --- */

describe("matching the SDR's calls with voice packs", () => {
  test("connected conversations on Growth", () => {
    const match = matchSdrCalls(inputs(), "connects");
    assert.equal(match.minutesNeeded, 565, "113 connects x 5 min");
    assert.deepEqual(match.combo.counts, { voice_100: 1, voice_500: 1 });
    assert.equal(match.minutes, 600);
    assert.equal(match.callsCovered, 120);
    assert.equal(match.addedMonthly, 274 + VOICE_NUMBER_MONTHLY_GBP);
  });

  test("every dial, unanswered attempts at the economics §13.4 length", () => {
    assert.equal(DEFAULT_UNANSWERED_ATTEMPT_MINUTES, 0.18);
    const match = matchSdrCalls(inputs(), "dials");
    assert.equal(match.minutesNeeded, 749, "113 x 5 + 1,017 x 0.18");
    assert.equal(match.combo.priceGbp, 340);
  });

  test("Pro with Voice counts its included minutes and number", () => {
    const match = matchSdrCalls(inputs({ plan: "pro_voice" }), "connects");
    assert.equal(match.includedMinutes, VOICE_ADDON.includedMinutes);
    assert.deepEqual(match.combo.counts, { voice_100: 4 });
    assert.equal(match.addedMonthly, 196, "no number: Pro with Voice includes it");
  });

  test("no calls needs no packs", () => {
    const match = matchSdrCalls(inputs({ callsPerDay: 0 }), "dials");
    assert.equal(match.combo.packs, 0);
    assert.equal(match.addedMonthly, 0);
  });

  test("beyond one workspace's calling capacity it points to sales", () => {
    const match = matchSdrCalls(inputs({ callsPerDay: 300, callConnectPct: 100, avgCallMinutes: 30 }), "connects");
    assert.ok(match.minutesNeeded > WORKSPACE_VOICE_MINUTES_PER_MONTH);
    assert.equal(match.beyondWorkspaceCapacity, true);
  });
});

/* ------------------------------------------------ capacity suggestion --- */

describe("capacity is bounded by plan allowances", () => {
  test("default SDR out-sources Growth's prospects: suggest Pro", () => {
    const s = capacitySuggestion(inputs());
    assert.equal(s.plan, "pro");
    assert.equal(s.currentPlanCovers, false);
    assert.ok(s.shortfalls.some((gap) => gap.metric === "leadsSourced"));
  });

  test("a plan that already covers stays", () => {
    const s = capacitySuggestion(inputs({ plan: "pro", callsPerDay: 0 }));
    assert.equal(s.plan, "pro");
    assert.equal(s.currentPlanCovers, true);
  });

  test("beyond Pro's allowances: Enterprise, never 'unlimited'", () => {
    const s = capacitySuggestion(inputs({ plan: "starter", leadsPerDay: 300 }));
    assert.equal(s.plan, "enterprise");
    assert.equal(s.enterprise, true);
  });

  test("messages beyond the plan's SMS suggest the cheapest SMS top-up", () => {
    const s = capacitySuggestion(inputs({ plan: "pro", messagesPerDay: 100, leadsPerDay: 0 }));
    // 100 x 18.83 = 1,883 messages against Pro's 1,000 segments.
    assert.equal(s.smsTopUp.units >= 883, true);
    assert.equal(s.smsTopUp.priceGbp, 211, "500 + 4 x 100 beats 1,000");
  });
});

/* --------------------------------------------------------------- URL --- */

describe("values persist in the URL", () => {
  test("the default link is bare", () => {
    assert.equal(inputsToQuery(inputs()), "");
  });

  test("round trip", () => {
    const changed = inputs({
      plan: "pro_voice",
      salary: 34_500,
      employerNi: false,
      volume: "allowance",
      voicePacks: { voice_250: 2 },
      whatsappPacks: { "2000": 1 },
      meetingToSalePct: 12.5,
    });
    const query = inputsToQuery(changed);
    assert.deepEqual(inputsFromQuery(query), changed);
  });

  test("junk in the query falls back to defaults", () => {
    const parsed = inputsFromQuery("plan=platinum&salary=abc&vp=<script>&calls=-50&ni=maybe");
    assert.equal(parsed.plan, DEFAULT_INPUTS.plan);
    assert.equal(parsed.salary, DEFAULT_INPUTS.salary);
    assert.deepEqual(parsed.voicePacks, {});
    assert.equal(parsed.callsPerDay, 0, "clamped to the minimum");
    assert.equal(parsed.employerNi, true);
  });
});

describe("formatting", () => {
  test("GBP", () => {
    assert.equal(formatGbp(3_896.9), "£3,897");
    assert.equal(formatGbp(2.87), "£2.87");
    assert.equal(formatGbp(0), "£0");
    assert.equal(formatGbp(99), "£99");
    assert.equal(formatGbp(11.99), "£11.99");
  });
});

/* ------------------------------------------------------------- page --- */

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const PAGE = "src/app/(marketing)/sdr-cost-calculator/page.tsx";
const UI = "src/components/marketing/public/sdr-calculator/calculator.tsx";

function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the /sdr-cost-calculator page", () => {
  test("server page with full metadata and one h1", () => {
    const page = read(PAGE);
    assert.doesNotMatch(page, /^"use client"/m);
    assert.match(page, /export const metadata: Metadata/);
    assert.match(page, /SDR cost calculator UK/i);
    assert.match(page, /alternates: \{ canonical:/);
    assert.match(page, /openGraph:/);
    assert.match(page, /twitter:/);
    const h1s = (page.match(/<h1[\s>]/g) ?? []).length + (read(UI).match(/<h1[\s>]/g) ?? []).length;
    assert.equal(h1s, 1);
  });

  test("the calculator is a client component using the pure module", () => {
    const ui = read(UI);
    assert.match(ui, /^"use client"/);
    assert.match(ui, /from "@\/lib\/marketing\/sdr-calculator"/);
  });

  test("no price or allowance typed by hand", () => {
    for (const file of [PAGE, UI]) {
      assert.doesNotMatch(code(file), /£\s?\d/, file);
    }
  });

  test("JSON-LD: an application with no ratings, FAQ only with a visible FAQ", () => {
    const page = read(PAGE);
    assert.match(page, /"@type": "WebApplication"/);
    assert.doesNotMatch(code(PAGE), /aggregateRating|ratingValue|reviewCount/);
    assert.match(page, /<FaqJsonLd items=\{FAQS\}/);
    assert.match(page, /<PublicFaq[\s\S]*items=\{FAQS\}/);
  });

  test("honesty: no 'unlimited', no fabricated proof, the footnote is present", () => {
    for (const file of [PAGE, UI, "src/lib/marketing/sdr-calculator.ts"]) {
      assert.doesNotMatch(code(file), /unlimited/i, file);
      assert.doesNotMatch(code(file), /testimonial|trusted by|\bcustomers? (?:say|saw|achieved)|\d+x more/i, file);
    }
    const page = read(PAGE);
    assert.match(page, /not financial advice/i);
    assert.match(page, /estimates/i);
    assert.match(page, /gov\.uk|EMPLOYER_NI\.source/);
    assert.match(page, /relationship/i);
    assert.match(read(UI), /example rates/i);
    assert.match(read(UI), /asked for a call/i);
  });

  test("reachable from the sitemap, nav and footer", () => {
    assert.match(read("src/app/sitemap.ts"), /"sdr-cost-calculator"/);
    const nav = read("src/components/marketing/public/nav-data.ts");
    assert.ok((nav.match(/\/sdr-cost-calculator/g) ?? []).length >= 2);
  });
});
