/**
 * Qualification craft (elite-closer brief). Pure.
 *
 * A skilled seller does not read out a form. They frame the question, build
 * on what the lead just said, and, where a question could feel nosy, give the
 * reason for asking. The NBA still fixes WHAT is asked (one question per
 * turn); this only tells the model how a good seller would ask it.
 *
 * `WHY_ASK` holds the honest reason for the dimensions where a lead may
 * wonder why they are being asked. Every reason is about helping the lead
 * (the right option, the right person, a realistic plan), never a pressure
 * line, and never a fact about the business.
 */

export const WHY_ASK: Readonly<Record<string, string>> = {
  BUDGET: "so you can point them to the option that fits",
  AUTHORITY: "so the right people get what they need",
  STAKEHOLDERS: "so nobody who matters is left out",
  DECISION_PROCESS: "so you can fit around how they decide",
  TIMING: "so the plan is realistic for their date",
  COMPANY_SIZE: "so you suggest the right setup for their size",
  TEAM_SIZE: "so the setup fits the team",
  VOLUME: "so the option matches their volumes",
  LOCATION: "so you can check it is somewhere you work",
  CURRENT_SOLUTION: "so you don't suggest what they already have",
  TECHNICAL_REQUIREMENTS: "so nothing clashes with what they run",
};

/** The dimension of an intent key ("BUDGET.RANGE" -> "BUDGET"). */
export function intentDimension(key: string | null | undefined): string | null {
  if (!key) return null;
  const head = key.split(".")[0];
  return /^[A-Z_]+$/.test(head) ? head : null;
}

/**
 * The ask for the NBA strategy block. It ENDS with the rendering: whatever
 * reads the block (the model, the story harness's scripted model) takes the
 * question from the end of the line, so no instruction may follow it there.
 * How to ask it is a separate line (`askCraftLine`).
 */
export function craftedAsk(rendering: string): string {
  return `ask only this, in natural wording: ${rendering}`;
}

/** How a skilled seller asks the planned question: its own strategy line. */
export function askCraftLine(intentKey: string | null | undefined): string {
  const why = WHY_ASK[intentDimension(intentKey) ?? ""];
  return `How to ask it: tie it to their last answer${why ? ` (why: ${why})` : ""}.`;
}

/** The legacy block's craft line (no intent key there). */
export const ASK_CRAFT_LINE = "How to ask it: build on their last answer, with a short reason for asking if it isn't obvious.";
