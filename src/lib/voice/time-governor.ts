/**
 * The call time budget. Deterministic: the turn adapter feeds its signal into
 * the strategy block as a context flag, so the model cannot overrule it.
 *
 *   - Hard budget: 5 minutes per call (`CALL_BUDGET_SEC`).
 *   - Each route has a target duration (brief): Qualification about 3 to 4
 *     minutes, Booking Close about 3, Direct Close about 5, Nurture about 2,
 *     Reactivation about 2 to 3.
 *   - TIME_AMBER at 75% of the route target: summarise progress, no new
 *     topics, steer to the route's next step.
 *   - TIME_RED at the route target, or at the budget less a wrap-up reserve if
 *     that comes first: summarise, then book / close now or offer a follow-up.
 *   - OVER at the hard stop: end politely.
 *   - A valuable-close extension: 60 seconds at a time, at most 2 (120 s in
 *     all), only while a close step is actually in progress with an engaged
 *     lead, and only inside the minutes reserved for the call.
 */

export const VOICE_ROUTES = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION"] as const;
export type VoiceRouteKey = (typeof VOICE_ROUTES)[number];

export const CALL_BUDGET_SEC = 300;
export const WRAP_UP_RESERVE_SEC = 45;
export const EXTENSION_STEP_SEC = 60;
export const MAX_EXTENSIONS = 2;
export const MAX_EXTENSION_SEC = EXTENSION_STEP_SEC * MAX_EXTENSIONS;
export const AMBER_FRACTION = 0.75;

export type RouteTarget = { minSec: number; targetSec: number; maxSec: number };

export const ROUTE_TARGETS: Readonly<Record<VoiceRouteKey, RouteTarget>> = {
  QUALIFICATION: { minSec: 180, targetSec: 210, maxSec: 240 },
  BOOKING_CLOSE: { minSec: 150, targetSec: 180, maxSec: 210 },
  DIRECT_CLOSE: { minSec: 240, targetSec: 300, maxSec: 300 },
  NURTURE: { minSec: 90, targetSec: 120, maxSec: 150 },
  REACTIVATION: { minSec: 120, targetSec: 150, maxSec: 180 },
};

/** Routes whose close is valuable enough to earn an extension. */
const CLOSING_ROUTES: readonly VoiceRouteKey[] = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE"];

export type TimeLevel = "GREEN" | "TIME_AMBER" | "TIME_RED" | "OVER";

export type TimeAction =
  | "CONTINUE"
  | "SUMMARISE_PROGRESS"
  | "NO_NEW_TOPICS"
  | "STEER_TO_NEXT_STEP"
  | "SUMMARISE"
  | "BOOK_NOW"
  | "CLOSE_NOW"
  | "OFFER_FOLLOW_UP"
  | "END_POLITELY";

export type Thresholds = { amberAtSec: number; redAtSec: number; hardStopSec: number };

export function thresholdsFor(route: VoiceRouteKey, extensionSec = 0): Thresholds {
  const t = ROUTE_TARGETS[route];
  const ext = Math.max(0, Math.min(MAX_EXTENSION_SEC, extensionSec));
  const hardStopSec = CALL_BUDGET_SEC + ext;
  const redAtSec = Math.min(t.targetSec, CALL_BUDGET_SEC - WRAP_UP_RESERVE_SEC) + ext;
  const amberAtSec = Math.round(t.targetSec * AMBER_FRACTION);
  return { amberAtSec: Math.min(amberAtSec, redAtSec), redAtSec, hardStopSec };
}

export type TimeSignal = {
  level: TimeLevel;
  elapsedSec: number;
  remainingSec: number;
  thresholds: Thresholds;
  actions: TimeAction[];
};

function redActions(route: VoiceRouteKey): TimeAction[] {
  switch (route) {
    case "BOOKING_CLOSE":
    case "QUALIFICATION":
      return ["SUMMARISE", "BOOK_NOW", "OFFER_FOLLOW_UP"];
    case "DIRECT_CLOSE":
      return ["SUMMARISE", "CLOSE_NOW", "OFFER_FOLLOW_UP"];
    case "NURTURE":
    case "REACTIVATION":
      return ["SUMMARISE", "OFFER_FOLLOW_UP"];
  }
}

export function governTime(input: { route: VoiceRouteKey; elapsedSec: number; extensionSec?: number }): TimeSignal {
  const th = thresholdsFor(input.route, input.extensionSec ?? 0);
  const e = Math.max(0, input.elapsedSec);
  const remainingSec = Math.max(0, th.hardStopSec - e);
  if (e >= th.hardStopSec) return { level: "OVER", elapsedSec: e, remainingSec, thresholds: th, actions: ["END_POLITELY"] };
  if (e >= th.redAtSec) return { level: "TIME_RED", elapsedSec: e, remainingSec, thresholds: th, actions: redActions(input.route) };
  if (e >= th.amberAtSec) {
    return {
      level: "TIME_AMBER",
      elapsedSec: e,
      remainingSec,
      thresholds: th,
      actions: ["SUMMARISE_PROGRESS", "NO_NEW_TOPICS", "STEER_TO_NEXT_STEP"],
    };
  }
  return { level: "GREEN", elapsedSec: e, remainingSec, thresholds: th, actions: ["CONTINUE"] };
}

export type CloseInProgress = "CONFIRMING_BOOKING_SLOT" | "SENDING_CHECKOUT_LINK" | "CONFIRMING_ORDER_DETAILS" | null;

export type ExtensionDecision =
  | { granted: true; extensionSec: number; newHardStopSec: number }
  | {
      granted: false;
      reason:
        | "ROUTE_NOT_ELIGIBLE"
        | "NO_CLOSE_IN_PROGRESS"
        | "LEAD_NOT_ENGAGED"
        | "LEAD_ASKED_TO_END"
        | "MAX_EXTENSIONS_REACHED"
        | "NOT_YET_RED"
        | "EXCEEDS_RESERVATION";
    };

/**
 * May the call run 60 seconds longer? Bounded twice over: at most
 * MAX_EXTENSIONS, and never past the seconds reserved for this call (so an
 * extension can never overdraw the minute balance).
 */
export function evaluateExtension(input: {
  route: VoiceRouteKey;
  elapsedSec: number;
  extensionsUsed: number;
  closeInProgress: CloseInProgress;
  leadEngaged: boolean;
  leadAskedToEnd: boolean;
  reservedSec: number;
}): ExtensionDecision {
  if (!CLOSING_ROUTES.includes(input.route)) return { granted: false, reason: "ROUTE_NOT_ELIGIBLE" };
  if (input.leadAskedToEnd) return { granted: false, reason: "LEAD_ASKED_TO_END" };
  if (!input.closeInProgress) return { granted: false, reason: "NO_CLOSE_IN_PROGRESS" };
  if (!input.leadEngaged) return { granted: false, reason: "LEAD_NOT_ENGAGED" };
  if (input.extensionsUsed >= MAX_EXTENSIONS) return { granted: false, reason: "MAX_EXTENSIONS_REACHED" };
  const current = thresholdsFor(input.route, input.extensionsUsed * EXTENSION_STEP_SEC);
  if (input.elapsedSec < current.redAtSec) return { granted: false, reason: "NOT_YET_RED" };
  const extensionSec = (input.extensionsUsed + 1) * EXTENSION_STEP_SEC;
  const newHardStopSec = CALL_BUDGET_SEC + extensionSec;
  if (newHardStopSec > input.reservedSec) return { granted: false, reason: "EXCEEDS_RESERVATION" };
  return { granted: true, extensionSec, newHardStopSec };
}

/** The provider-side max duration to set on the call: the absolute ceiling. */
export const PROVIDER_MAX_DURATION_SEC = CALL_BUDGET_SEC + MAX_EXTENSION_SEC;
