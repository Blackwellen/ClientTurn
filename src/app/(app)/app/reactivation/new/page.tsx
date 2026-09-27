import * as React from "react";
import { unlockPlanLabel } from "@/lib/billing/plans";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getFilterOptions } from "@/lib/leads/queries";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, PlanLimitState, Skeleton } from "@/components/ui/feedback";
import { ReactivationWizard } from "@/components/reactivation/reactivation-wizard";
import {
  campaignChannelReadiness,
  pickDefaultChannel,
  type CampaignTemplateOption,
} from "@/lib/campaigns/reactivation-channels";
import {
  listWorkspaceTemplates,
  whatsAppTransportFor,
} from "@/lib/messaging/template-registry";
import { platformConfigured } from "@/lib/integrations/queries";

/**
 * Approved templates on the WhatsApp sender this workspace actually uses. A
 * registry that cannot be read offers none, which keeps the WhatsApp channel
 * closed (with its explanation) rather than letting a campaign launch that
 * could not be delivered.
 */
async function approvedWhatsAppTemplates(
  businessId: string,
  whatsappAllowed: boolean,
): Promise<CampaignTemplateOption[]> {
  if (!whatsappAllowed) return [];
  try {
    const [templates, transport] = await Promise.all([
      listWorkspaceTemplates(businessId),
      whatsAppTransportFor(businessId),
    ]);
    return templates
      .filter((template) => template.provider === transport && template.status === "APPROVED")
      .map((template) => ({
        id: template.id,
        name: template.name,
        language: template.language,
        category: template.category,
        body: template.body,
        variables: template.variables,
      }));
  } catch (error) {
    console.error("[reactivation] WhatsApp templates unreadable", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export const metadata: Metadata = {
  title: "Create reactivation campaign",
};
export const dynamic = "force-dynamic";

/** Identical on all three steps, per the wizard design. */
function WizardHeader() {
  return (
    <div>
      <Link
        href="/app/reactivation"
        className="text-content-accent hover:text-accent-700 inline-flex items-center gap-1.5 text-[13px] font-medium"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to Reactivation
      </Link>
      <h1 className="text-content mt-3 text-[26px] font-bold leading-tight">
        Create Reactivation Campaign
      </h1>
      <p className="text-content-muted mt-1 text-[14px]">
        Reach out to older eligible leads and bring them back into your pipeline.
      </p>
    </div>
  );
}

export default async function NewReactivationPage() {
  const workspace = await requireWorkspace();
  const entitlements = await getEntitlements(workspace.businessId);
  const canManage = hasRole(workspace.role, "admin");

  if (!entitlements.campaignsEnabled) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <PlanLimitState
          title={`Reactivation campaigns need the ${unlockPlanLabel("campaigns")}`}
          description="Upgrade to message an old lead list from ClientTurn, with opt-outs, suppressions and quiet hours enforced for you."
          action={
            <Link
              href="/app/settings?section=billing"
              className="text-content-accent text-[13px] font-medium"
            >
              See plans and upgrade
            </Link>
          }
        />
      </div>
    );
  }

  // Creating and launching a campaign is an admin capability. The server
  // actions re-check this — this branch only avoids showing a form that would
  // be refused.
  if (!canManage) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <Card>
          <CardContent>
            <EmptyState
              icon={Lock}
              title="You do not have permission to create campaigns"
              description="Only owners and admins can create or launch a reactivation campaign. Ask an owner to give you admin access, or view results on the reactivation list."
              action={
                <Link
                  href="/app/reactivation"
                  className="text-content-accent text-[13px] font-medium"
                >
                  Back to Reactivation
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const [
    options,
    { data: settings, error: settingsError },
    { data: integrations, error: integrationsError },
    whatsappTemplates,
  ] = await Promise.all([
    getFilterOptions(workspace.businessId),
    supabase
      .from("business_settings")
      .select(
        "default_channel, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, opt_out_wording, ai_assist_enabled",
      )
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
    supabase
      .from("integrations")
      .select("provider_type, status")
      .eq("business_id", workspace.businessId),
    approvedWhatsAppTemplates(workspace.businessId, entitlements.whatsappEnabled),
  ]);

  // Without the settings and connections the wizard would guess at quiet
  // hours and at which channels can send, so it is not shown on a guess.
  if (settingsError || integrationsError) {
    return (
      <div className="space-y-5">
        <WizardHeader />
        <ErrorState
          title="The campaign builder could not load"
          description="Your workspace settings could not be read just now. Nothing has been created or sent. Refresh to try again."
        />
      </div>
    );
  }

  // Each channel needs its own connection: an SMS number, WhatsApp, or --
  // for email -- the workspace's own connected mailbox.
  const providers = campaignChannelReadiness(integrations ?? [], { sms: platformConfigured("twilio_sms"), whatsapp: platformConfigured("twilio_whatsapp") });

  const defaultChannel = pickDefaultChannel(settings?.default_channel, providers, {
    sms: true,
    whatsapp: entitlements.whatsappEnabled && whatsappTemplates.length > 0,
    email: true,
  });

  return (
    <div className="space-y-5">
      <WizardHeader />
      <React.Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <ReactivationWizard
          businessName={workspace.businessName}
          options={{ services: options.services, sources: options.sources }}
          defaultChannel={defaultChannel}
          whatsappEnabled={entitlements.whatsappEnabled}
          providers={providers}
          whatsappTemplates={whatsappTemplates}
          optOutWording={settings?.opt_out_wording ?? "Reply STOP to opt out."}
          aiPersonalizeAvailable={
            entitlements.aiAssistAllowed && (settings?.ai_assist_enabled ?? false)
          }
          quietHours={{
            enabled: settings?.quiet_hours_enabled ?? true,
            start: (settings?.quiet_hours_start ?? "20:00").slice(0, 5),
            end: (settings?.quiet_hours_end ?? "08:00").slice(0, 5),
            timezone: workspace.timezone,
          }}
        />
      </React.Suspense>
    </div>
  );
}
