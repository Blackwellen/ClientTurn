import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PLANS, planOrder, TRIAL } from "../src/lib/billing/plans.ts";
import {
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  VOICE_ADDON,
  PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN,
  PRO_MONTHLY_GBP,
  PRO_WITH_VOICE_MONTHLY_GBP,
  PRO_WITH_VOICE_ANNUAL_MONTHLY_GBP,
  VOICE_TRIAL_NOTE,
  VOICE_TERMS,
  CALL_BUDGET_MINUTES,
  planVoiceOffer,
  publicFeatureLines,
  gbp,
} from "../src/lib/marketing/voice-offer.ts";
import { OPENER_TEMPLATE } from "../src/lib/voice/opener.ts";
import { CALL_BUDGET_SEC } from "../src/lib/voice/time-governor.ts";
import { SUBPROCESSORS, SUBPROCESSOR_CHANGES } from "../src/lib/marketing/subprocessors.ts";
import {
  PRIMARY_NAV,
  FOOTER_PRODUCT,
  FOOTER_COMPANY,
} from "../src/components/marketing/public/nav-data.ts";

/**
 * The AI Voice Sales Agent and quote-to-cash on the public site (home page
 * sections, /pricing #voice-pricing, /compliance #voice-calls).
 *
 * These pages sell a paid, regulated capability. The tests pin the things a
 * reviewer cannot eyeball reliably: that every price is derived from one
 * constants file, that voice is never presented as free or as part of a trial,
 * that nothing is "unlimited", that every mock is labelled as an illustrative
 * example, and that the motion has a reduced-motion path.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const REVENUE_DIR = "src/components/marketing/public/revenue";
const revenueFiles = readdirSync(path.join(root, REVENUE_DIR))
  .filter((name) => /\.(tsx?|css)$/.test(name))
  .map((name) => `${REVENUE_DIR}/${name}`);

const HOME = "src/app/(marketing)/page.tsx";
const PRICING = "src/app/(marketing)/pricing/page.tsx";
const COMPLIANCE = "src/app/(marketing)/compliance/page.tsx";
const HERO = "src/components/marketing/public/home/hero.tsx";

/** Every file that renders a voice or quote price or claim. */
const PRICE_SURFACES = [
  ...revenueFiles,
  HOME,
  PRICING,
  "src/components/marketing/public/pricing/plan-grid.tsx",
  "src/components/marketing/public/pricing/comparison.tsx",
  "src/components/marketing/public/home/pricing-preview.tsx",
  "src/components/marketing/public/home/faq-data.ts",
];

/** Source with comments removed, so a rule explained in a comment is not a hit. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ------------------------------------------------------------ OD-2 prices --- */

describe("the OD-2 prices come from the constants", () => {
  test("the constants hold the owner's OD-2 packaging", () => {
    assert.deepEqual(
      VOICE_MINUTE_PACKS.map((pack) => [pack.minutes, pack.priceGbp]),
      [
        [100, 49],
        [250, 115],
        [500, 225],
        [1000, 449],
      ],
    );
    assert.equal(VOICE_NUMBER_MONTHLY_GBP, 11.99);
    assert.equal(VOICE_ADDON.monthlyPriceGbp, 100);
    assert.equal(VOICE_ADDON.includedMinutes, 200);
    assert.equal(VOICE_ADDON.includesNumber, true);
    assert.equal(PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN, 0.2);
  });

  test("Pro with Voice is derived from the plan catalogue, not written out", () => {
    assert.equal(PRO_MONTHLY_GBP, PLANS.pro.monthlyPrice);
    assert.equal(PRO_MONTHLY_GBP, 399);
    assert.equal(PRO_WITH_VOICE_MONTHLY_GBP, 499);
    // The annual discount applies to the platform only (OD-2 "Annual Pro").
    assert.equal(
      PRO_WITH_VOICE_ANNUAL_MONTHLY_GBP,
      Math.round((PLANS.pro.yearlyPrice as number) / 12) + VOICE_ADDON.monthlyPriceGbp,
    );
  });

  test("the call budget quoted on the site is the governor's budget", () => {
    assert.equal(CALL_BUDGET_MINUTES * 60, CALL_BUDGET_SEC);
  });

  test("no page or component types a voice price by hand", () => {
    // Any of these literals in a public source means a price was written into
    // markup instead of read from lib/marketing/voice-offer.
    const literal = /£\s?(499|449|225|115|11\.99|49)\b|\b(499|11\.99)\b|0\.20\/min/;
    for (const file of PRICE_SURFACES) {
      const match = code(file).match(literal);
      assert.equal(match, null, `${file} contains a hand-typed voice price: ${match?.[0]}`);
    }
  });

  test("the pricing surfaces read the constants", () => {
    for (const file of [
      PRICING,
      "src/components/marketing/public/pricing/plan-grid.tsx",
      "src/components/marketing/public/pricing/comparison.tsx",
      `${REVENUE_DIR}/voice-pricing.tsx`,
      `${REVENUE_DIR}/sections.tsx`,
    ]) {
      assert.match(read(file), /@\/lib\/marketing\/voice-offer/, file);
    }
  });

  test("formatting renders the prices the owner decided", () => {
    assert.equal(gbp(PRO_WITH_VOICE_MONTHLY_GBP), "£499");
    assert.equal(gbp(VOICE_NUMBER_MONTHLY_GBP), "£11.99");
    assert.equal(gbp(PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN), "£0.20");
  });
});

/* ------------------------------------------------ never free, never trial --- */

describe("voice is never shown as free or included in a trial", () => {
  test("the trial note says what the product enforces", () => {
    assert.equal(VOICE_TRIAL_NOTE, "Voice is a paid feature; trials don't place live calls.");
    assert.ok(VOICE_TERMS.includes(VOICE_TRIAL_NOTE));
    // The trial the site describes has no voice allowance of any kind.
    assert.ok(!Object.keys(TRIAL).some((key) => /voice/i.test(key)));
  });

  test("every per-plan voice offer has a price, and none is free", () => {
    for (const plan of planOrder()) {
      const offer = planVoiceOffer(plan.id);
      for (const text of [offer.agent, offer.number, offer.cardLine]) {
        assert.doesNotMatch(text, /\bfree\b|£0\b|included in (the|your) trial/i, `${plan.id}: ${text}`);
      }
    }
    assert.doesNotMatch(planVoiceOffer("trial").cardLine, /free/i);
  });

  test("every surface that prices voice also states the trial note", () => {
    for (const file of [
      `${REVENUE_DIR}/sections.tsx`,
      "src/components/marketing/public/pricing/plan-grid.tsx",
      "src/components/marketing/public/home/pricing-preview.tsx",
      "src/components/marketing/public/home/faq-data.ts",
      PRICING,
    ]) {
      assert.match(read(file), /VOICE_TRIAL_NOTE|VOICE_TERMS/, `${file} prices voice without the trial note`);
    }
  });

  test("no copy presents voice, calls or minutes as free", () => {
    const banned =
      /free (voice|ai calls?|calls?|minutes)|voice (is )?free|(voice|call) minutes? (are )?included in (the|your) (free )?trial|try (voice|ai calls?) free/i;
    for (const file of PRICE_SURFACES) {
      assert.doesNotMatch(code(file), banned, file);
    }
  });
});

/* ------------------------------------------------------------- honesty --- */

describe("honesty rules on the revenue sections", () => {
  test("nothing is described as unlimited", () => {
    for (const file of [...revenueFiles, "src/lib/marketing/voice-offer.ts"]) {
      if (file.endsWith("voice-offer.ts")) {
        // Only the filter that removes the word may mention it.
        assert.doesNotMatch(code(file).replace(/\/unlimited\/i/g, ""), /unlimited/i, file);
      } else {
        assert.doesNotMatch(code(file), /unlimited/i, file);
      }
    }
    for (const plan of planOrder()) {
      for (const line of publicFeatureLines(plan.features)) {
        assert.doesNotMatch(line, /unlimited/i, `${plan.id}: ${line}`);
      }
    }
  });

  test("the home pricing preview shows catalogue lines only through the filter", () => {
    const preview = read("src/components/marketing/public/home/pricing-preview.tsx");
    assert.match(preview, /publicFeatureLines\(plan\.features\)/);
    assert.doesNotMatch(preview, /Most popular/, "a popularity claim with no data behind it");
  });

  test("no fabricated proof: ratings, testimonials, logos or outcome metrics", () => {
    const banned =
      /trusted by|testimonial|aggregateRating|ratingValue|★|\d+(\.\d+)?\s?% (more|faster|higher|increase|uplift)|customers (love|say)|case study|as seen in|\d+x (more|faster)/i;
    for (const file of [...revenueFiles, HOME, PRICING, COMPLIANCE]) {
      assert.doesNotMatch(code(file), banned, file);
    }
  });

  test("no competitor names on the revenue sections", () => {
    const competitors =
      /\b(Gong|Outreach\.io|Salesloft|Apollo|Air\.ai|Bland|Vapi|Synthflow|PandaDoc|DocuSign|Proposify|Qwilr|Better Proposals|Xero|QuickBooks|Drift|Intercom|Conversica)\b/;
    for (const file of revenueFiles) {
      assert.doesNotMatch(code(file), competitors, file);
    }
  });

  test("the signature is a simple electronic signature, never a higher tier", () => {
    for (const file of [...PRICE_SURFACES, COMPLIANCE]) {
      assert.doesNotMatch(
        code(file),
        /advanced electronic signature|qualified electronic signature|\bAdES\b|\bQES\b|legally binding everywhere/i,
        file,
      );
    }
    assert.match(read(`${REVENUE_DIR}/pieces.tsx`), /Simple electronic signature/);
  });

  test("calls are consent-only: cold calling is only ever denied", () => {
    for (const file of [...revenueFiles, HOME, PRICING, COMPLIANCE, "src/components/marketing/public/home/faq-data.ts"]) {
      const text = code(file);
      for (const match of text.matchAll(/cold[- ]call/gi)) {
        const before = text.slice(Math.max(0, (match.index ?? 0) - 30), match.index);
        assert.match(before, /never|not|no\b/i, `${file}: "cold call" without a negation`);
      }
    }
    assert.match(read(`${REVENUE_DIR}/sections.tsx`), /asked for a call or agreed on your form|asked for a call or agreed/);
  });

  test("the example opener is the locked OD-1 AI disclosure", () => {
    assert.match(OPENER_TEMPLATE, /^This is an AI assistant calling from \{calling_as_name\}/);
    const data = read(`${REVENUE_DIR}/data.ts`);
    assert.match(data, /OPENER_TEMPLATE\.replace\("\{calling_as_name\}"/);
    assert.match(read(COMPLIANCE), /OPENER_TEMPLATE/);
    assert.match(read(COMPLIANCE), /\{your business\}/);
  });

  test("house style: no em or en dashes in the new copy", () => {
    for (const file of [...revenueFiles, "src/lib/marketing/voice-offer.ts"]) {
      assert.doesNotMatch(read(file), /[–—]/, file);
    }
  });
});

/* ------------------------------------------------- illustrative labels --- */

describe("every mock UI is labelled as an illustrative example", () => {
  test("the label text is exactly 'Illustrative example'", () => {
    assert.match(read(`${REVENUE_DIR}/data.ts`), /ILLUSTRATIVE_LABEL = "Illustrative example"/);
  });

  test("the live call opens with the disclosure caption and shows the call events", () => {
    const data = read(`${REVENUE_DIR}/data.ts`);
    // The first caption is the locked opener; the notice is a chip, not a caption.
    assert.match(data, /CALL_CAPTIONS[^=]*= \[\s*\{ speaker: "agent", text: EXAMPLE_OPENER/);
    for (const label of ["Objection: price", "Meeting booked Tue 10:00"]) assert.ok(data.includes(label), label);
    assert.match(data, /Quote \$\{EXAMPLE\.quoteNumber\} sent/);
    assert.match(read(`${REVENUE_DIR}/live-call.tsx`), /Recording notice given/);
  });

  test("the live call, timeline, quote sequence, ROI card and journey carry it", () => {
    const liveCall = read(`${REVENUE_DIR}/live-call.tsx`);
    assert.match(liveCall, /<IllustrativeTag>\{ILLUSTRATIVE_LABEL\}<\/IllustrativeTag>/);

    const pieces = read(`${REVENUE_DIR}/pieces.tsx`);
    for (const component of ["ChannelTimeline", "QuoteSequence", "RoiCard"]) {
      const start = pieces.indexOf(`export function ${component}`);
      assert.ok(start >= 0, component);
      const next = pieces.indexOf("export function", start + 10);
      const body = pieces.slice(start, next === -1 ? undefined : next);
      assert.match(body, /ILLUSTRATIVE_LABEL/, `${component} is not labelled`);
    }

    const sections = read(`${REVENUE_DIR}/sections.tsx`);
    const journey = sections.slice(sections.indexOf("export function RevenueJourneySection"));
    assert.match(journey.slice(0, journey.indexOf("export function", 10)), /ILLUSTRATIVE_LABEL/);
  });

  test("the ROI card says it is not a customer result", () => {
    assert.match(read(`${REVENUE_DIR}/pieces.tsx`), /not a customer result or a forecast/);
  });
});

/* ----------------------------------------------------- reduced motion --- */

describe("reduced-motion paths exist for every animation", () => {
  test("the stylesheet removes the waveform, pulse, stagger and journey motion", () => {
    const css = read(`${REVENUE_DIR}/revenue.css`);
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.ok(block.length > 0, "no reduced-motion block");
    for (const selector of [".rv-party-wave i", ".rv-live-dot", ".rv-stagger", ".rv-journey-card", ".rv-ring-fill"]) {
      assert.ok(block.includes(selector), `reduced motion does not cover ${selector}`);
    }
  });

  test("the client islands check the preference", () => {
    assert.match(read(`${REVENUE_DIR}/journey.tsx`), /useReducedMotion\(\)/);
    const liveCall = read(`${REVENUE_DIR}/live-call.tsx`);
    assert.match(liveCall, /useReducedMotion\(\)/);
    // Captions cycle only while on screen, and never under reduced motion.
    assert.match(liveCall, /if \(reduced \|\| !onScreen\) return;/);
  });

  test("nothing is hidden before JavaScript has armed the block", () => {
    const css = read(`${REVENUE_DIR}/revenue.css`);
    assert.match(css, /\[data-armed="true"\]:not\(\[data-inview="true"\]\) \.rv-stagger/);
    assert.match(read(`${REVENUE_DIR}/in-view.tsx`), /data-armed/);
  });
});

/* ------------------------------------------------------ pages and SEO --- */

describe("the sections live on existing pages, with their own anchors and SEO", () => {
  test("no new page routes were added for voice or quotes", () => {
    const marketing = readdirSync(path.join(root, "src/app/(marketing)"));
    for (const slug of ["ai-voice-sales-agent", "quotes-and-payments", "voice", "quotes"]) {
      assert.ok(!marketing.includes(slug), `/${slug} should be a section, not a page`);
    }
  });

  test("each section has a stable anchor", () => {
    const sections = read(`${REVENUE_DIR}/sections.tsx`);
    for (const id of ["revenue-journey", "voice-agent", "quotes-and-payments"]) {
      assert.match(sections, new RegExp(`id="${id}"`), id);
    }
    assert.match(read(PRICING), /id="voice-pricing"/);
    assert.match(read(COMPLIANCE), /id="voice-calls"/);
  });

  test("the home page renders the sections in the narrative", () => {
    const home = read(HOME);
    const order = ["<HowItWorksSection", "<RevenueJourneySection", "<VoiceAgentSection", "<QuotesPaymentsSection", "<CapabilitiesSection"];
    let last = -1;
    for (const tag of order) {
      const at = home.indexOf(tag);
      assert.ok(at > last, `${tag} out of order`);
      last = at;
    }
  });

  test("nav and footer link to the anchors", () => {
    const hrefs = new Set<string>();
    for (const item of PRIMARY_NAV) {
      if (item.kind === "link") hrefs.add(item.href);
      else for (const column of item.columns) for (const link of column.links) hrefs.add(link.href);
    }
    for (const link of [...FOOTER_PRODUCT, ...FOOTER_COMPANY]) hrefs.add(link.href);
    for (const href of ["/#voice-agent", "/#quotes-and-payments", "/#revenue-journey", "/pricing#voice-pricing"]) {
      assert.ok(hrefs.has(href), `${href} is not linked from the site chrome`);
    }
  });

  test("home, pricing and compliance each have full metadata", () => {
    for (const file of [HOME, PRICING, COMPLIANCE]) {
      const source = read(file);
      assert.match(source, /export const metadata: Metadata/, file);
      assert.match(source, /description/, file);
      assert.match(source, /alternates: \{ canonical:/, file);
      assert.match(source, /openGraph:/, file);
      assert.match(source, /twitter:/, file);
    }
    assert.match(read(HOME), /AI Sales Agent/);
    assert.match(read(PRICING), /Voice/);
  });

  test("one h1 per page, and none inside a section", () => {
    for (const file of revenueFiles) assert.doesNotMatch(read(file), /<h1[\s>]/, file);
    assert.equal((read(HOME).match(/<h1[\s>]/g) ?? []).length, 0, "the home h1 lives in the hero");
    assert.equal((read(HERO).match(/<h1[\s>]/g) ?? []).length, 1);
    assert.equal((read(PRICING).match(/<h1[\s>]/g) ?? []).length, 1);
    assert.equal((read(COMPLIANCE).match(/<h1[\s>]/g) ?? []).length, 1);
  });

  test("JSON-LD: SoftwareApplication with the voice offer, and no ratings", () => {
    for (const file of [HOME, PRICING]) {
      const source = read(file);
      assert.match(source, /"@type": "SoftwareApplication"/, file);
      assert.match(source, /PRO_WITH_VOICE_MONTHLY_GBP/, file);
      assert.doesNotMatch(code(file), /aggregateRating|ratingValue|reviewCount/, file);
    }
    assert.match(read(PRICING), /"BreadcrumbList"/);
    assert.match(read(COMPLIANCE), /"BreadcrumbList"/);
  });

  test("no new sitemap entries for sections", () => {
    const sitemap = read("src/app/sitemap.ts");
    assert.doesNotMatch(sitemap, /voice|quotes-and-payments|revenue-journey/);
  });
});

/* ------------------------------------------------------ sub-processors --- */

describe("the sub-processor register names the voice provider", () => {
  test("Retell AI is listed, optional, with a dated change entry", () => {
    const retell = SUBPROCESSORS.find((row) => row.name === "Retell AI");
    assert.ok(retell, "Retell AI is missing from the register");
    assert.equal(retell.optional, true);
    assert.match(retell.location, /United States/);
    // Checked against Retell AI's published privacy policy on 2026-09-29.
    assert.match(retell.transfer, /UK International Data Transfer Agreement/);
    assert.doesNotMatch(retell.location + retell.transfer, /To be confirmed/);
    assert.ok(SUBPROCESSOR_CHANGES.some((entry) => /Retell/.test(entry.change)));
  });
});
