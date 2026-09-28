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
  /**
   * Connections the provider no longer accepts (a revoked or expired grant, or
   * a Zoho connection missing the UPDATE scope). Rendered as the app-wide
   * Reconnect banner, so a silent sync failure is visible on every page.
   */
  reconnect: { providerType: string; label: string; message: string | null }[];
};

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Meta Lead Ads",
  twilio_sms: "SMS provider",
  twilio_whatsapp: "WhatsApp provider",
  whatsapp_cloud: "WhatsApp provider",
  google_calendar: "Google Calendar",
  calendly: "Calendly",
  email: "Email delivery",
  imap_smtp: "Your mailbox",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  zoho_crm: "Zoho CRM",
  slack: "Slack",
  google_ads: "Google Ads",
  linkedin_ads: "LinkedIn Ads",
  tiktok_ads: "TikTok Ads",
};

/** Error codes that mean "only reconnecting fixes this". */
const RECONNECT_CODES = new Set(["reconnect_required", "scope_outdated", "token_expired", "missing_token"]);

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
        .select("provider_type, status, last_error_code, last_error_message")
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
          "ClientTurn will not contact new leads until onboarding is complete.",
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
        actionHref: "/app/settings?section=connections",
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
        actionHref: "/app/settings?section=billing",
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
        actionHref: "/app/settings?section=billing",
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

    const reconnect = integrations
      .filter(
        (i) =>
          i.status === "ACTION_REQUIRED" &&
          RECONNECT_CODES.has((i as { last_error_code?: string | null }).last_error_code ?? ""),
      )
      .map((i) => ({
        providerType: i.provider_type,
        label: PROVIDER_LABELS[i.provider_type] ?? i.provider_type.replace(/_/g, " "),
        message: i.last_error_message ?? null,
      }));

    return {
      issues,
      reconnect,
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
