import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getFilterOptions } from "@/lib/leads/queries";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PlanLimitState } from "@/components/ui/feedback";
import { ReactivationWizard } from "@/components/reactivation/reactivation-wizard";

export const metadata: Metadata = { title: "New reactivation campaign · Client Turn" };
export const dynamic = "force-dynamic";

export default async function NewReactivationPage() {
  const workspace = await requireWorkspace();
  const entitlements = await getEntitlements(workspace.businessId);
  const canManage = hasRole(workspace.role, "admin");

  const header = (
    <PageHeader
      title="New reactivation campaign"
      description="Three steps: who to contact, what to say and when it sends, then a final review."
      action={
        <Link
          href="/app/reactivation"
          className="text-content-accent hover:text-accent-700 text-[13px] font-medium"
        >
          Back to reactivation
        </Link>
      }
    />
  );

  if (!entitlements.campaignsEnabled) {
    return (
      <div className="space-y-4">
        {header}
        <PlanLimitState
          title="Reactivation campaigns need the Growth plan"
          description="Upgrade to message an old lead list from Client Turn, with opt-outs, suppressions and quiet hours enforced for you."
          action={
            <Link
              href="/app/settings/billing"
              className="text-content-accent text-[13px] font-medium"
            >
              See plans and upgrade
            </Link>
          }
        />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        {header}
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
                  Back to reactivation
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const [options, { data: settings }] = await Promise.all([
    getFilterOptions(workspace.businessId),
    supabase
      .from("business_settings")
      .select(
        "default_channel, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
      )
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-4">
      {header}
      <ReactivationWizard
        businessName={workspace.businessName}
        options={{ services: options.services, sources: options.sources }}
        defaultChannel={
          settings?.default_channel === "whatsapp" && entitlements.whatsappEnabled
            ? "whatsapp"
            : "sms"
        }
        whatsappEnabled={entitlements.whatsappEnabled}
        aiAssistAllowed={entitlements.aiAssistAllowed}
        quietHours={{
          enabled: settings?.quiet_hours_enabled ?? true,
          start: (settings?.quiet_hours_start ?? "20:00").slice(0, 5),
          end: (settings?.quiet_hours_end ?? "08:00").slice(0, 5),
          timezone: workspace.timezone,
        }}
      />
    </div>
  );
}
