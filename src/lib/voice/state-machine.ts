/**
 * The call lifecycle. Pure transitions with guards; an illegal transition
 * throws. Persistence goes through one RPC that locks the call row and checks
 * the expected current state (gap map §73); this module is the rule that RPC
 * and the webhook reducer share.
 *
 *   REQUESTED -> ELIGIBILITY_CHECKED -> QUEUED -> DIALLING -> RINGING
 *     -> ANSWERED | VOICEMAIL | NO_ANSWER | BUSY | FAILED
 *   ANSWERED -> IN_CONVERSATION -> WRAPPING_UP -> ENDED
 *   ENDED -> POST_PROCESSING -> COMPLETE
 *   plus CANCELLED (before anyone answers) and TRANSFERRED (a live transfer).
 *
 * The dialled outcomes that are not a conversation (VOICEMAIL, NO_ANSWER,
 * BUSY, FAILED) still pass through POST_PROCESSING, which settles or releases
 * the minute reservation and plans the retry or fallback.
 */

export const CALL_STATES = [
  "REQUESTED",
  "ELIGIBILITY_CHECKED",
  "QUEUED",
  "DIALLING",
  "RINGING",
  "ANSWERED",
  "VOICEMAIL",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "IN_CONVERSATION",
  "WRAPPING_UP",
  "TRANSFERRED",
  "ENDED",
  "POST_PROCESSING",
  "COMPLETE",
  "CANCELLED",
] as const;
export type CallState = (typeof CALL_STATES)[number];

export const TRANSITIONS: Readonly<Record<CallState, readonly CallState[]>> = {
  REQUESTED: ["ELIGIBILITY_CHECKED", "CANCELLED"],
  ELIGIBILITY_CHECKED: ["QUEUED", "CANCELLED"],
  QUEUED: ["DIALLING", "CANCELLED"],
  DIALLING: ["RINGING", "ANSWERED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"],
  RINGING: ["ANSWERED", "VOICEMAIL", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"],
  // Answering-machine detection can conclude after the line is picked up.
  ANSWERED: ["IN_CONVERSATION", "VOICEMAIL", "ENDED", "FAILED"],
  IN_CONVERSATION: ["WRAPPING_UP", "TRANSFERRED", "ENDED", "FAILED"],
  WRAPPING_UP: ["ENDED", "TRANSFERRED"],
  TRANSFERRED: ["ENDED"],
  VOICEMAIL: ["ENDED", "POST_PROCESSING"],
  NO_ANSWER: ["POST_PROCESSING"],
  BUSY: ["POST_PROCESSING"],
  FAILED: ["POST_PROCESSING"],
  ENDED: ["POST_PROCESSING"],
  POST_PROCESSING: ["COMPLETE"],
  COMPLETE: [],
  CANCELLED: [],
};

export const TERMINAL_STATES: readonly CallState[] = ["COMPLETE", "CANCELLED"];
/** States that hold the lead's one-active-call slot and a concurrency slot. */
export const ACTIVE_STATES: readonly CallState[] = [
  "DIALLING",
  "RINGING",
  "ANSWERED",
  "IN_CONVERSATION",
  "WRAPPING_UP",
  "TRANSFERRED",
];

export class IllegalCallTransition extends Error {
  readonly from: CallState;
  readonly to: CallState;
  constructor(from: CallState, to: CallState) {
    super(`Illegal call transition ${from} -> ${to}`);
    this.name = "IllegalCallTransition";
    this.from = from;
    this.to = to;
  }
}

export class CallGuardFailed extends Error {
  readonly to: CallState;
  readonly guard: string;
  constructor(to: CallState, guard: string) {
    super(`Guard ${guard} failed for transition to ${to}`);
    this.name = "CallGuardFailed";
    this.to = to;
    this.guard = guard;
  }
}

/** Facts the guards read. Supplied by the caller from current state. */
export type GuardContext = {
  /** canCallLead + assertVoiceAllowed passed (re-checked by the dial job). */
  eligibilityAllowed?: boolean;
  /** A minute reservation is held for this call (budget.ts). */
  reservationHeld?: boolean;
  /** The locked OD-1 preamble was spoken and validated. */
  openerDelivered?: boolean;
  /** A transfer destination is configured and inside its hours. */
  transferAvailable?: boolean;
  /** The minute reservation was settled or released. */
  minutesAccounted?: boolean;
};

const GUARDS: Partial<Record<CallState, (g: GuardContext) => string | null>> = {
  ELIGIBILITY_CHECKED: (g) => (g.eligibilityAllowed ? null : "eligibilityAllowed"),
  DIALLING: (g) => {
    if (!g.eligibilityAllowed) return "eligibilityAllowed";
    if (!g.reservationHeld) return "reservationHeld";
    return null;
  },
  IN_CONVERSATION: (g) => (g.openerDelivered ? null : "openerDelivered"),
  TRANSFERRED: (g) => (g.transferAvailable ? null : "transferAvailable"),
  COMPLETE: (g) => (g.minutesAccounted ? null : "minutesAccounted"),
};

export function canTransition(from: CallState, to: CallState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Apply one transition. Throws IllegalCallTransition or CallGuardFailed. */
export function transition(from: CallState, to: CallState, guards: GuardContext = {}): CallState {
  if (!canTransition(from, to)) throw new IllegalCallTransition(from, to);
  const guard = GUARDS[to];
  const failed = guard ? guard(guards) : null;
  if (failed) throw new CallGuardFailed(to, failed);
  return to;
}

export function isTerminal(s: CallState): boolean {
  return TERMINAL_STATES.includes(s);
}

// --------------------------------------------------- provider observations

/**
 * Rank for "has the call progressed past this?". Provider webhooks arrive out
 * of order (Twilio `ringing` after `in-progress`, Retell `call_started` after
 * `call_ended`); an observation at or below the current rank is stale and is
 * ignored rather than regressing the call.
 */
export const STATE_RANK: Readonly<Record<CallState, number>> = {
  REQUESTED: 0,
  ELIGIBILITY_CHECKED: 1,
  QUEUED: 2,
  DIALLING: 3,
  RINGING: 4,
  ANSWERED: 5,
  IN_CONVERSATION: 6,
  WRAPPING_UP: 7,
  TRANSFERRED: 8,
  VOICEMAIL: 8,
  NO_ANSWER: 8,
  BUSY: 8,
  FAILED: 8,
  ENDED: 9,
  POST_PROCESSING: 10,
  COMPLETE: 11,
  CANCELLED: 11,
};

/** States a provider may skip reporting; the reducer may pass through them. */
const IMPLIED: readonly CallState[] = ["RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP"];

export type ObservationResult =
  | { applied: true; state: CallState; path: CallState[] }
  | { applied: false; state: CallState; reason: "STALE" | "TERMINAL" };

/**
 * Reduce a provider-observed state onto the current one. Walks through
 * implied intermediate states (a provider that reports `in-progress` straight
 * after `initiated` has skipped RINGING). Guards are not applied here: the
 * provider is reporting a fact about the telephone line, not asking permission;
 * the one guarded fact on this path, the opener, is enforced by the turn
 * adapter before the model speaks. An unreachable observation throws.
 */
export function applyObservedState(current: CallState, observed: CallState): ObservationResult {
  if (isTerminal(current)) return { applied: false, state: current, reason: "TERMINAL" };
  if (observed === current || STATE_RANK[observed] <= STATE_RANK[current]) {
    return { applied: false, state: current, reason: "STALE" };
  }
  // Breadth-first over legal edges, allowing only implied states in between.
  const queue: CallState[][] = [[current]];
  const seen = new Set<CallState>([current]);
  while (queue.length) {
    const path = queue.shift() as CallState[];
    const last = path[path.length - 1];
    for (const next of TRANSITIONS[last]) {
      if (seen.has(next)) continue;
      if (next === observed) return { applied: true, state: observed, path: [...path.slice(1), next] };
      if (IMPLIED.includes(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  throw new IllegalCallTransition(current, observed);
}
