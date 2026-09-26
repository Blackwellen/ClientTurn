/**
 * When the first-use tour and the per-section tours start on their own, and
 * how finishing each is remembered (Phases 8.4 and 8.29).
 *
 * The record of record is `profiles.product_tour_*` (migration 0128), read and
 * written by `./actions.ts`. `localStorage` is a second copy for two cases:
 * before 0128 is applied (the server cannot say either way), and when the
 * write fails — in both, someone who has already dismissed the tour must not
 * see it again on the next page load.
 *
 * Pure: no imports, no storage access. The component passes values in.
 */

export const TOUR_STORAGE_KEY = "ct-product-tour";

export type TourOutcome = "completed" | "skipped";

export type TourRecord = {
  version: number;
  outcome: TourOutcome;
  /** ISO timestamp. */
  at: string;
};

/** Where the tour starts on its own: the dashboard, the first page after onboarding. */
export const AUTO_START_PATH = "/app";

export function parseTourRecord(raw: unknown): TourRecord | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const version = Number(record.version);
  const outcome = record.outcome;
  if (!Number.isInteger(version) || version < 1) return null;
  if (outcome !== "completed" && outcome !== "skipped") return null;
  return { version, outcome, at: typeof record.at === "string" ? record.at : "" };
}

export function serialiseTourRecord(record: TourRecord): string {
  return JSON.stringify(record);
}

/** Finished (completed or skipped) this version or a later one. */
export function hasFinished(record: TourRecord | null | undefined, version: number): boolean {
  return Boolean(record && record.version >= version);
}

/**
 * Whether to start the tour without being asked.
 *
 * `server` is `undefined` when the server could not answer (migration not
 * applied, request failed) and `null` when it answered "never finished".
 * Either copy saying "finished" is enough to stay quiet: a tour that
 * reappears after being dismissed is worse than one that does not auto-start.
 */
export function shouldAutoStart(input: {
  pathname: string;
  version: number;
  server: TourRecord | null | undefined;
  local: TourRecord | null;
  /** Already shown in this browser session (e.g. dismissed, then navigated back). */
  shownThisSession: boolean;
}): boolean {
  if (input.pathname !== AUTO_START_PATH) return false;
  if (input.shownThisSession) return false;
  if (hasFinished(input.local, input.version)) return false;
  if (hasFinished(input.server ?? null, input.version)) return false;
  return true;
}

export function recordFor(version: number, outcome: TourOutcome, now: Date = new Date()): TourRecord {
  return { version, outcome, at: now.toISOString() };
}

/* ------------------------------------------------------ section tours */

/**
 * Section tours are remembered per section and per version, as a map from
 * section key to the same record the first-use tour uses. The server copy is
 * the signed-in person's `app_metadata.ct_section_tours` (see `./actions.ts`);
 * this browser copy covers the same two gaps as the first-use one.
 */
export const SECTION_TOUR_STORAGE_KEY = "ct-section-tours";

export type SectionTourRecords = Record<string, TourRecord>;

/** Keys are written by our own code, but a stored map is still input: drop anything malformed. */
export function parseSectionRecords(raw: unknown): SectionTourRecords {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SectionTourRecords = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key)) continue;
    const record = parseTourRecord(entry);
    if (record) out[key] = record;
  }
  return out;
}

export function withSectionRecord(
  records: SectionTourRecords,
  section: string,
  record: TourRecord,
): SectionTourRecords {
  return { ...records, [section]: record };
}

/** Per-tab flag: a section tour shown (then dismissed) this session does not come back on the next visit. */
export function sectionSessionKey(section: string): string {
  return `ct-section-tour-shown:${section}`;
}

export type AutoStartPick = { kind: "first-use" } | { kind: "section"; section: string } | null;

/**
 * Which tour, if any, should start on its own on this page. The one rule that
 * matters: **never two at once, and never a section tour before the first-use
 * tour is out of the way.**
 *
 *   - Nothing starts while a tour is already showing.
 *   - The first-use tour wins wherever it is due (only ever on the dashboard).
 *   - A section tour waits until the first-use tour has been completed or
 *     skipped, then starts on the first visit to its own page.
 *
 * `server` values follow `shouldAutoStart`: `undefined` = the server could not
 * say, `null` = never finished.
 */
export function pickAutoStart(input: {
  pathname: string;
  tourActive: boolean;
  firstUse: {
    version: number;
    server: TourRecord | null | undefined;
    local: TourRecord | null;
    shownThisSession: boolean;
  };
  section: {
    key: string;
    path: string;
    version: number;
    server: TourRecord | null | undefined;
    local: TourRecord | null;
    shownThisSession: boolean;
  } | null;
}): AutoStartPick {
  if (input.tourActive) return null;
  if (shouldAutoStart({ pathname: input.pathname, ...input.firstUse })) return { kind: "first-use" };

  const firstUseDone =
    hasFinished(input.firstUse.local, input.firstUse.version) ||
    hasFinished(input.firstUse.server ?? null, input.firstUse.version);
  if (!firstUseDone) return null;

  const section = input.section;
  if (!section || input.pathname !== section.path) return null;
  if (section.shownThisSession) return null;
  if (hasFinished(section.local, section.version)) return null;
  if (hasFinished(section.server ?? null, section.version)) return null;
  return { kind: "section", section: section.key };
}
