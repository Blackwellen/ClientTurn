import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getFilterOptions } from "@/lib/leads/queries";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PlanLimitState, Skeleton } from "@/components/ui/feedback";
import { ReactivationWizard } from "@/components/reactivation/reactivation-wizard";

export const metadata: Metadata = {
  title: "Create reactivation campaign · Client Turn",
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
          title="Reactivation campaigns need the Growth plan"
          description="Upgrade to message an old lead list from Client Turn, with opt-outs, suppressions and quiet hours enforced for you."
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
  const [options, { data: settings }, { data: integrations }] =
    await Promise.all([
      getFilterOptions(workspace.businessId),
      supabase
        .from("business_settings")
        .select(
          "default_channel, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
        )
        .eq("business_id", workspace.businessId)
        .maybeSingle(),
      supabase
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", workspace.businessId),
    ]);

  const defaultChannel =
    settings?.default_channel === "whatsapp" && entitlements.whatsappEnabled
      ? "whatsapp"
      : "sms";

  const usable = (provider: string) =>
    (integrations ?? []).some(
      (integration) =>
        integration.provider_type === provider &&
        integration.status !== "DISCONNECTED" &&
        integration.status !== "ACTION_REQUIRED",
    );

  const providerConnected =
    usable("twilio_sms") || usable("twilio_whatsapp") || usable("whatsapp_cloud");

  // Email campaigns go out through the workspace's own mailbox, so the channel
  // is only offered once that mailbox is connected and not in a failed state.
  const emailEnabled = usable("imap_smtp");

  return (
    <div className="space-y-5">
      <WizardHeader />
      <React.Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <ReactivationWizard
          businessName={workspace.businessName}
          options={{ services: options.services, sources: options.sources }}
          defaultChannel={defaultChannel}
          whatsappEnabled={entitlements.whatsappEnabled}
          emailEnabled={emailEnabled}
          providerConnected={providerConnected}
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
