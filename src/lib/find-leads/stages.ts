/**
 * The twelve canonical sourcing stages (V4 §11.4).
 *
 * The internal provider waterfall is more granular than this list and will get
 * more granular still. The customer-facing vocabulary deliberately does not
 * follow it: a sourcing run must read as work being done on the customer's
 * behalf, not as a developer pipeline console. Adding a provider is not a
 * reason to add a stage here.
 *
 * Pure module — imported by the run page, the worker and the tests alike.
 */

export const STAGE_KEYS = [
  "UNDERSTANDING_TARGET",
  "PLANNING_SEARCH",
  "FINDING_COMPANIES",
  "FINDING_CONTACTS",
  "PRE_FILTERING",
  "ENRICHING",
  "VERIFYING",
  "DEDUPLICATING",
  "CLASSIFYING",
  "SCORING",
  "INTENT_MATCHING",
  "PREPARING_OUTREACH",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export type StageStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "SKIPPED"
  | "FAILED"
  | "PAUSED";

export type StageDefinition = {
  key: StageKey;
  number: number;
  title: string;
  /** The sentence shown under the title. Never mentions a provider. */
  description: string;
  /**
   * Whether this stage can call a paid provider. Used by the budget guard to
   * decide where a reservation has to be taken before work begins.
   */
  costBearing: boolean;
};

export const STAGES: StageDefinition[] = [
  {
    key: "UNDERSTANDING_TARGET",
    number: 1,
    title: "Understanding target",
    description: "Analysing your request and business context",
    costBearing: false,
  },
  {
    key: "PLANNING_SEARCH",
    number: 2,
    title: "Planning search",
    description: "Creating search strategy and provider queries",
    costBearing: false,
  },
  {
    key: "FINDING_COMPANIES",
    number: 3,
    title: "Finding companies",
    description: "Searching across multiple data sources",
    costBearing: true,
  },
  {
    key: "FINDING_CONTACTS",
    number: 4,
    title: "Finding contacts",
    description: "Identifying key decision makers",
    costBearing: true,
  },
  {
    key: "PRE_FILTERING",
    number: 5,
    title: "Cheap pre-filtering",
    description: "Filtering for relevance (industry, location, size)",
    costBearing: false,
  },
  {
    key: "ENRICHING",
    number: 6,
    title: "Enriching high-fit records",
    description: "Getting additional data on high-fit companies",
    costBearing: true,
  },
  {
    key: "VERIFYING",
    number: 7,
    title: "Verifying emails",
    description: "Checking email deliverability",
    costBearing: true,
  },
  {
    key: "DEDUPLICATING",
    number: 8,
    title: "Deduplicating",
    description: "Removing duplicate companies and contacts",
    costBearing: false,
  },
  {
    key: "CLASSIFYING",
    number: 9,
    title: "Compliance / contactability",
    description: "Classifying contactability and checking opt-outs",
    costBearing: false,
  },
  {
    key: "SCORING",
    number: 10,
    title: "Scoring and grading",
    description: "Scoring prospects by fit and intent",
    costBearing: false,
  },
  {
    key: "INTENT_MATCHING",
    number: 11,
    title: "Intent matching",
    description: "Analysing signals for buying intent",
    costBearing: true,
  },
  {
    key: "PREPARING_OUTREACH",
    number: 12,
    title: "Preparing outreach",
    description: "Preparing final list for review",
    costBearing: false,
  },
];

export const STAGE_BY_KEY: Record<StageKey, StageDefinition> = Object.fromEntries(
  STAGES.map((stage) => [stage.key, stage]),
) as Record<StageKey, StageDefinition>;

export function stageNumber(key: StageKey): number {
  return STAGE_BY_KEY[key].number;
}

export function nextStage(key: StageKey): StageKey | null {
  const index = STAGE_KEYS.indexOf(key);
  return index >= 0 && index < STAGE_KEYS.length - 1 ? STAGE_KEYS[index + 1] : null;
}

/**
 * Progress is the proportion of stages that have reached a terminal state, not
 * a timer. A run that is genuinely stuck on stage 6 must show 42%, not creep
 * toward 100% because time is passing — a fake progress bar is a lie about
 * work the customer is paying for.
 */
export function progressPercent(
  stages: { status: StageStatus }[],
): number {
  if (stages.length === 0) return 0;
  const done = stages.filter(
    (s) => s.status === "COMPLETED" || s.status === "SKIPPED",
  ).length;
  return Math.round((done / stages.length) * 100);
}

export function currentStageNumber(
  stages: { stage_number: number; status: StageStatus }[],
): number {
  const running = stages.find((s) => s.status === "RUNNING" || s.status === "PAUSED");
  if (running) return running.stage_number;
  const pending = stages.find((s) => s.status === "PENDING");
  if (pending) return pending.stage_number;
  return STAGES.length;
}
