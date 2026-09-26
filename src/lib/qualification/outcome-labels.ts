/**
 * The one set of words for a qualification outcome.
 *
 * The lead badges, the lead drawer, the Follow-Up Qualification tab and the
 * preview all read these, so the same outcome never has two names (it used to
 * be "Meets criteria" on a lead and "Qualified" in the editor).
 *
 * Pure: no React, no `server-only`, so lib modules, client components and the
 * tests share it.
 */

export const QUALIFICATION_OUTCOMES = ["QUALIFIED", "NOT_QUALIFIED", "REVIEW", "PENDING"] as const;

export type QualificationOutcome = (typeof QUALIFICATION_OUTCOMES)[number];

export const QUALIFICATION_OUTCOME_LABEL: Record<QualificationOutcome, string> = {
  QUALIFIED: "Qualified",
  NOT_QUALIFIED: "Not qualified",
  REVIEW: "Needs review",
  PENDING: "Pending",
};

/** An outcome in words. Anything unrecognised reads as Pending, never raw. */
export function qualificationOutcomeLabel(state: string | null | undefined): string {
  return (
    QUALIFICATION_OUTCOME_LABEL[(state ?? "PENDING") as QualificationOutcome] ??
    QUALIFICATION_OUTCOME_LABEL.PENDING
  );
}
