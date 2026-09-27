/**
 * The /100 question grader (design 08 §24, §C.4). Pure.
 *
 * Grades one outbound question against the structured state it was asked in.
 * Shared by the pre-send QA record (the grade is stored on the turn's
 * accounting) and by the tests. Anti-gaming, by construction:
 *   - every criterion is computed from structured state (the NBA, the
 *     per-dimension fact status, the stage, the intent state, what was asked
 *     before); wording is read only to find which dimension a question asks,
 *     whether it is generic, and how it sits on the channel;
 *   - the labelled fixture (tests/fixtures/question-grades.json) was written
 *     before this file, and is never edited to fit it;
 *   - a mutation test proves each criterion can fail on its own.
 *
 * Weights are the contract's (QUESTION_GRADE_CRITERIA, sum 100). Any critical
 * failure grades the question 0. The pass mark is QUESTION_GRADE_PASS (80).
 */

import { countQuestions } from "../agent/validate.ts";
import { CHANNEL_LIMITS } from "../agent/types.ts";
import {
  CTA_ACTIONS,
  MAX_ASKS_PER_INTENT,
  QA_VERSION,
  QUESTION_GRADE_CRITERIA,
  type FactDimension,
  type QuestionGrade,
  type QuestionGradeCriterion,
  type QuestionGradeCriticalFailure,
  type QiDimensionKey,
} from "./types.ts";
import {
  askedDimension,
  baseAttrs,
  forbiddenDimensions,
  isKnownForAsking,
  isQuestionSentence,
  leadAsked,
  matchesPlanned,
  mentionedDimensions,
  prematurityOf,
  questionSentences,
  runQuestionQa,
  sentences,
  statusOf,
  unansweredPriorAsks,
  type QaContext,
} from "./qa.ts";

export type GradeInput = QaContext;

const W = QUESTION_GRADE_CRITERIA;

const PROBLEM_DIMS: ReadonlySet<string> = new Set(["PROBLEM", "USE_CASE", "OUTCOME", "DISSATISFACTION", "SERVICE_NEEDED", "PRODUCT_INTEREST"]);
const COMMERCIAL_DIMS: ReadonlySet<string> = new Set(["BUDGET", "AUTHORITY", "DECISION_PROCESS", "STAKEHOLDERS", "PURCHASE_READINESS"]);
const NARRATIVE_DIMS: ReadonlySet<string> = new Set(["PROBLEM", "USE_CASE", "OUTCOME", "SUCCESS_METRICS", "PROJECT_SCOPE", "DISSATISFACTION"]);

const GENERIC_PATTERN =
  /\b(how can i help|how can we help|what can i do for you|anything else|is there anything|tell me (a bit )?more|any (other )?questions|what are you looking for|what do you need)\b/i;
const MARKDOWN = /(^|\n)\s*([-*•]\s|\d+\.\s|#+\s)|\*\*[^*]+\*\*|__[^_]+__/;
const FORM_NUMBERING = /\b(q\s?\d|question\s?\d)\b|(^|\s)\d\)\s/i;
const LETTERED_OPTIONS = /(^|\s)(?:[a-e]\)|\(\s?[a-e]\s?\)|[a-e]\.\s)/gi;

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value * 10) / 10));
}

/** The question the grade is about: the first question sentence, or null. */
export function gradedQuestion(draft: string): string | null {
  return questionSentences(draft)[0] ?? null;
}

/**
 * Grades the question in `draft`. Returns null when the draft asks nothing
 * (there is no question to grade).
 */
export function gradeQuestion(draft: string, ctx: GradeInput): QuestionGrade | null {
  const text = draft.normalize("NFKC").trim();
  const question = gradedQuestion(text);
  if (!question) return null;

  const dimension = askedDimension(question) as FactDimension | null;
  const planned = ctx.plannedQuestion;
  const isPlanned = matchesPlanned(question, dimension, planned);
  const view = statusOf(ctx.dimensions, dimension ?? (isPlanned ? planned!.dimension : null));
  const known = new Set(ctx.dimensions.filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED").map((d) => d.dimension));
  const action = ctx.nbaAction;
  const all = sentences(text);
  const statements = all.filter((s) => !isQuestionSentence(s));
  const answeredFirst = statements.length > 0 && !isQuestionSentence(all[0]);
  const theyAsked = ctx.leadAskedQuestion ?? leadAsked(ctx.inbound);
  const priorAsks = unansweredPriorAsks(ctx.recentOutbound, dimension ?? (isPlanned ? planned!.dimension : null));
  const effectiveDimension = dimension ?? (isPlanned ? planned!.dimension : null);

  /* ------------------------------------------------ critical failures */
  const critical: QuestionGradeCriticalFailure[] = [];
  const verifying = isPlanned && planned !== null && planned.purpose !== "DISCOVER";
  if (effectiveDimension && isKnownForAsking(view) && !verifying) critical.push("ASKS_KNOWN_DIMENSION");
  const forbidden = forbiddenDimensions(ctx.forbiddenIntents);
  if ((dimension && forbidden.has(dimension as QiDimensionKey)) || (isPlanned && planned && ctx.forbiddenIntents.includes(planned.key))) {
    critical.push("ASKS_FORBIDDEN_INTENT");
  }
  if (countQuestions(text) > 1) critical.push("MULTIPLE_QUESTIONS");
  const ready = ctx.intentState === "BOOKING_READY" || ctx.intentState === "PURCHASE_READY";
  const ctaPlan = action !== null && (CTA_ACTIONS as readonly string[]).includes(action);
  const gatingAllowed = action === "CTA_BOOK" && isPlanned;
  if ((ready || ctaPlan) && dimension && dimension !== "AVAILABILITY" && !gatingAllowed) {
    critical.push("QUALIFIES_WHEN_BOOKING_READY");
  }
  if (
    ctx.intentState === "NEGATIVE" ||
    ctx.engineVerdict === "NOT_QUALIFIED" ||
    action === "DISQUALIFY" ||
    action === "NO_ACTION"
  ) {
    critical.push("PURSUES_NEGATIVE_OR_DISQUALIFIED");
  }

  /* --------------------------------------------------------- criteria */
  const criteria = {} as Record<QuestionGradeCriterion, number>;

  // necessity (15): the plan chose exactly this move. Under ANSWER_AND_ASK the
  // move includes the answer; a question that skips it is not the planned move.
  // Past the sticky re-ask limit the intent is no longer askable at all.
  if (!isPlanned || priorAsks >= MAX_ASKS_PER_INTENT) criteria.necessity = 0;
  else if (action === "ANSWER_AND_ASK" && statements.length === 0) criteria.necessity = 5;
  else criteria.necessity = view?.required || planned?.purpose !== "DISCOVER" ? W.necessity : 11;

  // notKnown (15): the dimension is genuinely open.
  if (!effectiveDimension) criteria.notKnown = 9;
  else if (!view || view.status === "UNKNOWN") criteria.notKnown = W.notKnown;
  else if (verifying && (view.status === "CONFLICTING" || view.status === "INFERRED")) criteria.notKnown = 13;
  else criteria.notKnown = 0;

  // stageFit (10): stage-adjusted prematurity.
  const p = prematurityOf(effectiveDimension, ctx.stage, known);
  const stageAllowed = !ctx.plannedIntent?.stages?.length || !isPlanned || ctx.plannedIntent.stages.includes(ctx.stage);
  criteria.stageFit = !stageAllowed || p > 0.6 ? 0 : p > 0.3 ? 6 : W.stageFit;

  // intentFit (10): what this intent state is ready to be asked.
  switch (ctx.intentState) {
    case "BOOKING_READY":
    case "PURCHASE_READY":
    case "HIGH":
      criteria.intentFit = gatingAllowed || view?.required ? W.intentFit : effectiveDimension && COMMERCIAL_DIMS.has(effectiveDimension) ? 5 : 3;
      break;
    case "LOW":
    case "EXPLORATORY":
    case "NO_DETECTED_INTENT":
      criteria.intentFit = !effectiveDimension ? 5 : PROBLEM_DIMS.has(effectiveDimension) ? W.intentFit : COMMERCIAL_DIMS.has(effectiveDimension) ? 0 : 6;
      break;
    case "MEDIUM":
      criteria.intentFit = W.intentFit;
      break;
    default:
      criteria.intentFit = 0;
  }

  // friction (10): the dimension's own cost, open text on a phone channel,
  // and asking again what went unanswered.
  let friction: number = W.friction * (1 - baseAttrs(effectiveDimension).friction);
  const phone = ctx.channel === "sms" || ctx.channel === "whatsapp";
  if (phone && effectiveDimension && NARRATIVE_DIMS.has(effectiveDimension) && /^(what|how|why|tell|describe)\b/i.test(question)) friction -= 1.5;
  if (priorAsks >= MAX_ASKS_PER_INTENT) friction = 0;
  else if (priorAsks === 1) friction -= 2;
  criteria.friction = clamp(friction, W.friction);

  // channelNaturalness (10).
  const limits = CHANNEL_LIMITS[ctx.channel];
  const lettered = (question.match(LETTERED_OPTIONS) ?? []).length;
  let natural: number = W.channelNaturalness;
  if (text.length > limits.hard) natural = 0;
  else {
    if (text.length > limits.preferred) natural -= 3;
    if (phone && MARKDOWN.test(text)) natural -= 5;
    if (FORM_NUMBERING.test(text)) natural -= 5;
    // A lettered list of options on a phone channel is a form, not a message:
    // the criterion fails outright there, and costs less in an email.
    if (phone && lettered >= 4) natural = 0;
    else if (lettered >= 4) natural -= 3;
  }
  criteria.channelNaturalness = clamp(natural, W.channelNaturalness);
  // Reading and mapping yourself onto a list of options is effort.
  if (lettered >= 4) criteria.friction = clamp(criteria.friction - 2, W.friction);

  // responsiveness (10): the lead's own question comes first.
  criteria.responsiveness = !theyAsked ? W.responsiveness : answeredFirst ? W.responsiveness : statements.length > 0 ? 5 : 0;

  // specificity (8).
  criteria.specificity = GENERIC_PATTERN.test(question) ? 0 : effectiveDimension ? W.specificity : 3;

  // singleFocus (7): one primary question about one thing.
  //
  // A lettered menu of four or more options ("a) new website b) redesign
  // c) SEO d) hosting e) something else?") has one question mark but is not
  // one question: the lead is handed a questionnaire and must judge each
  // option as its own proposition. The brief's QA list asks "one primary
  // question?" and "does it sound like a form?"; this is where the grade
  // answers both, on every channel (channelNaturalness above adds the
  // phone-channel cost).
  //
  // Deliberately NOT a critical failure. The five critical failures are harms
  // that make a question wrong to send whatever its wording: asking what is
  // known, a forbidden intent, several questions, qualifying a ready lead,
  // pursuing a negative one. A form-like question asks the right thing
  // badly: rewording fixes it, and pre-send QA check 8 (QA_FORM_LIKE) already
  // rejects it with that correction before it can be sent. The held-out label
  // for this shape (fixture `sms-multiple-choice-form`) agrees: fail, with no
  // critical failure.
  const mentions = new Set(mentionedDimensions(question).filter((d) => d !== "AVAILABILITY"));
  criteria.singleFocus = countQuestions(text) > 1 || lettered >= 4 ? 0 : mentions.size > 1 ? 3 : W.singleFocus;

  // progression (5): answering it moves the goal forward.
  if (!isPlanned || priorAsks >= MAX_ASKS_PER_INTENT) criteria.progression = 0;
  else if (view?.required) criteria.progression = W.progression;
  else criteria.progression = 3;

  const sum = (Object.keys(W) as QuestionGradeCriterion[]).reduce((acc, key) => acc + criteria[key], 0);
  const unique = [...new Set(critical)];
  return {
    total: unique.length > 0 ? 0 : Math.round(sum * 10) / 10,
    criteria,
    criticalFailures: unique,
    version: QA_VERSION,
  };
}

/** Convenience for the orchestrator: QA + grade in one pass. */
export function qaAndGrade(draft: string, ctx: GradeInput) {
  return { qa: runQuestionQa(draft, ctx), grade: gradeQuestion(draft, ctx) };
}
