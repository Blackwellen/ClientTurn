/**
 * Governed experiments for warm follow-up and reactivation (brief §§62-63).
 * Pure: assignment, the metric hierarchy and the results arithmetic.
 *
 * The governance, in one place:
 *
 *   * **Deterministic assignment.** A lead's arm is a hash of the experiment
 *     and the lead, so a retried job, a second worker or a re-read always
 *     lands the same lead in the same arm. The holdout is the first
 *     `holdoutPercent` of the hash space.
 *   * **Optimisation hierarchy (§63).** The primary metric is a win, a
 *     booking or a positive reply, never a raw reply. Unsubscribes and
 *     complaints are a negative constraint: an arm whose opt-out rate is
 *     credibly worse than control's cannot win, whatever it converts.
 *   * **No winner without evidence.** Every arm needs at least
 *     `minSamplePerArm` (>= 100) leads, and the 95% interval for the
 *     difference from control must exclude zero. Otherwise the result says
 *     "not enough evidence" and shows the intervals.
 *   * **No automatic change.** Nothing here rewrites a prompt or a template;
 *     a person reads the result and decides.
 *   * **Workspace-level only.** Inputs are one workspace's leads.
 */

export const EXPERIMENT_KINDS = ["WARM_FOLLOW_UP", "REACTIVATION"] as const;
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

export const PRIMARY_METRICS = ["WIN", "BOOKING", "POSITIVE_REPLY"] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const HOLDOUT_ARM = "HOLDOUT";
export const MIN_SAMPLE_FLOOR = 100;
export const MAX_HOLDOUT_PERCENT = 50;
/** The control arm is always the first variant. */
export const CONTROL_ARM = "A";

export type ExperimentVariant = {
  key: string;
  label: string;
  /** Step position (as a string) -> the body to send instead. Absent = control copy. */
  templates?: Record<string, string>;
};

export type ExperimentDefinition = {
  id: string;
  holdoutPercent: number;
  variants: ExperimentVariant[];
};

/** FNV-1a, 32-bit: stable across runtimes, no dependency. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A lead's arm: HOLDOUT, or a variant key. Same inputs, same arm, always. */
export function assignArm(experiment: ExperimentDefinition, leadId: string): string {
  const bucket = stableHash(`${experiment.id}:${leadId}`) % 10_000; // 0..9999
  const holdout = Math.min(Math.max(experiment.holdoutPercent, 0), MAX_HOLDOUT_PERCENT) * 100;
  if (bucket < holdout) return HOLDOUT_ARM;
  const variants = experiment.variants.length ? experiment.variants : [{ key: CONTROL_ARM, label: "Control" }];
  // Re-hash for the variant split so it is independent of the holdout cut.
  const index = stableHash(`${experiment.id}:${leadId}:variant`) % variants.length;
  return variants[index].key;
}

/** The body a variant sends for a step, or null for the control copy. */
export function variantTemplate(
  experiment: ExperimentDefinition,
  arm: string,
  stepPosition: number,
): string | null {
  const variant = experiment.variants.find((v) => v.key === arm);
  const body = variant?.templates?.[String(stepPosition)];
  return typeof body === "string" && body.trim() ? body : null;
}

/** Validates a definition before it is stored or started. Returns problems. */
export function experimentProblems(input: {
  holdoutPercent: number;
  variants: ExperimentVariant[];
  minSamplePerArm: number;
}): string[] {
  const problems: string[] = [];
  if (input.variants.length < 2 || input.variants.length > 4) problems.push("An experiment needs 2 to 4 variants.");
  if (input.variants[0]?.key !== CONTROL_ARM) problems.push(`The first variant must be the control, key "${CONTROL_ARM}".`);
  const keys = new Set(input.variants.map((v) => v.key));
  if (keys.size !== input.variants.length) problems.push("Variant keys must be unique.");
  if (keys.has(HOLDOUT_ARM)) problems.push(`"${HOLDOUT_ARM}" is reserved.`);
  if (input.holdoutPercent < 0 || input.holdoutPercent > MAX_HOLDOUT_PERCENT) {
    problems.push(`Holdout must be between 0 and ${MAX_HOLDOUT_PERCENT}%.`);
  }
  if (input.minSamplePerArm < MIN_SAMPLE_FLOOR) problems.push(`The minimum sample is ${MIN_SAMPLE_FLOOR} per arm.`);
  if (!input.variants.slice(1).some((v) => v.templates && Object.values(v.templates).some((t) => t.trim()))) {
    problems.push("At least one non-control variant must change a message.");
  }
  return problems;
}

/* ------------------------------------------------------------ results */

export type ArmOutcomes = {
  arm: string;
  leads: number;
  wins: number;
  bookings: number;
  positiveReplies: number;
  /** Unsubscribes and complaints. */
  optOuts: number;
};

export type Interval = { rate: number; low: number; high: number };

export type ArmResult = {
  arm: string;
  leads: number;
  primary: Interval;
  optOut: Interval;
  /** Primary rate minus control's, with its 95% interval; null for control. */
  lift: Interval | null;
  enoughSample: boolean;
  /** Opt-outs credibly worse than control's (the negative constraint). */
  harmful: boolean;
};

export type ExperimentResult = {
  metric: PrimaryMetric;
  arms: ArmResult[];
  winner: string | null;
  verdict: "WINNER" | "NO_DIFFERENCE" | "NOT_ENOUGH_DATA";
  explanation: string;
};

const Z95 = 1.96;

/** Wilson score interval: well behaved at small counts and at 0 or 100%. */
export function wilson(successes: number, n: number, z = Z95): Interval {
  if (n <= 0) return { rate: 0, low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { rate: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/** Newcombe's hybrid score interval for a difference of two proportions. */
export function differenceInterval(a: { x: number; n: number }, b: { x: number; n: number }): Interval {
  const wa = wilson(a.x, a.n);
  const wb = wilson(b.x, b.n);
  const d = wa.rate - wb.rate;
  const low = d - Math.sqrt((wa.rate - wa.low) ** 2 + (wb.high - wb.rate) ** 2);
  const high = d + Math.sqrt((wa.high - wa.rate) ** 2 + (wb.rate - wb.low) ** 2);
  return { rate: d, low, high };
}

function successes(arm: ArmOutcomes, metric: PrimaryMetric): number {
  switch (metric) {
    case "WIN":
      return arm.wins;
    case "BOOKING":
      return arm.bookings;
    case "POSITIVE_REPLY":
      return arm.positiveReplies;
  }
}

/**
 * Results for one experiment. The holdout is reported like any arm (it is
 * the baseline for "does messaging at all help") but it never wins: the
 * comparison for a winner is each variant against control.
 */
export function computeExperimentResult(input: {
  metric: PrimaryMetric;
  minSamplePerArm: number;
  arms: ArmOutcomes[];
}): ExperimentResult {
  const minSample = Math.max(input.minSamplePerArm, MIN_SAMPLE_FLOOR);
  const control = input.arms.find((a) => a.arm === CONTROL_ARM) ?? null;
  const arms: ArmResult[] = input.arms.map((arm) => {
    const x = successes(arm, input.metric);
    const isControl = arm.arm === CONTROL_ARM;
    const lift = control && !isControl ? differenceInterval({ x, n: arm.leads }, { x: successes(control, input.metric), n: control.leads }) : null;
    const optOutDiff =
      control && !isControl ? differenceInterval({ x: arm.optOuts, n: arm.leads }, { x: control.optOuts, n: control.leads }) : null;
    return {
      arm: arm.arm,
      leads: arm.leads,
      primary: wilson(x, arm.leads),
      optOut: wilson(arm.optOuts, arm.leads),
      lift,
      enoughSample: arm.leads >= minSample,
      harmful: Boolean(optOutDiff && optOutDiff.low > 0),
    };
  });

  const contenders = arms.filter((a) => a.arm !== HOLDOUT_ARM);
  if (!control || contenders.some((a) => !a.enoughSample)) {
    return {
      metric: input.metric,
      arms,
      winner: null,
      verdict: "NOT_ENOUGH_DATA",
      explanation: `Every arm needs at least ${minSample} leads before a result is shown as a winner.`,
    };
  }

  const credible = contenders
    .filter((a) => a.arm !== CONTROL_ARM && a.lift && a.lift.low > 0 && !a.harmful)
    .sort((a, b) => (b.lift!.rate - a.lift!.rate) || a.arm.localeCompare(b.arm));
  if (credible.length > 0) {
    return {
      metric: input.metric,
      arms,
      winner: credible[0].arm,
      verdict: "WINNER",
      explanation: `Variant ${credible[0].arm} beats control on ${input.metric.toLowerCase().replace("_", " ")} with a 95% interval above zero, without more opt-outs.`,
    };
  }
  // Control is only "the winner" when every variant is credibly worse.
  const allWorse = contenders.filter((a) => a.arm !== CONTROL_ARM).every((a) => (a.lift && a.lift.high < 0) || a.harmful);
  return {
    metric: input.metric,
    arms,
    winner: allWorse ? CONTROL_ARM : null,
    verdict: allWorse ? "WINNER" : "NO_DIFFERENCE",
    explanation: allWorse
      ? "Control does better than every variant (or the variants raise opt-outs)."
      : "No variant differs from control with 95% confidence. Keep the current copy or keep collecting.",
  };
}
