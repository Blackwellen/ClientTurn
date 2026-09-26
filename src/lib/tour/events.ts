/**
 * The browser event that (re)starts a tour.
 *
 * Any surface can offer "Replay tour" — the help popout, `/app/help`, the
 * "Tour this page" button in the top bar — without importing the tour or
 * sharing state with it: it dispatches this event and the tour mounted in the
 * app shell answers. The support popout listens too, and closes itself so the
 * tour is not hidden behind it.
 *
 * With no detail the event means the first-use tour; `{ section }` asks for
 * that page's section tour (Phase 8.29).
 */
export const TOUR_START_EVENT = "clientturn:tour-start";

export type TourStartDetail = { section?: string } | null;

export function requestProductTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
}

export function requestSectionTour(section: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourStartDetail>(TOUR_START_EVENT, { detail: { section } }));
}
