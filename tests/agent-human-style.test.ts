import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_TELLS,
  aiTellsIn,
  fixHumanStyle,
  hasChatSignOff,
  humanStyleFailures,
  HUMAN_STYLE_CODES,
  repeatedOpener,
  usSpellingsIn,
} from "../src/lib/agent/human-style.ts";
import { dashesIn, emojisIn, stripAiPunctuation } from "../src/lib/messaging/human-punctuation.ts";
import { normaliseForSms, smsEncoding } from "../src/lib/messaging/sms-segments.ts";
import { lintStyle, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { nextComposeStep, simulateComposeLoop } from "../src/lib/agent/compose-policy.ts";
import { MAX_VALIDATOR_REJECTIONS } from "../src/lib/agent/handover-policy.ts";
import { PROMPT_BODIES } from "../src/lib/ai/prompts.ts";
import { buildOfferCard } from "../src/lib/agent/offer-card.ts";
import { NEW_LEAD_SEQUENCE } from "../src/lib/automation/defaults.ts";
import { bookingReplyText } from "../src/lib/bookings/confirmation.ts";

/**
 * Human writing style (elite-closer brief, owner rule 2026-09-27): no emojis,
 * no em or en dashes used as dashes, and nothing that reads as automated.
 * Every rule of the "sounds like AI" lint has a case here, as do the repair,
 * the GSM backstop, the compose loop's model-call count, and the templates
 * and prompts that must carry none of it.
 */

const EM = "—";
const EN = "–";
const codes = (body: string, ctx: Parameters<typeof humanStyleFailures>[1] = {}) =>
  humanStyleFailures(body, ctx).map((f) => f.code);

describe("the owner rule: no emojis, no dashes", () => {
  test("an emoji is rejected, a trade mark is not", () => {
    assert.ok(codes("Great stuff \u{1F64C} see you then.").includes("STYLE_EMOJI"));
    assert.ok(codes("Thumbs up \u{1F44D}\u{1F3FD}").includes("STYLE_EMOJI"));
    assert.deepEqual(codes("Acme® and Widget™ both work with it."), []);
  });

  test("an em dash or an en dash used as a dash is rejected; a number range is not", () => {
    assert.ok(codes(`Yes ${EM} we can.`).includes("STYLE_EM_DASHES"));
    assert.ok(codes(`Yes ${EN} we can.`).includes("STYLE_EM_DASHES"));
    assert.ok(codes(`Yes${EM}we can.`).includes("STYLE_EM_DASHES"));
    assert.deepEqual(codes(`We're open 9${EN}5 and it takes 2${EN}3 weeks.`), []);
    assert.equal(dashesIn(`9${EN}5`), 0);
  });

  test("stripping keeps the meaning and leaves plain punctuation", () => {
    assert.equal(stripAiPunctuation(`Yes ${EM} we build on Shopify ${EM} and migrate stores.`), "Yes, we build on Shopify, and migrate stores.");
    assert.equal(stripAiPunctuation(`Thanks ${EM}`), "Thanks.");
    assert.equal(stripAiPunctuation(`Open 9${EN}5`), "Open 9-5");
    assert.equal(stripAiPunctuation("Hi \u{1F44B}, thanks"), "Hi, thanks");
    assert.deepEqual(emojisIn(stripAiPunctuation("Great \u{1F680}\u{1F680} done")), []);
  });

  test("GSM normalisation is the backstop: an SMS never carries an emoji or a dash", () => {
    const sent = normaliseForSms(`Great \u{1F64C} ${EM} I can do Tuesday.`);
    assert.equal(emojisIn(sent).length, 0);
    assert.equal(dashesIn(sent), 0);
    assert.equal(smsEncoding(sent), "GSM7");
  });

  test("the send path and the length lint judge the normalised text", () => {
    assert.match(readFileSync("src/lib/jobs/send-core.ts", "utf8"), /normaliseForSms\(gated\.body\)/);
  });
});

describe("the sounds-like-AI lint", () => {
  for (const tell of AI_TELLS) {
    test(`phrase list: ${tell.phrase}`, () => {
      const sample: Record<string, string> = {
        "Certainly!": "Certainly! Here it is.",
        "Great question": "Great question. It depends on the size.",
        delve: "Let me delve into the details.",
        "I'd be happy to assist": "I'd be happy to assist with that.",
        "As an AI": "As an AI assistant, I can help.",
        "I understand your concern": "I understand your concern about cost.",
        "rest assured": "Rest assured, it works.",
        "don't hesitate to": "Please don't hesitate to get in touch.",
        "let me know if you have any questions": "Let me know if you have any questions.",
        "hope this helps": "Hope this helps.",
        "thank you for reaching out": "Thank you for reaching out.",
        "feel free to": "Feel free to book a slot.",
        "at your earliest convenience": "Reply at your earliest convenience.",
        "I trust this": "I trust this finds you well.",
        "in today's fast-paced world": "In today's fast-paced world, speed matters.",
        seamless: "It's a seamless setup.",
        robust: "A robust platform.",
        "cutting-edge": "Our cutting-edge tools.",
        "industry-leading": "An industry-leading team.",
        "tailored solutions": "We build tailored solutions.",
        elevate: "We elevate your brand.",
        empower: "We empower your team.",
        "exceptional value": "It's exceptional value.",
        "Furthermore / Moreover / Additionally": "It's fast. Furthermore, it's cheap.",
        "I'm here to help": "I'm here to help.",
      };
      const text = sample[tell.phrase];
      assert.ok(text, `no sample for ${tell.phrase}`);
      assert.ok(aiTellsIn(text).includes(tell.phrase), text);
      assert.ok(codes(text).includes("STYLE_AI_TELL"));
    });
  }

  test("plain human replies pass every rule", () => {
    for (const text of [
      "Fair question. Is it the overall price, or how it compares with something else you've seen?",
      "Makes sense, January's usually calmer. Shall I drop you a line then?",
      "I can do Tue 6 Oct, 10:00am or Wed 7 Oct, 2:00pm. Does either work?",
      "Thanks Sam. What's driving the March date?",
    ]) {
      assert.deepEqual(codes(text, { channel: "sms", leadFirstName: "Sam" }), [], text);
    }
  });

  test("a list or formatting in a chat channel; email may list, never with headings or bold", () => {
    const list = "Here's what we offer:\n- Web design\n- SEO\nWhich interests you?";
    assert.ok(codes(list, { channel: "sms" }).includes("STYLE_LIST"));
    assert.ok(codes(list, { channel: "whatsapp" }).includes("STYLE_LIST"));
    assert.ok(!codes(list, { channel: "email" }).includes("STYLE_LIST"));
    assert.ok(codes("**Pricing** depends on scope.", { channel: "email" }).includes("STYLE_LIST"));
    assert.ok(codes("## Next steps\nA call.", { channel: "email" }).includes("STYLE_LIST"));
  });

  test("repeated openers: within a message, and the same stock opening as the last message", () => {
    assert.ok(repeatedOpener("We build sites. We host them. We fix them."));
    assert.ok(codes("We build sites. We host them. We fix them.").includes("STYLE_REPEATED_OPENER"));
    assert.ok(codes("Great, thanks. What's next?", { priorOutbound: ["Great, thanks for that. Which service?"] }).includes("STYLE_REPEATED_OPENER"));
    // A question that reuses the start of an earlier question is judged by QA_REPEAT, not here.
    assert.equal(repeatedOpener("Roughly how many staff work there now?", ["Roughly how many staff work there?"]), null);
  });

  test("exclamation overuse", () => {
    assert.deepEqual(codes("Brilliant!"), []);
    assert.ok(codes("Amazing!! Let's go!").includes("STYLE_EXCLAMATION"));
  });

  test("UK spelling", () => {
    assert.deepEqual(usSpellingsIn("We optimise and customise it, in your favourite colour, at the centre."), []);
    const us = "We optimize and customize it, in your favorite color, at the center.";
    assert.deepEqual(usSpellingsIn(us).map((w) => w.toLowerCase()).sort(), ["center", "color", "customize", "favorite", "optimize"]);
    assert.ok(codes(us).includes("STYLE_US_SPELLING"));
    assert.deepEqual(usSpellingsIn("We integrate with Optimizely."), [], "a product name is not a spelling");
  });

  test("the lead's name once at most", () => {
    assert.deepEqual(codes("Thanks Sarah, what's driving the date?", { leadFirstName: "Sarah" }), []);
    assert.ok(codes("Thanks Sarah! Sarah, what's driving it?", { leadFirstName: "Sarah" }).includes("STYLE_NAME_OVERUSE"));
  });

  test("a letter-style sign-off in chat; email may sign off", () => {
    assert.ok(hasChatSignOff("Speak soon. Kind regards"));
    assert.ok(codes("Happy to help. Best regards, The Team", { channel: "sms" }).includes("STYLE_SIGN_OFF"));
    assert.ok(!codes("Happy to help.\n\nKind regards", { channel: "email" }).includes("STYLE_SIGN_OFF"));
  });

  test("lintStyle carries the human-style rules, so restyled and reactivation copy is held to them too", () => {
    const found = lintStyle(`Hi ${EM} great news \u{1F389}`).map((f) => f.code);
    assert.ok(found.includes("STYLE_EM_DASHES") && found.includes("STYLE_EMOJI"));
  });
});

describe("the repair: regenerated once, then fixed text is used", () => {
  const cases: { text: string; ctx?: Parameters<typeof fixHumanStyle>[1] }[] = [
    { text: `Yes ${EM} we build on Shopify ${EM} and migrate stores. What's the store doing now?` },
    { text: "Great stuff \u{1F64C} I can do Tuesday. Does that work?" },
    { text: "Here's what we offer:\n- Web design\n- SEO\n- Hosting\nWhich interests you?", ctx: { channel: "sms" } },
    { text: "Certainly! I'd be happy to assist. Please don't hesitate to reach out." },
    { text: "Amazing!! So excited! Which day suits?" },
    { text: "We can optimize your checkout and customize the flow.", ctx: { channel: "sms" } },
    { text: "Thanks Sarah! March is doable Sarah. What's driving the date?", ctx: { leadFirstName: "Sarah" } },
    { text: "Happy to help. What's the biggest drop-off right now? Best regards, The Team", ctx: { channel: "sms" } },
    { text: "As an AI assistant, let me delve into it. What would you like to know?" },
  ];
  for (const [i, c] of cases.entries()) {
    test(`case ${i + 1} is repaired to pass every fixable rule`, () => {
      assert.ok(codes(c.text, c.ctx).length > 0, "the input must fail first");
      const fixed = fixHumanStyle(c.text, c.ctx);
      assert.deepEqual(codes(fixed, c.ctx), [], fixed);
      assert.ok(fixed.length > 0);
    });
  }

  test("the repair never adds a price, a time, a link or a promise", () => {
    for (const c of cases) {
      const fixed = fixHumanStyle(c.text, c.ctx);
      for (const pattern of [/£\d/, /\b\d{1,2}(am|pm)\b/i, /https?:\/\//, /\bguarantee/i]) {
        assert.equal(pattern.test(fixed), pattern.test(c.text), `${pattern} changed in ${fixed}`);
      }
    }
  });

  test("nextComposeStep: regenerate once, then FIX; never a hand-over for style alone", () => {
    const style = ["STYLE_EM_DASHES"];
    assert.equal(nextComposeStep({ codes: [], rejections: 0 }), "ACCEPT");
    assert.equal(nextComposeStep({ codes: style, rejections: 1 }), "REGENERATE");
    assert.equal(nextComposeStep({ codes: style, rejections: 2 }), "FIX");
    assert.equal(nextComposeStep({ codes: style, rejections: MAX_VALIDATOR_REJECTIONS }), "FIX");
    // A claim failure is the validator's ordinary path.
    assert.equal(nextComposeStep({ codes: ["UNSUPPORTED_PRICE_CLAIM"], rejections: 2 }), "REGENERATE");
    assert.equal(nextComposeStep({ codes: ["UNSUPPORTED_PRICE_CLAIM"], rejections: MAX_VALIDATOR_REJECTIONS }), "HANDOVER");
    assert.equal(nextComposeStep({ codes: ["STYLE_EMOJI", "UNSUPPORTED_PRICE_CLAIM"], rejections: 2 }), "REGENERATE");
    for (const code of HUMAN_STYLE_CODES) assert.equal(nextComposeStep({ codes: [code], rejections: 2 }), "FIX", code);
    // After the repair: polish left over is sent; a hard rule left over is not.
    assert.equal(nextComposeStep({ codes: ["STYLE_REPEATED_OPENER"], rejections: 2, fixTried: true }), "SEND_FIXED");
    assert.equal(nextComposeStep({ codes: ["STYLE_EMOJI"], rejections: 2, fixTried: true }), "REGENERATE");
    assert.equal(nextComposeStep({ codes: ["STYLE_INSTRUCTION_LEAK"], rejections: 3, fixTried: true }), "HANDOVER");
  });

  test("the same stock opener every turn is repaired, never handed over (story regression)", () => {
    const prior = ["Thanks, that helps. What would you mainly use it for?"];
    const draft = "Thanks, that helps. How many people would use it?";
    const check = (d: string) => humanStyleFailures(d, { channel: "sms", priorOutbound: prior }).map((f) => f.code);
    const result = simulateComposeLoop([draft, draft, draft], check, (d) => fixHumanStyle(d, { channel: "sms", priorOutbound: prior }));
    assert.equal(result.outcome, "SENT");
    assert.equal(result.body, "How many people would use it?");
    assert.equal(result.modelCalls, 2);
  });

  test("model calls per turn: a style slip never costs a third call; measured over a scenario set", () => {
    const check = (d: string) => humanStyleFailures(d, { channel: "sms" }).map((f): string => f.code).concat(/£\d/.test(d) ? ["UNSUPPORTED_PRICE_CLAIM"] : []);
    const fix = (d: string) => fixHumanStyle(d, { channel: "sms" });
    const clean = "Fair question. Is it the overall price, or how it compares?";
    const dashy = `Fair question ${EM} is it the price?`;
    const scenarios: { drafts: string[]; calls: number; outcome: "SENT" | "HANDOVER" }[] = [
      { drafts: [clean], calls: 1, outcome: "SENT" },
      { drafts: [dashy, clean], calls: 2, outcome: "SENT" },
      { drafts: [dashy, dashy, clean], calls: 2, outcome: "SENT" }, // fixed, not a third call
      { drafts: ["It's £90.", clean], calls: 2, outcome: "SENT" },
      { drafts: ["It's £90.", "It's £90.", "It's £90."], calls: 3, outcome: "HANDOVER" },
    ];
    let total = 0;
    for (const s of scenarios) {
      const result = simulateComposeLoop(s.drafts, check, fix);
      assert.equal(result.outcome, s.outcome, JSON.stringify(s.drafts));
      assert.equal(result.modelCalls, s.calls, JSON.stringify(s.drafts));
      total += result.modelCalls;
    }
    // Before the repair path, the third scenario spent 3 calls and the style
    // rules would have handed over after three rejections.
    const mean = total / scenarios.length;
    console.log(`[human-style] model calls per turn over ${scenarios.length} compose scenarios: mean ${mean.toFixed(2)}, max 3 (a style-only slip: max 2)`);
    assert.ok(mean <= 2);
  });
});

describe("the validator enforces it", () => {
  const facts = (extra: Partial<ValidationFacts> = {}): ValidationFacts => ({
    channel: "sms",
    businessName: "Acme",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
    ...extra,
  });

  test("a dash, an emoji or an AI tell rejects the draft", () => {
    for (const [text, code] of [
      [`Sure ${EM} what's the postcode?`, "STYLE_EM_DASHES"],
      ["Sure \u{1F44D} what's the postcode?", "STYLE_EMOJI"],
      ["Certainly! What's the postcode?", "STYLE_AI_TELL"],
    ] as const) {
      const result = validateResponse(text, facts());
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.failures.some((f) => f.code === code), text);
    }
  });

  test("the lead's name is checked when the orchestrator supplies it", () => {
    const result = validateResponse("Thanks Sam, Sam, what's next Sam?", facts({ leadFirstName: "Sam" }));
    assert.equal(result.ok, false);
  });
});

describe("no template, prompt or example carries an emoji or a dash", () => {
  test("every system prompt", () => {
    for (const [task, body] of Object.entries(PROMPT_BODIES)) {
      assert.equal(emojisIn(body).length, 0, `${task} has an emoji`);
      assert.equal(dashesIn(body), 0, `${task} has an em or en dash`);
    }
  });

  test("agent_decision teaches the human voice", () => {
    const prompt = PROMPT_BODIES.agent_decision;
    for (const phrase of ["contractions", "UK spelling", "mirror their length", "No emojis", "No em", "one clear question or next step", "Persuade honestly"]) {
      assert.ok(prompt.includes(phrase), phrase);
    }
  });

  test("the default follow-up sequence and the fixed booking lines", () => {
    for (const step of NEW_LEAD_SEQUENCE) {
      assert.equal(dashesIn(step.template) + emojisIn(step.template).length, 0, `step ${step.position}`);
    }
    for (const reply of [
      bookingReplyText({ kind: "confirmed", firstName: "Sam", slotLabel: "Tue 6 Oct, 2:00pm", invited: true }),
      bookingReplyText({ kind: "pending", firstName: null, slotLabel: "Tue 6 Oct, 2:00pm" }),
      bookingReplyText({ kind: "slot_taken", firstName: null, slotLabel: "Tue", alternatives: ["Wed", "Thu"] }),
    ]) {
      assert.equal(dashesIn(reply), 0, reply);
    }
  });

  test("lead-facing template files hold no em dash in a string", () => {
    for (const file of [
      "src/lib/outreach/social-copy.ts",
      "src/lib/campaigns/reactivation-fixtures.ts",
      "src/lib/bookings/confirmation.ts",
      "src/lib/agent/handover-policy.ts",
    ]) {
      const strings = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n")
        .match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      // An en dash between two times ("8:00 AM – 8:00 PM") is a range in a staff-facing label, not a dash.
      const dashed = strings.filter((s) => /—/.test(s));
      assert.deepEqual(dashed, [], file);
    }
  });

  test("the offer card tells the model how to sound, in the business's name", () => {
    const card = buildOfferCard({
      businessName: "Northwind Digital",
      businessDescription: null,
      aiTone: "friendly",
      replyLength: "short",
      outreach: { tone: null, valueProposition: null, keyMessages: null, proofPoints: null, avoid: null, callToAction: null, claimRestrictions: null },
      playbook: null,
      signature: null,
      services: [],
      facts: [],
      now: new Date("2026-09-27T00:00:00Z"),
      reassurance: ["Service level: We reply to every support ticket within one working day"],
    });
    assert.match(card.text, /Sound like Northwind Digital's best salesperson/);
    assert.match(card.text, /APPROVED CLAIMS\n- Service level: We reply to every support ticket within one working day/);
    assert.equal(card.hasApprovedClaims, true);
    assert.equal(dashesIn(card.text), 0);
  });
});
