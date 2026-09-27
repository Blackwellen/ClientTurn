/**
 * How the stories' scripted model reads the strategy block. Pure, so the
 * reading is unit-tested against the real block builders
 * (tests/story-strategy-read.test.ts) instead of only failing in a live run.
 *
 * The planned question is the END of its line in both layouts:
 *   legacy:  "Next best question. Ask only this, in natural wording: <q> (acceptable answers: ...)"
 *   engine:  "Move: acknowledge briefly, then ask only this, in natural wording: <q>"
 * How to ask it is always its own following line ("How to ask it: ..."),
 * which is an instruction, never words to say (question-craft.ts).
 */

const ASK_LINE = /^.*?\bask only this, in natural wording: (.+)$/im;
const OPTIONS_SUFFIX = / \(acceptable answers: .*\)$/;

/** The next question the strategy block tells the model to ask, if any. */
export function strategyQuestion(user: string): string | null {
  const match = user.match(ASK_LINE);
  if (!match) return null;
  const question = match[1].replace(OPTIONS_SUFFIX, "").trim();
  return question || null;
}

/** The block says to stop qualifying (the legacy threshold / no-more-questions lines). */
export function strategySaysStop(user: string): boolean {
  return /Stop qualifying: enough is known\.|No further questions\./.test(user);
}
