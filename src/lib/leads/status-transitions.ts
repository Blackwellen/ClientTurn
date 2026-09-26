/**
 * The lead status state machine (brief §51). Pure: no Supabase, no
 * `server-only`, so the client status pickers, the single status writer
 * (`lead.set_status` and `leads/actions.ts`) and the tests share one matrix.
 *
 * Opportunity stages have their own forward-only rule (opportunities/stages.ts
 * `canAdvance`); this is the lead's projection of the same lifecycle.
 *
 * ## The rules
 *
 *   * WON and LOST are closed. Nothing leaves them without an admin override
 *     that gives a reason (audited). A closed opportunity stays closed.
 *   * NEW means "nobody has been in touch". Once a lead has moved on it cannot
 *     go back to NEW: that would erase the fact that it was contacted.
 *   * CONTACTED is below a reply. A lead that RESPONDED (or got further) cannot
 *     be put back to CONTACTED: the reply happened.
 *   * Among RESPONDED, QUALIFIED and BOOKED a person may move either way (a
 *     booking cancelled, a lead re-qualified). Any open status may close.
 *
 * System writers (inbound replies, qualification, bookings) set statuses
 * through their own guarded paths and are not routed through this matrix.
 */

export const LEAD_STATUS_ORDER = ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"] as const;
export type LeadStatusValue = (typeof LEAD_STATUS_ORDER)[number];

export const CLOSED_LEAD_STATUSES: readonly LeadStatusValue[] = ["WON", "LOST"];

export type TransitionVerdict =
  | { allowed: true }
  | { allowed: false; code: "CLOSED" | "BACK_TO_NEW" | "BACK_TO_CONTACTED" | "UNKNOWN_STATUS"; reason: string };

function isStatus(value: string): value is LeadStatusValue {
  return (LEAD_STATUS_ORDER as readonly string[]).includes(value);
}

export function leadStatusTransition(from: string, to: string): TransitionVerdict {
  if (!isStatus(from) || !isStatus(to)) {
    return { allowed: false, code: "UNKNOWN_STATUS", reason: "That status is not recognised." };
  }
  if (from === to) return { allowed: true };
  if (CLOSED_LEAD_STATUSES.includes(from)) {
    return {
      allowed: false,
      code: "CLOSED",
      reason: `This lead is ${from === "WON" ? "won" : "lost"} and closed. An admin can reopen it with a reason.`,
    };
  }
  if (to === "NEW") {
    return {
      allowed: false,
      code: "BACK_TO_NEW",
      reason: "A lead that has been worked cannot go back to New.",
    };
  }
  if (to === "CONTACTED" && from !== "NEW") {
    return {
      allowed: false,
      code: "BACK_TO_CONTACTED",
      reason: "This lead has already replied, so it cannot go back to Contacted.",
    };
  }
  return { allowed: true };
}

/** The statuses a person may pick from `from` (itself included, for a picker's current value). */
export function allowedNextStatuses(from: string): LeadStatusValue[] {
  return LEAD_STATUS_ORDER.filter((to) => to === from || leadStatusTransition(from, to).allowed);
}

/** A refused transition may be overridden only by an admin/owner, with a reason, from the app. */
export const OVERRIDE_REASON_MIN = 5;

export function overridePermitted(input: { role: string; caller: string; reason: string | null | undefined }): boolean {
  return (
    (input.role === "admin" || input.role === "owner") &&
    input.caller === "UI" &&
    (input.reason ?? "").trim().length >= OVERRIDE_REASON_MIN
  );
}
