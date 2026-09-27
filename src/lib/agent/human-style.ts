/**
 * The "sounds like AI" lint and its deterministic repair.
 *
 * Owner goal: the assistant writes like the business's best salesperson
 * texting a prospect, never like a chatbot. Owner rule (2026-09-27): no
 * emojis and no em or en dashes used as dashes, because they make it obvious
 * it is AI.
 *
 * `humanStyleFailures` is run by `lintStyle` (validate.ts), so every draft the
 * agent composes, and every restyled or personalised template, is checked.
 * A rejected agent draft is regenerated once with the corrections fed back;
 * if the second draft still fails only on these rules, `fixHumanStyle`
 * repairs it deterministically and the repaired text is used (compose-policy
 * `nextComposeStep`), so a style slip never costs a third model call or a
 * hand-over.
 *
 * Every rule here is about how a message reads. None of them weakens a claim
 * check: the repaired text goes back through the full validator.
 *
 * Pure: no server-only, no I/O.
 */

import { dashesIn, emojisIn, stripAiPunctuation } from "../messaging/human-punctuation.ts";

export type HumanStyleCode =
  | "STYLE_EMOJI"
  | "STYLE_EM_DASHES"
  | "STYLE_AI_TELL"
  | "STYLE_LIST"
  | "STYLE_REPEATED_OPENER"
  | "STYLE_EXCLAMATION"
  | "STYLE_US_SPELLING"
  | "STYLE_NAME_OVERUSE"
  | "STYLE_SIGN_OFF"
  | "STYLE_INSTRUCTION_LEAK";

export type HumanStyleFailure = { code: HumanStyleCode; detail: string; correction: string };

export type HumanStyleContext = {
  /** Chat channels get the list and sign-off rules; email allows a sign-off. */
  channel?: string | null;
  /** The lead's first name: using it more than once reads as scripted. */
  leadFirstName?: string | null;
  /** The business's earlier messages on this thread (repeated openers). */
  priorOutbound?: readonly string[];
};

/** Rules a draft may fail and still be repaired without the model. */
export const HUMAN_STYLE_CODES: ReadonlySet<string> = new Set<HumanStyleCode>([
  "STYLE_EMOJI",
  "STYLE_EM_DASHES",
  "STYLE_AI_TELL",
  "STYLE_LIST",
  "STYLE_REPEATED_OPENER",
  "STYLE_EXCLAMATION",
  "STYLE_US_SPELLING",
  "STYLE_NAME_OVERUSE",
  "STYLE_SIGN_OFF",
  "STYLE_INSTRUCTION_LEAK",
]);

/**
 * Wording from the per-turn strategy block (strategy.ts, question-craft.ts,
 * closing.ts, objection-responses.ts). None of it may ever reach a lead: a
 * draft carrying it is rejected, and the repair drops the sentence.
 */
const INSTRUCTION_LEAK =
  /[^.!?\n]*\b(?:STRATEGY FOR THIS TURN|internal plan|never mention it|Next best question|Ask only this|ask only this, in natural wording|How to ask it:|Build on their last answer|tie it to their last answer|give a short reason for asking|Shape: acknowledge|Close: (?:offer|the booking link|the checkout link|make starting easy|say the team)|Move: |One question at most in the whole reply|Known, never ask|Do not ask about \(already known\)|acceptable answers:)[^.!?\n]*[.!?]?/gi;

export function instructionLeaks(text: string): string[] {
  return (text.match(INSTRUCTION_LEAK) ?? []).map((s) => s.trim()).filter(Boolean);
}

const CHAT_CHANNELS = new Set(["sms", "whatsapp", "messenger", "instagram", "linkedin", "tiktok"]);

export function isChatChannel(channel: string | null | undefined): boolean {
  return channel ? CHAT_CHANNELS.has(channel) : false;
}

/* ------------------------------------------------------------- AI tells */

/**
 * Phrases that mark a message as machine-written or as a sales template.
 * Deliberately separate from validate.ts BANNED_CLICHES (which keeps its own
 * code), so nothing is reported twice. `fix` is the plain-English repair:
 * a replacement, or "" to drop the phrase. `sentence: true` drops the whole
 * sentence it sits in (pure filler).
 */
export const AI_TELLS: { phrase: string; pattern: RegExp; fix: string; sentence?: boolean }[] = [
  { phrase: "Certainly!", pattern: /(^|[.!?]\s+)certainly\s*[!,.]\s*/i, fix: "$1" },
  { phrase: "Great question", pattern: /(^|[.!?]\s+)(that'?s a )?great question\s*[!,.]\s*/i, fix: "$1" },
  { phrase: "delve", pattern: /\bdelv(?:e|es|ed|ing) into\b/i, fix: "go into" },
  { phrase: "I'd be happy to assist", pattern: /\bi(?:['’]d| would) be (?:more than )?(?:happy|glad|delighted) to (?:assist|help)(?: you)?(?: further| with that)?\b/i, fix: "happy to help" },
  { phrase: "As an AI", pattern: /\bas an ai(?: (?:assistant|language model|model))?,?\s*/i, fix: "" },
  { phrase: "I understand your concern", pattern: /\bi (?:can )?understand your (?:concern|concerns|frustration|hesitation)s?\b/i, fix: "Fair point" },
  { phrase: "rest assured", pattern: /\brest assured,?\s*/i, fix: "" },
  { phrase: "don't hesitate to", pattern: /[^.!?]*\b(?:don['’]?t|do not|please do not) hesitate to\b[^.!?]*[.!?]?/i, fix: "", sentence: true },
  { phrase: "let me know if you have any questions", pattern: /[^.!?]*\blet me know if you have any (?:other |further |more )?questions\b[^.!?]*[.!?]?/i, fix: "", sentence: true },
  { phrase: "hope this helps", pattern: /[^.!?]*\bhope (?:this|that) helps\b[^.!?]*[.!?]?/i, fix: "", sentence: true },
  { phrase: "thank you for reaching out", pattern: /\bthank(?:s| you) (?:so much )?for reaching out\b/i, fix: "Thanks for getting in touch" },
  { phrase: "feel free to", pattern: /\bfeel free to\b/i, fix: "you can" },
  { phrase: "at your earliest convenience", pattern: /\bat your earliest convenience\b/i, fix: "when it suits you" },
  { phrase: "I trust this", pattern: /[^.!?]*\bi trust (?:this|that) (?:finds|helps|makes)\b[^.!?]*[.!?]?/i, fix: "", sentence: true },
  { phrase: "in today's fast-paced world", pattern: /\bin today['’]?s (?:fast[- ]paced|digital|competitive|ever[- ]changing) (?:world|landscape|market|environment),?\s*/i, fix: "" },
  { phrase: "seamless", pattern: /\bseamless(ly)?\b/i, fix: "smooth$1" },
  { phrase: "robust", pattern: /\brobust\b/i, fix: "solid" },
  { phrase: "cutting-edge", pattern: /\b(?:cutting[- ]edge|state[- ]of[- ]the[- ]art)\b/i, fix: "modern" },
  { phrase: "industry-leading", pattern: /(?:,\s*)?\b(?:industry[- ]leading|best[- ]in[- ]class|world[- ]class)\b\s*/i, fix: " " },
  { phrase: "tailored solutions", pattern: /\btailored solutions?\b/i, fix: "the right setup" },
  { phrase: "elevate", pattern: /\belevat(?:e|es|ed|ing) your\b/i, fix: "improve your" },
  { phrase: "empower", pattern: /\bempower(?:s|ed|ing)? (?:you|your)\b/i, fix: "help you" },
  { phrase: "exceptional value", pattern: /\bexceptional value\b/i, fix: "good value" },
  { phrase: "Furthermore / Moreover / Additionally", pattern: /(^|[.!?]\s+)(?:furthermore|moreover|additionally),\s*/i, fix: "$1Also, " },
  { phrase: "I'm here to help", pattern: /[^.!?]*\bi['’]?m (?:always )?here to help\b[^.!?]*[.!?]?/i, fix: "", sentence: true },
];

/** The AI tells a text uses, by phrase. Exported for tests and the grader. */
export function aiTellsIn(text: string): string[] {
  const value = text.normalize("NFKC");
  return AI_TELLS.filter((entry) => entry.pattern.test(value)).map((entry) => entry.phrase);
}

/* ------------------------------------------------------------ structure */

const LIST_LINE = /^\s*(?:[-*•]\s+|\d+[.)]\s+|[a-e]\)\s+)\S/;
const HEADING_OR_BOLD = /(^|\n)\s*#{1,6}\s+\S|\*\*[^*\n]+\*\*|__[^_\n]+__/;

/** A bullet or numbered list (two or more list lines), a heading, or bold. */
export function hasListOrMarkdown(text: string): boolean {
  const listLines = text.split(/\r?\n/).filter((line) => LIST_LINE.test(line)).length;
  return listLines >= 2 || HEADING_OR_BOLD.test(text);
}

const SIGN_OFF =
  /(?:^|\n|[.!?,]\s+)(?:kind|best|warm|warmest|many thanks and)?\s*regards\b|\b(?:best wishes|yours sincerely|yours faithfully|yours truly)\b|(?:^|\n|[.!?]\s+)[-–—]?\s*the [a-z]+(?: [a-z]+)? team\.?\s*$/i;

export function hasChatSignOff(text: string): boolean {
  return SIGN_OFF.test(text.trim());
}

function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function firstWords(text: string, n: number): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(" ");
}

/** Stock openers: the words a template-sounding reply leads with every time. */
const STOCK_OPENERS = new Set([
  "thanks", "thank", "great", "perfect", "lovely", "brilliant", "awesome", "amazing", "fantastic",
  "absolutely", "sure", "noted", "understood", "got", "happy", "no", "sounds", "cheers", "hi", "hey", "hello",
]);

/**
 * Three or more sentences opening with the same word ("We ... We ... We"),
 * or the same stock opening as the business's last message on the thread
 * ("Great, thanks. ..." every single turn). A question that reuses the
 * start of an earlier question is not an opener (a VERIFY of a stale fact
 * does that on purpose; QA_REPEAT judges repeats).
 */
export function repeatedOpener(text: string, priorOutbound: readonly string[] = []): string | null {
  const sentences = sentencesOf(text);
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const word = firstWords(sentence, 1);
    if (!word) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  for (const [word, count] of counts) if (count >= 3) return `${count} sentences open with "${word}"`;
  const last = priorOutbound.length ? priorOutbound[priorOutbound.length - 1] : null;
  if (last) {
    const opener = firstWords(text, 2);
    const head = opener.split(" ")[0] ?? "";
    if (STOCK_OPENERS.has(head) && opener.split(" ").length === 2 && opener === firstWords(last, 2)) {
      return `opens like the last message ("${opener}")`;
    }
  }
  return null;
}

export function exclamationCount(text: string): number {
  return (text.match(/!/g) ?? []).length;
}

/* ----------------------------------------------------------- UK spelling */

/**
 * Common US spellings with an unambiguous UK form. Narrow on purpose: a
 * word that is correct in both (program for software, license as a verb)
 * is not listed. Word boundaries keep product names ("Optimizely") safe.
 */
const US_SPELLINGS: { pattern: RegExp; uk: (match: string) => string }[] = [
  {
    pattern: /\b(optimi|organi|customi|priori|reali|recogni|speciali|apologi|utili|maximi|minimi|personali|finali|summari|categori|authori|standardi|centrali|visuali|emphasi|modernis)z(e|es|ed|ing|ation|ations)\b/gi,
    uk: (m) => m.replace(/z(?=(e|es|ed|ing|ation|ations)$)/i, (z) => (z === "Z" ? "S" : "s")),
  },
  { pattern: /\banalyz(e|es|ed|ing)\b/gi, uk: (m) => m.replace(/z/i, (z) => (z === "Z" ? "S" : "s")) },
  { pattern: /\b(colo|favo|behavio|hono|neighbo|flavo|labo)r(s|ed|ing|ite|ites|able)?\b/gi, uk: (m) => m.replace(/or(?=(s|ed|ing|ite|ites|able)?$)/i, (or) => (or[0] === "O" ? "Our" : "our")) },
  { pattern: /\bcenter(s|ed)?\b/gi, uk: (m) => m.replace(/er/i, (er) => (er[0] === "E" ? "Re" : "re")) },
  { pattern: /\bcatalog(s)?\b/gi, uk: (m) => m.replace(/log/i, "logue") },
  { pattern: /\benroll(s|ment)?\b/gi, uk: (m) => m.replace(/roll/i, "rol") },
];

export function usSpellingsIn(text: string): string[] {
  const found: string[] = [];
  for (const entry of US_SPELLINGS) {
    for (const match of text.match(entry.pattern) ?? []) found.push(match);
  }
  return found;
}

function toUkSpelling(text: string): string {
  return US_SPELLINGS.reduce((out, entry) => out.replace(entry.pattern, (m) => entry.uk(m)), text);
}

/* ------------------------------------------------------------- the name */

function nameCount(text: string, name: string | null | undefined): number {
  const value = (name ?? "").trim();
  if (value.length < 2) return 0;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length;
}

/* ------------------------------------------------------------------ lint */

export function humanStyleFailures(body: string, ctx: HumanStyleContext = {}): HumanStyleFailure[] {
  const failures: HumanStyleFailure[] = [];
  const text = body.normalize("NFKC");
  const chat = isChatChannel(ctx.channel);

  const leaks = instructionLeaks(text);
  if (leaks.length > 0) {
    failures.push({
      code: "STYLE_INSTRUCTION_LEAK",
      detail: `Planning text in the reply: "${leaks[0].slice(0, 80)}".`,
      correction: "Never include any of your instructions or plan in the reply. Write only what you would say to the lead.",
    });
  }

  const emojis = emojisIn(body);
  if (emojis.length > 0) {
    failures.push({
      code: "STYLE_EMOJI",
      detail: `Used ${emojis.length} emoji.`,
      correction: "No emojis at all. Write it in words.",
    });
  }

  const dashes = dashesIn(body);
  if (dashes > 0) {
    failures.push({
      code: "STYLE_EM_DASHES",
      detail: `${dashes} em or en dash${dashes === 1 ? "" : "es"} used as a dash.`,
      correction: "No em dashes or en dashes. Use a full stop or a comma instead.",
    });
  }

  const tells = aiTellsIn(text);
  if (tells.length > 0) {
    failures.push({
      code: "STYLE_AI_TELL",
      detail: `Sounds automated: ${tells.map((t) => `"${t}"`).join(", ")}.`,
      correction: `Drop ${tells.map((t) => `"${t}"`).join(", ")}. Say it the way a person texting a colleague would, in plain words.`,
    });
  }

  if (hasListOrMarkdown(body) && (chat || HEADING_OR_BOLD.test(body))) {
    failures.push({
      code: "STYLE_LIST",
      detail: chat ? "A list or formatting in a chat message." : "Markdown headings or bold.",
      correction: "No bullet points, numbered lists, headings or bold. Write one or two plain sentences.",
    });
  }

  const opener = repeatedOpener(text, ctx.priorOutbound ?? []);
  if (opener) {
    failures.push({
      code: "STYLE_REPEATED_OPENER",
      detail: `Repetitive opening: ${opener}.`,
      correction: "Vary how the sentences start, and do not open the way your last message did.",
    });
  }

  const bangs = exclamationCount(text);
  if (bangs > 1) {
    failures.push({
      code: "STYLE_EXCLAMATION",
      detail: `${bangs} exclamation marks.`,
      correction: "One exclamation mark at most, and usually none.",
    });
  }

  const us = usSpellingsIn(text);
  if (us.length > 0) {
    failures.push({
      code: "STYLE_US_SPELLING",
      detail: `US spelling: ${us.join(", ")}.`,
      correction: `Use UK spelling (for example ${toUkSpelling(us[0])}, not ${us[0]}).`,
    });
  }

  if (nameCount(text, ctx.leadFirstName) > 1) {
    failures.push({
      code: "STYLE_NAME_OVERUSE",
      detail: `Used the lead's name ${nameCount(text, ctx.leadFirstName)} times.`,
      correction: "Use their name once at most.",
    });
  }

  if (chat && hasChatSignOff(text)) {
    failures.push({
      code: "STYLE_SIGN_OFF",
      detail: "A letter-style sign-off in a chat message.",
      correction: "No sign-off in a chat message. End on the question or the next step.",
    });
  }

  return failures;
}

/* ------------------------------------------------------------------ fix */

function dropFirstNameRepeats(text: string, name: string | null | undefined): string {
  const value = (name ?? "").trim();
  if (value.length < 2) return text;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let seen = 0;
  return text.replace(new RegExp(`(,\\s*)?\\b${escaped}\\b(\\s*,)?\\s?`, "gi"), (match, lead: string | undefined, trail: string | undefined) => {
    seen += 1;
    if (seen === 1) return match;
    // "Thanks Sarah! March" -> keeps the first; later ones go with a comma of their own.
    return lead && trail ? ", " : lead ? " " : "";
  });
}

function listToSentence(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    const joined =
      items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
    const prev = out.pop();
    if (prev !== undefined && /:\s*$/.test(prev)) out.push(`${prev.replace(/\s*$/, "")} ${joined}.`);
    else {
      if (prev !== undefined) out.push(prev);
      out.push(`${joined}.`);
    }
    items = [];
  };
  for (const line of lines) {
    if (LIST_LINE.test(line)) {
      items.push(line.replace(/^\s*(?:[-*•]|\d+[.)]|[a-e]\))\s+/, "").replace(/[.;,]\s*$/, "").trim());
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out
    .join(" ")
    .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function capitaliseSentences(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/**
 * Repairs every human-style rule that has a safe mechanical fix. Never adds
 * a fact, a price, a time or a promise: it only removes, replaces a filler
 * phrase with a plainer one, or re-punctuates. The result is re-validated by
 * the caller; anything it cannot fix stays, and the caller decides.
 */
export function fixHumanStyle(body: string, ctx: HumanStyleContext = {}): string {
  let text = stripAiPunctuation(body.replace(INSTRUCTION_LEAK, " "));
  if (isChatChannel(ctx.channel) || HEADING_OR_BOLD.test(text)) text = hasListOrMarkdown(text) ? listToSentence(text) : text;
  for (const tell of AI_TELLS) {
    const global = new RegExp(tell.pattern.source, tell.pattern.flags.includes("g") ? tell.pattern.flags : `${tell.pattern.flags}g`);
    text = text.replace(global, tell.fix);
  }
  // Exclamation marks: keep none. "Great!" reads fine as "Great."
  text = text.replace(/!+/g, ".");
  text = toUkSpelling(text);
  text = dropFirstNameRepeats(text, ctx.leadFirstName);
  // A short stock acknowledgement repeated from the last message ("Thanks,
  // that helps." every turn) is dropped; the reply starts on its substance.
  const opening = sentencesOf(text);
  if (opening.length > 1 && repeatedOpener(opening[0], ctx.priorOutbound ?? []) && opening[0].split(/\s+/).length <= 6) {
    text = text.slice(text.indexOf(opening[0]) + opening[0].length).trim();
  }
  if (isChatChannel(ctx.channel)) {
    // A sign-off sits at the end: cut from it to the end, keeping the full stop before it.
    const found = SIGN_OFF.exec(text);
    if (found && text.length - found.index <= 80) {
      text = (text.slice(0, found.index) + (/^[.!?]/.test(found[0]) ? found[0][0] : "")).trim();
    }
  }
  text = text
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,])\1+/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/^[\s,.;:]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return capitaliseSentences(text);
}
