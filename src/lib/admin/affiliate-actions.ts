"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";
import { dispatchPayout, retryFailedPayout } from "@/lib/affiliates/dispatch";
import { closePartnership, reaccrueReferral, recordAdjustment } from "@/lib/affiliates/commissions";
import { approveDraftPayout, cancelPayout } from "@/lib/affiliates/payouts";
import { loadTiers, untypedDb } from "@/lib/affiliates/programme-settings";
import { measureAffiliate, recordTierChange } from "@/lib/affiliates/tiers";
import { isTierKey, MAX_TIER_PERCENT, MIN_TIER_PERCENT, validateTierEdit } from "@/lib/affiliates/tier-rules";
import { isSchemaMissing } from "@/lib/billing/stripe-events";

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

/**
 * Ends a partnership. Links stop tracking (the click route requires ACTIVE),
 * nothing more accrues, and a negative available balance is WRITTEN OFF, not
 * invoiced (owner decision 2026-09-28): one WRITE_OFF ledger entry nets it to
 * zero. Positive approved money is not touched here; pay it out first.
 */
export async function endPartnership(input: {
  affiliateId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.closed", async (operator) => {
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Give a reason. The partner will see it." };
    }
    const result = await closePartnership({
      affiliateId: parsed.data.affiliateId,
      actorUserId: operator.id,
      reason: parsed.data.reason,
    });
    if (!result.ok) return { ok: false, error: "That partnership could not be ended." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.closed",
      entityType: "affiliate",
      entityId: parsed.data.affiliateId,
      metadata: { reason: parsed.data.reason, writtenOffMinor: result.writtenOffMinor },
    });

    revalidatePath("/admin/affiliates");
    return {
      ok: true,
      message:
        result.writtenOffMinor > 0
          ? `Partnership ended. A negative balance of £${(result.writtenOffMinor / 100).toFixed(2)} was written off (not invoiced).`
          : "Partnership ended. Their links stop tracking now.",
    };
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

/* ------------------------------------------------------ payout dispatch */

/**
 * Sends an approved payout to the affiliate's connected Stripe account.
 *
 * Unlike `markPayoutPaid` above — which records that a person moved the money
 * by hand — this actually moves it. The two coexist because the programme
 * supports both: a bank transfer made manually is recorded, and a Connect
 * payout is sent.
 *
 * Everything that makes this safe lives in `dispatchPayout`: the payout status
 * is re-read and claimed atomically, readiness is re-checked at send time, and
 * Stripe is called with our payout id as its idempotency key. A double-click
 * here reaches Stripe once.
 */
export async function sendPayout(input: {
  payoutId: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.payout_processed", async (operator) => {
    const parsed = z
      .object({ payoutId: z.string().uuid() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "That payout is not valid." };

    const result = await dispatchPayout(parsed.data.payoutId);

    if (result.status === "sent") {
      await recordAudit({
        businessId: null,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "affiliate.payout_processed",
        entityType: "affiliate_payout",
        entityId: parsed.data.payoutId,
        metadata: {
          amountMinor: result.amountMinor,
          transferId: result.transferId,
          initiatedBy: "operator",
        },
      });
      revalidatePath("/admin/affiliates");
      return { ok: true, message: "Payout sent." };
    }

    if (result.status === "failed") {
      revalidatePath("/admin/affiliates");
      return {
        ok: false,
        error: `Stripe refused the transfer: ${result.reason} The commissions have been released back to the affiliate's balance.`,
      };
    }

    return { ok: false, error: SKIP_REASONS[result.reason] ?? skipFallback(result.reason) };
  });
}

/** Plain-English reasons a dispatch stopped before touching Stripe. */
const SKIP_REASONS: Record<string, string> = {
  not_found: "That payout no longer exists.",
  zero_amount: "That payout is for nothing, so there is nothing to send.",
  affiliate_missing: "That affiliate no longer exists.",
  affiliate_not_active: "That affiliate is not active, so payouts are on hold.",
  payouts_not_enabled:
    "Stripe has not enabled payouts on that affiliate's account yet.",
  identity_not_verified: "That affiliate's identity is not verified yet.",
  tax_not_provided: "That affiliate has not provided usable tax information.",
  already_processing: "That payout is already being sent.",
};

function skipFallback(reason: string): string {
  if (reason.startsWith("not_approved:")) {
    const status = reason.split(":")[1] ?? "unknown";
    return `That payout is ${status.toLowerCase()}, so it cannot be sent.`;
  }
  return "That payout could not be sent.";
}

/**
 * Puts a failed payout back in the queue.
 *
 * Its commissions were already released when it failed, so this only reopens
 * the payout row. Nothing is re-claimed and no money moves.
 */
export async function retryPayout(input: {
  payoutId: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.payout_scheduled", async (operator) => {
    const parsed = z.object({ payoutId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That payout is not valid." };

    const reopened = await retryFailedPayout(parsed.data.payoutId);
    if (!reopened) {
      return { ok: false, error: "Only a failed payout with commission still available can be retried. If nothing was available it has been cancelled." };
    }

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.payout_scheduled",
      entityType: "affiliate_payout",
      entityId: parsed.data.payoutId,
      metadata: { reopened: true },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Payout reopened with the current balance. Approve it to send." };
  });
}

/* ---------------------------------------------------------- adjustments */

/**
 * Writes a manual correction to an affiliate's ledger.
 *
 * This is the action `reverseCommission` points at when a commission is
 * already inside a payout. Rather than editing a historical entry — which
 * would falsify a statement the affiliate has already received — a new
 * ADJUSTMENT row is written and nets against future earnings.
 *
 * Amounts are in minor units and may be negative. The idempotency key is
 * derived from the operator, affiliate and reason, so a double-submitted form
 * writes one adjustment rather than two.
 */
export async function adjustAffiliateLedger(input: {
  affiliateId: string;
  amountMinor: number;
  reason: string;
  /**
   * A per-form-open id. A double-submit of the same form collides on it; a
   * genuinely new adjustment with the same wording does not (before, two
   * "Goodwill credit" adjustments months apart silently became one).
   */
  requestId?: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.commission_adjusted", async (operator) => {
    const parsed = z
      .object({
        affiliateId: z.string().uuid(),
        // Bounded either way: a slipped decimal point on an unbounded field is
        // a five-figure mistake, and £10,000 is far above any real correction.
        amountMinor: z
          .number()
          .int()
          .min(-1_000_000)
          .max(1_000_000)
          .refine((value) => value !== 0, "An adjustment of nothing does nothing."),
        reason: z.string().trim().min(4).max(300),
      })
      .safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message ??
          "Give an amount and a reason. The affiliate will see the reason.",
      };
    }

    const db = createAdminClient();
    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, commission_plan_id")
      .eq("id", parsed.data.affiliateId)
      .maybeSingle();

    if (!affiliate) return { ok: false, error: "That affiliate no longer exists." };

    const result = await recordAdjustment({
      affiliateId: affiliate.id,
      amountMinor: parsed.data.amountMinor,
      currency: "GBP",
      reason: parsed.data.reason,
      actorUserId: operator.id,
      idempotencyKey: input.requestId && /^[a-z0-9-]{8,64}$/i.test(input.requestId)
        ? `adjustment:${affiliate.id}:${input.requestId}`
        : `adjustment:${affiliate.id}:${operator.id}:${slug(parsed.data.reason)}:${parsed.data.amountMinor}:${new Date().toISOString().slice(0, 10)}`,
    });

    if (!result.ok) {
      return { ok: false, error: "That adjustment could not be recorded." };
    }

    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Adjustment recorded." };
  });
}

/** A stable key fragment from free text, so a resubmit collides on purpose. */
function slug(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------- payout approval (audit 17) */

/**
 * Approves one payout raised by the monthly run (DRAFT = pending approval).
 * Approval does not send money; Send (Stripe Connect) or Mark paid does.
 */
export async function approvePayout(input: { payoutId: string }): Promise<AdminActionResult> {
  return guarded("affiliate.payout_approved", async (operator) => {
    const parsed = z.object({ payoutId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That payout is not valid." };
    const approved = await approveDraftPayout({ payoutId: parsed.data.payoutId, actorUserId: operator.id });
    if (!approved) return { ok: false, error: "That payout is not waiting for approval. Refresh and check its status." };
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.payout_approved",
      entityType: "affiliate_payout",
      entityId: parsed.data.payoutId,
    });
    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Payout approved. It can now be sent." };
  });
}

/** Approves every payout in the current run that is waiting (bounded). */
export async function approvePayoutRun(): Promise<AdminActionResult> {
  return guarded("affiliate.payout_approved", async (operator) => {
    const { data } = await createAdminClient()
      .from("affiliate_payouts")
      .select("id")
      .eq("status", "DRAFT")
      .order("created_at", { ascending: true })
      .limit(200);
    let approved = 0;
    for (const row of data ?? []) {
      if (await approveDraftPayout({ payoutId: row.id, actorUserId: operator.id })) approved += 1;
    }
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.payout_approved",
      entityType: "affiliate_payout",
      metadata: { bulk: true, approved },
    });
    revalidatePath("/admin/affiliates");
    return approved > 0
      ? { ok: true, message: `${approved} payout${approved === 1 ? "" : "s"} approved.` }
      : { ok: false, error: "No payouts are waiting for approval." };
  });
}

export async function cancelPayoutAction(input: { payoutId: string; reason: string }): Promise<AdminActionResult> {
  return guarded("affiliate.payout_cancelled", async (operator) => {
    const parsed = z.object({ payoutId: z.string().uuid(), reason: z.string().trim().min(4).max(300) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Give a reason for cancelling." };
    const cancelled = await cancelPayout(parsed.data.payoutId);
    if (!cancelled) return { ok: false, error: "Only a payout that has not been sent can be cancelled." };
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.payout_cancelled",
      entityType: "affiliate_payout",
      entityId: parsed.data.payoutId,
      metadata: { reason: parsed.data.reason },
    });
    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Payout cancelled. Its commission is back in the partner's balance." };
  });
}

/* ----------------------------------------------------- fraud review queue */

/**
 * Decides a held or rejected referral.
 *
 * CLEAR: the signals were innocent. The hold is lifted, and every paid invoice
 * that was skipped while it was held is replayed from `billing_invoices`
 * (keyed on the invoice, so nothing accrues twice).
 * CONFIRM: not eligible. The referral is rejected and its unpaid commission
 * reversed; commission already paid is clawed back as a negative adjustment.
 */
export async function reviewReferralFlag(input: {
  referralId: string;
  decision: "CLEAR" | "CONFIRM";
  note: string;
}): Promise<AdminActionResult> {
  return guarded("affiliate.flag_reviewed", async (operator) => {
    const parsed = z
      .object({
        referralId: z.string().uuid(),
        decision: z.enum(["CLEAR", "CONFIRM"]),
        note: z.string().trim().min(4).max(500),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Add a short note explaining the decision." };

    const db = createAdminClient();
    const { data: referral } = await db
      .from("affiliate_referrals")
      .select("id, affiliate_id, business_id, paid_at, trial_at, flagged_reason")
      .eq("id", parsed.data.referralId)
      .maybeSingle();
    if (!referral) return { ok: false, error: "That referral no longer exists." };
    if (!referral.flagged_reason) return { ok: false, error: "That referral is not held for review." };

    const now = new Date().toISOString();
    await untypedDb()
      .from("affiliate_fraud_flags")
      .update({
        status: parsed.data.decision === "CLEAR" ? "CLEARED" : "CONFIRMED",
        reviewed_by: operator.id,
        reviewed_at: now,
        review_note: parsed.data.note,
      })
      .eq("referral_id", referral.id)
      .neq("severity", "INFO");

    let message: string;
    if (parsed.data.decision === "CLEAR") {
      await db
        .from("affiliate_referrals")
        .update({
          flagged_reason: null,
          status: referral.paid_at ? "PAID" : referral.trial_at ? "TRIALING" : "SIGNED_UP",
        })
        .eq("id", referral.id);
      const replayed = await reaccrueReferral(referral.business_id);
      message = replayed > 0
        ? `Cleared. ${replayed} paid invoice${replayed === 1 ? "" : "s"} now earn commission.`
        : "Cleared. Future payments earn commission as normal.";
    } else {
      await db.from("affiliate_referrals").update({ status: "REJECTED" }).eq("id", referral.id);
      const reversed = await reverseReferralForFraud(referral.id, operator.id);
      message = reversed > 0 ? `Confirmed. ${reversed} commission entr${reversed === 1 ? "y" : "ies"} reversed.` : "Confirmed. Nothing had accrued.";
    }

    await recordAudit({
      businessId: referral.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.flag_reviewed",
      entityType: "affiliate_referral",
      entityId: referral.id,
      metadata: { decision: parsed.data.decision, note: parsed.data.note, heldReason: referral.flagged_reason },
    });

    revalidatePath("/admin/affiliates");
    return { ok: true, message };
  });
}

async function reverseReferralForFraud(referralId: string, operatorId: string): Promise<number> {
  const db = createAdminClient();
  const { data: entries } = await db
    .from("affiliate_commissions")
    .select("id, affiliate_id, business_id, commission_plan_id, commission_amount_minor, currency, status, payout_id")
    .eq("referral_id", referralId)
    .in("entry_type", ["NEW_CUSTOMER", "RENEWAL"])
    .neq("status", "REVERSED");
  let count = 0;
  for (const entry of entries ?? []) {
    if ((entry.status === "PENDING" || entry.status === "APPROVED") && !entry.payout_id) {
      const { data } = await db
        .from("affiliate_commissions")
        .update({ status: "REVERSED", reversal_reason: "FRAUD", reversed_at: new Date().toISOString() })
        .eq("id", entry.id)
        .in("status", ["PENDING", "APPROVED"])
        .is("payout_id", null)
        .select("id");
      if (data && data.length > 0) count += 1;
      continue;
    }
    const { error } = await db.from("affiliate_commissions").insert({
      affiliate_id: entry.affiliate_id,
      referral_id: referralId,
      business_id: entry.business_id,
      commission_plan_id: entry.commission_plan_id,
      status: "APPROVED",
      entry_type: "REVERSAL",
      base_amount_minor: 0,
      commission_amount_minor: -Math.abs(entry.commission_amount_minor),
      currency: entry.currency,
      reversal_of_id: entry.id,
      reversal_reason: "FRAUD",
      idempotency_key: `fraud:${referralId}:${entry.id}`,
      available_at: new Date().toISOString(),
      metadata: { source_ref: `fraud:${referralId}`, reviewed_by: operatorId },
    });
    if (!error) count += 1;
  }
  return count;
}

/* ----------------------------------------------------------- tiers & settings */

const tierSchema = z.object({
  key: z.enum(["STANDARD", "PARTNER", "PREMIUM"]),
  name: z.string().trim().min(1).max(40),
  rank: z.number().int().min(0).max(10),
  // Paid referred customers in the last 12 months. There is no MRR
  // threshold and no recurring-months setting: commission is one-off and a
  // tier only sets its rate (owner decisions 2026-09-28, tier-rules.ts).
  minActiveCustomers: z.number().int().min(0).max(100000),
  commissionPercent: z.number().min(MIN_TIER_PERCENT).max(MAX_TIER_PERCENT).nullable(),
  description: z.string().trim().max(300).nullable(),
});

/** Edits the tier ladder. Validated as a whole: higher tiers need more and never pay less. */
export async function updateTiers(input: { tiers: unknown }): Promise<AdminActionResult> {
  return guarded("affiliate.tiers_updated", async (operator) => {
    const parsed = z.array(tierSchema).min(1).max(3).safeParse(input.tiers);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Those tiers are not valid." };
    const problems = validateTierEdit(parsed.data);
    if (problems.length > 0) return { ok: false, error: problems[0] };

    const { error } = await untypedDb()
      .from("affiliate_tiers")
      .upsert(
        parsed.data.map((tier) => ({
          key: tier.key,
          name: tier.name,
          rank: tier.rank,
          min_active_customers: tier.minActiveCustomers,
          // Kept columns, forced to their neutral values (0169).
          min_referred_mrr_minor: 0,
          commission_percent: tier.commissionPercent,
          recurring_months: 1,
          description: tier.description,
          updated_by: operator.id,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "key" },
      );
    if (error) {
      return { ok: false, error: isSchemaMissing(error) ? "Tiers need migration 0166 applied first." : "The tiers could not be saved." };
    }
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.tiers_updated",
      entityType: "affiliate_tiers",
      metadata: { tiers: parsed.data },
    });
    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Tiers saved. They apply to commission earned from now on and at the next recalculation." };
  });
}

/** Puts a partner on a tier by hand, optionally locking them there. */
export async function setAffiliateTier(input: {
  affiliateId: string;
  tier: string;
  lock: boolean;
}): Promise<AdminActionResult> {
  return guarded("affiliate.tier_changed", async (operator) => {
    const parsed = z
      .object({ affiliateId: z.string().uuid(), tier: z.enum(["STANDARD", "PARTNER", "PREMIUM"]), lock: z.boolean() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "That tier is not valid." };

    const db = untypedDb();
    const { data: current, error: readError } = await db
      .from("affiliates")
      .select("tier, tier_locked")
      .eq("id", parsed.data.affiliateId)
      .maybeSingle();
    if (readError) return { ok: false, error: isSchemaMissing(readError) ? "Tier overrides need migration 0166 applied first." : "That partner could not be read." };
    if (!current) return { ok: false, error: "That partner no longer exists." };

    const { error } = await db
      .from("affiliates")
      .update({ tier: parsed.data.tier, tier_locked: parsed.data.lock })
      .eq("id", parsed.data.affiliateId);
    if (error) return { ok: false, error: "The tier could not be changed." };

    const from = (current as { tier: string }).tier;
    if (from !== parsed.data.tier || !parsed.data.lock) {
      const { metrics } = await measureAffiliate(parsed.data.affiliateId);
      await recordTierChange({
        affiliateId: parsed.data.affiliateId,
        from: isTierKey(from) ? from : null,
        to: parsed.data.tier,
        metrics,
        reason: parsed.data.lock ? "ADMIN_OVERRIDE" : "ADMIN_UNLOCK",
        actorUserId: operator.id,
        tiers: await loadTiers(),
      });
    }
    revalidatePath("/admin/affiliates");
    return { ok: true, message: parsed.data.lock ? "Tier set and locked." : "Tier set. It will follow the thresholds again." };
  });
}

/** The two payout automation switches. Both off by default. */
export async function updateProgrammeSettings(input: {
  autoApprovePayouts: boolean;
  autoDispatchPayouts: boolean;
}): Promise<AdminActionResult> {
  return guarded("affiliate.settings_changed", async (operator) => {
    const parsed = z.object({ autoApprovePayouts: z.boolean(), autoDispatchPayouts: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those settings are not valid." };
    // Auto-sending without auto-approval would never fire; refuse the confusing combination.
    if (parsed.data.autoDispatchPayouts && !parsed.data.autoApprovePayouts) {
      return { ok: false, error: "Automatic sending needs automatic approval on too." };
    }
    const { error } = await untypedDb()
      .from("affiliate_programme_settings")
      .upsert({
        id: true,
        auto_approve_payouts: parsed.data.autoApprovePayouts,
        auto_dispatch_payouts: parsed.data.autoDispatchPayouts,
        updated_by: operator.id,
        updated_at: new Date().toISOString(),
      });
    if (error) {
      return { ok: false, error: isSchemaMissing(error) ? "Settings need migration 0166 applied first." : "The settings could not be saved." };
    }
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "affiliate.settings_changed",
      entityType: "affiliate_programme_settings",
      metadata: parsed.data,
    });
    revalidatePath("/admin/affiliates");
    return { ok: true, message: "Programme settings saved." };
  });
}
