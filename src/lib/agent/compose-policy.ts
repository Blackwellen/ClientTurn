/**
 * What the compose loop does after a draft is rejected (orchestrator
 * `composeValidated`). Pure, so the model-call count per turn is measurable
 * without a model (tests/agent-human-style.test.ts).
 *
 *   ACCEPT      the draft passed.
 *   FIX         the draft failed only on human-style rules (human-style.ts)
 *               and the model has already had one chance to rewrite: repair
 *               it deterministically (`fixHumanStyle`) and validate the
 *               repair. No model call.
 *   REGENERATE  ask the model again with the corrections.
 *   HANDOVER    the third rejection of anything else (handover-policy
 *               `policyOnCompose`): the model cannot say this safely.
 *
 * Owner rule: a style slip is regenerated once, then fixed text is used. It
 * never costs a third model call and never hands a lead to a person.
 */

import { HUMAN_STYLE_CODES } from "./human-style.ts";
import { policyOnCompose } from "./handover-policy.ts";

export type ComposeStep = "ACCEPT" | "FIX" | "SEND_FIXED" | "REGENERATE" | "HANDOVER";

/**
 * Human-style rules the repair always satisfies, so a repaired draft still
 * failing one is not safe to send: it goes back to the ordinary path.
 * Everything else in HUMAN_STYLE_CODES is a matter of polish (a repeated
 * opener, a stock phrase the repair could not rephrase): a repaired draft
 * failing only those is sent rather than costing a call or a hand-over.
 */
export const HARD_STYLE_CODES: ReadonlySet<string> = new Set(["STYLE_EMOJI", "STYLE_EM_DASHES", "STYLE_INSTRUCTION_LEAK"]);

export function onlyHumanStyle(codes: readonly string[]): boolean {
  return codes.length > 0 && codes.every((code) => HUMAN_STYLE_CODES.has(code));
}

/**
 * `rejections` counts this rejection (1 after the first draft fails).
 * `fixTried` is true once a repair of this turn has already been validated.
 */
export function nextComposeStep(input: { codes: readonly string[]; rejections: number; fixTried?: boolean }): ComposeStep {
  if (input.codes.length === 0) return "ACCEPT";
  if (!input.fixTried && onlyHumanStyle(input.codes) && input.rejections >= 2) return "FIX";
  // The repair ran and only polish is left: send it. A style slip never
  // costs a third model call or a hand-over.
  if (input.fixTried && onlyHumanStyle(input.codes) && !input.codes.some((code) => HARD_STYLE_CODES.has(code))) return "SEND_FIXED";
  return policyOnCompose(input.rejections) === "HANDOVER" ? "HANDOVER" : "REGENERATE";
}

/**
 * The loop, over canned drafts: what `composeValidated` would do, and how
 * many model calls it spends (the first proposal counts as one). Used to
 * measure calls per turn; the orchestrator runs the same `nextComposeStep`.
 */
export function simulateComposeLoop(
  drafts: readonly string[],
  check: (draft: string) => readonly string[],
  fix: (draft: string) => string,
): { outcome: "SENT" | "HANDOVER"; body: string | null; modelCalls: number; fixed: boolean } {
  let calls = 1;
  let rejections = 0;
  let fixTried = false;
  let draft = drafts[0] ?? "";
  for (;;) {
    const codes = check(draft);
    if (codes.length === 0) return { outcome: "SENT", body: draft, modelCalls: calls, fixed: fixTried };
    rejections += 1;
    const step = nextComposeStep({ codes, rejections, fixTried });
    if (step === "SEND_FIXED") return { outcome: "SENT", body: draft, modelCalls: calls, fixed: true };
    if (step === "FIX") {
      fixTried = true;
      draft = fix(draft);
      rejections -= 1; // a repair is not a model draft
      continue;
    }
    if (step === "HANDOVER") return { outcome: "HANDOVER", body: null, modelCalls: calls, fixed: fixTried };
    calls += 1;
    draft = drafts[Math.min(calls - 1, drafts.length - 1)] ?? "";
  }
}
