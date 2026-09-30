"use server";

import { requireCapability } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireWorkspace, type ActiveWorkspace } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient as UntypedClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import { parseCalendlyEventType } from "@/lib/bookings/calendly-event-type";
import { serverEnv } from "@/lib/env";
import { stripe, priceIdFor } from "@/lib/billing/stripe";
import { getEntitlements } from "@/lib/billing/entitlements";
import { PLANS, unlockPlanLabel, type PlanId } from "@/lib/billing/plans";
import {
  cancelPendingPlanChange,
  changeSubscriptionPlan,
  createSubscriptionCheckout,
} from "@/lib/billing/checkout";
import { resolvePlanInterval } from "@/lib/billing/plan-change";
import { recordUpsellConversion } from "@/lib/billing/upsell-service";
import {
  assertUploadAllowed,
  createUploadUrl,
  deleteObject,
  objectKey,
} from "@/lib/storage/r2";
import { passwordSchema } from "@/lib/validation/auth";
import { friendlyIssue } from "@/lib/validation/friendly-issue";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  BOOKING_MODES,
  DAYS,
  PRICING_VISIBILITY_OPTIONS,
  TIMEZONES,
  isAcceptedIndustry,
  normalisePublicPrice,
  type PricingVisibility,
} from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

const GENERIC = "Something went wrong. Try again.";

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function refresh(...paths: string[]) {
  revalidatePath("/app", "layout");
  for (const path of paths) revalidatePath(path);
}

async function requireSettingsAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  try {
    return { ok: true, workspace: await requireRole("admin") };
  } catch {
    return {
      ok: false,
      error: "Only an owner or admin can change workspace settings.",
    };
  }
}

/** Connection changes (0172): the integrations capability, not the admin role. */
async function requireIntegrationManager(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  try {
    return { ok: true, workspace: await requireCapability("manage_integrations") };
  } catch {
    return {
      ok: false,
      error: "Your permissions do not allow managing integrations. Ask the owner or an admin.",
    };
  }
}

/** Billing changes (0172): the owner, or an admin with billing delegated. */
async function requireBillingManager(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  try {
    return { ok: true, workspace: await requireCapability("manage_billing") };
  } catch {
    return { ok: false, error: "Only the owner, or an admin with billing permission, can do this." };
  }
}

async function requireOwner(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  try {
    return { ok: true, workspace: await requireRole("owner") };
  } catch {
    return { ok: false, error: "Only the workspace owner can do this." };
  }
}

/* ----------------------------------------------------------- business tab */

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value),
    "Enter a full web address, starting with https://",
  );

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  industry: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === "" ? null : value)),
  website: optionalUrl,
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === null || /^[+0-9 ()-]{7,30}$/.test(value),
      "Enter a valid contact number",
    ),
  timezone: z.enum(TIMEZONES),
});

export async function updateBusinessProfile(input: {
  name: string;
  industry: string;
  website: string;
  phone: string;
  timezone: string;
}): Promise<ActionResult> {
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check the details you entered."));
  }
  if (
    !isAcceptedIndustry(parsed.data.industry)
  ) {
    return fail("Choose an industry from the list.");
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);

  const admin = createAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({
      name: parsed.data.name,
      industry: parsed.data.industry,
      website: parsed.data.website,
      phone: parsed.data.phone,
      timezone: parsed.data.timezone,
    })
    .eq("id", guard.workspace.businessId);

  if (error) return fail("Could not save your business details.");

  await recordAudit({
    businessId: guard.workspace.businessId,
    actorUserId: guard.workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business",
    metadata: { section: "business" },
  });

  refresh("/app/settings");
  return { ok: true };
}

const logoSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(10 * 1024 * 1024),
});

export async function createLogoUploadUrl(input: {
  filename: string;
  contentType: string;
  size: number;
}): Promise<{ ok: true; url: string; key: string } | { ok: false; error: string }> {
  const parsed = logoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose a PNG, JPG or WebP image up to 10MB." };
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  // A rejected file is the user's to fix, not an outage: say what is allowed
  // rather than falling into the "not available right now" branch below.
  try {
    assertUploadAllowed("logo", parsed.data.contentType, parsed.data.size);
  } catch {
    return { ok: false, error: "Choose a PNG, JPG or WebP image up to 10MB." };
  }

  try {
    const key = objectKey(guard.workspace.businessId, "logo", parsed.data.filename);
    const url = await createUploadUrl(key, parsed.data.contentType, 300, parsed.data.size);
    return { ok: true, url, key };
  } catch {
    return {
      ok: false,
      error: "Logo uploads are not available right now. Try again later.",
    };
  }
}

const logoKeySchema = z.string().trim().min(1).max(300);

export async function saveBusinessLogo(key: string): Promise<ActionResult> {
  const parsed = logoKeySchema.safeParse(key);
  if (!parsed.success) return fail("That logo could not be saved.");

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);

  if (!parsed.data.startsWith(`logo/${guard.workspace.businessId}/`)) {
    return fail("That logo could not be saved.");
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("businesses")
    .select("logo_key")
    .eq("id", guard.workspace.businessId)
    .maybeSingle();

  const { error } = await admin
    .from("businesses")
    .update({ logo_key: parsed.data })
    .eq("id", guard.workspace.businessId);

  if (error) return fail("Could not save your logo.");

  if (existing?.logo_key && existing.logo_key !== parsed.data) {
    await deleteObject(existing.logo_key).catch(() => undefined);
  }

  refresh("/app/settings");
  return { ok: true };
}

export async function removeBusinessLogo(): Promise<ActionResult> {
  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("businesses")
    .select("logo_key")
    .eq("id", guard.workspace.businessId)
    .maybeSingle();

  const { error } = await admin
    .from("businesses")
    .update({ logo_key: null })
    .eq("id", guard.workspace.businessId);

  if (error) return fail("Could not remove your logo.");
  if (existing?.logo_key) await deleteObject(existing.logo_key).catch(() => undefined);

  refresh("/app/settings");
  return { ok: true };
}

/* ----------------------------------------------------------- services tab */

const serviceSchema = z.object({
  id: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, "Enter a service name")
    .max(80, "Keep the service name to 80 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(400, "Keep the description to 400 characters or fewer")
    .transform((value) => (value === "" ? null : value)),
  averageValue: z
    .string()
    .trim()
    .max(12)
    .transform((value) => (value === "" ? null : Number(value)))
    .refine(
      (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 1_000_000),
      "Enter an average job value between 0 and 1,000,000",
    ),
  active: z.boolean(),
  pricingVisibility: z
    .enum(PRICING_VISIBILITY_OPTIONS.map((option) => option.value) as [PricingVisibility, ...PricingVisibility[]])
    .optional(),
  publicPriceText: z.string().max(200).nullish(),
});

export async function saveService(input: {
  id?: string;
  name: string;
  description: string;
  averageValue: string;
  active: boolean;
  /** Omitted by callers that do not edit pricing (onboarding): left as is. */
  pricingVisibility?: PricingVisibility;
  publicPriceText?: string | null;
}): Promise<ActionResult> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check the service details."));
  }

  let pricing: { pricing_visibility: PricingVisibility; public_price_text: string | null } | null =
    null;
  if (parsed.data.pricingVisibility) {
    const price = normalisePublicPrice({
      visibility: parsed.data.pricingVisibility,
      text: parsed.data.publicPriceText,
    });
    if (!price.ok) return fail(price.error);
    pricing = { pricing_visibility: parsed.data.pricingVisibility, public_price_text: price.text };
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const payload = {
    name: parsed.data.name,
    description: parsed.data.description,
    average_value: parsed.data.averageValue,
    active: parsed.data.active,
    ...(pricing ?? {}),
  };

  if (parsed.data.id) {
    const { error } = await admin
      .from("services")
      .update(payload)
      .eq("id", parsed.data.id)
      .eq("business_id", workspace.businessId);

    if (error) return fail("Could not save that service.");

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "service.updated",
      entityType: "service",
      entityId: parsed.data.id,
      metadata: { name: parsed.data.name },
    });
  } else {
    const { count } = await admin
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("business_id", workspace.businessId);

    const { data, error } = await admin
      .from("services")
      .insert({
        ...payload,
        business_id: workspace.businessId,
        position: count ?? 0,
      })
      .select("id")
      .single();

    if (error || !data) return fail("Could not create that service.");

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "service.created",
      entityType: "service",
      entityId: data.id,
      metadata: { name: parsed.data.name },
    });
  }

  refresh("/app/settings");
  return { ok: true };
}

export async function deleteService(serviceId: string): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(serviceId);
  if (!parsed.success) return fail("That service could not be deleted.");

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const { count } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId)
    .eq("service_id", parsed.data);

  if ((count ?? 0) > 0) {
    return fail(
      "This service is attached to existing leads. Set it to inactive instead so their history stays intact.",
    );
  }

  const { error } = await admin
    .from("services")
    .delete()
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not delete that service.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "service.deleted",
    entityType: "service",
    entityId: parsed.data,
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ---------------------------------------------------------- messaging tab */

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Enter a time as HH:MM");

const dayHoursSchema = z.object({
  open: z.boolean(),
  start: timeSchema,
  end: timeSchema,
});

const messagingSchema = z.object({
  defaultChannel: z.enum(["sms", "whatsapp"]),
  fallbackChannel: z.enum(["sms", "whatsapp", ""]),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: timeSchema,
  quietHoursEnd: timeSchema,
  messageSignature: z
    .string()
    .trim()
    .max(160)
    .transform((value) => (value === "" ? null : value)),
  serviceAreaDescription: z
    .string()
    .trim()
    .max(400)
    .transform((value) => (value === "" ? null : value)),
  businessHours: z.record(z.string(), dayHoursSchema),
});

export async function updateMessagingSettings(input: {
  defaultChannel: string;
  fallbackChannel: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  messageSignature: string;
  serviceAreaDescription: string;
  businessHours: Record<string, { open: boolean; start: string; end: string }>;
}): Promise<ActionResult> {
  const parsed = messagingSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check your messaging settings."));
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const entitlements = await getEntitlements(workspace.businessId);
  if (
    (parsed.data.defaultChannel === "whatsapp" ||
      parsed.data.fallbackChannel === "whatsapp") &&
    !entitlements.whatsappEnabled
  ) {
    return fail(`WhatsApp is available on the ${unlockPlanLabel("whatsapp")} and above.`);
  }

  const hours: Record<string, { open: boolean; start: string; end: string }> = {};
  for (const day of DAYS) {
    const entry = parsed.data.businessHours[day.key];
    if (entry) hours[day.key] = entry;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      default_channel: parsed.data.defaultChannel,
      fallback_channel: parsed.data.fallbackChannel || null,
      quiet_hours_enabled: parsed.data.quietHoursEnabled,
      quiet_hours_start: parsed.data.quietHoursStart,
      quiet_hours_end: parsed.data.quietHoursEnd,
      message_signature: parsed.data.messageSignature,
      service_area_description: parsed.data.serviceAreaDescription,
      business_hours: hours,
    },
    { onConflict: "business_id" },
  );

  if (error) return fail("Could not save your messaging settings.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business_settings",
    metadata: { section: "messaging" },
  });

  refresh("/app/settings");
  return { ok: true };
}

const slackChannelSchema = z
  .string()
  .trim()
  .max(20)
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value === null || /^[CG][A-Z0-9]{8,15}$/.test(value),
    "Enter a Slack channel ID, found in the channel's About panel (starts with C or G)",
  );

export async function updateSlackChannel(input: {
  channelId: string;
}): Promise<ActionResult> {
  const parsed = slackChannelSchema.safeParse(input.channelId);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Enter a valid Slack channel ID."));
  }

  const guard = await requireIntegrationManager();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("id, status, config")
    .eq("business_id", workspace.businessId)
    .eq("provider_type", "slack")
    .maybeSingle();

  if (!integration || integration.status === "DISCONNECTED") {
    return fail("Connect Slack in Integrations before choosing a channel.");
  }

  const config = (integration.config ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("integrations")
    .update({ config: { ...config, channel_id: parsed.data } })
    .eq("id", integration.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not save the Slack channel.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.slack_channel_set",
    entityType: "integration",
    entityId: integration.id,
    metadata: { channel_id: parsed.data },
  });

  refresh("/app/settings");
  return { ok: true };
}

const slackPreferencesSchema = z.object({
  newLead: z.boolean(),
  handover: z.boolean(),
  booking: z.boolean(),
  warmProspect: z.boolean(),
  digest: z.boolean(),
});

export async function updateSlackNotificationPreferences(
  input: z.infer<typeof slackPreferencesSchema>,
): Promise<ActionResult> {
  const parsed = slackPreferencesSchema.safeParse(input);
  if (!parsed.success) return fail("Check the Slack alert settings and try again.");

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const { error } = await admin.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      slack_notify_new_lead: parsed.data.newLead,
      slack_notify_handover: parsed.data.handover,
      slack_notify_booking: parsed.data.booking,
      slack_notify_warm_prospect: parsed.data.warmProspect,
      slack_digest_enabled: parsed.data.digest,
    },
    { onConflict: "business_id" },
  );

  if (error) return fail("Could not save the Slack alert settings.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business_settings",
    metadata: { section: "slack_notifications" },
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------------ booking tab */

const bookingSchema = z.object({
  bookingMode: z.enum(["calendly", "google_calendar", "handover"]),
  bookingUrl: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === null || /^https:\/\/[^\s]+\.[^\s]+$/i.test(value),
      "Enter a full booking link, starting with https://",
    ),
  appointmentDurationMinutes: z.number().int().min(5).max(480),
  bookingBufferMinutes: z.number().int().min(0).max(240),
});

export async function updateBookingSettings(input: {
  bookingMode: string;
  bookingUrl: string;
  appointmentDurationMinutes: number;
  bookingBufferMinutes: number;
  /** Omitted: left as it is. Blank: cleared. */
  calendlyEventType?: string;
}): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check your booking settings."));
  }
  const eventType =
    typeof input.calendlyEventType === "string"
      ? parseCalendlyEventType(input.calendlyEventType.slice(0, 300))
      : null;
  if (eventType && !eventType.ok) return fail(eventType.error);
  if (!BOOKING_MODES.some((mode) => mode.value === parsed.data.bookingMode)) {
    return fail("Choose a booking method from the list.");
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();

  if (parsed.data.bookingMode !== "handover") {
    const { data: integration } = await admin
      .from("integrations")
      .select("status")
      .eq("business_id", workspace.businessId)
      .eq("provider_type", parsed.data.bookingMode)
      .maybeSingle();

    if (!integration || integration.status === "DISCONNECTED") {
      return fail(
        "Connect that calendar in Integrations before making it your booking method.",
      );
    }
  }

  const { error } = await admin.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      booking_mode: parsed.data.bookingMode,
      booking_url: parsed.data.bookingUrl,
      appointment_duration_minutes: parsed.data.appointmentDurationMinutes,
      booking_buffer_minutes: parsed.data.bookingBufferMinutes,
    },
    { onConflict: "business_id" },
  );

  if (error) return fail("Could not save your booking settings.");

  // The Calendly event type lives on the connection's config, beside what the
  // connection itself stored; only that one key is written.
  if (eventType?.ok) {
    const { data: calendly, error: calendlyError } = await admin
      .from("integrations")
      .select("id, config")
      .eq("business_id", workspace.businessId)
      .eq("provider_type", "calendly");
    if (calendlyError) return fail("Could not save the Calendly event type.");
    if (!calendly?.length && eventType.uri) {
      return fail("Connect Calendly in Connections before choosing an event type.");
    }
    for (const row of calendly ?? []) {
      const config = (row.config ?? {}) as Record<string, unknown>;
      if ((config.event_type_uri ?? null) === eventType.uri) continue;
      const { error: configError } = await admin
        .from("integrations")
        .update({ config: { ...config, event_type_uri: eventType.uri } as never })
        .eq("id", row.id)
        .eq("business_id", workspace.businessId);
      if (configError) return fail("Could not save the Calendly event type.");
    }
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business_settings",
    metadata: {
      section: "booking",
      mode: parsed.data.bookingMode,
      ...(eventType?.ok ? { calendly_event_type_uri: eventType.uri } : {}),
    },
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------------ billing tab */

export async function openBillingPortal(): Promise<UrlResult> {
  const guard = await requireBillingManager();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { workspace } = guard;

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return {
      ok: false,
      error:
        "There is no billing account yet. Choose a plan first and the portal becomes available.",
    };
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${serverEnv.siteUrl}/app/settings?section=billing`,
    });

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "billing.portal_opened",
      entityType: "subscription",
    });

    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Could not open the billing portal. Try again." };
  }
}

const checkoutSchema = z.object({
  plan: z.enum(["starter", "growth", "pro"]),
  // Optional: a live subscription always keeps its own interval (an annual
  // customer upgrades on annual prices), so the caller need not know it.
  interval: z.enum(["month", "year"]).optional(),
});

export async function startPlanCheckout(input: {
  plan: string;
  interval?: string;
}): Promise<UrlResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan to continue." };

  const guard = await requireBillingManager();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { workspace } = guard;

  const plan = parsed.data.plan;

  // A live subscription changes in place: upgrades now (prorated), downgrades
  // at the period end (terms 6.3). Opening a second Checkout here used to
  // create a second, parallel subscription.
  const change = await changeSubscriptionPlan(workspace, plan);
  if (change.ok) {
    if (change.mode !== "scheduled") {
      // Analytics only: an immediate upgrade after an upsell click.
      await recordUpsellConversion({
        businessId: workspace.businessId,
        offer: "tier_upgrade",
        ref: `tier:${workspace.businessId}:${plan}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    refresh("/app/settings");
    const outcome = change.mode === "scheduled" ? "scheduled" : "changed";
    return { ok: true, url: `/app/settings?section=billing&plan=${outcome}` };
  }
  if (!change.noLiveSubscription) return { ok: false, error: change.error };

  // No live subscription (never started, or ended): the caller's interval,
  // else the one this workspace last had, else monthly.
  const { data: previous, error: previousError } = await createAdminClient()
    .from("subscriptions")
    .select("billing_interval")
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (previousError) return { ok: false, error: "Could not read your billing details. Try again." };
  const interval = resolvePlanInterval({
    requested: parsed.data.interval,
    storedInterval: previous?.billing_interval ?? null,
  });

  if (!priceIdFor(plan as PlanId, interval)) {
    return {
      ok: false,
      error: `${PLANS[plan].name} is not available for self-serve checkout yet. Contact support and we will set it up.`,
    };
  }

  // A new Checkout, carrying a trial only if this workspace has not had one.
  return createSubscriptionCheckout(workspace, plan, interval);
}

/** Drops a downgrade scheduled for the period end; the current plan renews. */
export async function cancelScheduledPlanChange(): Promise<ActionResult> {
  const guard = await requireBillingManager();
  if (!guard.ok) return fail(guard.error);
  const result = await cancelPendingPlanChange(guard.workspace);
  if (!result.ok) return fail(result.error);
  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------------ danger zone */

const EXPORT_ROW_LIMIT = 5000;

export type ExportResult =
  | { ok: true; filename: string; json: string }
  | { ok: false; error: string };

export async function exportWorkspaceData(): Promise<ExportResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { workspace } = guard;

  const admin = createAdminClient();

  const [business, settings, members, services, leads, bookings, messages] =
    await Promise.all([
      admin.from("businesses").select("*").eq("id", workspace.businessId).maybeSingle(),
      admin
        .from("business_settings")
        .select("*")
        .eq("business_id", workspace.businessId)
        .maybeSingle(),
      admin
        .from("business_members")
        .select("role, status, invited_email, created_at")
        .eq("business_id", workspace.businessId),
      admin.from("services").select("*").eq("business_id", workspace.businessId),
      admin
        .from("leads")
        .select("*")
        .eq("business_id", workspace.businessId)
        .order("created_at", { ascending: false })
        .limit(EXPORT_ROW_LIMIT),
      admin
        .from("bookings")
        .select("*")
        .eq("business_id", workspace.businessId)
        .order("created_at", { ascending: false })
        .limit(EXPORT_ROW_LIMIT),
      admin
        .from("messages")
        .select("*")
        .eq("business_id", workspace.businessId)
        .order("created_at", { ascending: false })
        .limit(EXPORT_ROW_LIMIT),
    ]);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "export.performed",
    entityType: "business",
    metadata: { scope: "workspace" },
  });

  const payload = {
    exported_at: new Date().toISOString(),
    row_limit_per_table: EXPORT_ROW_LIMIT,
    business: business.data,
    settings: settings.data,
    members: members.data ?? [],
    services: services.data ?? [],
    leads: leads.data ?? [],
    bookings: bookings.data ?? [],
    messages: messages.data ?? [],
  };

  const date = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    filename: `client-turn-export-${date}.json`,
    json: JSON.stringify(payload, null, 2),
  };
}

export async function deleteWorkspace(confirmation: string): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  if (typeof confirmation !== "string" || confirmation.trim() !== workspace.businessName) {
    return fail("The name you typed does not match this workspace.");
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.delete_requested",
    entityType: "business",
    metadata: { name: workspace.businessName },
  });

  if (subscription?.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
    } catch {
      // Billing is reconciled by the Stripe webhook; deletion must not block.
    }
  }

  const { error } = await admin
    .from("businesses")
    .delete()
    .eq("id", workspace.businessId);

  if (error) return fail("Could not delete this workspace. Contact support.");

  refresh();
  return { ok: true };
}

/* ---------------------------------------------------------------- profile */

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(80),
  lastName: z.string().trim().min(1, "Enter your last name").max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === null || /^[+0-9 ()-]{7,30}$/.test(value),
      "Enter a valid contact number",
    ),
});

export async function updateProfile(input: {
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check your details."));
  }

  const workspace = await requireWorkspace();
  const admin = createAdminClient();

  const { error } = await admin
    .from("profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
    })
    .eq("id", workspace.userId);

  if (error) return fail("Could not save your profile.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "profile.updated",
    entityType: "profile",
  });

  refresh("/app/settings");
  return { ok: true };
}

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function changePassword(input: {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}): Promise<ActionResult> {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check your new password."));
  }

  const workspace = await requireWorkspace();

  // Verifying the current password is a sign-in attempt; bound it so a
  // hijacked session cannot use this form to guess the password.
  const limit = await checkRateLimit("auth:password_change", workspace.userId);
  if (!limit.allowed) {
    return fail("Too many attempts. Wait a few minutes and try again.");
  }

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", workspace.userId)
    .maybeSingle();

  if (!profile?.email) return fail(GENERIC);

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) return fail("That current password is not correct.");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) return fail("Could not change your password. Try again.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "profile.password_changed",
    entityType: "profile",
  });

  return { ok: true };
}

const notificationSchema = z.object({
  handover: z.boolean(),
  booking: z.boolean(),
  integrationFailure: z.boolean(),
  campaignComplete: z.boolean(),
  dailySummary: z.boolean(),
});

export async function updateNotificationPreferences(input: {
  handover: boolean;
  booking: boolean;
  integrationFailure: boolean;
  campaignComplete: boolean;
  dailySummary: boolean;
}): Promise<ActionResult> {
  const parsed = notificationSchema.safeParse(input);
  if (!parsed.success) return fail("Check your notification preferences.");

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const { error } = await admin.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      notify_handover: parsed.data.handover,
      notify_booking: parsed.data.booking,
      notify_integration_failure: parsed.data.integrationFailure,
      notify_campaign_complete: parsed.data.campaignComplete,
      notify_daily_summary: parsed.data.dailySummary,
    },
    { onConflict: "business_id" },
  );

  if (error) return fail("Could not save your notification preferences.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business_settings",
    metadata: { section: "notifications" },
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ----------------------------------------------------------- integrations */

const PROVIDER_TYPES = [
  "meta",
  "twilio_sms",
  "twilio_whatsapp",
  "whatsapp_cloud",
  "google_calendar",
  "calendly",
  "email",
  "google_ads",
  "tiktok_ads",
  "linkedin_ads",
  "slack",
  "hubspot",
  "zoho_crm",
  "salesforce",
] as const;

const TOKEN_PROVIDER_TYPES = ["hubspot"] as const;

/**
 * Providers connected with a customer-pasted token rather than an OAuth
 * redirect. HubSpot's private-app token is the only one today.
 */
export async function connectProviderToken(
  providerType: string,
  token: string,
): Promise<ActionResult> {
  const parsed = z.enum(TOKEN_PROVIDER_TYPES).safeParse(providerType);
  if (!parsed.success) return fail("That connection type is not supported.");

  if (typeof token !== "string") return fail("That token does not look right.");
  const trimmedToken = token.trim();
  if (trimmedToken.length < 10 || trimmedToken.length > 512) {
    return fail("That token does not look right.");
  }

  // Connecting is gated by the integrations capability (0172), like every
  // other connection change, not by the admin role.
  const guard = await requireIntegrationManager();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  // Every attempt makes an authenticated call to the provider's API, so a
  // bad-token retry loop is bounded here rather than left to HubSpot's own
  // rate limit.
  const limit = await checkRateLimit("integration:connect_token", workspace.businessId);
  if (!limit.allowed) {
    return fail("Too many connection attempts. Try again in a few minutes.");
  }

  if (parsed.data === "hubspot") {
    const { connectHubspot } = await import("@/lib/integrations/providers/hubspot");
    return connectHubspot(workspace, trimmedToken);
  }

  return fail("That connection type is not supported.");
}

export async function disconnectIntegration(
  providerType: string,
): Promise<ActionResult> {
  const parsed = z.enum(PROVIDER_TYPES).safeParse(providerType);
  if (!parsed.success) return fail("That connection could not be found.");

  const guard = await requireIntegrationManager();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("provider_type", parsed.data)
    .maybeSingle();

  if (!integration) return fail("That connection is not set up.");

  const { error } = await admin
    .from("integrations")
    .update({
      status: "DISCONNECTED",
      external_account_id: null,
      display_name: null,
      scopes: [],
      // Cleared, not carried forward — a reconnect (possibly to a different
      // external account entirely) must not silently inherit a stale Page id,
      // phone number id or Slack channel id from the connection just severed.
      config: {},
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", integration.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not disconnect that provider.");

  if (parsed.data === "calendly") {
    // Best-effort: a customer must always be able to disconnect a provider
    // from their own workspace even when the provider's own API is
    // unreachable, so a failed revoke is logged and never blocks the rest of
    // this function.
    try {
      const { revokeCalendlyWebhook } = await import(
        "@/lib/integrations/providers/calendly"
      );
      await revokeCalendlyWebhook(integration.id);
    } catch (revokeError) {
      console.error("Could not revoke the Calendly webhook subscription.", revokeError);
    }
  }

  await admin.from("integration_secrets").delete().eq("integration_id", integration.id);

  // The optional CRM pull is switched off with the connection. Left "enabled",
  // the Settings toggle kept claiming an import that could no longer run, and
  // a reconnect -- possibly to a different CRM account -- would have silently
  // resumed pulling from wherever the cursor last stood.
  if (parsed.data === "hubspot" || parsed.data === "zoho_crm" || parsed.data === "salesforce") {
    const { error: pullError } = await (admin as unknown as UntypedClient)
      .from("crm_pull_settings")
      .update({ enabled: false })
      .eq("integration_id", integration.id)
      .eq("business_id", workspace.businessId);
    if (pullError) console.error("Could not switch off CRM pull on disconnect.", pullError.message);
  }

  await admin
    .from("integration_objects")
    .update({ enabled: false })
    .eq("integration_id", integration.id)
    .eq("business_id", workspace.businessId);

  if (parsed.data === "calendly" || parsed.data === "google_calendar") {
    await admin
      .from("business_settings")
      .update({ booking_mode: "handover" })
      .eq("business_id", workspace.businessId)
      .eq("booking_mode", parsed.data);
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.disconnected",
    entityType: "integration",
    entityId: integration.id,
    metadata: { provider_type: parsed.data },
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------- workspace (settings v2) */

const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  industry: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === "" ? null : value)),
  website: optionalUrl,
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === null || /^[+0-9 ()-]{7,30}$/.test(value),
      "Enter a valid contact number",
    ),
  timezone: z.enum(TIMEZONES),
  serviceAreaDescription: z
    .string()
    .trim()
    .max(500, "Keep the service area under 500 characters")
    .transform((value) => (value === "" ? null : value)),
  businessHours: z.object(
    Object.fromEntries(DAYS.map((day) => [day.key, dayHoursSchema])) as Record<
      (typeof DAYS)[number]["key"],
      typeof dayHoursSchema
    >,
  ),
});

/**
 * The single save behind Settings → Workspace. Identity, hours and service
 * area move together because the page presents them as one draft with one
 * save bar, so a partial write would leave the form showing values that were
 * never stored.
 */
export async function saveWorkspaceSettings(input: {
  name: string;
  industry: string;
  website: string;
  phone: string;
  timezone: string;
  serviceAreaDescription: string;
  businessHours: Record<string, { open: boolean; start: string; end: string }>;
}): Promise<ActionResult> {
  const parsed = workspaceSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(friendlyIssue(parsed.error, "Check the details you entered."));
  }
  if (
    !isAcceptedIndustry(parsed.data.industry)
  ) {
    return fail("Choose an industry from the list.");
  }

  for (const day of DAYS) {
    const hours = parsed.data.businessHours[day.key];
    if (hours.open && hours.end <= hours.start) {
      return fail(`${day.label} must close after it opens.`);
    }
  }

  const guard = await requireSettingsAdmin();
  if (!guard.ok) return fail(guard.error);
  const { workspace } = guard;

  const admin = createAdminClient();

  const { error: businessError } = await admin
    .from("businesses")
    .update({
      name: parsed.data.name,
      industry: parsed.data.industry,
      website: parsed.data.website,
      phone: parsed.data.phone,
      timezone: parsed.data.timezone,
    })
    .eq("id", workspace.businessId);

  if (businessError) return fail("Could not save your business details.");

  // Only the two columns this form owns are written, so the messaging and
  // booking values on the same row are never clobbered.
  const { error: settingsError } = await admin.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      service_area_description: parsed.data.serviceAreaDescription,
      business_hours: parsed.data.businessHours,
    },
    { onConflict: "business_id" },
  );

  if (settingsError) {
    return fail("Business details were saved, but hours and service area were not.");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business",
    metadata: { section: "workspace" },
  });

  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------ connection health */

export type ConnectionTestResult =
  | { ok: true; status: string; message: string }
  | { ok: false; error: string };

/** Runs the provider's real credential/token probe. Never sends a message. */
export async function testConnection(
  providerType: string,
): Promise<ConnectionTestResult> {
  const parsedProvider = z.enum(PROVIDER_TYPES).safeParse(providerType);
  if (!parsedProvider.success) return { ok: false, error: "Unknown connection." };

  const guard = await requireIntegrationManager();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { workspace } = guard;

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("provider_type", parsedProvider.data)
    .neq("status", "DISCONNECTED")
    .maybeSingle();

  if (!integration) {
    return { ok: false, error: "That connection is not connected." };
  }

  const { runIntegrationHealthChecks } = await import(
    "@/lib/jobs/handlers/integration-health"
  );

  let outcomes;
  try {
    outcomes = await runIntegrationHealthChecks({
      businessId: workspace.businessId,
      integrationId: integration.id,
    });
  } catch {
    return { ok: false, error: "The connection could not be tested. Try again." };
  }

  const outcome = outcomes[0];
  if (!outcome) return { ok: false, error: "The connection could not be tested." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.tested",
    entityType: "integration",
    entityId: integration.id,
    metadata: { provider: parsedProvider.data, status: outcome.status },
  });

  refresh("/app/settings");

  if (outcome.status === "HEALTHY") {
    return { ok: true, status: outcome.status, message: "Connection tested successfully" };
  }
  return {
    ok: false,
    error: outcome.errorMessage ?? "This connection needs attention.",
  };
}

/** The Refresh control on Settings → Connections. */
export async function refreshConnectionHealth(): Promise<ActionResult> {
  const guard = await requireIntegrationManager();
  if (!guard.ok) return fail(guard.error);

  const { runIntegrationHealthChecks } = await import(
    "@/lib/jobs/handlers/integration-health"
  );

  try {
    await runIntegrationHealthChecks({ businessId: guard.workspace.businessId });
  } catch {
    return fail("Connection health could not be refreshed. Try again.");
  }

  refresh("/app/settings");
  return { ok: true };
}

/* ------------------------------------------- account preferences (dialog) */

/**
 * Sends the signed-in user a password reset email. Deliberately reports
 * success regardless of the provider's answer so this cannot be used to probe
 * which addresses exist.
 */
export async function requestOwnPasswordReset(): Promise<ActionResult> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", workspace.userId)
    .maybeSingle();

  if (!profile?.email) return fail(GENERIC);

  await supabase.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${serverEnv.siteUrl}/auth/callback?next=/reset-password`,
  });

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "profile.password_reset_requested",
    entityType: "profile",
  });

  return { ok: true };
}

export type AccountPreferences = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notifications: {
    handover: boolean;
    booking: boolean;
    integrationFailure: boolean;
    campaignComplete: boolean;
    dailySummary: boolean;
  };
  canEditNotifications: boolean;
};

/**
 * Loaded when the Account preferences dialog opens rather than on every app
 * render, so the shell stays cheap. Always scoped to the signed-in user.
 */
export async function loadAccountPreferences(): Promise<
  { ok: true; data: AccountPreferences } | { ok: false; error: string }
> {
  const workspace = await requireWorkspace();
  const { getProfileView } = await import("./queries");

  try {
    const view = await getProfileView(
      workspace.userId,
      workspace.businessId,
      workspace.role,
    );
    return {
      ok: true,
      data: {
        firstName: view.firstName ?? "",
        lastName: view.lastName ?? "",
        email: view.email,
        phone: view.phone ?? "",
        notifications: view.notifications,
        canEditNotifications: view.canEditNotifications,
      },
    };
  } catch {
    return { ok: false, error: "Your account details could not be loaded." };
  }
}
