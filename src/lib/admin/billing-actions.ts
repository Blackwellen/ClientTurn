"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { stripe, priceIdFor } from "@/lib/billing/stripe";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * Admin → Billing writes (V4 §45).
 *
 * The architecture rule that shapes every function here: **Stripe is changed,
 * and the webhook updates our mirror.** Nothing in this file writes `plan`,
 * `status` or `current_period_end` on the `subscriptions` row directly. If it
 * did, an admin action and a Stripe event could disagree, and the mirror would
 * quietly stop being a mirror.
 *
 * The two exceptions are deliberate and are not Stripe's business: temporary
 * entitlement grants, and the internal credit ledger that records *why* a
 * Stripe credit was issued.
 */

const subscriptionRef = z.object({ subscriptionId: z.string().uuid() });

async function loadSubscription(subscriptionId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("subscriptions")
    .select(
      "id, business_id, plan, status, billing_interval, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, current_period_end, trial_ends_at",
    )
    .eq("id", subscriptionId)
    .maybeSingle();
  return { db, subscription: data };
}

/* ------------------------------------------------------------ plan change --- */

export async function changePlan(input: {
  subscriptionId: string;
  plan: string;
  interval?: "month" | "year";
}): Promise<AdminActionResult> {
  return guarded("admin.plan_changed", async (operator) => {
    const parsed = subscriptionRef
      .extend({
        plan: z.enum(["starter", "growth", "pro", "enterprise"]),
        interval: z.enum(["month", "year"]).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Choose a valid plan." };

    const { subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };

    if (!subscription.stripe_subscription_id) {
      return {
        ok: false,
        error:
          "This workspace has no Stripe subscription yet. It must complete checkout before a plan can be changed.",
      };
    }
    if (subscription.status === "CANCELLED") {
      return {
        ok: false,
        error: "A cancelled subscription cannot be moved to another plan.",
      };
    }
    if (subscription.plan === parsed.data.plan) {
      return { ok: false, error: `This workspace is already on ${PLANS[parsed.data.plan as Exclude<PlanId, "trial">].name}.` };
    }

    const interval =
      parsed.data.interval ??
      ((subscription.billing_interval as "month" | "year" | null) ?? "month");
    const priceId = priceIdFor(parsed.data.plan as PlanId, interval);
    if (!priceId) {
      return {
        ok: false,
        error: `No Stripe price is configured for ${parsed.data.plan} (${interval}).`,
      };
    }

    try {
      // Re-read Stripe rather than trusting the mirror: the item id has to come
      // from the live subscription, and a subscription cancelled at Stripe but
      // not yet mirrored must not be "upgraded".
      const live = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
      );
      if (live.status === "canceled" || live.status === "incomplete_expired") {
        return {
          ok: false,
          error:
            "Stripe reports this subscription as no longer active. Refresh before making a change.",
        };
      }

      const item = live.items.data[0];
      if (!item) return { ok: false, error: "That Stripe subscription has no price to change." };

      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        items: [{ id: item.id, price: priceId }],
        // Proration is what makes an upgrade fair mid-period, and Stripe is the
        // only thing that can compute it correctly.
        proration_behavior: "create_prorations",
        metadata: {
          changed_by: "platform_admin",
          changed_by_user: operator.id,
        },
      });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Stripe rejected the change: ${error.message}`
            : "Stripe rejected the plan change.",
      };
    }

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.plan_changed",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: {
        from: subscription.plan,
        to: parsed.data.plan,
        interval,
        summary: `Plan changed from ${subscription.plan} to ${parsed.data.plan}`,
      },
    });

    revalidatePath("/admin/billing");
    return {
      ok: true,
      message:
        "Plan changed in Stripe. Entitlements update as soon as the subscription webhook lands.",
    };
  });
}

/* --------------------------------------------------------- cancellation --- */

export async function cancelAtPeriodEnd(input: {
  subscriptionId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("admin.subscription_cancelled_at_period_end", async (operator) => {
    const parsed = subscriptionRef
      .extend({ reason: z.string().trim().min(5).max(500) })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Record why this subscription is being cancelled." };
    }

    const { subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };
    if (!subscription.stripe_subscription_id) {
      return { ok: false, error: "This workspace has no Stripe subscription to cancel." };
    }
    if (subscription.cancel_at_period_end) {
      return { ok: false, error: "This subscription is already set to cancel." };
    }

    let effectiveOn: string | null = null;
    try {
      const updated = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        {
          // Never `cancel()`: the customer has paid for the period they are in.
          cancel_at_period_end: true,
          metadata: { cancelled_by: "platform_admin", cancelled_by_user: operator.id },
        },
      );
      const periodEnd = (updated as { current_period_end?: number }).current_period_end;
      effectiveOn = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Stripe rejected the cancellation: ${error.message}`
            : "Stripe rejected the cancellation.",
      };
    }

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.subscription_cancelled_at_period_end",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: {
        reason: parsed.data.reason,
        effective_on: effectiveOn,
        summary: "Set to cancel at period end",
      },
    });

    revalidatePath("/admin/billing");
    return {
      ok: true,
      message: effectiveOn
        ? `Set to cancel on ${new Date(effectiveOn).toLocaleDateString("en-GB")}. Access continues until then.`
        : "Set to cancel at the end of the current period.",
    };
  });
}

export async function revertCancellation(input: {
  subscriptionId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.subscription_cancellation_reverted", async (operator) => {
    const parsed = subscriptionRef.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That subscription reference is not valid." };

    const { subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };
    if (!subscription.stripe_subscription_id) {
      return { ok: false, error: "This workspace has no Stripe subscription." };
    }
    if (!subscription.cancel_at_period_end) {
      return { ok: false, error: "This subscription is not scheduled to cancel." };
    }

    try {
      const live = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
      );
      // Once the period has actually ended, Stripe has closed it and there is
      // nothing to un-cancel — a new checkout is the only way back.
      if (live.status === "canceled") {
        return {
          ok: false,
          error:
            "This subscription has already ended at Stripe. The customer needs to subscribe again.",
        };
      }
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Stripe rejected the change: ${error.message}`
            : "Stripe rejected the change.",
      };
    }

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.subscription_cancellation_reverted",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { summary: "Scheduled cancellation removed" },
    });

    revalidatePath("/admin/billing");
    return { ok: true, message: "Cancellation removed. The subscription will renew as normal." };
  });
}

/* ------------------------------------------------------------- credits --- */

export async function applyAccountCredit(input: {
  subscriptionId: string;
  amount: number;
  reason: string;
  supportReference?: string;
}): Promise<AdminActionResult> {
  return guarded("admin.credit_applied", async (operator) => {
    const parsed = subscriptionRef
      .extend({
        // Bounded: an admin screen should not be able to issue an unlimited
        // credit by mistyping a figure.
        amount: z.number().positive().max(10_000),
        reason: z.string().trim().min(5).max(500),
        supportReference: z.string().trim().max(60).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Enter an amount up to £10,000 and a reason." };
    }

    const { db, subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };
    if (!subscription.stripe_customer_id) {
      return {
        ok: false,
        error: "This workspace has no Stripe customer, so a credit has nowhere to land.",
      };
    }

    const amountMinor = Math.round(parsed.data.amount * 100);

    // Record the intent first, so a Stripe call that succeeds but whose
    // response is lost still leaves a trace an operator can reconcile.
    const { data: entry, error: insertError } = await db
      .from("billing_credit_entries")
      .insert({
        business_id: subscription.business_id,
        entry_type: "CREDIT",
        amount_minor: amountMinor,
        currency: "GBP",
        reason: parsed.data.reason,
        support_reference: parsed.data.supportReference ?? null,
        state: "PENDING",
        created_by: operator.id,
        created_by_email: operator.email,
      })
      .select("id")
      .single();

    if (insertError || !entry) {
      return { ok: false, error: "The credit could not be recorded." };
    }

    try {
      const transaction = await stripe.customers.createBalanceTransaction(
        subscription.stripe_customer_id,
        {
          // Negative reduces what the customer owes — that is what a credit is.
          amount: -amountMinor,
          currency: "gbp",
          description: parsed.data.reason,
        },
      );

      await db
        .from("billing_credit_entries")
        .update({ state: "APPLIED", stripe_balance_transaction_id: transaction.id })
        .eq("id", entry.id);
    } catch (error) {
      await db
        .from("billing_credit_entries")
        .update({
          state: "FAILED",
          failure_reason:
            error instanceof Error ? error.message.slice(0, 500) : "Stripe rejected the credit",
        })
        .eq("id", entry.id);

      return {
        ok: false,
        error:
          error instanceof Error
            ? `Stripe rejected the credit: ${error.message}`
            : "Stripe rejected the credit.",
      };
    }

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.credit_applied",
      entityType: "billing_credit_entry",
      entityId: entry.id,
      metadata: {
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        support_reference: parsed.data.supportReference ?? null,
        summary: `Applied a £${parsed.data.amount.toFixed(2)} credit`,
      },
    });

    revalidatePath("/admin/billing");
    return { ok: true, message: `£${parsed.data.amount.toFixed(2)} credit applied.` };
  });
}

/**
 * Reverses a credit by posting the opposite entry. The original row is never
 * updated or deleted — a financial ledger that can be edited is not a ledger.
 */
export async function reverseCredit(input: {
  entryId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("admin.credit_reversed", async (operator) => {
    const parsed = z
      .object({
        entryId: z.string().uuid(),
        reason: z.string().trim().min(5).max(500),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Record why this credit is being reversed." };

    const db = createAdminClient();
    const { data: original } = await db
      .from("billing_credit_entries")
      .select("id, business_id, amount_minor, currency, state, entry_type")
      .eq("id", parsed.data.entryId)
      .maybeSingle();

    if (!original) return { ok: false, error: "That ledger entry no longer exists." };
    if (original.state !== "APPLIED") {
      return { ok: false, error: "Only an applied entry can be reversed." };
    }
    if (original.entry_type === "REVERSAL") {
      return { ok: false, error: "A reversal cannot itself be reversed." };
    }

    const { data: existing } = await db
      .from("billing_credit_entries")
      .select("id")
      .eq("reverses_entry_id", original.id)
      .maybeSingle();
    if (existing) {
      return { ok: false, error: "This entry has already been reversed." };
    }

    const { data: subscription } = await db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", original.business_id)
      .maybeSingle();

    if (!subscription?.stripe_customer_id) {
      return { ok: false, error: "This workspace has no Stripe customer to reverse against." };
    }

    let transactionId: string | null = null;
    try {
      const transaction = await stripe.customers.createBalanceTransaction(
        subscription.stripe_customer_id,
        {
          amount: Number(original.amount_minor),
          currency: original.currency.toLowerCase(),
          description: `Reversal: ${parsed.data.reason}`,
        },
      );
      transactionId = transaction.id;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Stripe rejected the reversal: ${error.message}`
            : "Stripe rejected the reversal.",
      };
    }

    await db.from("billing_credit_entries").insert({
      business_id: original.business_id,
      entry_type: "REVERSAL",
      amount_minor: original.amount_minor,
      currency: original.currency,
      reason: parsed.data.reason,
      state: "APPLIED",
      stripe_balance_transaction_id: transactionId,
      reverses_entry_id: original.id,
      created_by: operator.id,
      created_by_email: operator.email,
    });

    await recordAudit({
      businessId: original.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.credit_reversed",
      entityType: "billing_credit_entry",
      entityId: original.id,
      metadata: {
        reason: parsed.data.reason,
        summary: `Reversed a £${(Number(original.amount_minor) / 100).toFixed(2)} credit`,
      },
    });

    revalidatePath("/admin/billing");
    return { ok: true, message: "Credit reversed and recorded." };
  });
}

/* -------------------------------------------------------- entitlements --- */

export async function grantEntitlement(input: {
  subscriptionId: string;
  key: string;
  numericValue?: number;
  booleanValue?: boolean;
  reason: string;
  /** ISO date. Required — a temporary grant with no end is a permanent one. */
  expiresAt: string;
}): Promise<AdminActionResult> {
  return guarded("admin.entitlement_granted", async (operator) => {
    const parsed = subscriptionRef
      .extend({
        key: z.string().trim().min(2).max(60),
        numericValue: z.number().min(0).max(10_000_000).optional(),
        booleanValue: z.boolean().optional(),
        reason: z.string().trim().min(5).max(500),
        expiresAt: z.string().min(4),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Choose an entitlement, a value, a reason and an expiry." };
    }
    if (parsed.data.numericValue === undefined && parsed.data.booleanValue === undefined) {
      return { ok: false, error: "Give the entitlement a value." };
    }

    const expires = new Date(parsed.data.expiresAt);
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
      return { ok: false, error: "The expiry must be in the future." };
    }
    // A "temporary" grant lasting a year is a plan change wearing a disguise.
    if (expires.getTime() - Date.now() > 180 * 86_400_000) {
      return {
        ok: false,
        error: "A temporary grant may run for at most 180 days. Change the plan instead.",
      };
    }

    const { db, subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };

    const { error } = await db.from("business_entitlement_grants").upsert(
      {
        business_id: subscription.business_id,
        entitlement_key: parsed.data.key,
        numeric_value: parsed.data.numericValue ?? null,
        boolean_value: parsed.data.booleanValue ?? null,
        reason: parsed.data.reason,
        granted_by: operator.id,
        granted_at: new Date().toISOString(),
        expires_at: expires.toISOString(),
        revoked_at: null,
      },
      { onConflict: "business_id,entitlement_key" },
    );

    if (error) return { ok: false, error: "The entitlement could not be granted." };

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.entitlement_granted",
      entityType: "business_entitlement_grant",
      metadata: {
        key: parsed.data.key,
        value: parsed.data.numericValue ?? parsed.data.booleanValue,
        expires_at: expires.toISOString(),
        reason: parsed.data.reason,
        summary: `Granted ${parsed.data.key} until ${expires.toISOString().slice(0, 10)}`,
      },
    });

    revalidatePath("/admin/billing");
    return {
      ok: true,
      message: `Granted until ${expires.toLocaleDateString("en-GB")}. It expires automatically.`,
    };
  });
}

export async function revokeEntitlement(input: {
  grantId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.entitlement_revoked", async (operator) => {
    const parsed = z.object({ grantId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That grant reference is not valid." };

    const db = createAdminClient();
    const { data, error } = await db
      .from("business_entitlement_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", parsed.data.grantId)
      .is("revoked_at", null)
      .select("id, business_id, entitlement_key")
      .maybeSingle();

    if (error || !data) {
      return { ok: false, error: "That grant no longer exists, or was already revoked." };
    }

    await recordAudit({
      businessId: data.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.entitlement_revoked",
      entityType: "business_entitlement_grant",
      entityId: data.id,
      metadata: {
        key: data.entitlement_key,
        summary: `Revoked ${data.entitlement_key}`,
      },
    });

    revalidatePath("/admin/billing");
    return { ok: true, message: "Entitlement revoked." };
  });
}

/* ------------------------------------------------------ trial extension --- */

export async function extendTrial(input: {
  subscriptionId: string;
  trialEndsAt: string;
  reason: string;
  supportReference?: string;
}): Promise<AdminActionResult> {
  return guarded("admin.trial_extended", async (operator) => {
    const parsed = subscriptionRef
      .extend({
        trialEndsAt: z.string().min(4),
        reason: z.string().trim().min(5).max(500),
        supportReference: z.string().trim().max(60).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Choose a new trial end date and record why." };
    }

    const newEnd = new Date(parsed.data.trialEndsAt);
    if (Number.isNaN(newEnd.getTime()) || newEnd.getTime() <= Date.now()) {
      return { ok: false, error: "The new trial end must be in the future." };
    }
    if (newEnd.getTime() - Date.now() > 90 * 86_400_000) {
      return { ok: false, error: "A trial may be extended by at most 90 days at a time." };
    }

    const { db, subscription } = await loadSubscription(parsed.data.subscriptionId);
    if (!subscription) return { ok: false, error: "That subscription no longer exists." };
    if (subscription.status !== "TRIALING") {
      return {
        ok: false,
        error: "Only a workspace still on trial can have its trial extended.",
      };
    }
    if (
      subscription.trial_ends_at &&
      new Date(subscription.trial_ends_at).getTime() >= newEnd.getTime()
    ) {
      return { ok: false, error: "The new date must be later than the current trial end." };
    }

    // A trial that Stripe knows about must be moved at Stripe; a pre-checkout
    // trial exists only in our mirror, so that is where it is extended.
    if (subscription.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          trial_end: Math.floor(newEnd.getTime() / 1000),
          proration_behavior: "none",
        });
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? `Stripe rejected the extension: ${error.message}`
              : "Stripe rejected the extension.",
        };
      }
    } else {
      await db
        .from("subscriptions")
        .update({ trial_ends_at: newEnd.toISOString() })
        .eq("id", subscription.id)
        .eq("status", "TRIALING");
    }

    await recordAudit({
      businessId: subscription.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.trial_extended",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: {
        from: subscription.trial_ends_at,
        to: newEnd.toISOString(),
        reason: parsed.data.reason,
        support_reference: parsed.data.supportReference ?? null,
        summary: `Trial extended to ${newEnd.toISOString().slice(0, 10)}`,
      },
    });

    revalidatePath("/admin/billing");
    return {
      ok: true,
      message: `Trial extended to ${newEnd.toLocaleDateString("en-GB")}.`,
    };
  });
}
