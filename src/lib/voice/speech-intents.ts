/**
 * What a call must hear, and what it must do about it (voice QA pass,
 * 2026-09-28). Pure: no I/O, no model.
 *
 * WHERE DETECTION HAPPENS. A live call is heard by three layers, and this
 * module is the single table all three read:
 *
 *   1. PROVIDER. Retell's own voicemail and IVR detection (`voicemail_option`,
 *      disconnection reasons `voicemail_reached` / `ivr_reached`,
 *      providers/retell-protocol.ts). The model never talks to a machine that
 *      the provider caught first.
 *   2. MODEL, in the call. The Retell LLM hears the lead and acts through the
 *      tools. It is told what to listen for and what to do by the fixed
 *      general prompt, whose LISTEN FOR block is RENDERED from
 *      `SPOKEN_INTENT_PLAYBOOK` below (`renderListenFor`), so the prompt and
 *      the tests can never drift apart. The words are ASR text: no
 *      punctuation, fillers, mishearings, regional phrasing, cut-offs.
 *   3. POST-CALL, deterministic safety net. `analyseCall` (post-call.ts) runs
 *      `detectSpokenIntents` over the lead's own words after the call: an
 *      opt-out the model missed is still recorded (with its scope), a wrong
 *      number is still a WRONG_PERSON, and a voicemail greeting or IVR menu
 *      that reached the model is still "no conversation".
 *
 * `detectSpokenIntents` is also what the call QA simulator's scripted model
 * hears with (tests/fixtures/voice-call-qa/simulator.ts), so the simulation
 * proves the playbook, not a private copy of it.
 *
 * Deterministic and deliberately conservative: a false opt-out costs a lead,
 * a missed opt-out costs a complaint, so the opt-out patterns are explicit
 * phrases, never single words.
 */

import { matchObjection } from "../sales-library/objections.ts";
import type { ObjectionKey } from "../sales-library/types.ts";
import { detectBuyingSignal } from "../agent/closing.ts";
import type { VoiceToolName } from "./tools/definitions.ts";

export const SPOKEN_INTENTS = [
  // Adversarial QA pass (2026-09-28): an automated call screen (Google Call
  // Screen, iOS "record your name") is neither voicemail nor a person.
  "CALL_SCREEN",
  "VOICEMAIL",
  "IVR",
  "OPT_OUT_ALL",
  "OPT_OUT_CALLS",
  "WRONG_NUMBER",
  // A child, a carer, illness or a bereavement: stop selling at once.
  "VULNERABLE",
  "GATEKEEPER",
  "ANGRY",
  "WANTS_PERSON",
  "ASKS_IF_AI",
  "HOW_GOT_NUMBER",
  "WHO_IS_THIS",
  // "What data do you hold on me": a subject access request, never refused.
  "DATA_REQUEST",
  "PRIVACY",
  "LANGUAGE_BARRIER",
  "BAD_TIME",
  // "Hello? Are you there? Can you hear me?": barge-in or a dropped line.
  "LINE_CHECK",
  "NOT_INTERESTED",
  "SEND_DETAILS",
  // A price, date, area or guarantee asked for: only a tool answers it.
  "PRICE_QUESTION",
  "BUYING_SIGNAL",
  "OBJECTION",
] as const;
export type SpokenIntentKey = (typeof SPOKEN_INTENTS)[number];

export type DetectionLayer = "PROVIDER" | "MODEL" | "POST_CALL";

export type SpokenIntentPlay = {
  /** Short label for the prompt and the reports. */
  label: string;
  /** How it tends to be said on a UK call (examples for the model, not a whitelist). */
  examples: string;
  /** What to do, in words the model follows. */
  action: string;
  /** Tools the right handling calls (the first is the defining one). */
  tools: readonly VoiceToolName[];
  /** The call ends after handling it. */
  endsCall: boolean;
  /** The fixed closing line is spoken (never after an opt-out). */
  closingLine: boolean;
  /** Selling may continue after handling it. */
  sellingContinues: boolean;
  layers: readonly DetectionLayer[];
};

/**
 * The playbook. Order is priority: when several match, the earliest wins
 * (a machine first, then a stop, then everything a person says).
 */
export const SPOKEN_INTENT_PLAYBOOK: Readonly<Record<SpokenIntentKey, SpokenIntentPlay>> = {
  CALL_SCREEN: {
    label: "An automated call screen",
    examples: "say your name and why you're calling, using a screening service",
    action: "A call screen: one sentence, you are the business's AI assistant calling about their enquiry. No pitch. A person answers: carry on. Nobody: end_call_summary (VOICEMAIL).",
    tools: ["end_call_summary"],
    endsCall: false,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  VOICEMAIL: {
    label: "A voicemail greeting",
    examples: "leave a message after the tone, not available to take your call",
    action: "A machine: say nothing, end_call_summary (VOICEMAIL).",
    tools: ["end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["PROVIDER", "MODEL", "POST_CALL"],
  },
  IVR: {
    label: "A phone menu or hold message",
    examples: "press one for sales, please hold",
    action: "A menu: never press keys, end_call_summary (VOICEMAIL).",
    tools: ["end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["PROVIDER", "MODEL", "POST_CALL"],
  },
  OPT_OUT_ALL: {
    label: "No contact at all",
    examples: "take me off your mailing list, opt me out, leave me alone, f off",
    action: "opt_out scope ALL at once, confirm in one sentence. No question, no pitch, no closing line. Nothing promised earlier is sent.",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  OPT_OUT_CALLS: {
    label: "No more calls",
    examples: "stop calling, don't ring me, I'm on the TPS",
    action: "opt_out scope CALLS at once, confirm in one sentence. No question, no pitch, no closing line.",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  WRONG_NUMBER: {
    label: "Wrong number or wrong person",
    examples: "wrong number, she doesn't work here any more, I never gave you my number",
    action: "Apologise once, ask and sell nothing. opt_out scope CALLS so the number is not rung again, end_call_summary (WRONG_PERSON).",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  VULNERABLE: {
    label: "A child, a carer, illness or a death",
    examples: "mummy there's a lady on the phone, I'm his carer, she's not well, he passed away",
    action: "A child or vulnerable person: stop selling, ask and note nothing, say sorry to have troubled them, end. end_call_summary (WRONG_PERSON) saying why.",
    tools: ["end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  GATEKEEPER: {
    label: "Someone else answered (a receptionist or colleague)",
    examples: "she's not in today, can I take a message, who shall I say is calling",
    action: "Someone else answered: no pitch, share nothing. Ask when the lead is best reached, schedule_callback, thank them, end.",
    tools: ["schedule_callback", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  ANGRY: {
    label: "An angry or upset caller",
    examples: "this is harassment, how dare you, I want to complain about this call",
    action: "Apologise once, never argue or sell. Ask if they want you to stop calling (yes: opt_out). A complaint: transfer_to_human (COMPLAINT) if allowed, else schedule_callback by a person.",
    tools: ["opt_out", "transfer_to_human", "schedule_callback"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  WANTS_PERSON: {
    label: "Wants a person",
    examples: "can I speak to a real person, put me through to someone, get me your manager",
    action: "Say you are putting them through, transfer_to_human (ASKED_FOR_PERSON); if refused, schedule_callback by a person.",
    tools: ["transfer_to_human", "schedule_callback"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  ASKS_IF_AI: {
    label: "Asks if you are a robot",
    examples: "is this a robot, are you real, am I talking to a person",
    action: "Say yes honestly: you are the business's AI assistant, and a person can follow up if they prefer. Never claim to be human. Carry on.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  HOW_GOT_NUMBER: {
    label: "How did you get my number",
    examples: "how did you get my number, who gave you my number",
    action: "Truthfully: from their own enquiry. Offer to stop calling; carry on only if they are happy to.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  WHO_IS_THIS: {
    label: "Who is this",
    examples: "who's this, what's it about, is this a scam",
    action: "The brief's identity answer (a doubter may ring the business on its own number), then carry on.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  DATA_REQUEST: {
    label: "Asks for their data",
    examples: "what data do you hold on me, I want a copy of my data",
    action: "Never refuse or ask why: a colleague will send a copy of what we hold. schedule_callback by a person noting data request, log_objection COMPLIANCE, wrap up.",
    tools: ["schedule_callback", "log_objection"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  PRIVACY: {
    label: "A data or privacy question",
    examples: "what do you do with my data, are you recording this",
    action: "Recording: the brief's RECORDING answer word for word. Else: the privacy notice, or a colleague. log_objection COMPLIANCE. No legal advice.",
    tools: ["log_objection"],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL", "POST_CALL"],
  },
  LANGUAGE_BARRIER: {
    label: "Finds English hard",
    examples: "my English is not good, no hablo ingles, do you speak Polish",
    action: "English only. Slow down once, simple words. Still hard, or no English at all: offer to text the details, end politely.",
    tools: ["send_booking_link", "schedule_callback"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  BAD_TIME: {
    label: "Bad time, call later, driving",
    examples: "I'm driving, I'm on another call, ring me back after five",
    action: "No pitch. Ask when suits, schedule_callback then, thank them, end. Driving: one line only.",
    tools: ["schedule_callback", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  LINE_CHECK: {
    label: "Cannot hear you",
    examples: "hello, are you there, can you hear me",
    action: "Say yes, you are here, and repeat your last line in fewer words.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  NOT_INTERESTED: {
    label: "Not interested",
    examples: "not interested mate, you're alright thanks, I said no",
    action: "Accept it: log_objection NOT_INTERESTED, thank them in one sentence, end. Never argue.",
    tools: ["log_objection", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  SEND_DETAILS: {
    label: "Just email me, send me something",
    examples: "just email me, drop me a line, send me something",
    action: "Yes: send it now as SEND ME SOMETHING says (send_booking_link, send_checkout_link or send_quote), then offer a short follow-up call at two times. log_objection SEND_INFORMATION.",
    tools: ["send_booking_link", "log_objection", "check_availability"],
    endsCall: false,
    closingLine: true,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  PRICE_QUESTION: {
    label: "Asks a price, date, area or guarantee",
    examples: "how much, ballpark, do you cover Leeds, are you free Saturday",
    action: "Never a figure, date, area or guarantee of your own: only calculate_quote, check_availability or send_checkout_link if allowed, or an approved offer line; else a colleague confirms (schedule_callback).",
    tools: ["calculate_quote", "check_availability", "send_checkout_link", "schedule_callback"],
    endsCall: false,
    closingLine: true,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  BUYING_SIGNAL: {
    label: "Ready to go ahead",
    examples: "sounds good, go on then, book me in",
    action: "Stop qualifying, close now. Still read back any email, number or time.",
    tools: ["check_availability", "book_meeting", "send_checkout_link", "calculate_quote"],
    endsCall: false,
    closingLine: true,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  OBJECTION: {
    label: "An objection (price, competitor, timing, authority, and the rest)",
    examples: "bit pricey, we use someone already, not till the new year, ask the boss",
    action: "log_objection with its key, then the brief's OBJECTIONS section.",
    tools: ["log_objection"],
    endsCall: false,
    closingLine: true,
    sellingContinues: true,
    layers: ["MODEL", "POST_CALL"],
  },
};

/* --------------------------------------------------------- normalisation */

/**
 * ASR text to something the patterns can read: lower case, straight
 * apostrophes, no noise tags or fillers, the common mishearings and UK
 * spoken forms mapped to their written form. Pure; exported for tests.
 */
export function normaliseSpoken(raw: string): string {
  let t = ` ${(raw ?? "").slice(0, 2000).normalize("NFKC").toLowerCase()} `;
  t = t.replace(/[’‘`]/g, "'").replace(/\[(?:noise|inaudible|crosstalk|silence|music|laughter|beep|tone)\]/g, " ");
  t = t.replace(/[.,!?;:"()]/g, " ");
  // Fillers and hesitations.
  t = t.replace(/\b(?:u+m+|e+r+m+|e+r+|u+h+m*|h+m+|m+h*m+|ah+|oh+)\b/g, " ");
  const map: [RegExp, string][] = [
    // Missing apostrophes (ASR drops them).
    [/\bdont\b|\bdoan\b/g, "don't"],
    [/\bdoesnt\b/g, "doesn't"],
    [/\bdidnt\b/g, "didn't"],
    [/\bwont\b/g, "won't"],
    [/\bcant\b/g, "can't"],
    [/\bim\b/g, "i'm"],
    [/\bive\b/g, "i've"],
    [/\bits\b/g, "it's"],
    [/\bwhos\b/g, "who's"],
    [/\bwhats\b/g, "what's"],
    [/\byouve\b/g, "you've"],
    [/\byoure\b/g, "you're"],
    [/\bhes\b/g, "he's"],
    [/\bshes\b/g, "she's"],
    [/\btheyre\b/g, "they're"],
    [/\bill\s+(call|ring|phone|go|have|think|let|read|look|get)\b/g, "i'll $1"],
    [/\bwere\s+(alright|fine|good|ok|okay|sorted|all good)\b/g, "we're $1"],
    // "your alright" is how ASR spells the UK "you're alright" (no thanks).
    [/\byour\s+(alright|all right)\b/g, "you're alright"],
    [/\ball right\b/g, "alright"],
    [/\bthats\b/g, "that's"],
    [/\bid\s+(have|need|rather|like|want)\b/g, "i'd $1"],
    // Dropped g's and run-together speech.
    [/\bdrivin\b/g, "driving"],
    [/\bcallin\b/g, "calling"],
    [/\bringin\b/g, "ringing"],
    [/\bphonin\b/g, "phoning"],
    [/\bgimme\b/g, "give me"],
    [/\bwanna\b/g, "want to"],
    // Mishearings and spoken forms.
    [/\bstop (?:colin|call in|coleing|cooling)\b/g, "stop calling"],
    [/\bof (?:your|the|ya|yer) ((?:\w+ )?(?:list|system|database|books))\b/g, "off your $1"],
    [/\b(?:ya|yer)\b/g, "your"],
    [/\bme (number|details|name|data|info|email)\b/g, "my $1"],
    [/\bfanks\b|\bthanx\b|\bthanks very much\b|\bcheers\b|\bta\b/g, "thanks"],
    [/\bfink\b/g, "think"],
    [/\bwiv\b/g, "with"],
    [/\bnumba\b|\bnumbah\b/g, "number"],
    [/\be ?-?mail\b/g, "email"],
    [/\bwhats ?app\b|\bwhat's ?app\b/g, "whatsapp"],
    [/\bro ?bot\b|\browbot\b|\brobo\b/g, "robot"],
    [/\bnot interest(?:ed|it|id)?\b/g, "not interested"],
    [/\bgaffer\b|\bguv'?nor\b/g, "boss"],
    [/\bgive (?:me|us) a (?:bell|buzz|tinkle|ring)\b/g, "call me"],
    [/\bring (me|us) back\b/g, "call $1 back"],
    [/\bdo(?:n't| not) ring\b/g, "don't call"],
    [/\bno ta\b/g, "no thanks"],
    [/\bt p s\b/g, "tps"],
  ];
  for (const [pattern, replacement] of map) t = t.replace(pattern, replacement);
  return t.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------- patterns */

/**
 * Google Call Screen and iOS call screening / Live Voicemail. Checked BEFORE
 * voicemail: the screen's words overlap a voicemail greeting ("the person you
 * are calling") but the right move differs (say who you are, once).
 */
const CALL_SCREEN = [
  /\b(screening service|call screen(ing)?|call assist)\b/,
  /\b(say|state|record|tell me) your name and (why|the reason|reason|what)/,
  /\bgo ahead and (say|state) (your name|who you are)\b/,
  /\bplease (say|state) (your name|who('s| is) calling|why you('re| are) calling)\b/,
  /\bwill get a copy of this conversation\b/,
  /\bi'?ll see if (this|the) person is available\b/,
];
const MACHINE_VOICEMAIL = [
  /\b(leave|record) (a |your )?(message|name and number)\b/,
  /\bafter the (tone|beep)\b/,
  /\b(not|isn't) available to (take|answer) (your|the) call\b/,
  /\bthe person you('re| are) (calling|trying to reach) is (not available|unavailable|busy|on another call)\b/,
  /\bthe person you are calling\b/,
  /\bmailbox (is full|of)\b/,
  /\bvoicemail\b/,
  /\byou('ve| have) reached (the )?(voicemail|mobile|phone) of\b/,
  /\byou('ve| have) reached \w+\b.*\b(can't|cannot|unable to) (take|get to|answer)\b/,
  /\bi (can't|cannot) (take|get to|answer) (your call|the phone)\b/,
  /\bthe number you have (called|dialled)\b/,
  /\b(phone|mobile|number) you are calling is (switched off|not (available|reachable|in service))\b/,
  /\b(is|has been) switched off\b/,
];
const MACHINE_IVR = [
  /\bpress (one|two|three|four|five|six|seven|eight|nine|zero|star|hash|\d)\b/,
  /\bfor [a-z ]{2,30} press\b/,
  /\bplease (hold|stay on the line)\b/,
  /\byour call is important\b/,
  /\bplease say the name of\b/,
  /\ball (of )?our (agents|advisors|lines|operators) are (busy|currently busy)\b/,
  /\byou are (number )?\w+ in the queue\b/,
  /\bmenu options have changed\b/,
  /\b(listen carefully|choose from the following options)\b/,
];

const OPT_OUT_ALL = [
  /\b(take|get) (me|us|my number|my details|my name|my email) off (your|the|this|of) (\w+ )?(list|system|database|books|records)\b/,
  /\b(remove|delete|erase|wipe) (me|us|my (number|details|data|info|name|email))\b(?! from (the|this|that) (invite|meeting|calendar|call|cc|chat|group))/,
  /\b(stop|quit) (contacting|messaging|texting|emailing|bothering|pestering|hassling) (me|us)\b/,
  /\b(don't|do not|never) (contact|message|text|email) (me|us)( again)?\b/,
  /\b(don't|do not) want to be contacted\b/,
  /\bunsubscribe\b/,
  /\bopt (me |us )?out\b/,
  /\b(withdraw|take back) (my )?consent\b/,
  /\bno more (contact|messages|texts|emails)\b/,
  // A swear-off or "leave me alone" is an objection to contact, not only to
  // this call (owner decision 2026-09-28; PECR, UK GDPR Art. 21): every
  // channel, through the one global opt-out path, as "take me off your list".
  /\bleave (me|us) alone\b/,
  /\b(f+u+c+k+|f\*+\w*|eff|f) off\b|\b(piss|sod|bugger|naff|jog) off\b|\bget lost\b/,
  /(?<!(i'll|we'll|i will|we will|let me|let us|let's|to|and|can) )\bgo away\b(?! and)/,
];

/** What may follow "don't call me" without it being an opt-out ("don't call me before ten", "don't call me sir"). */
const NOT_A_STOP_AFTER =
  /^ (before|after|until|till|til|on (a |the )?\w+day|at (work|home|the office|lunch)|at \d|between|during|today|tonight|tomorrow|this (morning|afternoon|evening|week)|next week|in the (morning|afternoon|evening)|sir|madam|mr|mrs|ms|miss|by|that|love|darling|dear|pal|i'll|i will|we'll|we will|when|if|unless|first|yet|on this|on my (mobile|landline|work))\b/;

/** "Don't call me", "never ring this number again", "stop calling", each with its tail checked. */
function callsStop(t: string): boolean {
  const dont = /\b(?:don't|do not|never|please don't|please do not) (?:call|phone|ring)(?: me| us| this number| here)?(?: again| back| anymore| any more| ever again)?\b/g;
  for (let m = dont.exec(t); m; m = dont.exec(t)) {
    if (!NOT_A_STOP_AFTER.test(t.slice(m.index + m[0].length))) return true;
  }
  // "stop calling", but not "stop calling it a website".
  const stop = /\bstop (?:calling|phoning|ringing)(?: me| us| this number)?\b/g;
  for (let m = stop.exec(t); m; m = stop.exec(t)) {
    const rest = t.slice(m.index + m[0].length);
    if (/ (me|us|this number)$/.test(m[0]) || !/^ (it|that|them|him|her|the|a|an|my|our|this|these|those)\b/.test(rest)) return true;
  }
  return false;
}
const OPT_OUT_CALLS = [
  /\bno more (calls|phone calls)\b/,
  /\blose (my|this) number\b/,
  /\bdon't want (any )?(more )?(calls|to be called)\b/,
  // A TPS/CTPS registration said on the call: they object to calls.
  /\b(i'm|i am|we're|we are|this number is|number's) (registered )?(on|with) (the )?c?tps\b|\btelephone preference( service)?\b|\bdo not call (list|register)\b/,
];
const WRONG_NUMBER = [
  /\bwrong (number|person|fella|bloke|guy)\b/,
  /\b(no one|nobody|there's no one|there is no one|no-one) (here )?(called|by that name|of that name)\b/,
  /\bthere's no \w+ here\b/,
  /\bi (never|didn't|did not|haven't) (enquire|enquired|inquire|inquired|fill(ed)? (in|out) (a|any|your) form|signed up|sign up|asked (for|about) (this|a call|anything))\b/,
  /\b(never|didn't|did not) (give|gave) (you|anyone|it) (my|this) (number|details)\b|\bnever gave you (my|this) (number|details)\b/,
  /\b(didn't|did not|never) give (you )?(permission|consent)\b/,
  /\b(don't|do not) know (anyone|anybody|a|an) (called|named|by that name)\b/,
  /\bnot (me|my number)\b.*\b(wrong|never)\b/,
  /\b(doesn't|does not|don't|do not) work (here|there|for us) any ?more\b/,
  /\bno longer (works|work|is) (here|with us|at)\b/,
  /\b(he|she|they)('s| has| have) left( the (company|business|firm))?\b(?! a message)/,
  /\b(he|she|they) left (the|this) (company|business|firm)\b/,
  /\b(that's|that is|it's|it is) not me\b/,
  /\bi'm not (the person|who) you('re| are) (after|looking for|want)\b|\bi'm not the person you want\b/,
];
/** "Wrong number? No, it's the right one": not a wrong number. */
const NOT_WRONG = /\b(right|correct) (number|person)\b|\bnot (a |the )?wrong (number|person)\b/;
const VULNERABLE = [
  /\b(mummy|mommy|daddy)\b/,
  /\b(mum|mam|dad) (there's|someone's|it's|phone|the phone|a man|a lady)\b/,
  /\bi'm only (\d{1,2}|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/,
  /\bi'm (\d{1,2}|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen) years old\b/,
  /\b(i'm|i am) (his|her|their) (carer|care worker|nurse)\b/,
  /\b(dementia|alzheimer'?s)\b/,
  /\b(he|she|they)('s| is| are) (very |really |too )?(ill|unwell|not well|in hospital|poorly)\b/,
  /\b(mum|mam|dad|mother|father|husband|wife|son|daughter|partner)('s| is) (very |really |too )?(ill|unwell|not well|in hospital|poorly)\b/,
  /\b(passed away|has died|died last|recently died|at the funeral|bereavement|bereaved)\b/,
  /\bi don't (know|understand) what (i'm|i am) agreeing to\b/,
];
const GATEKEEPER = [
  /\b(he's|she's|they're|he is|she is|they are) (not in|out of the office|away|off today|off sick|on holiday|on leave|not available|in a meeting|on another call|not at (his|her|their) desk|popped out|stepped out|gone out|at lunch|on lunch|with a (customer|client))\b/,
  /\bcan i take a message\b/,
  /\bwho (shall|should|can) i say is calling\b/,
  /\b(he's|she's|they're) not (here|around|about)\b/,
  /\bcan i ask what it's (regarding|about|in connection with)\b/,
];
const ANGRY = [
  /\b(harass|harassment|harassing)\b/,
  /\b(sick|fed up|tired) of (these|your|the) (calls|call)\b/,
  // A complaint about THIS call or business; a complaint about their current
  // supplier is a pain point to qualify, not an escalation.
  /\b(complain|complaint)\b(?! about (my |our )?(current |existing |old |last |previous )?(agency|supplier|provider|developer|designer|host|platform|website|site|system))/,
  /\b(report you|reporting you|trading standards|the ico)\b/,
  /\bhow dare you\b/,
  /\bhow many times\b/,
  /\bwhat the (f+u+c+k+|hell)\b|\bf+u+c+k+ (you|sake)\b/,
  // Directed at the call, not at their own website ("our site is crap").
  /\b(this|that|it|you)('s| is| are|'re) (absolutely |just |bloody |totally )?(ridiculous|disgusting|outrageous|unacceptable|a joke)\b(?! (how|that|what|the way))/,
];
const WANTS_PERSON = [
  /\b(speak|talk|chat) (to|with) (a |an |some |your |the )?(real |actual )?(person|human|someone|somebody|manager|owner|boss|member of staff|supervisor|someone in charge)\b/,
  /\b(put|pass|transfer) me (through|over|on)\b/,
  /\b(is there|can i get|get me|i want|i need) (a |an |your )?(real |actual )?(person|human|someone|manager|supervisor)\b/,
  /\b(real|actual) (person|human) please\b/,
];
const ASKS_IF_AI = [
  /\b(is this|are you|am i (talking|speaking) to) (a |an )?(robot|bot|machine|computer|ai|a\.i|automated|chat ?gpt)\b/,
  /\bis this a record(ing|ed message)\b/,
  /\bare you (a )?(real|human)( person| human)?\b(?! (company|business|firm|agency))/,
  /\bis (this|that) a (real )?(person|human)\b/,
  /\bam i (talking|speaking) to a (real )?(person|human)\b/,
  /\byou sound like a (robot|machine|computer|bot)\b/,
  /\bis (this|it) (ai|a\.i|artificial intelligence|automated)\b/,
  /\byou're not (real|a (real )?person) are you\b/,
];
const HOW_GOT_NUMBER = [
  /\bhow (did|do) you (get|have|find) (my|this) (number|details|info|name)\b/,
  /\bwhere('d| did| do| have) you (get|got|find|found) (my|this) (number|details|info)\b/,
  /\bwho gave you (my|this) (number|details)\b/,
];
const WHO_IS_THIS = [
  /\bwho('s| is) (this|calling|that|speaking)\b/,
  /\bwho are you\b/,
  /\bwhat company (is (this|it)|are you)\b/,
  /\bwhere are you calling from\b/,
  /\bwhat('s| is) (this|it) (about|regarding|in connection with)\b/,
  /\b(is this|this is|sounds like|are you) a scam\b/,
];
const DATA_REQUEST = [
  /\bwhat (data|information|info|details|personal data) (do|have) you (got |hold|have|keep|store)/,
  /\bwhat do you (hold|have|keep|know) (on|about) me\b/,
  /\b(a )?copy of (my|the) (data|information|details|personal data)\b/,
  /\bsubject access( request)?\b/,
  /\bsee (the|my|what) (data|information) you (hold|have)\b/,
];
const PRIVACY = [
  /\b(gdpr|data protection|privacy (policy|notice))\b/,
  /\bwhat (do|will) you do with my (data|details|information|number)\b/,
  /\bare you recording( this| me)?\b/,
  /\bis this (call )?(being )?recorded\b/,
  /\bwho (else )?(do|will) you share (my|this)\b/,
];
const FOREIGN = /\b(no hablo|hablas?|no entiendo|no comprendo|nie rozumiem|nie (mówię|mowie)|mówisz|mowisz|je ne comprends|parlez|sprechen sie|ich verstehe nicht|non capisco)\b/;
const NO_ENGLISH = /\b(no|don't|do not) (speak|understand) english\b|\bno english\b|\benglish no\b/;
const LANGUAGE = [
  /\b(my )?english (is )?(not|no) (good|great|very good)\b/,
  /\b(no|don't|do not) (speak|understand) english\b/,
  /\b(no|not much|little|small) english\b|\benglish no\b/,
  /\b(speak|talk) (more )?slow(ly|er)\b/,
  /\bi (don't|do not|can't|cannot) understand (you|what you('re| are) saying)\b/,
  /\b(do you|can you|can i) speak (in )?(polish|french|spanish|urdu|punjabi|arabic|portuguese|romanian|italian|german|hindi|bengali|chinese|mandarin|cantonese|welsh|turkish|another language)\b/,
  FOREIGN,
];
const BAD_TIME = [
  /\b(bad|not a good|not the best|awkward|terrible) time\b/,
  /\bi'?m (driving|in the car|behind the wheel|on the motorway|in a meeting|at work|on the train|on a train|at the doctor'?s|at the hospital|with a (customer|client|patient)|in the middle of something|on another call|on the other line|at lunch|having lunch|having my lunch)\b(?! (the|this|that|our|a|it|forward|growth|sales)\b)/,
  /\b(on the train|in the car|driving)\b.*\b(call|later|back)\b/,
  /\b(call|phone|ring|try) (me|us) (back )?(later|tomorrow|next week|another time|in (an|a|half an) hour|this afternoon|this evening|after \w+)\b/,
  /\b(call|phone|ring|try) (me |us )?(back|again) (later|in \w+( \w+)? (minutes?|mins?|hours?)|tomorrow|this afternoon|this evening|after \w+)\b/,
  /\bcall (me|us) back\b/,
  /\bcan'?t (talk|speak)( right now| now| at the moment| just now)?\b/,
  /\b(busy|tied up) (right now|at the moment|just now)\b/,
  // "I'm busy" is right now; "we're flat out" is the business (TOO_BUSY, an objection).
  /\b(i'm|i am) (a bit |really |very |quite |so )?(busy|swamped|slammed|tied up|rushed off my feet)\b(?! (tomorrow|on|next|then|that day|this (week|afternoon|evening)))/,
  /\b(just )?about to (go )?(into|in) a meeting\b|\b(just )?going into a meeting\b/,
  /\bnow('s| is) not (good|great|a good time)\b/,
  /\bthe line('s| is) (bad|terrible|breaking up)\b/,
  /\byou('re| are) breaking up\b/,
  /\bcan'?t hear you\b/,
];
const LINE_CHECK = [
  /^(hello ?)+$/,
  /\b(are you|you) still there\b|\bare you there\b/,
  /\bcan you hear me\b/,
  /^(hello )*(is )?(anyone|anybody) there$/,
];
const NOT_INTERESTED = [
  // "not interested", but not "not interested in the blue one, the red one".
  /\bnot interested\b(?! in (?!(it|that|this|anything|any of|you|your|what you|buying|changing|switching|the (service|offer|product|call)|a (call|meeting|chat))\b))/,
  /\bno thank(s| you)\b/,
  /\bnot for (us|me)\b/,
  /\b(we're|i'm) (alright|fine|all good|good|sorted|ok|okay)( (thanks|thank you|mate|love|pal|for now|as we are))*$/,
  /\b(we're|i'm) (alright|fine|all good|sorted)( thanks| for now)\b/,
  /\byou're alright\b(?! (go on|go ahead|carry on|fire away|what))/,
  /\bdon't (want|need) it\b/,
  /\bi (said|already said|told you|already told you) no\b|\balready told you\b/,
];
const SEND_DETAILS = [
  /\b(just )?(email|text|message|whatsapp) me\b/,
  /\bsend (me|us|it|them|that|something|some|the|over|a|an|info|details)\b/,
  /\b(pop|stick|put|drop) (it|that|something|them|me) in (an )?(email|text|message|the post)\b/,
  /\bdrop me (a line|an email|a text|a message)\b/,
  /\bhave you got (a |an )?(website|brochure|link|something in writing)\b/,
  /\bin writing\b/,
];
const PRICE_QUESTION = [
  /\bhow much (is|does|would|will|are|do|for|to|we)\b/,
  /\bwhat('s| is| are| would be) (the |your )?(price|cost|rate|fee|charge)s?\b/,
  /\bwhat do you charge\b|\b(ballpark|rough (idea|figure|cost|price)|price list|day rate|hourly rate)\b/,
  /\bdo you (cover|work in|serve|come out to|do work in|operate in) [a-z]+/,
  /\b(are you|is anyone|is someone) (free|available) (on|this|next|tomorrow|at|in)\b/,
  /\b(how soon|when) (can|could) you (start|do it|begin|get (it|this) done)\b/,
  /\bcan you guarantee\b|\bhow long (does|will|would) it take\b/,
];

function any(patterns: readonly RegExp[], t: string): boolean {
  return patterns.some((p) => p.test(t));
}

export type SpokenIntent = {
  key: SpokenIntentKey;
  /** For OPT_OUT_*: the scope to pass to opt_out. */
  optOutScope?: "CALLS" | "ALL";
  /** For OBJECTION: the sales-library key (log_objection). */
  objectionKey?: ObjectionKey;
  /** For LANGUAGE_BARRIER: they speak no English at all (skip "I will speak slowly"). */
  noEnglish?: boolean;
};

/** Refusals and stops: nothing after them is a sale, a price question or an objection to handle. */
const REFUSALS: readonly SpokenIntentKey[] = ["OPT_OUT_ALL", "OPT_OUT_CALLS", "NOT_INTERESTED", "WRONG_NUMBER", "ANGRY", "VULNERABLE"];
/** Honest-answer questions: a "scam?" or "robot?" is answered, not logged as a TRUST objection. */
const IDENTITY_QUESTIONS: readonly SpokenIntentKey[] = ["ASKS_IF_AI", "WHO_IS_THIS", "HOW_GOT_NUMBER"];

/**
 * Everything the words carry, strongest first (`SPOKEN_INTENTS` order). An
 * empty or noise-only turn returns []. The objection taxonomy is the sales
 * library's own (`matchObjection`), read on the normalised words.
 */
export function detectSpokenIntents(raw: string): SpokenIntent[] {
  const t = normaliseSpoken(raw);
  if (!t) return [];
  const hits: SpokenIntent[] = [];
  const push = (key: SpokenIntentKey, extra: Partial<SpokenIntent> = {}) => hits.push({ key, ...extra });

  // A call screen is not a voicemail, though its words overlap one.
  if (any(CALL_SCREEN, t)) push("CALL_SCREEN");
  else if (any(MACHINE_VOICEMAIL, t)) push("VOICEMAIL");
  if (any(MACHINE_IVR, t)) push("IVR");
  if (any(OPT_OUT_ALL, t)) push("OPT_OUT_ALL", { optOutScope: "ALL" });
  else if (callsStop(t) || any(OPT_OUT_CALLS, t)) push("OPT_OUT_CALLS", { optOutScope: "CALLS" });
  if (any(WRONG_NUMBER, t) && !NOT_WRONG.test(t)) push("WRONG_NUMBER");
  if (any(VULNERABLE, t)) push("VULNERABLE");
  if (any(GATEKEEPER, t)) push("GATEKEEPER");
  if (any(ANGRY, t)) push("ANGRY");
  if (any(WANTS_PERSON, t)) push("WANTS_PERSON");
  if (any(ASKS_IF_AI, t)) push("ASKS_IF_AI");
  if (any(HOW_GOT_NUMBER, t)) push("HOW_GOT_NUMBER");
  else if (any(WHO_IS_THIS, t)) push("WHO_IS_THIS");
  if (any(DATA_REQUEST, t)) push("DATA_REQUEST");
  else if (any(PRIVACY, t)) push("PRIVACY");
  if (any(LANGUAGE, t)) push("LANGUAGE_BARRIER", FOREIGN.test(t) || NO_ENGLISH.test(t) ? { noEnglish: true } : {});
  if (any(BAD_TIME, t)) push("BAD_TIME");
  if (any(LINE_CHECK, t)) push("LINE_CHECK");
  const stop = hits.some((h) => h.key === "OPT_OUT_ALL" || h.key === "OPT_OUT_CALLS");
  if (any(NOT_INTERESTED, t) && !stop) push("NOT_INTERESTED");
  if (any(SEND_DETAILS, t) && !stop) push("SEND_DETAILS");
  const refused = hits.some((h) => REFUSALS.includes(h.key));
  if (!refused && any(PRICE_QUESTION, t)) push("PRICE_QUESTION");
  if (!refused && (detectBuyingSignal(t) || /\b(go on then|book me in|let'?s crack on|let'?s get (it|this) (booked|sorted)|sign me up|i'?ll take it|count me in|ready to (go ahead|move|get started|crack on))\b/.test(t))) {
    push("BUYING_SIGNAL");
  }
  if (!refused && !hits.some((h) => IDENTITY_QUESTIONS.includes(h.key))) {
    const objection = matchObjection(spokenObjectionText(t))[0];
    // "Send me information" and "not interested" are their own intents above.
    if (objection && objection.key !== "NOT_INTERESTED" && objection.key !== "SEND_INFORMATION" && objection.key !== "CALL_LATER") {
      push("OBJECTION", { objectionKey: objection.key });
    }
  }
  const order = new Map(SPOKEN_INTENTS.map((k, i) => [k, i]));
  return hits.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

/** Spoken phrasing the written objection patterns do not know, mapped onto them. */
function spokenObjectionText(t: string): string {
  return t
    .replace(/\b(bit|little bit|a bit) (pricey|dear|steep|much|rich)\b/g, "too expensive")
    .replace(/\b(costs|cost) an arm and a leg\b/g, "too expensive")
    .replace(/\bhow much\b.*\b(that'?s|is) (loads|a lot|mad|steep)\b/g, "too expensive")
    .replace(/\bwe (use|have|got|work with) (someone|somebody|a company|an agency|a guy|a bloke)\b/g, "we already have someone")
    .replace(/\b(run it|check) (past|with|by) (the )?(boss|wife|husband|missus|partner|directors?|md)\b/g, "i need to check with my boss")
    .replace(/\b(the )?(boss|missus|wife|husband|partner) (decides|makes the call|signs off)\b/g, "not my decision")
    .replace(/\bnot the (right person|decision maker|one who decides|person who decides)\b/g, "not my decision")
    .replace(/\byou('d)? (want|need) to (speak|talk) (to|with) (our|my|the) \w+/g, "not my decision")
    .replace(/\b(go away and )?(have a )?think (about|on) it\b|\bhave a think\b|\bsleep on it\b|\bmull it over\b/g, "not now")
    .replace(/\b(not|nothing) (till|until|before) (after )?(christmas|the new year|new year|january|spring|the summer)\b/g, "maybe next year");
}

/** The strongest intent, or null. */
export function primarySpokenIntent(raw: string): SpokenIntent | null {
  return detectSpokenIntents(raw)[0] ?? null;
}

/** Every lead turn is a machine: a greeting, a menu or a call screen (and nothing a person said). */
export function isMachineOnly(leadTurns: readonly string[]): boolean {
  const said = leadTurns.map((t) => t.trim()).filter(Boolean);
  if (!said.length) return false;
  return said.every((t) => {
    const intents = detectSpokenIntents(t).map((i) => i.key);
    return intents.includes("VOICEMAIL") || intents.includes("IVR") || intents.includes("CALL_SCREEN");
  });
}

/* ------------------------------------------------------------ the prompt */

/**
 * The LISTEN FOR block of the Retell general prompt, rendered from the
 * playbook. One line per intent; examples are illustrative ("go by the
 * meaning": the words arrive misheard and unpunctuated).
 */
export function renderListenFor(): string {
  const lines = SPOKEN_INTENTS.map((key) => {
    const p = SPOKEN_INTENT_PLAYBOOK[key];
    // Examples only (the label is for reports): the prompt is paid for on every turn.
    return `"${p.examples}": ${p.action}`;
  });
  return [
    "LISTEN FOR. Words arrive misheard and unpunctuated: go by the meaning, not these exact words. Any of these comes before your plan.",
    ...lines,
  ].join("\n");
}
