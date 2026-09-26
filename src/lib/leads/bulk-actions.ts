"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { runOperation } from "@/lib/services";
import { LEAD_STATUSES } from "./filters";
import { statusNeedsReason } from "./detail-page";
import {
  MAX_BULK_LEADS,
  bulkAction,
  bulkMinimumRole,
  bulkNeedsConfirmation,
  itemFromService,
  summariseBulk,
  type BulkActionKind,
  type BulkItemResult,
  type BulkSummary,
} from "./bulk";

/**
 * The Leads list's bulk actions (tracker 8.12).
 *
 * One entry point, one lead at a time through the service runtime. There is no
 * bulk SQL here on purpose: running `runOperation` per lead is what gives every
 * lead in the selection its own permission check, its own policy verdict (an
 * opted-out lead cannot be put back into follow-up by being selected alongside
 * nineteen others) and its own audit row.
 *
 * The role is checked twice, deliberately: `requireRole` here refuses the whole
 * request up front with one clear message, and the runtime re-checks per
 * operation. The UI hiding an action is a courtesy, never the gate.
 */

const idsSchema = z.array(z.uuid()).min(1).max(MAX_BULK_LEADS);

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assign"), leadIds: idsSchema, userId: z.uuid().nullable() }),
  z.object({
    kind: z.literal("set_status"),
    leadIds: idsSchema,
    status: z.enum(LEAD_STATUSES),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({ kind: z.literal("add_to_campaign"), leadIds: idsSchema, campaignId: z.uuid() }),
  z.object({ kind: z.literal("start_follow_up"), leadIds: idsSchema }),
  z.object({ kind: z.literal("stop_follow_up"), leadIds: idsSchema }),
  z.object({ kind: z.literal("rescore"), leadIds: idsSchema }),
  z.object({
    kind: z.literal("suppress"),
    leadIds: idsSchema,
    reason: z.enum(["MANUAL", "OPT_OUT", "LEGAL"]),
    note: z.string().trim().max(500).optional(),
    confirmed: z.boolean(),
  }),
  z.object({ kind: z.literal("archive"), leadIds: idsSchema, confirmed: z.boolean() }),
]);

export type BulkLeadInput = z.input<typeof inputSchema>;

export type BulkLeadResult =
  | { ok: true; summary: BulkSummary; items: BulkItemResult[] }
  | { ok: false; error: string };

const CONCURRENCY = 5;

function argsFor(input: z.infer<typeof inputSchema>, leadId: string): Record<string, unknown> {
  switch (input.kind) {
    case "assign":
      return { leadId, userId: input.userId };
    case "set_status":
      return { leadId, status: input.status, reason: input.reason || undefined };
    case "add_to_campaign":
      return { leadId, campaignId: input.campaignId };
    case "suppress":
      return { leadId, channel: "ALL", reason: input.reason, note: input.note || undefined };
    default:
      return { leadId };
  }
}

export async function runLeadBulkAction(raw: BulkLeadInput): Promise<BulkLeadResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Select between 1 and 200 leads and try again." };
  }
  const input = parsed.data;
  const kind: BulkActionKind = input.kind;
  const def = bulkAction(kind);

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole(bulkMinimumRole(kind));
  } catch {
    return {
      ok: false,
      error: `Your role cannot ${def.label.replace(/…$/, "").toLowerCase()} leads.`,
    };
  }

  const confirmed = "confirmed" in input ? input.confirmed === true : false;
  if (bulkNeedsConfirmation(kind) && !confirmed) {
    return { ok: false, error: "Confirm this action before it runs." };
  }

  if (input.kind === "set_status" && statusNeedsReason(input.status) && !input.reason) {
    return { ok: false, error: "Won and lost need a reason." };
  }

  if (input.kind === "add_to_campaign") {
    try {
      await assertEntitlement(workspace.businessId, "campaigns");
    } catch (error) {
      if (error instanceof EntitlementError) return { ok: false, error: error.message };
      return { ok: false, error: "Campaigns are unavailable right now." };
    }
  }

  // Duplicates in the selection would audit the same change twice.
  const leadIds = Array.from(new Set(input.leadIds));
  const correlationId = randomUUID();
  const items: BulkItemResult[] = [];

  for (let index = 0; index < leadIds.length; index += CONCURRENCY) {
    const chunk = leadIds.slice(index, index + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (leadId) => {
        try {
          const result = await runOperation(def.operation, argsFor(input, leadId), {
            businessId: workspace.businessId,
            userId: workspace.userId,
            role: workspace.role,
            caller: "UI",
            confirmed,
            correlationId,
          });
          return itemFromService(leadId, result);
        } catch {
          return { leadId, outcome: "failed", reason: "unexpected error" } as BulkItemResult;
        }
      }),
    );
    items.push(...results);
  }

  revalidatePath("/app");
  revalidatePath("/app/leads", "layout");
  if (kind === "add_to_campaign") revalidatePath("/app/reactivation");

  return { ok: true, summary: summariseBulk(kind, items), items };
}

/** Reactivation campaigns a lead can still be added to (draft, scheduled, paused). */
export async function listBulkCampaignTargets(): Promise<
  { ok: true; campaigns: { id: string; name: string; status: string }[] } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole(bulkMinimumRole("add_to_campaign"));
  } catch {
    return { ok: false, error: "Only owners and admins can add leads to campaigns." };
  }
  const result = await runOperation(
    "campaign.list",
    { limit: 50 },
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      caller: "UI",
      correlationId: randomUUID(),
    },
  );
  if (!result.success) return { ok: false, error: result.message };
  const rows =
    (result.data as { campaigns?: { id: string; name: string; status: string }[] }).campaigns ??
    [];
  return {
    ok: true,
    campaigns: rows
      .filter((row) => ["DRAFT", "SCHEDULED", "PAUSED"].includes(row.status))
      .map((row) => ({ id: row.id, name: row.name, status: row.status })),
  };
}
