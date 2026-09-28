/**
 * Voice QA pass, part A: what a call must hear in SPOKEN, ASR-noisy words,
 * and what it must do about it (src/lib/voice/speech-intents.ts). Pure: no
 * Retell, no model, no spend.
 *
 * Table-driven. Each row is what a UK lead might say as the recogniser
 * delivers it (no punctuation, fillers, mishearings, regional forms,
 * cut-offs), the intent that must win, and for an opt-out its scope. The
 * second half proves every intent maps to the right action in the playbook,
 * that the Retell prompt carries the playbook, and that the post-call safety
 * net applies it when the model did not.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectSpokenIntents,
  primarySpokenIntent,
  normaliseSpoken,
  isMachineOnly,
  renderListenFor,
  SPOKEN_INTENTS,
  SPOKEN_INTENT_PLAYBOOK,
  type SpokenIntentKey,
} from "../src/lib/voice/speech-intents.ts";
import { RETELL_GENERAL_PROMPT, VOICE_TOOL_NAMES, VOICE_TOOL_ARGS } from "../src/lib/voice/tools/definitions.ts";
import { analyseCall } from "../src/lib/voice/post-call.ts";

type Row = { said: string; want: SpokenIntentKey | null; scope?: "CALLS" | "ALL"; objection?: string; also?: SpokenIntentKey[] };

export const DETECTION_TABLE: Row[] = [
  // ---- opt-out: calls only
  { said: "stop calling me", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "um can you stop colin me please", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "dont ring me again", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "erm yeah please don't call again mate", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "no more calls please", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "lose my number", want: "OPT_OUT_CALLS", scope: "CALLS" },
  // ---- opt-out: everything
  { said: "take me off your list", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "take me of ya list mate", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "remove my number", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "remove me number from your system", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "delete my details", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "stop contacting me", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "not interested take me off your list", want: "OPT_OUT_ALL", scope: "ALL" },
  // ---- wrong number
  { said: "you've got the wrong number", want: "WRONG_NUMBER" },
  { said: "wrong numba love", want: "WRONG_NUMBER" },
  { said: "there's no priya here", want: "WRONG_NUMBER" },
  { said: "nobody called that here sorry", want: "WRONG_NUMBER" },
  { said: "i never enquired about anything", want: "WRONG_NUMBER" },
  // ---- a gatekeeper answered
  { said: "northwind sarah speaking priya's not in today can i take a message", want: "GATEKEEPER" },
  { said: "she's in a meeting who shall i say is calling", want: "GATEKEEPER" },
  { said: "can i ask what it's regarding", want: "GATEKEEPER" },
  // ---- is this a robot
  { said: "is this a robot", want: "ASKS_IF_AI" },
  { said: "hang on is this a ro bot", want: "ASKS_IF_AI" },
  { said: "am i talking to a real person", want: "ASKS_IF_AI" },
  { said: "are you real", want: "ASKS_IF_AI" },
  { said: "you sound like a machine", want: "ASKS_IF_AI" },
  { said: "is this ai", want: "ASKS_IF_AI" },
  // ---- who is this / how did you get my number
  { said: "sorry who's this", want: "WHO_IS_THIS" },
  { said: "whos calling", want: "WHO_IS_THIS" },
  { said: "what company is this", want: "WHO_IS_THIS" },
  { said: "how did you get my number", want: "HOW_GOT_NUMBER" },
  { said: "where'd you get me details from", want: "HOW_GOT_NUMBER" },
  { said: "where did you get my details", want: "HOW_GOT_NUMBER" },
  // ---- bad time / call later / driving
  { said: "i'm driving", want: "BAD_TIME" },
  { said: "im in the car can you call back later", want: "BAD_TIME" },
  { said: "not a good time", want: "BAD_TIME" },
  { said: "bad time mate i'm in a meeting", want: "BAD_TIME" },
  { said: "can you ring me back tomorrow", want: "BAD_TIME" },
  { said: "give us a bell back after three", want: "BAD_TIME" },
  { said: "i'm on the train you're breaking up", want: "BAD_TIME" },
  { said: "cant talk right now", want: "BAD_TIME" },
  // ---- speak to a person
  { said: "can i speak to a real person", want: "WANTS_PERSON" },
  { said: "put me through to someone", want: "WANTS_PERSON" },
  { said: "i want to talk to a human", want: "WANTS_PERSON" },
  // ---- email me / send me something
  { said: "just email me", want: "SEND_DETAILS" },
  { said: "just e mail me the details", want: "SEND_DETAILS" },
  { said: "can you send me something", want: "SEND_DETAILS" },
  { said: "pop it in an email", want: "SEND_DETAILS" },
  { said: "text me the details", want: "SEND_DETAILS" },
  { said: "have you got a website", want: "SEND_DETAILS" },
  // ---- voicemail and IVR
  { said: "hi you've reached the voicemail of dave please leave a message after the tone", want: "VOICEMAIL" },
  { said: "the person you are calling is not available", want: "VOICEMAIL" },
  { said: "the mailbox is full", want: "VOICEMAIL" },
  { said: "thank you for calling for sales press one for accounts press two", want: "IVR" },
  { said: "please hold your call is important to us", want: "IVR" },
  // ---- not interested
  { said: "not interested", want: "NOT_INTERESTED" },
  { said: "nah not interest it thanks", want: "NOT_INTERESTED" },
  { said: "no thanks", want: "NOT_INTERESTED" },
  { said: "no ta", want: "NOT_INTERESTED" },
  { said: "it's not for us", want: "NOT_INTERESTED" },
  { said: "we're alright thanks", want: "NOT_INTERESTED" },
  // ---- buying signals
  { said: "sounds good whats the next step", want: "BUYING_SIGNAL" },
  { said: "yeah go on then book me in", want: "BUYING_SIGNAL" },
  { said: "lets crack on", want: "BUYING_SIGNAL" },
  { said: "how do we get started", want: "BUYING_SIGNAL" },
  { said: "sign me up", want: "BUYING_SIGNAL" },
  // ---- objections: price, competitor, timing, authority
  { said: "it's a bit pricey", want: "OBJECTION", objection: "PRICE" },
  { said: "that's too expensive for us", want: "OBJECTION", objection: "PRICE" },
  { said: "we already use someone for that", want: "OBJECTION", objection: "EXISTING_PROVIDER" },
  { said: "we're getting quotes from a few other agencies", want: "OBJECTION", objection: "COMPETITOR" },
  { said: "not till after christmas", want: "OBJECTION", objection: "TIMING" },
  { said: "maybe next year", want: "OBJECTION", objection: "TIMING" },
  { said: "i'd have to run it past the gaffer", want: "OBJECTION", objection: "AUTHORITY" },
  { said: "it's not my decision", want: "OBJECTION", objection: "AUTHORITY" },
  { said: "we've had a bad experience before with an agency", want: "OBJECTION", objection: "RISK" },
  { said: "honestly we're flat out busy", want: "OBJECTION", objection: "TOO_BUSY" },
  // ---- language barrier
  { said: "sorry my english is not good", want: "LANGUAGE_BARRIER" },
  { said: "can you speak more slowly please", want: "LANGUAGE_BARRIER" },
  { said: "i don't understand what you're saying", want: "LANGUAGE_BARRIER" },
  // ---- privacy
  { said: "what do you do with my data", want: "PRIVACY" },
  { said: "are you recording this", want: "PRIVACY" },
  // ---- angry
  { said: "this is harassment i'm sick of these calls", want: "ANGRY" },
  { said: "how dare you ring me on a sunday", want: "ANGRY" },
  { said: "i want to make a complaint", want: "ANGRY" },
  // ---- ordinary answers: nothing to act on beyond the plan
  { said: "yeah go on i've got a minute", want: null },
  { said: "we're about twenty five people", want: null },
  { said: "um so we need a new website erm for the shop", want: null },
  { said: "[noise]", want: null },
  { said: "", want: null },
  { said: "no i didn't ask about the price yet", want: null },
  { said: "is this a real company", want: "OBJECTION", objection: "TRUST" },
  // Adversarial QA pass (2026-09-28): a stall is a NOT_NOW objection now, so
  // the call agrees a follow-up time instead of ending with no next step.
  { said: "leave it with me i'll have a think", want: "OBJECTION", objection: "NOT_NOW" },
  { said: "i'll go away and think about it", want: "OBJECTION", objection: "NOT_NOW" },
  // ---- UK refusals the table missed
  { said: "you're alright mate ta", want: "NOT_INTERESTED" },
  { said: "your alright thanks", want: "NOT_INTERESTED" },
  { said: "nah not interested mate", want: "NOT_INTERESTED" },
  { said: "we're sorted", want: "NOT_INTERESTED" },
  { said: "i already told you no", want: "NOT_INTERESTED" },
  // ---- stops the table missed. A swear-off or "leave me alone" moved from ANGRY
  // to OPT_OUT_ALL: an objection to contact on every channel (owner decision 2026-09-28).
  { said: "take me off your mailing list", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "i want to opt out", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "don't want to be contacted", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "don't ring me", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "don't call", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "never ring this number again", want: "OPT_OUT_CALLS", scope: "CALLS" },
  { said: "piss off", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "oh f off", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "fuck off", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "just leave me alone", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "go away", want: "OPT_OUT_ALL", scope: "ALL" },
  { said: "i'll go away and read it", want: null },
  { said: "i'm registered with the tps", want: "OPT_OUT_CALLS", scope: "CALLS" },
  // ---- negatives: must NOT stop, refuse or escalate
  { said: "i'm not interested in the blue one the red one", want: null },
  { said: "not interested in the price just the timeline", want: null },
  { said: "stop calling it a website it's a shop", want: null },
  { said: "don't call me before ten", want: null },
  { said: "don't call me sir", want: null },
  { said: "remove me from the invite", want: null },
  { said: "take me off speaker", want: null },
  { said: "wrong number no it's the right number go on", want: null },
  { said: "i want to complain about our current agency", want: null },
  { said: "our current site is crap to be honest", want: null },
  { said: "it's ridiculous how slow our site is", want: null },
  { said: "i'm driving the project", want: null },
  { said: "yeah you're alright go on", want: null },
  { said: "she's left a message for you", want: null },
  // ---- wrong person
  { said: "i never gave you my number", want: "WRONG_NUMBER" },
  { said: "she doesn't work here anymore", want: "WRONG_NUMBER" },
  { said: "he left the company", want: "WRONG_NUMBER" },
  { said: "that's not me", want: "WRONG_NUMBER" },
  // ---- machines and screens
  { said: "please state your name and why you're calling", want: "CALL_SCREEN" },
  { said: "the person you're calling is using a screening service from google go ahead and say your name", want: "CALL_SCREEN" },
  { said: "if you record your name and reason for calling i'll see if this person is available", want: "CALL_SCREEN" },
  { said: "hi you've reached dave sorry i can't take your call right now", want: "VOICEMAIL" },
  { said: "the mobile phone you are calling is switched off", want: "VOICEMAIL" },
  { said: "please listen carefully as our menu options have changed", want: "IVR" },
  // ---- vulnerable people
  { said: "mummy there's a lady on the phone", want: "VULNERABLE" },
  { said: "i'm only twelve", want: "VULNERABLE" },
  { said: "i'm her carer she has dementia", want: "VULNERABLE" },
  { said: "my dad's not well he can't talk", want: "VULNERABLE" },
  { said: "he passed away last month", want: "VULNERABLE" },
  // ---- identity, a person, data
  { said: "is this a scam", want: "WHO_IS_THIS" },
  { said: "what's this about", want: "WHO_IS_THIS" },
  { said: "who gave you my number", want: "HOW_GOT_NUMBER" },
  { said: "is this a real person", want: "ASKS_IF_AI" },
  { said: "i want to speak to your manager", want: "WANTS_PERSON" },
  { said: "what data do you hold on me", want: "DATA_REQUEST" },
  { said: "i want a copy of my data", want: "DATA_REQUEST" },
  { said: "subject access request", want: "DATA_REQUEST" },
  { said: "are you recording this call", want: "PRIVACY" },
  // ---- language, line, time
  { said: "hola no hablo ingles", want: "LANGUAGE_BARRIER" },
  { said: "do you speak polish", want: "LANGUAGE_BARRIER" },
  { said: "hello hello are you there", want: "LINE_CHECK" },
  { said: "can you hear me", want: "LINE_CHECK" },
  { said: "i'm on another call", want: "BAD_TIME" },
  { said: "call back in ten minutes", want: "BAD_TIME" },
  { said: "i'm drivin mate", want: "BAD_TIME" },
  { said: "sorry i'm busy", want: "BAD_TIME" },
  // ---- prices, dates, areas
  { said: "how much is it", want: "PRICE_QUESTION" },
  { said: "can you give me a ballpark", want: "PRICE_QUESTION" },
  { said: "do you cover manchester", want: "PRICE_QUESTION" },
  { said: "are you free on saturday", want: "PRICE_QUESTION" },
  { said: "can you guarantee it'll be live by march", want: "PRICE_QUESTION" },
  { said: "just drop me an email", want: "SEND_DETAILS" },
  { said: "i'm not the decision maker", want: "OBJECTION", objection: "AUTHORITY" },
];

describe("part A: spoken intent detection on ASR text", () => {
  for (const row of DETECTION_TABLE) {
    test(`"${row.said}" -> ${row.want ?? "nothing"}`, () => {
      const got = primarySpokenIntent(row.said);
      assert.equal(got?.key ?? null, row.want, `detected ${JSON.stringify(detectSpokenIntents(row.said))} from "${normaliseSpoken(row.said)}"`);
      if (row.scope) assert.equal(got?.optOutScope, row.scope);
      if (row.objection) assert.equal(got?.objectionKey, row.objection);
    });
  }

  test("the table covers every intent", () => {
    const covered = new Set(DETECTION_TABLE.map((r) => r.want).filter(Boolean));
    for (const key of SPOKEN_INTENTS) assert.ok(covered.has(key), `${key} has no row`);
    assert.ok(DETECTION_TABLE.length >= 160);
  });

  test("an opt-out always outranks everything a person says with it", () => {
    for (const said of ["stop calling me you idiot this is harassment", "no thanks and don't call me again", "take me off your list i'm driving"]) {
      assert.match(primarySpokenIntent(said)?.key ?? "", /^OPT_OUT_/, said);
    }
  });

  test("a refusal is never also a buying signal or a sales objection", () => {
    for (const said of ["not interested sounds good to you maybe", "wrong number, what's the next step", "stop calling me, it's too expensive"]) {
      const keys = detectSpokenIntents(said).map((i) => i.key);
      assert.ok(!keys.includes("BUYING_SIGNAL") && !keys.includes("OBJECTION"), `${said}: ${keys.join(",")}`);
    }
  });
});

describe("part A: every intent maps to the right action", () => {
  const tools = new Set<string>(VOICE_TOOL_NAMES);

  test("every tool the playbook names is a real voice tool", () => {
    for (const key of SPOKEN_INTENTS) for (const t of SPOKEN_INTENT_PLAYBOOK[key].tools) assert.ok(tools.has(t), `${key}: ${t}`);
  });

  test("opt-out: opt_out first, ends, no closing line, no more selling", () => {
    for (const key of ["OPT_OUT_ALL", "OPT_OUT_CALLS"] as const) {
      const p = SPOKEN_INTENT_PLAYBOOK[key];
      assert.equal(p.tools[0], "opt_out");
      assert.equal(p.endsCall, true);
      assert.equal(p.closingLine, false);
      assert.equal(p.sellingContinues, false);
      assert.match(p.action, key === "OPT_OUT_ALL" ? /scope ALL/ : /scope CALLS/);
      assert.match(p.action, /no closing line/i);
    }
    // The scope the tool accepts.
    assert.equal(VOICE_TOOL_ARGS.opt_out.parse({ scope: "ALL" }).scope, "ALL");
  });

  test("'email me' sends a link now and books a short follow-up", () => {
    const p = SPOKEN_INTENT_PLAYBOOK.SEND_DETAILS;
    assert.equal(p.tools[0], "send_booking_link");
    assert.match(p.action, /send_booking_link, send_checkout_link or send_quote/);
    assert.match(p.action, /follow-up call at two times/);
    assert.equal(p.sellingContinues, true);
  });

  test("'is this a robot' gets an honest yes and the call carries on", () => {
    const p = SPOKEN_INTENT_PLAYBOOK.ASKS_IF_AI;
    assert.match(p.action, /Say yes honestly/);
    assert.match(p.action, /AI assistant/);
    assert.equal(p.endsCall, false);
    assert.equal(p.sellingContinues, true);
  });

  test("wrong number: no pitch, the number is not rung again, WRONG_PERSON", () => {
    const p = SPOKEN_INTENT_PLAYBOOK.WRONG_NUMBER;
    assert.deepEqual([...p.tools], ["opt_out", "end_call_summary"]);
    assert.match(p.action, /WRONG_PERSON/);
    assert.equal(p.sellingContinues, false);
  });

  test("a machine is never pitched and never pressed through", () => {
    for (const key of ["VOICEMAIL", "IVR"] as const) {
      const p = SPOKEN_INTENT_PLAYBOOK[key];
      assert.ok(p.layers.includes("PROVIDER"), "the provider catches it first");
      assert.match(p.action, /\(VOICEMAIL\)/);
      assert.equal(p.sellingContinues, false);
    }
    assert.ok(VOICE_TOOL_ARGS.end_call_summary.safeParse({ summary: "Reached voicemail.", disposition: "VOICEMAIL" }).success);
  });

  test("bad time: no pitch, a call-back at their time; angry: apologise, offer to stop, a complaint to a person", () => {
    assert.equal(SPOKEN_INTENT_PLAYBOOK.BAD_TIME.tools[0], "schedule_callback");
    assert.match(SPOKEN_INTENT_PLAYBOOK.BAD_TIME.action, /No pitch/);
    assert.match(SPOKEN_INTENT_PLAYBOOK.ANGRY.action, /COMPLAINT/);
    assert.match(SPOKEN_INTENT_PLAYBOOK.ANGRY.action, /stop calling/);
    assert.equal(SPOKEN_INTENT_PLAYBOOK.WANTS_PERSON.tools[0], "transfer_to_human");
  });

  test("the Retell general prompt carries the rendered playbook, every intent", () => {
    const block = renderListenFor();
    assert.ok(RETELL_GENERAL_PROMPT.includes(block));
    for (const key of SPOKEN_INTENTS) assert.ok(block.includes(SPOKEN_INTENT_PLAYBOOK[key].action), key);
    assert.doesNotMatch(block, /[‒-―−]/, "no dashes in speech instructions");
  });
});

describe("part A: the post-call safety net", () => {
  const t = (content: string) => ({ role: "user" as const, content, startMs: null, endMs: null });
  const a = (content: string) => ({ role: "agent" as const, content, startMs: null, endMs: null });
  const base = { outcome: "COMPLETED" as const, durationSec: 40, providerSummary: null, endedAt: new Date("2026-09-29T10:00:00Z") };

  test("a spoken opt-out the model missed is still recorded, with its scope", () => {
    const calls = analyseCall({ ...base, transcript: [a("Is now OK?"), t("dont ring me again")] });
    assert.equal(calls.disposition, "OPTED_OUT");
    assert.equal(calls.voiceOptOut, true);
    assert.equal(calls.optOutScope, "CALLS");
    const all = analyseCall({ ...base, transcript: [a("Is now OK?"), t("take me of ya list")] });
    assert.equal(all.optOutScope, "ALL");
  });

  test("a wrong number is WRONG_PERSON", () => {
    assert.equal(analyseCall({ ...base, transcript: [t("wrong numba love")] }).disposition, "WRONG_PERSON");
  });

  test("a voicemail greeting that reached the model is no conversation, and its words are not the lead's", () => {
    const r = analyseCall({ ...base, transcript: [a("This is an AI assistant..."), t("you've reached the voicemail of dave please leave a message after the tone")] });
    assert.equal(r.disposition, "NO_CONVERSATION");
    assert.equal(r.leadText, "");
    assert.equal(isMachineOnly(["please hold your call is important to us"]), true);
    assert.equal(isMachineOnly(["please hold", "yeah hi sorry about that"]), false);
  });

  test("adversarial pass: a call screen nobody answered is no conversation; a swear-off is an opt-out; a vulnerable signal is WRONG_PERSON", () => {
    assert.equal(isMachineOnly(["please state your name and why you're calling"]), true);
    const swore = analyseCall({ ...base, transcript: [a("Is now OK?"), t("oh f off")] });
    assert.equal(swore.disposition, "OPTED_OUT");
    assert.equal(swore.optOutScope, "ALL");
    assert.equal(analyseCall({ ...base, transcript: [t("i'm her carer she has dementia")] }).disposition, "WRONG_PERSON");
    // The negative stays a conversation.
    assert.notEqual(analyseCall({ ...base, transcript: [t("stop calling it a website it's a shop")] }).disposition, "OPTED_OUT");
  });
});
