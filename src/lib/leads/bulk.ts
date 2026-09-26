/**
 * Bulk actions on the Leads list (tracker 8.12).
 *
 * Pure — no server-only, no Supabase — so the catalogue, the role gate, the
 * confirmation rule and the result wording are asserted in
 * tests/bulk-actions.test.ts and rendered by the bar without a round trip.
 *
 * A bulk action is not a new capability. Each one is an existing service
 * operation (src/lib/services/registry.ts) run once per selected lead, so the
 * permission check, validation, audit row and policy verdict are exactly the
 * ones the drawer's single-lead action gets. The minimum role and the
 * confirmation requirement are therefore *read from the registry*, never
 * restated here, so the bar cannot offer something the server will refuse.
 */

import { serviceOperation } from "../services/registry.ts";
import {
  requiresConfirmation,
  roleMeets,
  type BusinessRoleName,
} from "../services/types.ts";

/** The most leads one request may touch — one page of the list at its largest. */
export const MAX_BULK_LEADS = 200;

export type BulkActionKind =
  | "assign"
  | "set_status"
  | "add_to_campaign"
  | "start_follow_up"
  | "stop_follow_up"
  | "rescore"
  | "suppress"
  | "archive";

export type BulkActionDef = {
  kind: BulkActionKind;
  label: string;
  /** Present-tense verb for the result line: "12 archived". */
  done: string;
  operation:
    | "lead.assign"
    | "lead.set_status"
    | "campaign.add_lead"
    | "lead.resume_follow_up"
    | "lead.takeover"
    | "lead.rescore"
    | "lead.suppress"
    | "lead.archive";
  group: "Ownership" | "Pipeline" | "Follow-up" | "Data";
  destructive?: boolean;
};

export const BULK_ACTIONS: readonly BulkActionDef[] = [
  { kind: "assign", label: "Assign to…", done: "assigned", operation: "lead.assign", group: "Ownership" },
  { kind: "set_status", label: "Change status…", done: "updated", operation: "lead.set_status", group: "Pipeline" },
  { kind: "rescore", label: "Re-score", done: "re-scored", operation: "lead.rescore", group: "Pipeline" },
  {
    kind: "add_to_campaign",
    label: "Add to reactivation campaign…",
    done: "added",
    operation: "campaign.add_lead",
    group: "Follow-up",
  },
  { kind: "start_follow_up", label: "Start follow-up", done: "resumed", operation: "lead.resume_follow_up", group: "Follow-up" },
  { kind: "stop_follow_up", label: "Stop follow-up", done: "taken over", operation: "lead.takeover", group: "Follow-up" },
  { kind: "suppress", label: "Suppress…", done: "suppressed", operation: "lead.suppress", group: "Data", destructive: true },
  { kind: "archive", label: "Archive…", done: "archived", operation: "lead.archive", group: "Data", destructive: true },
];

export function bulkAction(kind: BulkActionKind): BulkActionDef {
  const def = BULK_ACTIONS.find((a) => a.kind === kind);
  if (!def) throw new Error(`Unknown bulk action: ${kind}`);
  return def;
}

function declarationFor(kind: BulkActionKind) {
  const name = bulkAction(kind).operation;
  const declaration = serviceOperation(name);
  if (!declaration) throw new Error(`Bulk action ${kind} names an unregistered operation: ${name}`);
  return declaration;
}

/** The role the registry demands for the operation behind this action. */
export function bulkMinimumRole(kind: BulkActionKind): BusinessRoleName {
  return declarationFor(kind).minimumRole;
}

export function bulkAllowed(role: string, kind: BulkActionKind): boolean {
  return roleMeets(role, bulkMinimumRole(kind));
}

/** Whether a person must confirm in a dialog before this action runs. */
export function bulkNeedsConfirmation(kind: BulkActionKind): boolean {
  return requiresConfirmation(declarationFor(kind).risk);
}

/** Actions this role may run, in menu order. */
export function bulkActionsFor(role: string): BulkActionDef[] {
  return BULK_ACTIONS.filter((a) => bulkAllowed(role, a.kind));
}

/* ----------------------------------------------------------- results */

export type BulkItemResult =
  | { leadId: string; outcome: "updated" }
  /** Nothing to do (already in that state) or refused by a rule, with why. */
  | { leadId: string; outcome: "skipped"; reason: string }
  | { leadId: string; outcome: "failed"; reason: string };

export type BulkSummary = {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Distinct reasons, most common first, with how many leads each covers. */
  reasons: { reason: string; count: number; outcome: "skipped" | "failed" }[];
  /** One sentence for the toast: "12 archived, 2 skipped: opted out." */
  message: string;
  /** Leads that did not change, so the selection can be kept on them. */
  unchangedIds: string[];
};

/** Service error codes that mean "a rule said no", not "something broke". */
const SKIP_CODES = new Set(["CONFLICT", "POLICY_BLOCKED", "NOT_FOUND"]);

/** Maps one service envelope onto a per-item result. */
export function itemFromService(
  leadId: string,
  result:
    | { success: true; data?: unknown }
    | { success: false; code?: string; message: string },
): BulkItemResult {
  if (result.success) {
    const data = result.data as { unchanged?: boolean } | undefined;
    return data?.unchanged
      ? { leadId, outcome: "skipped", reason: "already done" }
      : { leadId, outcome: "updated" };
  }
  const reason = normaliseReason(result.message);
  return result.code && SKIP_CODES.has(result.code)
    ? { leadId, outcome: "skipped", reason }
    : { leadId, outcome: "failed", reason };
}

function normaliseReason(message: string): string {
  const trimmed = message.trim().replace(/[.!]+$/, "");
  if (!trimmed) return "unknown reason";
  // "This lead opted out. Follow-up cannot resume." → "this lead opted out"
  const first = trimmed.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "");
  return first.charAt(0).toLowerCase() + first.slice(1);
}

export function summariseBulk(kind: BulkActionKind, items: BulkItemResult[]): BulkSummary {
  const def = bulkAction(kind);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const counts = new Map<string, { count: number; outcome: "skipped" | "failed" }>();
  const unchangedIds: string[] = [];

  for (const item of items) {
    if (item.outcome === "updated") {
      updated += 1;
      continue;
    }
    unchangedIds.push(item.leadId);
    if (item.outcome === "skipped") skipped += 1;
    else failed += 1;
    const key = `${item.outcome}:${item.reason}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, outcome: item.outcome });
  }

  const reasons = Array.from(counts.entries())
    .map(([key, value]) => ({
      reason: key.slice(key.indexOf(":") + 1),
      count: value.count,
      outcome: value.outcome,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const parts = [`${updated.toLocaleString("en-GB")} ${def.done}`];
  if (skipped > 0) {
    const why = reasons
      .filter((r) => r.outcome === "skipped")
      .map((r) => (skipped > 1 && r.count !== skipped ? `${r.reason} (${r.count})` : r.reason))
      .join("; ");
    parts.push(`${skipped.toLocaleString("en-GB")} skipped: ${why}`);
  }
  if (failed > 0) {
    parts.push(`${failed.toLocaleString("en-GB")} failed — try again`);
  }

  return {
    total: items.length,
    updated,
    skipped,
    failed,
    reasons,
    message: `${parts.join(", ")}.`,
    unchangedIds,
  };
}

/** Plain "3 leads" / "1 lead". */
export function leadCount(n: number): string {
  return `${n.toLocaleString("en-GB")} lead${n === 1 ? "" : "s"}`;
}
