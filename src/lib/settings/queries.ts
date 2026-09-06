import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements, getPeriodUsage } from "@/lib/billing/entitlements";
import { PLANS, TRIAL_ENTITLEMENTS, type PlanId } from "@/lib/billing/plans";
import { createDownloadUrl } from "@/lib/storage/r2";
import {
  parseBusinessHours,
  trimTime,
  type BillingView,
  type BookingSettings,
  type BusinessProfile,
  type BusinessRole,
  type MessagingSettings,
  type ProfileView,
  type ServiceRow,
  type TeamMemberRow,
} from "./types";

export async function getBusinessProfile(
  businessId: string,
): Promise<BusinessProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("id, name, industry, website, phone, timezone, logo_key")
    .eq("id", businessId)
    .maybeSingle();

  if (!data) return null;

  let logoUrl: string | null = null;
  if (data.logo_key) {
    try {
      logoUrl = await createDownloadUrl(data.logo_key);
    } catch {
      logoUrl = null;
    }
  }

  return {
    id: data.id,
    name: data.name,
    industry: data.industry,
    website: data.website,
    phone: data.phone,
    timezone: data.timezone,
    logoKey: data.logo_key,
    logoUrl,
  };
}

export async function getMessagingSettings(
  businessId: string,
): Promise<MessagingSettings> {
  const supabase = await createClient();
  const [{ data }, { data: slack }] = await Promise.all([
    supabase
      .from("business_settings")
      .select(
        "default_channel, fallback_channel, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, message_signature, opt_out_wording, service_area_description, business_hours",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("integrations")
      .select("status, config")
      .eq("business_id", businessId)
      .eq("provider_type", "slack")
      .maybeSingle(),
  ]);

  const slackConfig =
    slack?.config && typeof slack.config === "object"
      ? (slack.config as Record<string, unknown>)
      : null;

  return {
    defaultChannel: data?.default_channel ?? "sms",
    fallbackChannel: data?.fallback_channel ?? null,
    quietHoursEnabled: data?.quiet_hours_enabled ?? true,
    quietHoursStart: trimTime(data?.quiet_hours_start ?? "20:00"),
    quietHoursEnd: trimTime(data?.quiet_hours_end ?? "08:00"),
    messageSignature: data?.message_signature ?? null,
    optOutWording: data?.opt_out_wording ?? "Reply STOP to opt out.",
    serviceAreaDescription: data?.service_area_description ?? null,
    businessHours: parseBusinessHours(data?.business_hours),
    slackConnected: Boolean(slack) && slack?.status !== "DISCONNECTED",
    slackChannelId:
      slackConfig && typeof slackConfig.channel_id === "string"
        ? slackConfig.channel_id
        : null,
  };
}

export async function getBookingSettings(
  businessId: string,
): Promise<BookingSettings> {
  const supabase = await createClient();
  const [settingsResult, integrationsResult] = await Promise.all([
    supabase
      .from("business_settings")
      .select(
        "booking_mode, booking_url, appointment_duration_minutes, booking_buffer_minutes",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("integrations")
      .select("provider_type, status")
      .eq("business_id", businessId)
      .in("provider_type", ["calendly", "google_calendar"]),
  ]);

  const connected = new Set(
    (integrationsResult.data ?? [])
      .filter((row) => row.status !== "DISCONNECTED")
      .map((row) => row.provider_type),
  );

  return {
    bookingMode: settingsResult.data?.booking_mode ?? "handover",
    bookingUrl: settingsResult.data?.booking_url ?? null,
    appointmentDurationMinutes:
      settingsResult.data?.appointment_duration_minutes ?? 60,
    bookingBufferMinutes: settingsResult.data?.booking_buffer_minutes ?? 0,
    calendlyConnected: connected.has("calendly"),
    googleCalendarConnected: connected.has("google_calendar"),
  };
}

export async function listTeamMembers(
  businessId: string,
): Promise<TeamMemberRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_members")
    .select(
      "id, user_id, role, status, invited_email, invited_at, accepted_at, created_at",
    )
    .eq("business_id", businessId)
    .neq("status", "removed")
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  const userIds = rows.map((row) => row.user_id).filter(Boolean);

  const profiles = new Map<
    string,
    { first_name: string | null; last_name: string | null; email: string | null }
  >();

  if (userIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("id", userIds);

    for (const profile of profileRows ?? []) {
      profiles.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
      });
    }
  }

  return rows.map((row) => {
    const profile = profiles.get(row.user_id) ?? null;
    return {
      membershipId: row.id,
      userId: row.user_id,
      name: [profile?.first_name, profile?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      email: profile?.email ?? row.invited_email ?? "",
      role: row.role as BusinessRole,
      status: row.status,
      invitedAt: row.invited_at,
      createdAt: row.created_at,
      joinedAt: row.accepted_at ?? row.created_at,
    };
  });
}

/**
 * Removals in the last 30 days, for the Team overview rail. Counted from the
 * membership row rather than the audit log so it stays correct even where an
 * audit entry was pruned.
 */
export async function countRecentlyRemoved(businessId: string): Promise<number> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("business_members")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "removed")
    .gte("updated_at", since);

  return count ?? 0;
}

export async function listServices(businessId: string): Promise<ServiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("id, name, description, average_value, active, position")
    .eq("business_id", businessId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    averageValue: row.average_value === null ? null : Number(row.average_value),
    active: row.active,
    position: row.position,
  }));
}

export async function getBillingView(businessId: string): Promise<BillingView> {
  const admin = createAdminClient();

  const [subscriptionResult, entitlements, seatResult] = await Promise.all([
    admin
      .from("subscriptions")
      .select(
        "plan, status, billing_interval, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end, stripe_customer_id",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    getEntitlements(businessId),
    admin
      .from("business_members")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("status", ["active", "invited"]),
  ]);

  const usage = await getPeriodUsage(businessId, entitlements.periodStart);
  const subscription = subscriptionResult.data;

  const planId = entitlements.plan as PlanId;
  const definition = planId === "trial" ? null : (PLANS[planId] ?? null);

  return {
    plan: entitlements.plan,
    status: entitlements.status,
    billingInterval: subscription?.billing_interval ?? null,
    currentPeriodStart: subscription?.current_period_start ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    trialEndsAt: subscription?.trial_ends_at ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    hasStripeCustomer: Boolean(subscription?.stripe_customer_id),
    leadLimit: entitlements.leadLimit,
    userLimit: entitlements.userLimit,
    seatsUsed: seatResult.count ?? 0,
    leadsUsed: usage.leads,
    messagesUsed: usage.messages,
    messageAllowance:
      definition?.smsSegmentAllowance ?? TRIAL_ENTITLEMENTS.smsSegmentAllowance,
    monthlyPrice: definition?.monthlyPrice ?? null,
    planFeatures: definition?.features ?? [
      "14-day trial",
      `${TRIAL_ENTITLEMENTS.leadLimit} leads`,
      "New-lead follow-up and qualification",
    ],
  };
}

export async function getProfileView(
  userId: string,
  businessId: string,
  role: BusinessRole,
): Promise<ProfileView> {
  const supabase = await createClient();

  const [profileResult, settingsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, email, phone")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("business_settings")
      .select(
        "notify_handover, notify_booking, notify_integration_failure, notify_campaign_complete, notify_daily_summary",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const settings = settingsResult.data;

  return {
    userId,
    firstName: profileResult.data?.first_name ?? null,
    lastName: profileResult.data?.last_name ?? null,
    email: profileResult.data?.email ?? "",
    phone: profileResult.data?.phone ?? null,
    notifications: {
      handover: settings?.notify_handover ?? true,
      booking: settings?.notify_booking ?? true,
      integrationFailure: settings?.notify_integration_failure ?? true,
      campaignComplete: settings?.notify_campaign_complete ?? true,
      dailySummary: settings?.notify_daily_summary ?? false,
    },
    canEditNotifications: role === "owner" || role === "admin",
  };
}

export type GettingStartedStep = {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

export async function getGettingStarted(
  businessId: string,
): Promise<GettingStartedStep[]> {
  const supabase = await createClient();

  const [services, integrations, questions, leads, automations] =
    await Promise.all([
      supabase
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("active", true),
      supabase
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", businessId),
      supabase
        .from("qualification_questions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("active", true),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId),
      supabase
        .from("business_settings")
        .select("booking_mode, booking_url")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

  const live = (integrations.data ?? []).filter(
    (row) => row.status !== "DISCONNECTED",
  );

  return [
    {
      id: "services",
      label: "Add your services",
      description:
        "Client Turn needs at least one service before it can qualify a lead.",
      href: "/app/settings?section=workspace",
      done: (services.count ?? 0) > 0,
    },
    {
      id: "lead-source",
      label: "Connect a lead source",
      description: "Meta Lead Ads delivers new enquiries within seconds.",
      href: "/app/settings?section=connections",
      done: live.some((row) => row.provider_type === "meta"),
    },
    {
      id: "messaging",
      label: "Connect a messaging channel",
      description: "Follow-up cannot be sent until SMS or WhatsApp is connected.",
      href: "/app/settings?section=connections",
      done: live.some((row) => row.provider_type.startsWith("twilio")),
    },
    {
      id: "qualification",
      label: "Set your qualifying questions",
      description: "The deterministic rules that decide who is worth booking.",
      href: "/app/follow-up?view=qualification",
      done: (questions.count ?? 0) > 0,
    },
    {
      id: "booking",
      label: "Choose how leads book",
      description: "A calendar connection, or a booking link you provide.",
      href: "/app/settings?section=workspace",
      done: Boolean(
        automations.data?.booking_url ||
          (automations.data?.booking_mode &&
            automations.data.booking_mode !== "handover"),
      ),
    },
    {
      id: "first-lead",
      label: "Receive your first lead",
      description: "Everything is working once a real lead lands here.",
      href: "/app/leads",
      done: (leads.count ?? 0) > 0,
    },
  ];
}
