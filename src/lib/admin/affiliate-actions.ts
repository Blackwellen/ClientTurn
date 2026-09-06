"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * Admin -> Affiliates writes (V4 section 41).
 *
 * All of these move money or decide who may earn it, so every one runs through
 * `guarded`: authorised, step-up protected and audited by the same path as
 * suspending a workspace.
 *
 * Nothing here calls a payment provider. "Mark as paid" records that a person
 * sent the money; it does not send it. Wiring a payout button straight to a
 * transfer API is how a double-click becomes a double-payment.
 */

/* -------------------------------------------------------- affiliate status */

export async function approveAffiliate(input: {
  affiliateId: string;
  commissionPlanId?: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.approved", async (operator) => {
    const parsed = z
      .object({
        affiliateId: z.string().uuid(),
        commissionPlanId: z.string().uuid().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "That partner is not valid." };

    const db = createAdminClient();

    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, status, commission_plan_id")
      .eq("id", parsed.data.affiliateId)
      .maybeSingle();

    if (!affiliate) return { ok: false, error: "That partner no longer exists." };
    if (affiliate.status === "ACTIVE") {
      return { ok: false, error: "That partner is already active." };
    }

    // A partner cannot be activated without commission terms: they would start
    // referring customers with no defined rate, and the arithmetic that accrues
    // commission has nothing to work from.
    const planId = parsed.data.commissionPlanId ?? affiliate.commission_plan_id;
    if (!planId) {
      const { data: fallback } = await db
        .from("affiliate_commission_plans")
        .select("id")
        .eq("is_default", true)
        .eq("active", true)
        .maybeSingle();
      if (!fallback) {
        return {
          ok: false,
          error: "No commission plan is set, and there is no active default to fall back on.",
        };
      }
      return finishApproval(parsed.data.affiliateId, fallback.id, operator.id);
    }

    return finishApproval(parsed.data.affiliateId, planId, operator.id);
  });
}

async function finishApproval(
  affiliateId: string,
  planId: string,
  operatorId: string,
): Promise<AdminActionResult> {
  const db = createAdminClient();

  const { error } = await db
    .from("affiliates")
    .update({
      status: "ACTIVE",
      status_reason: null,
      commission_plan_id: planId,
      approved_by: operatorId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", affiliateId);

  if (error) return { ok: false, error: "That partner could not be approved." };

  await recordAudit({
    businessId: null,
    actorUserId: operatorId,
    actorType: "platform_admin",
    action: "affiliate.approved",
    entityType: "affiliate",
    entityId: affiliateId,
    metadata: { commission_plan_id: planId },
  });

  revalidatePath("/admin/affiliates");
  return { ok: true, message: "Partner approved." };
}

const decisionSchema = z.object({
  affiliateId: z.string().uuid(),
  reason: z.string().trim().min(4).max(500),
});

export async function rejectAffiliate(input: {
  affiliateId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.rejected", async (operator) => {
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) {
      // The reason is shown to the applicant, so it is required rather than
      // optional: "rejected" with no explanation generates a support ticket.
      return { ok: false, error: "Give a reason. The applicant will see it." };
    }

    const { error } = await createAdminClient()
      .from("affiliates")
      .update({ status: "REJECTED", status_reason: parsed.data.reason })
      .eq("id", parsed.data.affiliateId);

    if (error) return { ok: false, error: "That partner could not be updated." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.rejected",
      entityType: "affiliate",
      entityId: parsed.data.affiliateId,
      metadata: { reason: parsed.data.reason },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Application declined." };
  });
}

export async function suspendAffiliate(input: {
  affiliateId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.suspended", async (operator) => {
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Give a reason. The partner will see it." };
    }

    const { error } = await createAdminClient()
      .from("affiliates")
      .update({ status: "SUSPENDED", status_reason: parsed.data.reason })
      .eq("id", parsed.data.affiliateId);

    if (error) return { ok: false, error: "That partner could not be suspended." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.suspended",
      entityType: "affiliate",
      entityId: parsed.data.affiliateId,
      metadata: { reason: parsed.data.reason },
    });

    // Existing links stop tracking immediately: the click route re-reads the
    // partner's status on every request rather than trusting the link row.
    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Partner suspended. Their links stop tracking now." };
  });
}

export async function reinstateAffiliate(input: {
  affiliateId: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.approved", async (operator) => {
    const parsed = z.string().uuid().safeParse(input.affiliateId);
    if (!parsed.success) return { ok: false, error: "That partner is not valid." };

    const { error } = await createAdminClient()
      .from("affiliates")
      .update({ status: "ACTIVE", status_reason: null })
      .eq("id", parsed.data)
      .eq("status", "SUSPENDED");

    if (error) return { ok: false, error: "That partner could not be reinstated." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.approved",
      entityType: "affiliate",
      entityId: parsed.data,
      metadata: { reinstated: true },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Partner reinstated." };
  });
}

/* -------------------------------------------------------------- commissions */

export async function approveCommission(input: {
  commissionId: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.commission_approved", async (operator) => {
    const parsed = z.string().uuid().safeParse(input.commissionId);
    if (!parsed.success) return { ok: false, error: "That commission is not valid." };

    const db = createAdminClient();

    // Scoped to PENDING so approving twice is a no-op rather than a way to
    // resurrect a commission that was later reversed.
    const { data: updated, error } = await db
      .from("affiliate_commissions")
      .update({
        status: "APPROVED",
        approved_by: operator.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", parsed.data)
      .eq("status", "PENDING")
      .select("id");

    if (error) return { ok: false, error: "That commission could not be approved." };
    if (!updated || updated.length === 0) {
      return { ok: false, error: "That commission is no longer pending." };
    }

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.commission_approved",
      entityType: "affiliate_commission",
      entityId: parsed.data,
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Commission approved." };
  });
}

export async function reverseCommission(input: {
  commissionId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.commission_rejected", async (operator) => {
    const parsed = z
      .object({
        commissionId: z.string().uuid(),
        reason: z.string().trim().min(4).max(300),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Give a reason. The partner will see it." };
    }

    const db = createAdminClient();

    // A commission already inside a payout cannot be reversed here: the money
    // has been committed to a batch, and unpicking it silently would make the
    // payout total disagree with its own line items.
    const { data: commission } = await db
      .from("affiliate_commissions")
      .select("id, status, payout_id")
      .eq("id", parsed.data.commissionId)
      .maybeSingle();

    if (!commission) return { ok: false, error: "That commission no longer exists." };
    if (commission.status === "PAID" || commission.payout_id) {
      return {
        ok: false,
        error: "This commission is already in a payout. Handle it as an adjustment instead.",
      };
    }

    const { error } = await db
      .from("affiliate_commissions")
      .update({
        status: "REVERSED",
        reversal_reason: parsed.data.reason,
        reversed_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.commissionId);

    if (error) return { ok: false, error: "That commission could not be reversed." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.commission_rejected",
      entityType: "affiliate_commission",
      entityId: parsed.data.commissionId,
      metadata: { reason: parsed.data.reason },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Commission reversed." };
  });
}

/* ------------------------------------------------------------------ payouts */

/**
 * Records that a payout has been sent.
 *
 * This does not send money. A person makes the transfer and then marks it here,
 * which is why the external reference is required: without it there is no way
 * to reconcile our record against the bank's.
 */
export async function markPayoutPaid(input: {
  payoutId: string;
  externalReference: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.payout_marked_paid", async (operator) => {
    const parsed = z
      .object({
        payoutId: z.string().uuid(),
        externalReference: z.string().trim().min(3).max(120),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Enter the payment reference from your bank." };
    }

    const db = createAdminClient();
    const paidAt = new Date().toISOString();

    // Anything already PAID is left alone, so a second submission cannot
    // rewrite the paid date or the reference on a settled payout.
    const { data: updated, error } = await db
      .from("affiliate_payouts")
      .update({
        status: "PAID",
        external_reference: parsed.data.externalReference,
        paid_at: paidAt,
      })
      .eq("id", parsed.data.payoutId)
      .in("status", ["APPROVED", "PROCESSING"])
      .select("id");

    if (error) return { ok: false, error: "That payout could not be updated." };
    if (!updated || updated.length === 0) {
      return {
        ok: false,
        error: "That payout is not awaiting payment. Refresh and check its status.",
      };
    }

    // The commissions in the batch settle with it.
    await db
      .from("affiliate_commissions")
      .update({ status: "PAID", paid_at: paidAt })
      .eq("payout_id", parsed.data.payoutId)
      .neq("status", "REVERSED");

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.payout_marked_paid",
      entityType: "affiliate_payout",
      entityId: parsed.data.payoutId,
      metadata: { external_reference: parsed.data.externalReference },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Payout marked as paid." };
  });
}
