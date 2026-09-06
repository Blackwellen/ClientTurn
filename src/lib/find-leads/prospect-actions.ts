"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { suppress } from "@/lib/policy/suppression";
import { refreshProspectResearch } from "./server/research";
import { generateResearchSummary } from "./server/research-summary";
import type { ActionResult } from "./actions";

/**
 * Prospect state changes (V4 §12.7, §13.2).
 *
 * Separate from `actions.ts`, which is about *sourcing* — starting a search,
 * spending provider budget, running a plan. These are decisions taken on a
 * record that already exists, and they share one rule that sourcing does not:
 * every one of them is expressed as predicates on the UPDATE rather than as an
 * application-side check followed by a write. A suppressed row in a 200-row
 * selection is skipped by the database, not by a loop that could be got wrong.
 *
 * Nothing here can widen who may be contacted. Approval is permission from the
 * business; it never overrides contactability, which is the recipient's.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function refresh() {
  revalidatePath("/app/find-leads");
}

/** Changing a prospect's state is an admin act: it decides who gets contacted. */
async function requireProspectAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return fail("Only owners and admins can change a prospect's status.");
  }
  try {
    await assertCapability(workspace.businessId, "sourcing");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Find Leads is unavailable right now.");
  }
  return { ok: true, workspace };
}

/* ------------------------------------------------------------- suppression */

// The reason list itself lives in `lib/prospects/types.ts`: a "use server"
// module may only export async functions, and the drawer needs the options to
// render the confirmation dialog.
const suppressSchema = z.object({
  prospectId: z.uuid(),
  reason: z.enum(["OPT_OUT", "COMPLAINT", "MANUAL", "LEGAL"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Suppression.
 *
 * Two writes, and both are needed. The destination-scoped `suppression_entries`
 * row is what every future send checks, whatever surface it comes from — that
 * is the one that actually stops contact. The prospect columns record *this*
 * decision about *this* record, so the drawer can say who suppressed it and why
 * without inferring it from an address-level entry that may cover several
 * prospects.
 *
 * The destination entry is written first. If the second write fails the contact
 * is still blocked, which is the safe way round for this pair to fail.
 *
 * The record is never deleted: a deleted prospect would be re-sourced by the
 * next run and contacted again, which is exactly what suppression prevents.
 */
export async function suppressProspectAction(
  input: unknown,
): Promise<ActionResult<{ status: string }>> {
  const parsed = suppressSchema.safeParse(input);
  if (!parsed.success) return fail("A reason is required to suppress a prospect.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, email, phone_e164, status")
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.prospectId)
    .maybeSingle();

  if (!prospect) return fail("That prospect could not be found.");

  await suppress({
    businessId: access.workspace.businessId,
    channel: "ALL",
    reason: parsed.data.reason,
    source: "USER",
    sourceReference: parsed.data.prospectId,
    note: parsed.data.note ?? null,
    createdBy: access.workspace.userId,
    email: prospect.email,
    phone: prospect.phone_e164,
  });

  await admin
    .from("prospects")
    .update({
      status: "SUPPRESSED",
      outreach_eligibility: "SUPPRESSED",
      eligibility_reason:
        parsed.data.reason === "OPT_OUT"
          ? "Opted out — do not contact."
          : "Suppressed by a workspace admin.",
      suppression_reason: parsed.data.reason,
      suppressed_at: new Date().toISOString(),
      suppressed_by: access.workspace.userId,
      // Membership is dropped so the scheduler has nothing to pick up, on top
      // of the eligibility check it already performs at send time.
      campaign_id: null,
      last_activity_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.prospectId);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.suppressed",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: { reason: parsed.data.reason },
  });

  refresh();
  return ok({ status: "SUPPRESSED" });
}

/* ------------------------------------------------------------ bulk actions */

const bulkSchema = z.array(z.uuid()).min(1).max(500);

/**
 * Bulk approval.
 *
 * Deliberately not a loop over the single-prospect action: the eligibility and
 * status conditions are predicates on the UPDATE, so the database decides what
 * is skipped. The result reports how many were actually approved, never how
 * many were asked for — a selection of 40 that approves 12 has to say so.
 */
export async function approveProspectsAction(
  prospectIds: unknown,
): Promise<ActionResult<{ approved: number; skipped: number }>> {
  const ids = bulkSchema.safeParse(prospectIds);
  if (!ids.success) return fail("Select at least one prospect.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("prospects")
    .update({
      status: "APPROVED",
      approved_by: access.workspace.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .in("id", ids.data)
    .eq("outreach_eligibility", "ELIGIBLE")
    .in("status", ["READY", "REVIEW", "VERIFIED"])
    .is("promoted_to_lead_id", null)
    .select("id");

  const approved = updated?.length ?? 0;

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.approved",
    entityType: "prospect",
    entityId: null,
    metadata: { requested: ids.data.length, approved },
  });

  refresh();
  return approved > 0
    ? ok({ approved, skipped: ids.data.length - approved })
    : fail("None of those prospects are eligible and ready to approve.");
}

/** Sends prospects back to a human. Always permitted: moving work toward review
 *  can never widen who gets contacted. */
export async function markProspectsForReviewAction(
  prospectIds: unknown,
): Promise<ActionResult<{ updated: number }>> {
  const ids = bulkSchema.safeParse(prospectIds);
  if (!ids.success) return fail("Select at least one prospect.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("prospects")
    .update({ status: "REVIEW" })
    .eq("business_id", access.workspace.businessId)
    .in("id", ids.data)
    .in("status", ["DISCOVERED", "ENRICHING", "VERIFIED", "READY", "APPROVED"])
    .is("promoted_to_lead_id", null)
    .select("id");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.marked_for_review",
    entityType: "prospect",
    entityId: null,
    metadata: { requested: ids.data.length, updated: updated?.length ?? 0 },
  });

  refresh();
  return ok({ updated: updated?.length ?? 0 });
}

/**
 * Removes prospects from their campaign.
 *
 * Only one that has not started sending to them. Pulling a prospect out
 * mid-sequence would leave a recipient run pointing at a campaign the prospect
 * is no longer in; a contacted prospect is *stopped*, not un-enrolled, and that
 * is a different action.
 */
export async function removeProspectsFromCampaignAction(
  prospectIds: unknown,
): Promise<ActionResult<{ removed: number }>> {
  const ids = bulkSchema.safeParse(prospectIds);
  if (!ids.success) return fail("Select at least one prospect.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("prospects")
    .update({ campaign_id: null })
    .eq("business_id", access.workspace.businessId)
    .in("id", ids.data)
    .not("campaign_id", "is", null)
    .in("status", ["READY", "APPROVED", "REVIEW"])
    .select("id");

  const removed = updated?.length ?? 0;

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.removed_from_campaign",
    entityType: "prospect",
    entityId: null,
    metadata: { requested: ids.data.length, removed },
  });

  refresh();
  return removed > 0
    ? ok({ removed })
    : fail(
        "None of those prospects could be removed — a contacted prospect is stopped, not un-enrolled.",
      );
}

/* ------------------------------------------------------------- research */

/**
 * Re-runs enrichment for one prospect.
 *
 * Everything that decides whether this may happen lives in
 * `refreshProspectResearch`: plan, cooldown, workspace daily cap, provider
 * health. The state the button was rendered with is a courtesy, never the
 * authorisation — it may be an hour old, and a colleague may have consumed the
 * cooldown since.
 */
export async function refreshProspectResearchAction(
  prospectId: unknown,
): Promise<ActionResult<{ updatedFields: string[] }>> {
  const id = z.uuid().safeParse(prospectId);
  if (!id.success) return fail("That prospect could not be found.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const outcome = await refreshProspectResearch(
    access.workspace.businessId,
    id.data,
    access.workspace.userId,
  );

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.research_refreshed",
    entityType: "prospect",
    entityId: id.data,
    metadata: {
      ok: outcome.ok,
      updatedFields: outcome.updatedFields,
      // Pence, and admin-only by virtue of living in the audit log.
      costMinor: outcome.costMinor,
    },
  });

  if (!outcome.ok) return fail(outcome.error ?? "Research could not be refreshed.");

  refresh();
  return ok({ updatedFields: outcome.updatedFields });
}

/**
 * Generates the AI research summary from evidence already stored.
 *
 * Spends AI tokens, not provider budget, and calls no external data source — so
 * it is gated on the workspace AI toggle rather than on the research cooldown.
 */
export async function generateResearchSummaryAction(
  prospectId: unknown,
): Promise<ActionResult<{ claims: number }>> {
  const id = z.uuid().safeParse(prospectId);
  if (!id.success) return fail("That prospect could not be found.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: exists } = await admin
    .from("prospects")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!exists) return fail("That prospect could not be found.");

  const outcome = await generateResearchSummary(access.workspace.businessId, id.data);
  if (!outcome.ok) return fail(outcome.error);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.research_summarised",
    entityType: "prospect",
    entityId: id.data,
    metadata: { claims: outcome.summary.claims.length },
  });

  refresh();
  return ok({ claims: outcome.summary.claims.length });
}

/* --------------------------------------------------------- bulk suppress */

const bulkSuppressSchema = z.object({
  prospectIds: z.array(z.uuid()).min(1).max(200),
  reason: z.enum(["OPT_OUT", "COMPLAINT", "MANUAL", "LEGAL"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Suppresses a selection.
 *
 * Capped lower than the other bulk actions (200 rather than 500), because this
 * one is irreversible for the reasons that matter: an OPT_OUT or COMPLAINT
 * entry is the recipient's decision and is not the workspace's to lift. A
 * mis-clicked 500-row suppression is not something a support ticket can undo.
 *
 * Each destination entry is written individually rather than as one bulk
 * insert, so a single bad address cannot roll back the suppression of the other
 * 199 — failing to suppress is the worse outcome here.
 */
export async function suppressProspectsAction(
  input: unknown,
): Promise<ActionResult<{ suppressed: number; failed: number }>> {
  const parsed = bulkSuppressSchema.safeParse(input);
  if (!parsed.success) return fail("Select prospects and give a reason.");

  const access = await requireProspectAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: prospects } = await admin
    .from("prospects")
    .select("id, email, phone_e164")
    .eq("business_id", access.workspace.businessId)
    .in("id", parsed.data.prospectIds);

  if (!prospects?.length) return fail("None of those prospects could be found.");

  let suppressed = 0;
  let failed = 0;

  for (const prospect of prospects) {
    try {
      await suppress({
        businessId: access.workspace.businessId,
        channel: "ALL",
        reason: parsed.data.reason,
        source: "USER",
        sourceReference: prospect.id,
        note: parsed.data.note ?? null,
        createdBy: access.workspace.userId,
        email: prospect.email,
        phone: prospect.phone_e164,
      });
      suppressed += 1;
    } catch {
      failed += 1;
    }
  }

  // The prospect side is one statement: it cannot partially fail in a way that
  // leaves a record contactable, because the destination entries above are what
  // the send path actually checks.
  await admin
    .from("prospects")
    .update({
      status: "SUPPRESSED",
      outreach_eligibility: "SUPPRESSED",
      eligibility_reason:
        parsed.data.reason === "OPT_OUT"
          ? "Opted out — do not contact."
          : "Suppressed by a workspace admin.",
      suppression_reason: parsed.data.reason,
      suppressed_at: new Date().toISOString(),
      suppressed_by: access.workspace.userId,
      campaign_id: null,
      last_activity_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .in(
      "id",
      prospects.map((prospect) => prospect.id),
    );

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "prospect.suppressed",
    entityType: "prospect",
    entityId: null,
    metadata: {
      reason: parsed.data.reason,
      requested: parsed.data.prospectIds.length,
      suppressed,
      failed,
    },
  });

  refresh();
  return ok({ suppressed, failed });
}
