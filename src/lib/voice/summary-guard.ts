/**
 * The assistant's own end-of-call summary, kept honest (live-call fix,
 * 2026-09-28). Pure.
 *
 * The owner's first real call ended with "Qualified lead interested in
 * tailored solutions" after no question had been asked: the model labelled
 * the lead. It may not (resolved conflict 1: the deterministic engine decides
 * the verdict). So before the summary is stored, and again in post-call
 * analysis, any "qualified" label is replaced unless the lead's deterministic
 * verdict is QUALIFIED, and what was learned is stated from the facts the
 * call actually recorded (record_fact), not from the model's impression.
 */

/** "Qualified lead", "fully qualified", "qualified": not "not qualified", "unqualified", "disqualified", "prequalified". */
const QUALIFIED_LABEL = /(?<![a-z-])(?<!not )(?<!n't )(?:(?:fully|highly|well|now) )?qualified(?: (?:lead|prospect|opportunity|buyer))?\b/gi;

export type RecordedFact = { dimension: string; value: string };

export type SummaryGuardInput = {
  summary: string;
  /** leads.qualification_state (the deterministic verdict); null = unknown. */
  verdict: string | null;
  /** What record_fact recorded in THIS call. */
  facts: readonly RecordedFact[];
};

export type SummaryGuardResult = { summary: string; changed: boolean; reasons: string[] };

function label(dimension: string): string {
  return dimension.replace(/^Q\.[0-9a-f-]+$/i, "answer").replace(/[_.]/g, " ").toLowerCase();
}

/** Replaces a "qualified" label the deterministic verdict does not support. */
export function stripQualifiedLabel(summary: string, verdict: string | null): { summary: string; changed: boolean } {
  const qualified = (verdict ?? "").toUpperCase() === "QUALIFIED";
  QUALIFIED_LABEL.lastIndex = 0;
  if (qualified || !QUALIFIED_LABEL.test(summary)) {
    QUALIFIED_LABEL.lastIndex = 0;
    return { summary, changed: false };
  }
  QUALIFIED_LABEL.lastIndex = 0;
  const out = summary
    .replace(QUALIFIED_LABEL, (m) => {
      const noun = /\b(lead|prospect|opportunity|buyer)$/i.exec(m)?.[1];
      return noun ? `${noun} (qualification pending)` : "qualification pending";
    })
    .replace(/^([a-z])/, (c) => c.toUpperCase());
  QUALIFIED_LABEL.lastIndex = 0;
  return { summary: out, changed: true };
}

export function guardCallSummary(input: SummaryGuardInput): SummaryGuardResult {
  const reasons: string[] = [];
  const stripped = stripQualifiedLabel(input.summary.replace(/\s+/g, " ").trim(), input.verdict);
  let summary = stripped.summary;
  if (stripped.changed) reasons.push("QUALIFIED_LABEL_WITHOUT_VERDICT");
  const learned = input.facts.filter((f) => f.value.trim()).slice(0, 8);
  const factLine = learned.length
    ? `Learned on the call: ${learned.map((f) => `${label(f.dimension)}: ${f.value.trim().slice(0, 80)}`).join("; ")}.`
    : "No qualifying answers were recorded on the call; qualification stays pending.";
  if (!learned.length) reasons.push("NO_FACTS_RECORDED");
  if (!summary.includes(factLine)) summary = `${summary.replace(/[.\s]*$/, ".")} ${factLine}`;
  return { summary: summary.slice(0, 1200), changed: summary !== input.summary, reasons };
}
