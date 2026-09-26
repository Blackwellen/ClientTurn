import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { planThatUnlocks } from "./plans";
import {
  deriveEntitlements,
  type BillingAccess,
  type DunningLike,
  type LifecycleState,
  type SubscriptionRowLike,
} from "./lifecycle";

export type Entitlements = {
  /** The plan key limits resolve against: "trial" while trialling. */
  plan: string;
  /** The tier chosen at checkout (differs from `plan` during a trial). */
  selectedPlan: string;
  status: string;
  /** Where the subscription is in its lifecycle (see lifecycle.ts). */
  state: LifecycleState;
  access: BillingAccess;
  leadLimit: number;
  userLimit: number;
  whatsappEnabled: boolean;
  campaignsEnabled: boolean;
  aiAssistAllowed: boolean;
  /** Subscription permits billable work to happen at all. */
  active: boolean;
  /** Outbound sending permitted right now (false in a dunning pause). */
  sendingAllowed: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  trialEndsAt: string | null;
};

export type EntitlementFeature =
  | "whatsapp"
  | "campaigns"
  | "ai_assist";

/**
 * The single read of what a workspace may do, derived by the pure lifecycle
 * rules: a trial ends on its date, a failed payment moves through the grace
 * policy, and a workspace that never went through Checkout gets nothing.
 *
 * A read failure throws rather than answering. Answering "no subscription"
 * would lock a paying workspace out on a blip, and answering "active" would
 * give the product away; neither is a safe default for a billing read.
 */
export async function getEntitlements(
  businessId: string,
): Promise<Entitlements> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "plan, status, trial_ends_at, stripe_subscription_id, current_period_start, current_period_end, lead_limit, user_limit, whatsapp_enabled, campaigns_enabled, ai_assist_allowed",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the subscription: ${error.message}`);

  let dunning: DunningLike | null = null;
  if (data && (data.status === "PAST_DUE" || data.status === "UNPAID")) {
    // billing_dunning (0129) post-dates the generated types.
    const dunningRead = await (supabase as unknown as SupabaseClient)
      .from("billing_dunning")
      .select("status, first_failed_at, attempts, last_attempt_on")
      .eq("business_id", businessId)
      .order("first_failed_at", { ascending: true })
      .in("status", ["OPEN", "EXHAUSTED"])
      .limit(1)
      .maybeSingle();
    if (dunningRead.error) {
      throw new Error(`Could not read the dunning state: ${dunningRead.error.message}`);
    }
    dunning = (dunningRead.data as DunningLike | null) ?? null;
  }

  return deriveEntitlements(data as SubscriptionRowLike | null, dunning, new Date());
}

/** Leads counted against the plan allowance in the current billing period. */
export async function getPeriodUsage(businessId: string, since: string | null) {
  const supabase = createAdminClient();
  const from = since ?? new Date(Date.now() - 30 * 864e5).toISOString();

  const [leads, messages] = await Promise.all([
    supabase
      .from("usage_events")
      .select("quantity")
      .eq("business_id", businessId)
      .eq("metric", "lead_processed")
      .gte("occurred_at", from),
    supabase
      .from("usage_events")
      .select("quantity")
      .eq("business_id", businessId)
      .in("metric", ["message_sent", "campaign_message"])
      .gte("occurred_at", from),
  ]);

  const sum = (rows: { quantity: number }[] | null) =>
    (rows ?? []).reduce((total, row) => total + Number(row.quantity), 0);

  return { leads: sum(leads.data), messages: sum(messages.data) };
}

export class EntitlementError extends Error {
  // Declared as a field rather than a constructor parameter property, matching
  // `ServiceError`: the test runner strips types without transforming them, and
  // a parameter property is a transform. Keeping this plain means the
  // end-to-end tests exercise the file that ships rather than a compiled
  // variant of it — and this module is on the path of every billable action, so
  // it is exactly the one worth testing for real.
  readonly code: "PLAN_LIMIT" | "FEATURE_LOCKED" | "SUBSCRIPTION_INACTIVE";

  constructor(
    message: string,
    code: "PLAN_LIMIT" | "FEATURE_LOCKED" | "SUBSCRIPTION_INACTIVE",
  ) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
  }
}

/**
 * The single gate every server path calls before doing billable work.
 * UI hiding is a courtesy; this is the enforcement.
 */
export async function assertEntitlement(
  businessId: string,
  feature?: EntitlementFeature,
): Promise<Entitlements> {
  const entitlements = await getEntitlements(businessId);

  if (!entitlements.active) {
    throw new EntitlementError(inactiveMessage(entitlements.state), "SUBSCRIPTION_INACTIVE");
  }

  if (feature === "whatsapp" && !entitlements.whatsappEnabled) {
    throw new EntitlementError(lockedMessage("WhatsApp", "whatsapp", entitlements.state), "FEATURE_LOCKED");
  }
  if (feature === "campaigns" && !entitlements.campaignsEnabled) {
    throw new EntitlementError(
      lockedMessage("Reactivation campaigns", "campaigns", entitlements.state),
      "FEATURE_LOCKED",
    );
  }
  if (feature === "ai_assist" && !entitlements.aiAssistAllowed) {
    throw new EntitlementError(lockedMessage("AI assist", "ai_assist", entitlements.state), "FEATURE_LOCKED");
  }

  return entitlements;
}

export async function assertLeadCapacity(businessId: string) {
  const entitlements = await assertEntitlement(businessId);
  const usage = await getPeriodUsage(businessId, entitlements.periodStart);

  if (usage.leads >= entitlements.leadLimit) {
    throw new EntitlementError(
      `Lead limit of ${entitlements.leadLimit} reached for this billing period.`,
      "PLAN_LIMIT",
    );
  }

  return { entitlements, usage };
}

/** Why billable work is refused, in words the owner can act on. */
export function inactiveMessage(state: LifecycleState): string {
  switch (state) {
    case "AWAITING_CARD":
      return "Start your free trial by adding a card before using this workspace.";
    case "TRIAL_EXPIRED":
      return "Your free trial has ended. Choose a plan to carry on.";
    case "PAST_DUE_RESTRICTED":
      return "Sending and AI are paused because the last payment failed. Update your card to resume.";
    case "CANCELLED":
      return "This subscription has ended, so the workspace is read-only. Resubscribe to carry on.";
    default:
      return "This workspace does not have an active subscription.";
  }
}

/**
 * A locked feature names the plan that unlocks it, read from the catalogue
 * rather than written into the sentence -- so repricing or re-tiering cannot
 * leave a message pointing at the wrong plan. During a trial the tier's
 * feature is locked by the trial, not the plan, and the message says so.
 */
export function lockedMessage(
  label: string,
  feature: EntitlementFeature,
  state: LifecycleState,
): string {
  if (state === "TRIALING") {
    return `${label} switches on when your trial converts to a paid plan that includes it.`;
  }
  const plan = planThatUnlocks(feature);
  return plan
    ? `${label} is available on the ${plan.name} plan and above.`
    : `${label} is not available on your plan.`;
}
