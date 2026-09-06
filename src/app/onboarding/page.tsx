import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getActiveWorkspace,
  requireUser,
  type ActiveWorkspace,
} from "@/lib/auth/session";
import { activatePendingInvites } from "@/lib/auth/invites";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onboardingIncomplete } from "@/lib/app/health";
import { isOnboardingStep, type OnboardingStep } from "@/lib/onboarding/steps";
import { getActivationChecks } from "@/lib/onboarding/provision";
import { getTestLeadOutcome } from "@/lib/onboarding/test-lead";
import { getQualificationConfig } from "@/lib/qualification/queries";
import { getIntegrationsView } from "@/lib/integrations/queries";
import { parseBusinessHours } from "@/lib/settings/types";
import { NEW_LEAD_SEQUENCE } from "@/lib/automation/defaults";
import { OnboardingWizard, type OnboardingInitial } from "@/components/onboarding/wizard";
import { Logo } from "@/components/ui/logo";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Set up ClientTurn",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();

  /*
   * requireWorkspace() redirects here, so a user with no active membership must
   * be handled explicitly or they bounce between /app and /onboarding forever.
   * Activating a pending invitation is the common reason one appears.
   */
  const workspace = await getActiveWorkspace();

  if (!workspace) {
    const activated = await activatePendingInvites(
      user.id,
      user.email,
      Boolean(user.email_confirmed_at),
    );
    /*
     * Re-reading in this same render still returns the pre-write result, so a
     * newly activated member is bounced through a fresh request instead. This
     * only ever happens once, on the invitee's first visit.
     */
    if (activated > 0) redirect("/onboarding");
    return <NoWorkspace email={user.email ?? ""} />;
  }
  if (!onboardingIncomplete(workspace)) redirect("/app");

  const step: OnboardingStep = isOnboardingStep(workspace.onboardingStep)
    ? workspace.onboardingStep
    : "business";

  return <Wizard workspace={workspace} step={step} />;
}

function NoWorkspace({ email }: { email: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[16px] border border-[rgba(150,170,190,0.28)] bg-[#0a131b] p-6 text-center">
        <Logo href={null} height={56} className="justify-center" />
        <h1 className="mt-3 text-[17px] font-semibold text-[#f8fafc]">
          You are not in a workspace yet
        </h1>
        <p className="mt-2 text-[13px] text-[#96a1b3]">
          {email
            ? `${email} is signed in, but it is not a member of any workspace.`
            : "This account is not a member of any workspace."}{" "}
          If you were invited, open the invitation link from your email. If you meant to start
          your own, create a new account.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <a
            href="/signup"
            className="inline-flex h-9 items-center rounded-[9px] bg-[var(--auth-lime)] px-3 text-[13px] font-semibold text-[#071009] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
          >
            Create a workspace
          </a>
          <a
            href="/login"
            className="inline-flex h-9 items-center rounded-[9px] border border-[rgba(150,170,190,0.35)] px-3 text-[13px] font-medium text-[#eef2f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
          >
            Sign in as someone else
          </a>
        </div>
      </div>
    </div>
  );
}

async function Wizard({
  workspace,
  step,
}: {
  workspace: ActiveWorkspace;
  step: OnboardingStep;
}) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const [
    businessResult,
    settingsResult,
    servicesResult,
    qualificationConfig,
    integrationsView,
    checks,
    testOutcome,
    automationSteps,
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("industry, phone, website")
      .eq("id", workspace.businessId)
      .maybeSingle(),
    supabase
      .from("business_settings")
      .select(
        "business_hours, service_area_description, default_channel, message_signature, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, opt_out_wording, booking_mode, booking_url",
      )
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
    supabase
      .from("services")
      .select("id, name, description, average_value, active")
      .eq("business_id", workspace.businessId)
      .order("position"),
    getQualificationConfig(workspace.businessId),
    getIntegrationsView(workspace.businessId),
    getActivationChecks(workspace.businessId),
    getTestLeadOutcome(workspace.businessId),
    (async () => {
      const { data: definition } = await admin
        .from("automation_definitions")
        .select("id")
        .eq("business_id", workspace.businessId)
        .eq("type", "new_lead")
        .maybeSingle();
      if (!definition) return null;

      const { data: version } = await admin
        .from("automation_versions")
        .select("id")
        .eq("business_id", workspace.businessId)
        .eq("automation_id", definition.id)
        .eq("status", "PUBLISHED")
        .maybeSingle();
      if (!version) return null;

      const { data: rows } = await admin
        .from("automation_steps")
        .select("delay_seconds, channel, template, enabled")
        .eq("version_id", version.id)
        .order("position");
      return rows;
    })(),
  ]);

  const business = businessResult.data;
  const settings = settingsResult.data;
  const services = servicesResult.data ?? [];

  const twilioSms = integrationsView.cards.find((c) => c.definition.id === "twilio_sms");
  const twilioWhatsapp = integrationsView.cards.find((c) => c.definition.id === "twilio_whatsapp");
  const calendly = integrationsView.cards.find((c) => c.definition.id === "calendly");
  const googleCalendar = integrationsView.cards.find((c) => c.definition.id === "google_calendar");

  const rulesByQuestion = new Map<string, (typeof qualificationConfig.rules)[number]>();
  for (const rule of [...qualificationConfig.rules].sort((a, b) => a.priority - b.priority)) {
    if (rule.questionId && !rulesByQuestion.has(rule.questionId)) {
      rulesByQuestion.set(rule.questionId, rule);
    }
  }

  const steps = (
    automationSteps && automationSteps.length > 0
      ? automationSteps.map((row) => ({
          delaySeconds: row.delay_seconds,
          channel: row.channel as "sms" | "whatsapp",
          template: row.template,
          enabled: row.enabled,
        }))
      : NEW_LEAD_SEQUENCE.map((row) => ({
          delaySeconds: row.delaySeconds,
          channel: row.channel,
          template: row.template,
          enabled: true,
        }))
  ).slice(0, 8);

  const initial: OnboardingInitial = {
    business: {
      business: {
        name: workspace.businessName,
        industry: business?.industry ?? "",
        website: business?.website ?? "",
        phone: business?.phone ?? "",
        timezone: workspace.timezone,
      },
      hours: parseBusinessHours(settings?.business_hours),
      serviceAreaDescription: settings?.service_area_description ?? "",
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description ?? "",
        averageValue: service.average_value === null ? "" : String(service.average_value),
        active: service.active,
      })),
    },
    followUp: {
      defaultChannel: (settings?.default_channel as "sms" | "whatsapp") ?? "sms",
      signature: settings?.message_signature ?? "",
      businessPhone: business?.phone ?? "",
      smsConnected: Boolean(twilioSms?.connected),
      whatsappAvailable: integrationsView.whatsappAvailableOnPlan && Boolean(twilioWhatsapp?.connected),
      quietHoursEnabled: settings?.quiet_hours_enabled ?? true,
      quietHoursStart: (settings?.quiet_hours_start ?? "20:00:00").slice(0, 5),
      quietHoursEnd: (settings?.quiet_hours_end ?? "08:00:00").slice(0, 5),
      optOutWording: settings?.opt_out_wording ?? "Reply STOP to opt out at any time.",
      steps,
    },
    qualifyBook: {
      questions: qualificationConfig.questions.map((question) => {
        const rule = rulesByQuestion.get(question.id);
        return {
          id: question.id,
          questionText: question.questionText,
          responseType: question.responseType,
          required: question.required,
          optionsText: question.options.map((o) => o.value).join(", "),
          rule: rule
            ? {
                id: rule.id,
                operator: rule.operator,
                comparisonValue: rule.comparisonValue,
                result: rule.result,
              }
            : null,
        };
      }),
      bookingMode: (settings?.booking_mode as "calendly" | "google_calendar" | "handover") ?? "handover",
      bookingUrl: settings?.booking_url ?? "",
      calendlyConnected: Boolean(calendly?.connected),
      googleCalendarConnected: Boolean(googleCalendar?.connected),
    },
    testGoLive: {
      checks,
      services: services.map((s) => ({ id: s.id, name: s.name })),
      defaultPhone: business?.phone ?? "",
      initialOutcome: testOutcome,
    },
  };

  return (
    <ToastProvider>
      <OnboardingWizard
        step={step}
        canEdit={workspace.role === "owner" || workspace.role === "admin"}
        initial={initial}
      />
    </ToastProvider>
  );
}
