/**
 * The call card's view model: what the conversation timeline and the lead's
 * voice panel show for one call. Pure, and imported by the client card, so it
 * holds no secrets and no server import.
 *
 * Two redactions, both enforced HERE rather than in the component:
 *   - provider cost is ClientTurn's cost of the call: only an owner or admin
 *     sees it (null for anyone else, so it never reaches their browser);
 *   - the model's internal reasoning is never part of a call record. Only
 *     what was said (transcript), what was decided (disposition, next action)
 *     and the provider's plain summary are shown; any stored key that looks
 *     like reasoning or a prompt is dropped from the facts.
 */

export type CallCardRow = {
  id: string;
  direction: "OUTBOUND" | "INBOUND" | string;
  route: string;
  state: string;
  to_e164: string | null;
  from_e164: string | null;
  created_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  billed_sec: number | null;
  outcome: string | null;
  recording_enabled: boolean;
  persona_name: string | null;
  attempt_number: number;
};

export type CallCardOutcome = {
  disposition: string;
  summary: string | null;
  facts: Record<string, unknown>;
  next_action: string | null;
  callback_requested_for: string | null;
} | null;

export type TranscriptSegment = { role: "agent" | "user"; content: string };

export type CallCard = {
  id: string;
  direction: "Outbound" | "Inbound";
  routeLabel: string;
  state: string;
  number: string | null;
  at: string;
  durationLabel: string | null;
  billedMinutes: number | null;
  outcome: string | null;
  disposition: string | null;
  summary: string | null;
  facts: { label: string; value: string }[];
  nextAction: string | null;
  callbackRequestedFor: string | null;
  qualificationChange: { before: string | null; after: string | null } | null;
  objections: { key: string; label: string; handledOutcome: string | null }[];
  transcript: TranscriptSegment[];
  /** A short-lived signed URL, only when recording is on and the file is stored. */
  recordingUrl: string | null;
  recordingStatus: "NONE" | "PENDING" | "STORED" | "FAILED";
  /** Owner/admin only. GBP. */
  costGbp: number | null;
  attemptNumber: number;
  inProgress: boolean;
  /** The agent that asked for this call ("Called by <agent>"); null for a person, a retry or an inbound call. */
  calledBy: string | null;
};

const ROUTE_LABELS: Record<string, string> = {
  QUALIFICATION: "Qualification",
  BOOKING_CLOSE: "Booking close",
  DIRECT_CLOSE: "Direct close",
  NURTURE: "Nurture",
  REACTIVATION: "Reactivation",
  INBOUND: "Inbound call",
  RETURN_CALL: "Return call",
};

const FACT_LABELS: Record<string, string> = {
  stated_date: "Date mentioned",
  wants_meeting: "Wants a meeting",
  asked_about_price: "Asked about price",
  urgency: "Urgency",
};

const HIDDEN_FACT = /(reason|prompt|thought|chain|internal|model|_raw|^_)/i;

const LIVE_STATES = ["QUEUED", "DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];

/**
 * A call's cost is ClientTurn's serving cost: platform admin only (owner
 * decision 2026-09-30). No workspace role sees it, owners and admins included;
 * customers see minutes used instead.
 */
export function canSeeCallCost(_role: string): boolean {
  return false;
}

export function durationLabel(sec: number | null): string | null {
  if (sec == null) return null;
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function objectionLabel(key: string): string {
  const k = key.replace(/[_.:-]+/g, " ").toLowerCase().trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export function toCallCard(input: {
  row: CallCardRow;
  outcome: CallCardOutcome;
  transcript: TranscriptSegment[] | null;
  recording: { status: string; url: string | null } | null;
  objections: { objection_key: string; handled_outcome: string | null }[];
  costGbp: number | null;
  qualificationChange?: { before: string | null; after: string | null } | null;
  viewerRole: string;
  /** The requesting agent's name (0176). */
  calledBy?: string | null;
}): CallCard {
  const { row } = input;
  const facts = Object.entries(input.outcome?.facts ?? {})
    .filter(([key, value]) => !HIDDEN_FACT.test(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .map(([key, value]) => ({ label: FACT_LABELS[key] ?? objectionLabel(key), value: String(value) }));

  const recordingStatus: CallCard["recordingStatus"] = !row.recording_enabled || !input.recording
    ? "NONE"
    : input.recording.status === "STORED"
      ? "STORED"
      : input.recording.status === "FAILED"
        ? "FAILED"
        : "PENDING";

  return {
    id: row.id,
    direction: row.direction === "INBOUND" ? "Inbound" : "Outbound",
    routeLabel: ROUTE_LABELS[row.route] ?? row.route,
    state: row.state,
    number: row.direction === "INBOUND" ? row.from_e164 : row.to_e164,
    at: row.started_at ?? row.created_at,
    durationLabel: durationLabel(row.duration_sec),
    billedMinutes: row.billed_sec != null ? Math.round((row.billed_sec / 60) * 10) / 10 : null,
    outcome: row.outcome,
    disposition: input.outcome?.disposition ?? null,
    summary: input.outcome?.summary ?? null,
    facts,
    nextAction: input.outcome?.next_action ?? null,
    callbackRequestedFor: input.outcome?.callback_requested_for ?? null,
    qualificationChange: input.qualificationChange ?? null,
    objections: input.objections.map((o) => ({ key: o.objection_key, label: objectionLabel(o.objection_key), handledOutcome: o.handled_outcome })),
    transcript: (input.transcript ?? []).map((t) => ({ role: t.role === "agent" ? "agent" : "user", content: t.content })),
    recordingUrl: recordingStatus === "STORED" ? (input.recording?.url ?? null) : null,
    recordingStatus,
    costGbp: canSeeCallCost(input.viewerRole) ? input.costGbp : null,
    attemptNumber: row.attempt_number,
    inProgress: LIVE_STATES.includes(row.state),
    calledBy: input.calledBy ?? null,
  };
}
