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
  "VOICEMAIL",
  "IVR",
  "OPT_OUT_ALL",
  "OPT_OUT_CALLS",
  "WRONG_NUMBER",
  "GATEKEEPER",
  "ANGRY",
  "WANTS_PERSON",
  "ASKS_IF_AI",
  "HOW_GOT_NUMBER",
  "WHO_IS_THIS",
  "PRIVACY",
  "LANGUAGE_BARRIER",
  "BAD_TIME",
  "NOT_INTERESTED",
  "SEND_DETAILS",
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
  VOICEMAIL: {
    label: "A voicemail greeting",
    examples: "leave a message after the tone, not available to take your call",
    action: "A machine: say nothing more, end_call_summary (VOICEMAIL), end the call.",
    tools: ["end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["PROVIDER", "MODEL", "POST_CALL"],
  },
  IVR: {
    label: "A phone menu or hold message",
    examples: "press one for sales, please hold",
    action: "Never press keys or go through menus: end_call_summary (VOICEMAIL), end the call.",
    tools: ["end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["PROVIDER", "MODEL", "POST_CALL"],
  },
  OPT_OUT_ALL: {
    label: "No contact at all",
    examples: "take me off your list, delete my details, stop contacting me",
    action: "opt_out scope ALL at once, confirm in one sentence. No question, no pitch, no closing line.",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  OPT_OUT_CALLS: {
    label: "No more calls",
    examples: "stop calling me, don't ring again, lose my number",
    action: "opt_out scope CALLS at once, confirm in one sentence. No question, no pitch, no closing line.",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  WRONG_NUMBER: {
    label: "Wrong number or wrong person",
    examples: "wrong number, no one by that name here",
    action: "Apologise once, ask and sell nothing. opt_out scope CALLS so the number is not rung again, end_call_summary (WRONG_PERSON).",
    tools: ["opt_out", "end_call_summary"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  GATEKEEPER: {
    label: "Someone else answered (a receptionist or colleague)",
    examples: "she's not in today, can I take a message, who shall I say is calling",
    action: "Never pitch to them or share the lead's details. Ask when the lead is best reached, schedule_callback then, thank them, end.",
    tools: ["schedule_callback", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  ANGRY: {
    label: "An angry or upset caller",
    examples: "this is harassment, I want to complain, swearing",
    action: "Apologise once, calmly. Never argue or sell. Ask if they want you to stop calling (yes: opt_out). A complaint goes to a person: transfer_to_human (COMPLAINT) if allowed, else schedule_callback by a person.",
    tools: ["opt_out", "transfer_to_human", "schedule_callback"],
    endsCall: true,
    closingLine: false,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  WANTS_PERSON: {
    label: "Wants a person",
    examples: "can I speak to a real person, put me through",
    action: "Say you are putting them through, transfer_to_human (ASKED_FOR_PERSON). If refused, schedule_callback by a person.",
    tools: ["transfer_to_human", "schedule_callback"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  ASKS_IF_AI: {
    label: "Asks if you are a robot",
    examples: "is this a robot, are you real, am I talking to a person",
    action: "Say yes honestly: you are the business's AI assistant, and a person can follow up if they prefer. Then carry on.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  HOW_GOT_NUMBER: {
    label: "How did you get my number",
    examples: "how did you get my number",
    action: "Truthfully: from their own enquiry, as you said at the start. Offer to stop calling; carry on only if they are happy to.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  WHO_IS_THIS: {
    label: "Who is this",
    examples: "who's this, what company is it",
    action: "Give the identity answer from the brief, then carry on.",
    tools: [],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  PRIVACY: {
    label: "A data or privacy question",
    examples: "what do you do with my data, are you recording this",
    action: "The call may be recorded, as you said at the start; the business's privacy notice has the rest; a colleague answers anything more. log_objection COMPLIANCE. No legal advice.",
    tools: ["log_objection"],
    endsCall: false,
    closingLine: false,
    sellingContinues: true,
    layers: ["MODEL", "POST_CALL"],
  },
  LANGUAGE_BARRIER: {
    label: "Finds English hard",
    examples: "my English is not good, speak slowly",
    action: "Slow down, short simple words, once. Still hard: offer to text the details, then end politely.",
    tools: ["send_booking_link", "schedule_callback"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL"],
  },
  BAD_TIME: {
    label: "Bad time, call later, driving",
    examples: "I'm driving, bad time, ring me back later",
    action: "No pitch. Ask when suits, schedule_callback at that time, thank them, end. Driving: one line only.",
    tools: ["schedule_callback", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  NOT_INTERESTED: {
    label: "Not interested",
    examples: "not interested, no thanks, we're alright thanks",
    action: "Accept it: log_objection NOT_INTERESTED, thank them in one sentence, end. Never try to change their mind.",
    tools: ["log_objection", "end_call_summary"],
    endsCall: true,
    closingLine: true,
    sellingContinues: false,
    layers: ["MODEL", "POST_CALL"],
  },
  SEND_DETAILS: {
    label: "Just email me, send me something",
    examples: "just email me, send me something",
    action: "Say yes and send it now as the brief's SEND ME SOMETHING says (send_booking_link, send_checkout_link or send_quote), then offer a short follow-up call at two times. log_objection SEND_INFORMATION.",
    tools: ["send_booking_link", "log_objection", "check_availability"],
    endsCall: false,
    closingLine: true,
    sellingContinues: true,
    layers: ["MODEL"],
  },
  BUYING_SIGNAL: {
    label: "Ready to go ahead",
    examples: "sounds good, go on then, book me in",
    action: "Stop qualifying and take the goal's close now. Still read back any email, number or time first.",
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
  t = t.replace(/[’‘`]/g, "'").replace(/\[(?:noise|inaudible|crosstalk|silence|music|laughter)\]/g, " ");
  t = t.replace(/[.,!?;:"()]/g, " ");
  // Fillers and hesitations.
  t = t.replace(/\b(?:u+m+|e+r+m+|e+r+|u+h+m*|h+m+|m+h*m+|ah+|oh+)\b/g, " ");
  const map: [RegExp, string][] = [
    // Missing apostrophes (ASR drops them).
    [/\bdont\b/g, "don't"],
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
    [/\bwere\s+(alright|fine|good|ok|okay|sorted|all good)\b/g, "we're $1"],
    [/\bthats\b/g, "that's"],
    [/\bid\s+(have|need|rather|like|want)\b/g, "i'd $1"],
    // Mishearings and spoken forms.
    [/\bstop (?:colin|call in|coleing|cooling)\b/g, "stop calling"],
    [/\bof (?:your|the|ya|yer) (list|system|database|books)\b/g, "off your $1"],
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
  ];
  for (const [pattern, replacement] of map) t = t.replace(pattern, replacement);
  return t.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------- patterns */

const MACHINE_VOICEMAIL = [
  /\b(leave|record) (a |your )?(message|name and number)\b/,
  /\bafter the (tone|beep)\b/,
  /\b(not|isn't) available to (take|answer) (your|the) call\b/,
  /\bthe person you are calling\b/,
  /\bmailbox (is full|of)\b/,
  /\bvoicemail\b/,
  /\byou('ve| have) reached (the )?(voicemail|mobile|phone) of\b/,
  /\bthe number you have (called|dialled)\b/,
];
const MACHINE_IVR = [
  /\bpress (one|two|three|four|five|six|seven|eight|nine|zero|star|hash|\d)\b/,
  /\bfor [a-z ]{2,30} press\b/,
  /\bplease (hold|stay on the line)\b/,
  /\byour call is important\b/,
  /\bplease say the name of\b/,
  /\ball (of )?our (agents|advisors|lines|operators) are (busy|currently busy)\b/,
  /\byou are (number )?\w+ in the queue\b/,
];

const OPT_OUT_ALL = [
  /\b(take|get) (me|us|my number|my details|my name) off (your|the|this|of) (list|system|database|books|records)\b/,
  /\b(remove|delete|erase|wipe) (me|us|my (number|details|data|info|name|email))\b/,
  /\b(stop|quit) (contacting|messaging|texting|emailing|bothering|pestering|hassling) (me|us)\b/,
  /\b(don't|do not|never) (contact|message|text|email) (me|us)( again)?\b/,
  /\bunsubscribe\b/,
  /\bno more (contact|messages|texts|emails)\b/,
];
const OPT_OUT_CALLS = [
  /\bstop (calling|phoning|ringing)( me| us)?\b/,
  /\b(don't|do not|never) (call|phone)( me| us)?( again| back| anymore| any more)\b/,
  /\bno more (calls|phone calls)\b/,
  /\blose (my|this) number\b/,
  /\bdon't want (any )?(more )?(calls|to be called)\b/,
  /\bplease (don't|do not) call\b/,
];
const WRONG_NUMBER = [
  /\bwrong (number|person|fella|bloke|guy)\b/,
  /\b(no one|nobody|there's no one|there is no one|no-one) (here )?(called|by that name|of that name)\b/,
  /\bthere's no \w+ here\b/,
  /\bi (never|didn't|did not|haven't) (enquire|enquired|inquire|inquired|fill(ed)? (in|out) (a|any|your) form|signed up|sign up|asked (for|about) (this|a call|anything))\b/,
  /\b(don't|do not) know (anyone|anybody|a|an) (called|named|by that name)\b/,
  /\bnot (me|my number)\b.*\b(wrong|never)\b/,
];
const GATEKEEPER = [
  /\b(he's|she's|they're|he is|she is|they are) (not in|out of the office|away|off today|off sick|on holiday|on leave|not available|in a meeting|on another call|not at (his|her|their) desk)\b/,
  /\bcan i take a message\b/,
  /\bwho (shall|should|can) i say is calling\b/,
  /\b(he's|she's|they're) not here\b/,
  /\bcan i ask what it's (regarding|about|in connection with)\b/,
];
const ANGRY = [
  /\b(harass|harassment|harassing)\b/,
  /\b(sick|fed up|tired) of (these|your|the) (calls|call)\b/,
  /\b(complain|complaint|report you|reporting you|trading standards|the ico)\b/,
  /\bhow dare you\b/,
  /\b(f+u+c+k+\w*|f\*+\w*|bloody|piss off|sod off|bugger off|bollocks|shit|crap)\b/,
  /\b(ridiculous|disgusting|outrageous|unacceptable)\b/,
];
const WANTS_PERSON = [
  /\b(speak|talk|chat) (to|with) (a |an |some )?(real |actual )?(person|human|someone|somebody|manager|owner|boss|member of staff)\b/,
  /\b(put|pass|transfer) me (through|over|on)\b/,
  /\b(is there|can i get|get me) (a |an )?(real |actual )?(person|human|someone)\b/,
  /\b(real|actual) (person|human) please\b/,
];
const ASKS_IF_AI = [
  /\b(is this|are you|am i (talking|speaking) to) (a |an )?(robot|bot|machine|computer|ai|a\.i|automated)\b/,
  /\bis this a recording\b/,
  /\bare you (a )?(real|human)( person| human)?\b(?! (company|business|firm|agency))/,
  /\bis (this|that) a (real )?(person|human)\b/,
  /\bam i (talking|speaking) to a (real )?(person|human)\b/,
  /\byou sound like a (robot|machine|computer|bot)\b/,
  /\bis (this|it) (ai|a\.i|artificial intelligence)\b/,
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
];
const PRIVACY = [
  /\b(gdpr|data protection|privacy (policy|notice))\b/,
  /\bwhat (do|will) you do with my (data|details|information|number)\b/,
  /\bare you recording( this| me)?\b/,
  /\bis this (call )?(being )?recorded\b/,
];
const LANGUAGE = [
  /\b(my )?english (is )?(not|no) (good|great|very good)\b/,
  /\b(no|don't|do not) (speak|understand) english\b/,
  /\b(speak|talk) (more )?slow(ly|er)\b/,
  /\bi (don't|do not|can't|cannot) understand (you|what you('re| are) saying)\b/,
  /\b(no entiendo|no hablo|nie rozumiem|je ne comprends)\b/,
];
const BAD_TIME = [
  /\b(bad|not a good|not the best|awkward|terrible) time\b/,
  /\bi'?m (driving|in the car|behind the wheel|on the motorway|in a meeting|at work|on the train|on a train|at the doctor'?s|at the hospital|with a (customer|client|patient)|in the middle of something)\b/,
  /\b(on the train|in the car|driving)\b.*\b(call|later|back)\b/,
  /\b(call|phone|ring|try) (me|us) (back )?(later|tomorrow|next week|another time|in (an|a|half an) hour|this afternoon|this evening|after \w+)\b/,
  /\bcall (me|us) back\b/,
  /\bcan'?t (talk|speak) (right )?now\b/,
  /\b(busy|tied up) (right now|at the moment|just now)\b/,
  /\bnow('s| is) not (good|great|a good time)\b/,
  /\bthe line('s| is) (bad|terrible|breaking up)\b/,
  /\byou('re| are) breaking up\b/,
];
const NOT_INTERESTED = [
  /\bnot interested\b/,
  /\bno thank(s| you)\b/,
  /\bnot for (us|me)\b/,
  /\bwe're (alright|fine|all good|sorted)( thanks| for now)\b/,
  /\bdon't (want|need) it\b/,
];
const SEND_DETAILS = [
  /\b(just )?(email|text|message|whatsapp) me\b/,
  /\bsend (me|us|it|them|that|something|some|the|over|a|an|info|details)\b/,
  /\b(pop|stick|put|drop) (it|that|something|them) in (an )?(email|text|message|the post)\b/,
  /\bhave you got (a |an )?(website|brochure|link|something in writing)\b/,
  /\bin writing\b/,
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
};

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

  if (any(MACHINE_VOICEMAIL, t)) push("VOICEMAIL");
  if (any(MACHINE_IVR, t)) push("IVR");
  if (any(OPT_OUT_ALL, t)) push("OPT_OUT_ALL", { optOutScope: "ALL" });
  else if (any(OPT_OUT_CALLS, t)) push("OPT_OUT_CALLS", { optOutScope: "CALLS" });
  if (any(WRONG_NUMBER, t)) push("WRONG_NUMBER");
  if (any(GATEKEEPER, t)) push("GATEKEEPER");
  if (any(ANGRY, t)) push("ANGRY");
  if (any(WANTS_PERSON, t)) push("WANTS_PERSON");
  if (any(ASKS_IF_AI, t)) push("ASKS_IF_AI");
  if (any(HOW_GOT_NUMBER, t)) push("HOW_GOT_NUMBER");
  else if (any(WHO_IS_THIS, t)) push("WHO_IS_THIS");
  if (any(PRIVACY, t)) push("PRIVACY");
  if (any(LANGUAGE, t)) push("LANGUAGE_BARRIER");
  if (any(BAD_TIME, t)) push("BAD_TIME");
  const stop = hits.some((h) => h.key === "OPT_OUT_ALL" || h.key === "OPT_OUT_CALLS");
  if (any(NOT_INTERESTED, t) && !stop) push("NOT_INTERESTED");
  if (any(SEND_DETAILS, t) && !stop) push("SEND_DETAILS");
  const refused = hits.some((h) => ["OPT_OUT_ALL", "OPT_OUT_CALLS", "NOT_INTERESTED", "WRONG_NUMBER", "ANGRY"].includes(h.key));
  if (!refused && (detectBuyingSignal(t) || /\b(go on then|book me in|let'?s crack on|let'?s get (it|this) (booked|sorted)|sign me up|i'?ll take it|count me in)\b/.test(t))) {
    push("BUYING_SIGNAL");
  }
  if (!refused) {
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
    .replace(/\b(not|nothing) (till|until|before) (after )?(christmas|the new year|new year|january|spring|the summer)\b/g, "maybe next year");
}

/** The strongest intent, or null. */
export function primarySpokenIntent(raw: string): SpokenIntent | null {
  return detectSpokenIntents(raw)[0] ?? null;
}

/** Every lead turn is a machine greeting or menu (and nothing a person said). */
export function isMachineOnly(leadTurns: readonly string[]): boolean {
  const said = leadTurns.map((t) => t.trim()).filter(Boolean);
  if (!said.length) return false;
  return said.every((t) => {
    const intents = detectSpokenIntents(t).map((i) => i.key);
    return intents.includes("VOICEMAIL") || intents.includes("IVR");
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
    return `${p.label} (${p.examples}): ${p.action}`;
  });
  return [
    "LISTEN FOR. Their words reach you misheard and unpunctuated: go by the meaning. Any of these comes before your plan.",
    ...lines,
  ].join("\n");
}
