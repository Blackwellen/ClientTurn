"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Coachmark } from "./coachmark";
import {
  FIRST_USE_TOUR,
  adjacentStepIndex,
  availablePosition,
  clampStep,
  firstAvailableIndex,
  isSectionKey,
  routeMatches,
  sectionTourFor,
  sectionTourForPath,
  tourSelector,
  type SectionKey,
  type TourDefinition,
} from "@/lib/tour/model";
import {
  AUTO_START_PATH,
  SECTION_TOUR_STORAGE_KEY,
  TOUR_STORAGE_KEY,
  parseSectionRecords,
  parseTourRecord,
  pickAutoStart,
  recordFor,
  sectionSessionKey,
  serialiseTourRecord,
  withSectionRecord,
  type TourOutcome,
} from "@/lib/tour/persistence";
import { TOUR_START_EVENT, type TourStartDetail } from "@/lib/tour/events";
import {
  finishProductTour,
  finishSectionTour,
  readProductTour,
  readSectionTours,
} from "@/lib/tour/actions";

const SESSION_KEY = "ct-product-tour-shown";
/** A beat after the page paints, so the first spotlight lands on a settled layout rather than on skeletons. */
const SETTLE_MS = 900;

/** Whether any element carries this `data-tour` key (hidden or not). */
function isPresent(key: string): boolean {
  return document.querySelector(tourSelector(key)) !== null;
}

function readLocal() {
  try {
    return parseTourRecord(window.localStorage.getItem(TOUR_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readLocalSections() {
  try {
    return parseSectionRecords(window.localStorage.getItem(SECTION_TOUR_STORAGE_KEY));
  } catch {
    return {};
  }
}

function shownThisSession(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markShown(key: string) {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: the server record still stops a repeat.
  }
}

type Active = {
  tour: TourDefinition;
  /** Null for the first-use tour. */
  section: SectionKey | null;
  /** Where the tour lives; section steps without their own route go here. */
  path: string | null;
  label: string | null;
  index: number;
};

/**
 * Every tour in the app, mounted once in the shell (Phases 8.4 and 8.29).
 *
 * Two kinds share this one controller, and that is the whole guarantee that
 * two tours never run at once: there is one `active` slot.
 *
 *   - The first-use tour starts on its own on the first visit to the
 *     dashboard after onboarding, and walks across pages.
 *   - Each section tour starts on its own on the first visit to its page,
 *     but only once the first-use tour is completed or skipped
 *     (`pickAutoStart`).
 *
 * Either can be replayed through `TOUR_START_EVENT` — Help, and the "Tour this
 * page" button in the top bar. A section tour asked for from another page
 * navigates there first and starts once the page has rendered. A step about
 * something the plan or role hides (`requiresTarget`) is skipped when that
 * element is absent; a section tour with nothing to show does not start.
 */
export function ProductTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = React.useState<Active | null>(null);
  const activeRef = React.useRef<Active | null>(null);
  const pendingRef = React.useRef<{ section: SectionKey; path: string } | null>(null);

  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const startSection = React.useCallback((section: SectionKey, replay: boolean) => {
    const tour = sectionTourFor(section);
    const start = firstAvailableIndex(tour.steps, isPresent);
    // Nothing to point at (a plan-gated page): an auto-start stays quiet; a
    // replay still opens, on its first step, rather than doing nothing.
    if (start === null && !replay) return;
    markShown(sectionSessionKey(section));
    setActive({ tour, section, path: tour.path, label: tour.label, index: start ?? 0 });
  }, []);

  /* ------------------------------------------------------------- replay */
  React.useEffect(() => {
    function start(event: Event) {
      const detail = (event as CustomEvent<TourStartDetail>).detail;
      const section = detail?.section;
      if (section && isSectionKey(section)) {
        const tour = sectionTourFor(section);
        if (window.location.pathname !== tour.path) {
          // Start once the page is there, not on the one being left.
          pendingRef.current = { section, path: tour.path };
          setActive(null);
          router.push(tour.path);
          return;
        }
        startSection(section, true);
        return;
      }
      markShown(SESSION_KEY);
      setActive({ tour: FIRST_USE_TOUR, section: null, path: null, label: null, index: 0 });
    }
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, [router, startSection]);

  /* -------------------------------------- a replay that had to navigate */
  React.useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pathname !== pending.path) return;
    pendingRef.current = null;
    const timer = window.setTimeout(() => startSection(pending.section, true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, startSection]);

  /* --------------------------------------------------------- auto-start */
  React.useEffect(() => {
    if (activeRef.current || pendingRef.current) return;
    const section = sectionTourForPath(pathname);
    if (pathname !== AUTO_START_PATH && !section) return;

    // Cheap local answer first: no server round trip for a page whose tour
    // this browser has already finished, or already shown this session.
    const localSections = readLocalSections();
    const firstUseLocal = readLocal();
    const firstUseDue =
      pathname === AUTO_START_PATH &&
      !((firstUseLocal?.version ?? 0) >= FIRST_USE_TOUR.version) &&
      !shownThisSession(SESSION_KEY);
    const sectionDue =
      section !== null &&
      !shownThisSession(sectionSessionKey(section.section)) &&
      !((localSections[section.section]?.version ?? 0) >= section.version);
    if (!firstUseDue && !sectionDue) return;

    let cancelled = false;
    let timer = 0;

    Promise.all([readProductTour(), section ? readSectionTours() : Promise.resolve(null)])
      .then(([firstUse, sections]) => {
        if (cancelled) return;
        const decide = () =>
          pickAutoStart({
            pathname: window.location.pathname,
            tourActive: activeRef.current !== null || pendingRef.current !== null,
            firstUse: {
              version: FIRST_USE_TOUR.version,
              server: firstUse.known ? firstUse.record : undefined,
              local: readLocal(),
              shownThisSession: shownThisSession(SESSION_KEY),
            },
            section: section
              ? {
                  key: section.section,
                  path: section.path,
                  version: section.version,
                  server: sections?.known ? (sections.records[section.section] ?? null) : undefined,
                  local: readLocalSections()[section.section] ?? null,
                  shownThisSession: shownThisSession(sectionSessionKey(section.section)),
                }
              : null,
          });
        if (!decide()) return;
        timer = window.setTimeout(() => {
          // Decided again after the pause: a replay may have started, or the
          // person may have moved on, in the meantime.
          const pick = decide();
          if (!pick) return;
          if (pick.kind === "first-use") {
            markShown(SESSION_KEY);
            setActive({ tour: FIRST_USE_TOUR, section: null, path: null, label: null, index: 0 });
          } else if (isSectionKey(pick.section)) {
            startSection(pick.section, false);
          }
        }, SETTLE_MS);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, startSection]);

  const tour = active?.tour ?? null;
  const step = active && tour ? tour.steps[clampStep(active.index, tour.steps.length)] : null;
  // A section step with no route of its own belongs on the section's page.
  const stepRoute = step ? (step.route ?? active?.path ?? undefined) : undefined;

  /* ------------------------------------------------- follow the step route */
  React.useEffect(() => {
    if (!stepRoute) return;
    if (!routeMatches(stepRoute, window.location.pathname, window.location.search)) {
      router.push(stepRoute);
    }
  }, [stepRoute, step, router]);

  const finish = React.useCallback(
    (outcome: TourOutcome) => {
      const current = activeRef.current;
      setActive(null);
      if (!current) return;
      const record = recordFor(current.tour.version, outcome);
      if (current.section) {
        try {
          window.localStorage.setItem(
            SECTION_TOUR_STORAGE_KEY,
            JSON.stringify(withSectionRecord(readLocalSections(), current.section, record)),
          );
        } catch {
          // Private browsing: the server copy is the record.
        }
        void finishSectionTour({ section: current.section, version: current.tour.version, outcome }).catch(
          () => undefined,
        );
        return;
      }
      try {
        window.localStorage.setItem(TOUR_STORAGE_KEY, serialiseTourRecord(record));
      } catch {
        // Private browsing: the server copy is the record.
      }
      void finishProductTour({ version: current.tour.version, outcome }).catch(() => undefined);
    },
    [],
  );

  const next = React.useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const to = adjacentStepIndex(current.tour.steps, current.index, 1, isPresent);
    if (to === null) finish("completed");
    else setActive({ ...current, index: to });
  }, [finish]);

  const back = React.useCallback(() => {
    setActive((current) => {
      if (!current) return current;
      const to = adjacentStepIndex(current.tour.steps, current.index, -1, isPresent);
      return to === null ? current : { ...current, index: to };
    });
  }, []);

  const skip = React.useCallback(() => finish("skipped"), [finish]);

  if (!active || !tour || !step) return null;

  // Counted over the steps that will be shown, so a skipped step never makes
  // the counter jump or stop short of its total.
  const position = availablePosition(tour.steps, clampStep(active.index, tour.steps.length), isPresent);

  return (
    <Coachmark
      key={`${tour.id}:${step.id}`}
      step={step}
      index={position.index}
      total={position.total}
      routeKey={pathname}
      heading={active.label ? `${active.label} tour` : "ClientTurn tour"}
      firstLabel={active.section ? "Next" : "Start tour"}
      onNext={next}
      onBack={back}
      onSkip={skip}
    />
  );
}
