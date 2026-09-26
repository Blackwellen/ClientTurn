import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { TERMS_PATH, TERMS_VERSION } from "@/lib/marketing/terms-version";
import { stripe, priceIdFor, planForPriceId } from "./stripe";
import { PLANS, creditBundlesFor, messageCreditBundle, type PlanId } from "./plans";
import { getEntitlements } from "./entitlements";
import { trialOffer, type SubscriptionRowLike } from "./lifecycle";
import {
  decidePlanChange,
  downgradeSchedulePhases,
  pendingChangeFromSchedule,
  resolvePlanInterval,
  type PendingPlanChange,
} from "./plan-change";

/**
 * Stripe Checkout sessions, built server-side only.
 *
 * Card-first trial (8.10) is expressed entirely in one Checkout session, so no
 * SetupIntent flow of our own is needed:
 *
 *   mode: "subscription"                     -- the subscription exists from
 *                                               the start, in `trialing`
 *   subscription_data.trial_period_days      -- TRIAL.days (lifecycle.trialOffer)
 *   payment_method_collection: "always"      -- a card is required even though
 *                                               nothing is charged today;
 *                                               Stripe validates it with a
 *                                               SetupIntent before completing
 *   consent_collection.terms_of_service      -- Checkout will not complete
 *                                               without the terms box ticked;
 *                                               custom_text links OUR terms
 *   trial_settings.end_behavior              -- no card, no trial: cancel
 *     .missing_payment_method: "cancel"
 */

type Workspace = { businessId: string; userId: string };

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const SUBSCRIPTION_COLUMNS =
  "plan, status, trial_ends_at, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end, lead_limit, user_limit, whatsapp_enabled, campaigns_enabled, ai_assist_allowed";

type SubscriptionRow = SubscriptionRowLike & { stripe_customer_id: string | null };

async function readSubscription(businessId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await db()
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the subscription: ${error.message}`);
  return data as SubscriptionRow | null;
}

async function ownerEmail(userId: string): Promise<string | undefined> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return data?.email ?? undefined;
}

export type UrlOutcome = { ok: true; url: string } | { ok: false; error: string };

/** Subscriptions Stripe still considers live: a new Checkout would duplicate. */
const LIVE_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID"]);

/**
 * Checkout for a new subscription: the card-first trial for a new workspace,
 * or a straight subscription for one that has already had its trial.
 */
export async function createSubscriptionCheckout(
  workspace: Workspace,
  plan: Exclude<PlanId, "trial" | "enterprise">,
  interval: "month" | "year",
): Promise<UrlOutcome> {
  const priceId = priceIdFor(plan, interval);
  if (!priceId) {
    return {
      ok: false,
      error: `${PLANS[plan].name} is not available for self-serve checkout yet. Contact support and we will set it up.`,
    };
  }

  const row = await readSubscription(workspace.businessId);
  if (row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)) {
    return { ok: false, error: "This workspace already has a subscription. Change plan from Billing." };
  }

  const offer = trialOffer(row, new Date());
  const site = serverEnv.siteUrl.replace(/\/$/, "");

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: row?.stripe_customer_id ?? undefined,
    customer_email: row?.stripe_customer_id ? undefined : await ownerEmail(workspace.userId),
    client_reference_id: workspace.businessId,
    payment_method_collection: "always",
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message: `I agree to the [ClientTurn Terms of Service](${site}${TERMS_PATH}).${
          offer.kind === "trial_days"
            ? ` My card is charged when the ${offer.days}-day trial ends unless I cancel before then.`
            : ""
        }`,
      },
    },
    subscription_data: {
      metadata: { business_id: workspace.businessId },
      ...(offer.kind === "trial_days"
        ? {
            trial_period_days: offer.days,
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          }
        : {}),
    },
    metadata: {
      kind: "subscription",
      business_id: workspace.businessId,
      user_id: workspace.userId,
      plan,
      terms_version: TERMS_VERSION,
    },
    success_url: `${site}/start-trial?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/start-trial?checkout=cancelled`,
  };

  try {
    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) return { ok: false, error: "Could not start checkout. Try again." };

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.trial_checkout_started",
      entityType: "subscription",
      metadata: { plan, interval, trial: offer.kind === "trial_days" ? offer.days : 0 },
    });
    return { ok: true, url: session.url };
  } catch (error) {
    console.error("[checkout] subscription session failed", {
      businessId: workspace.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Could not start checkout. Try again." };
  }
}

/**
 * Moving between self-serve tiers on a live subscription, as terms §6.3
 * promises (decisions in `plan-change.ts`):
 *
 *   * upgrade    -- the price is swapped now and Stripe prorates the
 *                   difference for the rest of the term;
 *   * downgrade  -- a Subscription Schedule keeps the current price until the
 *                   period end, then moves to the lower one. The webhook
 *                   mirrors the plan when Stripe applies it;
 *   * in a trial -- swapped now with no prorations (nothing has been charged).
 *
 * The subscription keeps its billing interval: an annual customer upgrades to
 * the annual price. Never opens a second Checkout -- that used to create a
 * second, parallel subscription.
 */
export type PlanChangeOutcome =
  | { ok: true; changed: boolean; mode?: "immediate" | "scheduled"; effectiveAt?: string }
  | { ok: false; error: string; noLiveSubscription?: boolean };

export async function changeSubscriptionPlan(
  workspace: Workspace,
  plan: Exclude<PlanId, "trial" | "enterprise">,
): Promise<PlanChangeOutcome> {
  const row = await readSubscription(workspace.businessId);
  if (!row?.stripe_subscription_id || !LIVE_STATUSES.has(row.status)) {
    return { ok: false, error: "There is no live subscription to change.", noLiveSubscription: true };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const item = subscription.items.data[0];
    if (!item) return { ok: false, error: "The subscription has no plan to change." };

    const interval = resolvePlanInterval({ liveInterval: item.price.recurring?.interval });
    const priceId = priceIdFor(plan, interval);
    if (!priceId) {
      return {
        ok: false,
        error: `${PLANS[plan].name} is not available on ${interval === "year" ? "annual" : "monthly"} billing yet. Contact support and we will set it up.`,
      };
    }

    const currentPlan = planForPriceId(item.price.id);
    const scheduleId = idOfSchedule(subscription.schedule);
    const decision = decidePlanChange({
      currentPlan,
      targetPlan: plan,
      trialing: subscription.status === "trialing",
      currentPeriodEnd: item.current_period_end ?? null,
    });

    if (!decision) {
      return {
        ok: false,
        error: "The current billing period is not known yet, so the downgrade cannot be scheduled. Try again shortly.",
      };
    }

    if (decision.kind === "noop") {
      // Choosing the plan you are already on while a downgrade is pending
      // keeps it: the pending change is dropped.
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId);
        await auditPlanChange(workspace, { from: currentPlan, to: plan, interval, mode: "pending_cancelled" });
        return { ok: true, changed: true, mode: "immediate" };
      }
      return { ok: true, changed: false };
    }

    if (decision.kind === "immediate") {
      // A pending downgrade is superseded by a change made now.
      if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId);
      await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: decision.prorationBehavior,
        metadata: { business_id: workspace.businessId },
      });
      await auditPlanChange(workspace, { from: currentPlan, to: plan, interval, mode: decision.reason });
      return { ok: true, changed: true, mode: "immediate" };
    }

    // Downgrade at period end. An existing schedule (an earlier pending
    // downgrade) is reused; otherwise one is created from the subscription.
    const schedule = scheduleId
      ? await stripe.subscriptionSchedules.retrieve(scheduleId)
      : await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
    const nowUnix = Math.floor(Date.now() / 1000);
    const currentPhase =
      schedule.phases.find((phase) => phase.start_date <= nowUnix && phase.end_date > nowUnix) ??
      schedule.phases[0];
    await stripe.subscriptionSchedules.update(
      schedule.id,
      downgradeSchedulePhases({
        currentPriceId: item.price.id,
        targetPriceId: priceId,
        quantity: item.quantity ?? 1,
        currentPhaseStart: currentPhase?.start_date ?? item.current_period_start,
        currentPeriodEnd: decision.effectiveAt,
        interval,
        businessId: workspace.businessId,
      }),
    );
    const effectiveAt = new Date(decision.effectiveAt * 1000).toISOString();
    await auditPlanChange(workspace, { from: currentPlan, to: plan, interval, mode: "scheduled", effectiveAt });
    return { ok: true, changed: true, mode: "scheduled", effectiveAt };
  } catch (error) {
    console.error("[checkout] plan change failed", {
      businessId: workspace.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Could not change the plan. Try again or open the billing portal." };
  }
}

/** Drops a pending (scheduled) downgrade; the current plan simply renews. */
export async function cancelPendingPlanChange(
  workspace: Workspace,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const row = await readSubscription(workspace.businessId);
  if (!row?.stripe_subscription_id) return { ok: true, changed: false };
  try {
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const scheduleId = idOfSchedule(subscription.schedule);
    if (!scheduleId) return { ok: true, changed: false };
    await stripe.subscriptionSchedules.release(scheduleId);
    const price = subscription.items.data[0]?.price;
    const current = planForPriceId(price?.id);
    await auditPlanChange(workspace, {
      from: current,
      to: current,
      interval: price?.recurring?.interval ?? null,
      mode: "pending_cancelled",
    });
    return { ok: true, changed: true };
  } catch (error) {
    console.error("[checkout] cancel pending plan change failed", {
      businessId: workspace.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Could not cancel the scheduled change. Try again or open the billing portal." };
  }
}

/**
 * The downgrade waiting to apply at the period end, read from Stripe (the
 * source of truth) for the billing page. Null when there is none, or when
 * Stripe cannot be reached -- the page then shows the current plan only.
 */
export async function getPendingPlanChange(businessId: string): Promise<PendingPlanChange | null> {
  let row: SubscriptionRow | null;
  try {
    row = await readSubscription(businessId);
  } catch {
    return null;
  }
  if (!row?.stripe_subscription_id || !LIVE_STATUSES.has(row.status)) return null;
  try {
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
      expand: ["schedule"],
    });
    const schedule = subscription.schedule;
    if (!schedule || typeof schedule === "string") return null;
    return pendingChangeFromSchedule(
      schedule,
      planForPriceId(subscription.items.data[0]?.price.id),
      Math.floor(Date.now() / 1000),
      planForPriceId,
    );
  } catch {
    return null;
  }
}

function idOfSchedule(value: string | Stripe.SubscriptionSchedule | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function auditPlanChange(
  workspace: Workspace,
  metadata: { from: string; to: string; interval: string | null; mode: string; effectiveAt?: string },
) {
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "billing.plan_changed",
    entityType: "subscription",
    metadata,
  });
}

/** One-off Checkout for an SMS or WhatsApp credit bundle (8.9). */
export async function createCreditCheckout(workspace: Workspace, bundleKey: string): Promise<UrlOutcome> {
  const bundle = messageCreditBundle(bundleKey);
  if (!bundle) return { ok: false, error: "Choose a bundle to continue." };

  // Only credit the plan can spend. Read here, not trusted from the page.
  let whatsappEnabled: boolean;
  try {
    ({ whatsappEnabled } = await getEntitlements(workspace.businessId));
  } catch {
    return { ok: false, error: "Could not check your plan. Try again." };
  }
  if (!creditBundlesFor({ whatsappEnabled }).some((allowed) => allowed.key === bundle.key)) {
    return {
      ok: false,
      error: "WhatsApp is not included in your plan, so WhatsApp credit cannot be used. Upgrade to a plan with WhatsApp first.",
    };
  }

  const row = await readSubscription(workspace.businessId);
  const admin = db();

  // The purchase row exists before the session, so a webhook that beats this
  // function back still has something to attach to.
  const purchase = await admin
    .from("message_credit_purchases")
    .insert({
      business_id: workspace.businessId,
      bundle_key: bundle.key,
      channel: bundle.channel,
      credits: bundle.credits,
      amount_minor: Math.round(bundle.priceGbp * 100),
      currency: "GBP",
      status: "PENDING",
      purchased_by: workspace.userId,
    })
    .select("id")
    .single();
  if (purchase.error || !purchase.data) {
    return { ok: false, error: "Could not start the purchase. Try again." };
  }
  const purchaseId = (purchase.data as { id: string }).id;
  const site = serverEnv.siteUrl.replace(/\/$/, "");
  const label = bundle.channel === "sms" ? "UK SMS segment credits" : "WhatsApp message credits";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: Math.round(bundle.priceGbp * 100),
            product_data: {
              name: `ClientTurn: ${bundle.credits.toLocaleString("en-GB")} ${label}`,
            },
          },
        },
      ],
      customer: row?.stripe_customer_id ?? undefined,
      customer_email: row?.stripe_customer_id ? undefined : await ownerEmail(workspace.userId),
      client_reference_id: workspace.businessId,
      // Receipts for the history table: Stripe emails one and keeps it.
      invoice_creation: row?.stripe_customer_id ? { enabled: true } : undefined,
      metadata: {
        kind: "message_credits",
        business_id: workspace.businessId,
        purchase_id: purchaseId,
        bundle_key: bundle.key,
      },
      payment_intent_data: {
        metadata: { kind: "message_credits", business_id: workspace.businessId, purchase_id: purchaseId },
      },
      success_url: `${site}/app/settings?section=billing&credits=success`,
      cancel_url: `${site}/app/settings?section=billing&credits=cancelled`,
    });

    if (!session.url) throw new Error("no session url");
    logWriteError(
      await admin
        .from("message_credit_purchases")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", purchaseId),
      "credit checkout: record session id",
      { businessId: workspace.businessId, purchaseId },
    );
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.credits_purchase_started",
      entityType: "message_credit_purchase",
      entityId: purchaseId,
      metadata: { bundleKey: bundle.key, channel: bundle.channel, credits: bundle.credits },
    });
    return { ok: true, url: session.url };
  } catch {
    logWriteError(
      await admin.from("message_credit_purchases").update({ status: "FAILED" }).eq("id", purchaseId),
      "credit checkout: mark failed",
      { businessId: workspace.businessId, purchaseId },
    );
    return { ok: false, error: "Could not start checkout. Try again." };
  }
}

/** A Billing Portal session for the owner (update card, invoices, cancel). */
export async function createPortalSession(businessId: string, returnPath: string): Promise<UrlOutcome> {
  const row = await readSubscription(businessId);
  if (!row?.stripe_customer_id) {
    return { ok: false, error: "There is no billing account yet. Start your trial first." };
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${serverEnv.siteUrl.replace(/\/$/, "")}${returnPath}`,
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Could not open the billing portal. Try again." };
  }
}
