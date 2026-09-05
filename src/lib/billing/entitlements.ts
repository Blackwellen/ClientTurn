import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRIAL_ENTITLEMENTS } from "./plans";

export type Entitlements = {
  plan: string;
  status: string;
  leadLimit: number;
  userLimit: number;
  whatsappEnabled: boolean;
  campaignsEnabled: boolean;
  aiAssistAllowed: boolean;
  /** Subscription permits work to happen at all. */
  active: boolean;
  periodStart: string | null;
  periodEnd: string | null;
};

export type EntitlementFeature =
  | "whatsapp"
  | "campaigns"
  | "ai_assist";

const ACTIVE_STATUSES = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

export async function getEntitlements(
  businessId: string,
): Promise<Entitlements> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) {
    return {
      plan: "trial",
      status: "TRIALING",
      leadLimit: TRIAL_ENTITLEMENTS.leadLimit,
      userLimit: TRIAL_ENTITLEMENTS.userLimit,
      whatsappEnabled: TRIAL_ENTITLEMENTS.whatsappEnabled,
      campaignsEnabled: TRIAL_ENTITLEMENTS.campaignsEnabled,
      aiAssistAllowed: TRIAL_ENTITLEMENTS.aiAssistAllowed,
      active: true,
      periodStart: null,
      periodEnd: null,
    };
  }

  return {
    plan: data.plan,
    status: data.status,
    leadLimit: data.lead_limit,
    userLimit: data.user_limit,
    whatsappEnabled: data.whatsapp_enabled,
    campaignsEnabled: data.campaigns_enabled,
    aiAssistAllowed: data.ai_assist_allowed,
    active: ACTIVE_STATUSES.has(data.status),
    periodStart: data.current_period_start,
    periodEnd: data.current_period_end,
  };
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
  constructor(
    message: string,
    readonly code: "PLAN_LIMIT" | "FEATURE_LOCKED" | "SUBSCRIPTION_INACTIVE",
  ) {
    super(message);
    this.name = "EntitlementError";
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
    throw new EntitlementError(
      "This workspace does not have an active subscription.",
      "SUBSCRIPTION_INACTIVE",
    );
  }

  if (feature === "whatsapp" && !entitlements.whatsappEnabled) {
    throw new EntitlementError(
      "WhatsApp is available on the Growth plan and above.",
      "FEATURE_LOCKED",
    );
  }
  if (feature === "campaigns" && !entitlements.campaignsEnabled) {
    throw new EntitlementError(
      "Reactivation campaigns are available on the Growth plan and above.",
      "FEATURE_LOCKED",
    );
  }
  if (feature === "ai_assist" && !entitlements.aiAssistAllowed) {
    throw new EntitlementError(
      "AI assist is available on the Growth plan and above.",
      "FEATURE_LOCKED",
    );
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
