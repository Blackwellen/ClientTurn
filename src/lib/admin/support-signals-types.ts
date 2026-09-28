/**
 * Admin -> Customers -> support drawer: the read-only support signals for the
 * features shipped 2026-09-28 (0171 LinkedIn Assist, 0172 per-person
 * permissions, 0173 invoice pay links, 0174 commercial rules).
 *
 * Pure: no `server-only`, no Supabase, because the drawer is a client
 * component (see the server-only boundary note in admin/affiliates-types.ts).
 * Relative imports with `.ts`, so the tests import it directly.
 */

import { CAPABILITIES, canOverride, capabilityAllowed, overridesFromRow, type Capability } from "../auth/capabilities.ts";

export type SignalLoad<T> = { state: "ok"; data: T } | { state: "not_installed"; note: string } | { state: "error" };

export type MemberPermissionRow = {
  memberId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  /** Per capability: the effective answer and whether it comes from an explicit override. */
  capabilities: { key: Capability; label: string; allowed: boolean; overridden: boolean }[];
};

export type LinkedInAssistSignals = {
  hold: { reason: string; heldAt: string } | null;
  /** False until 0175 is applied: pausing is then unavailable. */
  holdAvailable: boolean;
  people: number;
  pausedPeople: number;
  activeContacts: number;
  openTasks: number;
  sent7d: number;
  sent30d: number;
  connectionNotes7d: number;
};

export type PaymentReviewSignals = {
  total: number;
  byKind: { kind: string; label: string; count: number }[];
};

export type CommercialRuleSignals = {
  competitors: number;
  enabledCompetitors: number;
  agents: number;
  agentsWithSelectedOffers: number;
};

export type SupportSignals = {
  members: SignalLoad<MemberPermissionRow[]>;
  linkedIn: SignalLoad<LinkedInAssistSignals>;
  paymentReviews: SignalLoad<PaymentReviewSignals>;
  commercial: SignalLoad<CommercialRuleSignals>;
};

/**
 * The permission grid for one member row: effective answers from the same
 * rules the service runtime enforces (auth/capabilities.ts), and which of
 * them are explicit overrides rather than the role default.
 */
export function memberPermissionRow(input: {
  memberId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  row: Record<string, unknown> | null;
}): MemberPermissionRow {
  const overrides = overridesFromRow(input.row);
  return {
    memberId: input.memberId,
    name: input.name,
    email: input.email,
    role: input.role,
    status: input.status,
    capabilities: CAPABILITIES.map(({ key, label }) => ({
      key,
      label,
      allowed: capabilityAllowed(input.role, key, overrides),
      // An override the role cannot carry is ignored by the runtime, so it is not shown as one.
      overridden: typeof overrides[key] === "boolean" && canOverride(input.role, key),
    })),
  };
}

/** Sent-task counts over a window, from SENT rows' completion times. */
export function linkedInSentCounts(
  sent: readonly { kind: string; completed_at: string | null }[],
  now: Date,
): { sent7d: number; sent30d: number; connectionNotes7d: number } {
  const day = 86_400_000;
  const weekAgo = now.getTime() - 7 * day;
  const monthAgo = now.getTime() - 30 * day;
  let sent7d = 0;
  let sent30d = 0;
  let connectionNotes7d = 0;
  for (const row of sent) {
    const at = row.completed_at ? Date.parse(row.completed_at) : NaN;
    if (!Number.isFinite(at) || at < monthAgo) continue;
    sent30d += 1;
    if (at >= weekAgo) {
      sent7d += 1;
      if (row.kind === "CONNECTION_NOTE") connectionNotes7d += 1;
    }
  }
  return { sent7d, sent30d, connectionNotes7d };
}

/** Reason text for an admin hold: plain, bounded, and not empty. */
export function normaliseHoldReason(reason: string): string | null {
  const text = reason.replace(/\s+/g, " ").trim();
  return text.length >= 3 && text.length <= 500 ? text : null;
}
