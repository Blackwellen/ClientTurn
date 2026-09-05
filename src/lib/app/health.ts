import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements, getPeriodUsage } from "@/lib/billing/entitlements";
import type { ActiveWorkspace } from "@/lib/auth/session";

export type HealthIssue = {
  id: string;
  severity: "warning" | "error";
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
};

export type WorkspaceHealth = {
  issues: HealthIssue[];
  /** Worst integration status across connected providers, for the top-bar dot. */
  integrationStatus: "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "DISCONNECTED";
  usage: { leads: number; leadLimit: number; atLimit: boolean };
};

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Meta Lead Ads",
  twilio_sms: "SMS provider",
  twilio_whatsapp: "WhatsApp provider",
  whatsapp_cloud: "WhatsApp provider",
  google_calendar: "Google Calendar",
  calendly: "Calendly",
  email: "Email delivery",
};

/**
 * The banner must only ever surface work the user can actually do, so this
 * returns real blockers and nothing decorative.
 */
export const getWorkspaceHealth = cache(
  async (workspace: ActiveWorkspace): Promise<WorkspaceHealth> => {
    const supabase = await createClient();

    const [integrationsResult, entitlements] = await Promise.all([
      supabase
        .from("integrations")
        .select("provider_type, status, last_error_message")
        .eq("business_id", workspace.businessId),
      getEntitlements(workspace.businessId),
    ]);

    const usage = await getPeriodUsage(
      workspace.businessId,
      entitlements.periodStart,
    );

    const integrations = integrationsResult.data ?? [];
    const issues: HealthIssue[] = [];

    if (
      workspace.businessStatus === "onboarding" ||
      !workspace.activatedAt
    ) {
      issues.push({
        id: "onboarding",
        severity: "warning",
        title: "Setup is not finished",
        description:
          "Client Turn will not contact new leads until onboarding is complete.",
        actionLabel: "Finish setup",
        actionHref: "/onboarding",
      });
    }

    for (const integration of integrations) {
      if (
        integration.status !== "ACTION_REQUIRED" &&
        integration.status !== "DISCONNECTED"
      ) {
        continue;
      }
      const label =
        PROVIDER_LABELS[integration.provider_type] ?? integration.provider_type;
      issues.push({
        id: `integration-${integration.provider_type}`,
        severity: integration.status === "ACTION_REQUIRED" ? "error" : "warning",
        title:
          integration.status === "ACTION_REQUIRED"
            ? `${label} needs attention`
            : `${label} is not connected`,
        description:
          integration.last_error_message ??
          "Leads and messages that depend on this connection are not flowing.",
        actionLabel: "Open integrations",
        actionHref: "/app/settings/connections",
      });
    }

    const atLimit = usage.leads >= entitlements.leadLimit;
    if (atLimit) {
      issues.push({
        id: "plan-limit",
        severity: "error",
        title: "Lead limit reached",
        description: `You have used all ${entitlements.leadLimit} leads in this billing period. New leads are not being processed.`,
        actionLabel: "Review plan",
        actionHref: "/app/settings/billing",
      });
    }

    if (!entitlements.active) {
      issues.push({
        id: "subscription",
        severity: "error",
        title: "Subscription is not active",
        description:
          "Follow-up, qualification and booking are paused until billing is resolved.",
        actionLabel: "Review billing",
        actionHref: "/app/settings/billing",
      });
    }

    const rank = { HEALTHY: 0, DEGRADED: 1, DISCONNECTED: 2, ACTION_REQUIRED: 3 };
    let integrationStatus: WorkspaceHealth["integrationStatus"] =
      integrations.length === 0 ? "DISCONNECTED" : "HEALTHY";
    for (const integration of integrations) {
      const status = integration.status as WorkspaceHealth["integrationStatus"];
      if ((rank[status] ?? 0) > rank[integrationStatus]) {
        integrationStatus = status;
      }
    }

    return {
      issues,
      integrationStatus,
      usage: {
        leads: usage.leads,
        leadLimit: entitlements.leadLimit,
        atLimit,
      },
    };
  },
);

/** Onboarding is only finished when the workspace has actually been activated. */
export function onboardingIncomplete(workspace: ActiveWorkspace) {
  return workspace.businessStatus === "onboarding" && !workspace.activatedAt;
}
