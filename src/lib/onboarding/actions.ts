"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  defaultQualifyQuestions,
  isOnboardingStep,
  nextStep,
  stepIndex,
  type OnboardingStep,
} from "./steps";
import { extractSitePrefill, normaliseWebsite, type SitePrefill } from "./prefill";
import { validateWorkspaceName } from "@/lib/auth/workspace-name";
import { safeFetchText } from "@/lib/security/safe-fetch";
import { ensureDefaultAutomations, getActivationChecks } from "./provision";
import {
  createTestLead,
  getTestLeadOutcome,
  type TestLeadOutcome,
  type TestLeadOverrides,
} from "./test-lead";
import {
  updateBusinessProfile,
  saveService,
  deleteService,
  updateMessagingSettings,
  updateBookingSettings,
} from "@/lib/settings/actions";
import { saveQuestion, deleteQuestion, saveRule } from "@/lib/qualification/actions";
import { saveAutomationDraft, publishAutomation } from "@/lib/automations/actions";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { normalisePhone } from "@/lib/messaging/types";
import { getIntegrationsView } from "@/lib/integrations/queries";

export type OnboardingResult =
  | { ok: true; nextStep: OnboardingStep | null }
  | { ok: false; error: string };

function fail(error: string): OnboardingResult {
  return { ok: false, error };
}

async function workspaceOrFail() {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/** Only ever moves forward, so a stale tab cannot rewind a finished workspace. */
async function advance(
  workspace: ActiveWorkspace,
  from: OnboardingStep,
): Promise<OnboardingResult> {
  const target = nextStep(from);
  const admin = createAdminClient();

  if (target) {
    await admin
      .from("businesses")
      .update({ onboarding_step: target })
      .eq("id", workspace.businessId)
      .eq("status", "onboarding");
  }

  revalidatePath("/onboarding");
  return { ok: true, nextStep: target };
}

async function currentSettings(businessId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_settings")
    .select(
      "default_channel, fallback_channel, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, message_signature, service_area_description, business_hours, appointment_duration_minutes, booking_buffer_minutes",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  return data;
}

/* ------------------------------------------------------ copilot step --- */

/**
 * The guided first-Copilot step (Phase 8.3) saves nothing of its own: the
 * question the person asks goes through Copilot's own action, with its own
 * permission checks and audit. Continuing only moves the wizard on.
 */
export async function advanceCopilotStep(): Promise<OnboardingResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");
  return advance(workspace, "copilot");
}

/* ------------------------------------------------------------- step 1 --- */

const dayHoursSchema = z.object({
  open: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const businessStepSchema = z.object({
  // Named by hand, here, by every owner (8.29). The placeholder a new
  // workspace is created with is refused, as is a blank or one-letter name.
  name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((value) => validateWorkspaceName(value).ok, "Name your workspace."),
  industry: z.string().trim().max(80),
  website: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  timezone: z.string().trim().min(3).max(64),
  serviceAreaDescription: z.string().trim().max(400),
  hours: z.record(z.string(), dayHoursSchema),
  services: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(400),
        averageValue: z.string().trim().max(12),
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(30),
  deletedServiceIds: z.array(z.uuid()).max(30),
});

export type BusinessStepInput = z.infer<typeof businessStepSchema>;

export async function saveBusinessStep(
  input: BusinessStepInput,
): Promise<OnboardingResult> {
  const parsed = businessStepSchema.safeParse(input);
  if (!parsed.success) {
    const naming = validateWorkspaceName(input?.name);
    return fail(naming.ok ? "Check your business details and try again." : naming.error);
  }

  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");

  const profile = await updateBusinessProfile({
    name: parsed.data.name,
    industry: parsed.data.industry,
    website: parsed.data.website,
    phone: parsed.data.phone,
    timezone: parsed.data.timezone,
  });
  if (!profile.ok) return fail(profile.error);

  const settings = await currentSettings(workspace.businessId);
  const messaging = await updateMessagingSettings({
    defaultChannel: settings?.default_channel ?? "sms",
    fallbackChannel: settings?.fallback_channel ?? "",
    quietHoursEnabled: settings?.quiet_hours_enabled ?? true,
    quietHoursStart: (settings?.quiet_hours_start ?? "20:00:00").slice(0, 5),
    quietHoursEnd: (settings?.quiet_hours_end ?? "08:00:00").slice(0, 5),
    messageSignature: settings?.message_signature ?? "",
    serviceAreaDescription: parsed.data.serviceAreaDescription,
    businessHours: parsed.data.hours,
  });
  if (!messaging.ok) return fail(messaging.error);

  for (const id of parsed.data.deletedServiceIds) {
    const result = await deleteService(id);
    if (!result.ok) return fail(result.error);
  }

  for (const service of parsed.data.services) {
    const result = await saveService({
      id: service.id,
      name: service.name,
      description: service.description,
      averageValue: service.averageValue,
      active: service.active,
    });
    if (!result.ok) return fail(result.error);
  }

  return advance(workspace, "business");
}

/* ------------------------------------------------------------- step 2 --- */

export async function checkMetaConnection(): Promise<
  { ok: true; status: string; reason: string | null } | { ok: false; error: string }
> {
  const workspace = await workspaceOrFail();
  if (!workspace) return { ok: false, error: "You do not have permission to view this." };

  const view = await getIntegrationsView(workspace.businessId);
  const meta = view.cards.find((card) => card.definition.id === "meta");
  return {
    ok: true,
    status: meta?.status ?? "DISCONNECTED",
    reason: meta?.block?.reason ?? null,
  };
}

export async function advanceConnectLeadsStep(): Promise<OnboardingResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");
  return advance(workspace, "connect_leads");
}

/* ------------------------------------------------------------- step 3 --- */

const followUpStepSchema = z.object({
  defaultChannel: z.enum(["sms", "whatsapp"]),
  signature: z.string().trim().max(160),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  optOutWording: z.string().trim().min(4).max(160),
  steps: z
    .array(
      z.object({
        delaySeconds: z.coerce.number().int().min(0).max(2_592_000),
        channel: z.enum(["sms", "whatsapp"]),
        template: z.string().trim().min(1).max(1200),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(8),
});

export type FollowUpStepInput = z.infer<typeof followUpStepSchema>;

export async function saveFollowUpStep(
  input: FollowUpStepInput,
): Promise<OnboardingResult> {
  const parsed = followUpStepSchema.safeParse(input);
  if (!parsed.success) return fail("Check your follow-up settings and try again.");
  if (!/stop/i.test(parsed.data.optOutWording)) {
    return fail("Opt-out wording must tell a lead how to reply STOP.");
  }

  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");

  const settings = await currentSettings(workspace.businessId);
  const messaging = await updateMessagingSettings({
    defaultChannel: parsed.data.defaultChannel,
    fallbackChannel: settings?.fallback_channel ?? "",
    quietHoursEnabled: parsed.data.quietHoursEnabled,
    quietHoursStart: parsed.data.quietHoursStart,
    quietHoursEnd: parsed.data.quietHoursEnd,
    messageSignature: parsed.data.signature,
    serviceAreaDescription: settings?.service_area_description ?? "",
    businessHours:
      (settings?.business_hours as Record<
        string,
        { open: boolean; start: string; end: string }
      > | null) ?? {},
  });
  if (!messaging.ok) return fail(messaging.error);

  const admin = createAdminClient();
  const { error: optOutError } = await admin
    .from("business_settings")
    .update({ opt_out_wording: parsed.data.optOutWording })
    .eq("business_id", workspace.businessId);
  if (optOutError) return fail("Could not save your opt-out wording.");

  try {
    await ensureDefaultAutomations(workspace.businessId, workspace.userId);
  } catch {
    return fail("Could not set up your follow-up sequence. Try again.");
  }

  const { data: definition } = await admin
    .from("automation_definitions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("type", "new_lead")
    .maybeSingle();

  if (!definition) return fail("Could not find your follow-up sequence.");

  const draft = await saveAutomationDraft({
    automationId: definition.id,
    name: "New lead follow-up",
    // Onboarding only ever seeds SMS/WhatsApp steps, so neither a subject nor
    // a sending identity applies. Email steps are added later, in Follow-Up.
    steps: parsed.data.steps.map((step) => ({
      ...step,
      subject: null,
      senderIdentityId: null,
    })),
  });
  if (!draft.ok) return fail(draft.error);

  const published = await publishAutomation({ automationId: definition.id });
  if (!published.ok) return fail(published.error);

  return advance(workspace, "follow_up");
}

export type SendTestMessageResult =
  | { ok: true; provider: string }
  | { ok: false; error: string };

export async function sendFollowUpTestMessage(input: {
  channel: "sms" | "whatsapp";
  message: string;
}): Promise<SendTestMessageResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return { ok: false, error: "You do not have permission to do this." };

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("phone")
    .eq("id", workspace.businessId)
    .maybeSingle();

  const to = business?.phone ? normalisePhone(business.phone) : null;
  if (!to) {
    return {
      ok: false,
      error: "Add your business phone number in Step 1 before sending a test.",
    };
  }

  const message = input.message.trim().slice(0, 500);
  if (!message) return { ok: false, error: "Write a message before sending a test." };

  const provider = getMessagingProvider();
  const result = await provider.send({
    businessId: workspace.businessId,
    to,
    body: message,
    sendKey: `onboarding-test-message:${workspace.businessId}:${Date.now()}`,
    channel: input.channel,
  });

  if (!result.ok) return { ok: false, error: result.errorMessage };
  return { ok: true, provider: result.provider };
}

/* ------------------------------------------------------------- step 4 --- */

const qualifyBookStepSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.uuid().optional(),
        questionText: z.string().trim().min(3).max(300),
        responseType: z.enum([
          "text",
          "yes_no",
          "single_choice",
          "number",
          "postcode",
          "timing",
        ]),
        required: z.boolean(),
        options: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              value: z.string().trim().min(1).max(80),
            }),
          )
          .max(12),
        rule: z
          .object({
            id: z.uuid().optional(),
            operator: z.enum([
              "equals",
              "not_equals",
              "in",
              "not_in",
              "gte",
              "lte",
              "prefix_in",
              "prefix_not_in",
              "is_present",
            ]),
            comparisonValue: z.array(z.string().trim().min(1).max(80)).max(20),
            result: z.enum(["pass", "hard_fail", "review"]),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(10),
  deletedQuestionIds: z.array(z.uuid()).max(10),
  bookingMode: z.enum(["calendly", "google_calendar", "handover"]),
  bookingUrl: z.string().trim().max(300),
});

export type QualifyBookStepInput = z.infer<typeof qualifyBookStepSchema>;

export async function saveQualifyBookStep(
  input: QualifyBookStepInput,
): Promise<OnboardingResult> {
  const parsed = qualifyBookStepSchema.safeParse(input);
  if (!parsed.success) return fail("Check your qualification questions and try again.");

  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");

  for (const id of parsed.data.deletedQuestionIds) {
    const result = await deleteQuestion({ questionId: id });
    if (!result.ok) return fail(result.error);
  }

  for (const [index, question] of parsed.data.questions.entries()) {
    const saved = await saveQuestion({
      id: question.id,
      questionText: question.questionText,
      helpText: "",
      responseType: question.responseType,
      required: question.required,
      active: true,
      serviceId: null,
      options: question.options,
    });
    if (!saved.ok) return fail(saved.error);

    const questionId = question.id ?? saved.id;
    if (!questionId) continue;

    if (question.rule) {
      const ruleResult = await saveRule({
        id: question.rule.id,
        questionId,
        operator: question.rule.operator,
        comparisonValue: question.rule.comparisonValue,
        result: question.rule.result,
        priority: index + 1,
        active: true,
      });
      if (!ruleResult.ok) return fail(ruleResult.error);
    }
  }

  const settings = await currentSettings(workspace.businessId);
  const booking = await updateBookingSettings({
    bookingMode: parsed.data.bookingMode,
    bookingUrl: parsed.data.bookingUrl,
    appointmentDurationMinutes: settings?.appointment_duration_minutes ?? 60,
    bookingBufferMinutes: settings?.booking_buffer_minutes ?? 0,
  });
  if (!booking.ok) return fail(booking.error);

  return advance(workspace, "qualify_book");
}

/* ------------------------------------------------------------- step 5 --- */

export type TestLeadResult =
  | { ok: true; outcome: TestLeadOutcome | null }
  | { ok: false; error: string };

/** Runs a synthetic lead through the real pipeline so setup is proven, not assumed. */
export async function runTestLead(
  overrides?: TestLeadOverrides,
): Promise<TestLeadResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return { ok: false, error: "You do not have permission to set this up." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name")
    .eq("id", workspace.userId)
    .maybeSingle();

  try {
    await ensureDefaultAutomations(workspace.businessId, workspace.userId);
    await createTestLead(workspace.businessId, profile?.first_name ?? null, overrides);
  } catch {
    return { ok: false, error: "Could not create the test lead. Try again." };
  }

  revalidatePath("/onboarding");
  return { ok: true, outcome: await getTestLeadOutcome(workspace.businessId) };
}

export async function readTestLead(): Promise<TestLeadResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return { ok: false, error: "You do not have permission to set this up." };
  return { ok: true, outcome: await getTestLeadOutcome(workspace.businessId) };
}

/**
 * Activation is the only thing that lets a workspace out of onboarding, so it
 * re-checks that the essential configuration actually exists rather than
 * trusting the recorded step.
 */
export async function completeOnboarding(): Promise<OnboardingResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to finish setup.");

  const admin = createAdminClient();

  await ensureDefaultAutomations(workspace.businessId, workspace.userId);
  const checks = await getActivationChecks(workspace.businessId);
  const blocking = checks.filter((check) => check.blocking && !check.passed);
  if (blocking.length > 0) {
    return fail(`Not ready yet: ${blocking.map((c) => c.label.toLowerCase()).join(", ")}.`);
  }

  const { error } = await admin
    .from("businesses")
    .update({
      status: "active",
      onboarding_step: "complete",
      activated_at: new Date().toISOString(),
    })
    .eq("id", workspace.businessId);

  if (error) return fail("Could not activate your workspace.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.activated",
    entityType: "business",
    entityId: workspace.businessId,
  });

  revalidatePath("/app", "layout");
  return { ok: true, nextStep: null };
}

export async function goToStep(step: string): Promise<OnboardingResult> {
  if (!isOnboardingStep(step)) return fail("Unknown step.");

  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");

  const admin = createAdminClient();
  await admin
    .from("businesses")
    .update({ onboarding_step: step })
    .eq("id", workspace.businessId)
    .eq("status", "onboarding");

  revalidatePath("/onboarding");
  return { ok: true, nextStep: step };
}

/* ------------------------------------------------ prefill from website --- */

export type PrefillResult =
  | {
      ok: true;
      website: string;
      prefill: SitePrefill;
      /** The Companies House match for the site's name, when there is an exact one. */
      registry: { registeredName: string; companyNumber: string; status: string | null } | null;
    }
  | { ok: false; error: string };

/**
 * Reads the owner's own home page once and returns what it plainly says, for
 * the business step to offer (Phase 8.29). Nothing is saved here: every value
 * comes back as a suggestion the owner can change before Continue.
 *
 * Two existing pieces are reused rather than rebuilt: `safeFetchText` (the
 * SSRF-safe fetch the website analysis worker uses), and the Companies House
 * lookup the compliance layer uses, to show the registered name beside the
 * site's. The full website analysis that feeds the Business Profile is also
 * queued, so it is ready by the time the owner opens Find Leads.
 */
export async function prefillFromWebsite(raw: unknown): Promise<PrefillResult> {
  const website = typeof raw === "string" ? normaliseWebsite(raw) : null;
  if (!website) return { ok: false, error: "Enter your website address, like acme.co.uk." };

  const workspace = await workspaceOrFail();
  if (!workspace) return { ok: false, error: "You do not have permission to set this up." };

  const page = await safeFetchText(website);
  if (!page.ok) {
    return {
      ok: false,
      error:
        page.code === "TIMEOUT"
          ? "Your website took too long to answer. Fill the details in yourself, or try again."
          : "We could not read that website. Check the address, or fill the details in yourself.",
    };
  }

  const prefill = extractSitePrefill(page.body);

  let registry: { registeredName: string; companyNumber: string; status: string | null } | null = null;
  if (prefill.siteName) {
    try {
      const { lookupCompany } = await import("@/lib/find-leads/server/providers/companies-house");
      const verdict = await lookupCompany(prefill.siteName);
      if (verdict.companyNumber && verdict.registeredName) {
        registry = {
          registeredName: verdict.registeredName,
          companyNumber: verdict.companyNumber,
          status: verdict.status,
        };
      }
    } catch {
      // The register is a nice-to-have here, never a blocker.
    }
  }

  try {
    const { startAnalysis } = await import("@/lib/find-leads/server/analysis");
    await startAnalysis({ businessId: workspace.businessId, userId: workspace.userId, websiteUrl: website });
  } catch {
    // Best effort: the analysis can be started again from Settings.
  }

  return { ok: true, website, prefill, registry };
}

/* ------------------------------------------------- skip to go live --- */

/**
 * "Skip to go live" (Phase 8.29): applies the recommended setup for anything
 * not configured yet and moves the wizard to its last step.
 *
 * Nothing is bypassed. The follow-up sequence is the same one onboarding has
 * always seeded (`ensureDefaultAutomations`); the qualification questions go
 * through `saveQualifyBookStep`, so they pass the same validation and role
 * checks as if typed in. Anything the owner already set up is left alone, and
 * activation still re-checks everything in `completeOnboarding`.
 */
export async function applyRecommendedSetup(): Promise<OnboardingResult> {
  const workspace = await workspaceOrFail();
  if (!workspace) return fail("You do not have permission to set this up.");

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("name, onboarding_step, status")
    .eq("id", workspace.businessId)
    .maybeSingle();
  if (!business || business.status !== "onboarding") return fail("Setup is already finished.");
  if (!validateWorkspaceName(business.name).ok) return fail("Name your workspace first.");

  try {
    await ensureDefaultAutomations(workspace.businessId, workspace.userId);
  } catch {
    return fail("Could not set up your follow-up sequence. Try again.");
  }

  const [{ count: questionCount }, { data: services }, settings] = await Promise.all([
    admin
      .from("qualification_questions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", workspace.businessId)
      .eq("active", true),
    admin
      .from("services")
      .select("name")
      .eq("business_id", workspace.businessId)
      .eq("active", true)
      .order("position"),
    admin
      .from("business_settings")
      .select("booking_mode, booking_url")
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
  ]);

  if ((questionCount ?? 0) === 0) {
    const mode = (settings.data?.booking_mode as "calendly" | "google_calendar" | "handover" | null) ?? "handover";
    const url = settings.data?.booking_url ?? "";
    const saved = await saveQualifyBookStep({
      questions: defaultQualifyQuestions((services ?? []).map((row) => row.name)).map((question) => ({
        questionText: question.questionText,
        responseType: question.responseType,
        required: question.required,
        options: question.options.map((option) => ({ label: option, value: option })),
        rule: question.rule,
      })),
      deletedQuestionIds: [],
      // A calendar mode with no link would fail activation; handing over to a
      // person always works and is changed later in Settings.
      bookingMode: mode !== "handover" && !url ? "handover" : mode,
      bookingUrl: url,
    });
    if (!saved.ok) return saved;
  }

  // Forward only: a stale tab cannot rewind a later step.
  if (stepIndex(business.onboarding_step ?? "") < stepIndex("test_go_live")) {
    await admin
      .from("businesses")
      .update({ onboarding_step: "test_go_live" })
      .eq("id", workspace.businessId)
      .eq("status", "onboarding");
  }

  revalidatePath("/onboarding");
  return { ok: true, nextStep: "test_go_live" };
}
