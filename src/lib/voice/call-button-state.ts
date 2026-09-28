/**
 * Whether "Call with AI" may be offered for a lead, and what to say when not.
 * One function for every surface that shows the button (the lead page's AI
 * calls panel and the Leads drawer), so they never disagree. The server
 * re-checks everything on press (voice.request_call -> requestCall ->
 * decideDial); this only decides what the button looks like.
 *
 * Pure: no server import, so it is testable and client-safe.
 */

export type CallButtonRole = "owner" | "admin" | "member" | "viewer";

/** The parts of `VoiceSettingsView` (services/operations/voice.ts) this reads. */
export type CallButtonVoiceView = {
  entitlement: { allowed: boolean; locked: boolean; message: string | null };
  settings: { adminKillSwitch: boolean };
  integration: { ready: boolean };
  number?: { e164: string | null };
};

export type CallButtonLead = {
  phone: string | null;
  optedOut: boolean;
  anonymised: boolean;
  archived: boolean;
};

const RANK: Record<CallButtonRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

function atLeast(role: CallButtonRole, minimum: CallButtonRole): boolean {
  return (RANK[role] ?? -1) >= RANK[minimum];
}

/** Why "Call with AI" is unavailable, most fundamental first. Null = it may be offered. */
export function callDisabledReason(input: {
  role: CallButtonRole;
  lead: CallButtonLead;
  view: CallButtonVoiceView;
  latest: { inProgress: boolean } | null;
}): string | null {
  const { view, lead } = input;
  if (view.entitlement.locked) return "Voice is a paid feature and isn't on this plan.";
  if (view.settings.adminKillSwitch) return "AI calling is paused for this workspace by ClientTurn.";
  if (!view.integration.ready) return "Calling isn't connected on this environment yet.";
  if (!atLeast(input.role, "member")) return "Viewers can't place calls.";
  if (lead.anonymised) return "This lead's personal data has been erased.";
  if (lead.archived) return "This lead is archived.";
  if (lead.optedOut) return "This lead has opted out of contact.";
  if (!lead.phone) return "This lead has no phone number to call.";
  if (!view.entitlement.allowed) return view.entitlement.message ?? "Voice isn't ready on this workspace yet. Check Settings, Voice.";
  if (input.latest?.inProgress) return "A call to this lead is already in progress.";
  return null;
}

/** Where an admin fixes a workspace-level reason; null for a lead-level one or a non-admin. */
export function callFixLink(role: CallButtonRole, view: CallButtonVoiceView): { href: string; label: string } | null {
  if (view.entitlement.locked) return { href: "/app/settings?section=billing", label: "See plans with AI calling" };
  if (!atLeast(role, "admin")) return null;
  if (!view.entitlement.allowed || !view.integration.ready) {
    return { href: "/app/settings?section=voice&panel=overview", label: "Open voice settings" };
  }
  return null;
}

/** What the Leads drawer needs to render its "Call with AI" action. */
export type DrawerCallState = {
  disabledReason: string | null;
  numberE164: string | null;
  fix: { href: string; label: string } | null;
};

export function drawerCallState(input: {
  role: CallButtonRole;
  lead: CallButtonLead;
  view: CallButtonVoiceView;
  latest: { inProgress: boolean } | null;
}): DrawerCallState {
  return {
    disabledReason: callDisabledReason(input),
    numberE164: input.view.number?.e164 ?? null,
    fix: callFixLink(input.role, input.view),
  };
}

/** When the voice view could not be read: never an enabled button. */
export const DRAWER_CALL_UNAVAILABLE: DrawerCallState = {
  disabledReason: "AI calling can't be checked right now. Try again shortly.",
  numberE164: null,
  fix: null,
};
