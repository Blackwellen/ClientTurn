/**
 * Which status changes a person is offered for a booking, in the order the
 * menu shows them. Every target here must be accepted by `staffStatusChange`
 * (proven in tests/phase0-followups.test.ts), so the menu never offers a
 * change the server will refuse.
 *
 * No `server-only`, no Supabase and no relative imports: this file is loaded
 * directly by `node --test` and by client components.
 */

export type StaffBookingTarget = "scheduled" | "completed" | "no_show" | "cancelled";

export type StaffBookingAction = {
  to: StaffBookingTarget;
  label: string;
  destructive?: boolean;
};

const PENDING_ACTIONS: StaffBookingAction[] = [
  { to: "scheduled", label: "Confirm time" },
  { to: "cancelled", label: "Decline", destructive: true },
];

const OUTCOME_ACTIONS: StaffBookingAction[] = [
  { to: "completed", label: "It went ahead" },
  { to: "no_show", label: "They did not turn up" },
  { to: "cancelled", label: "It was cancelled", destructive: true },
];

export function staffBookingActions(status: string): StaffBookingAction[] {
  return status === "pending" ? PENDING_ACTIONS : OUTCOME_ACTIONS;
}
