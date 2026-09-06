import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, type BusinessRole } from "@/lib/auth/session";
import { getWorkspaceMembers } from "@/lib/leads/queries";
import type { WorkspaceMember } from "@/lib/leads/types";
import type { ConversionGoalValue, FollowUpAvailability } from "./types";

/**
 * Everything the Add Lead wizard needs before it opens: the workspace's own
 * services, team, conversion goals and follow-up readiness. Loaded on the
 * server with the Leads page so the modal has no loading state on open, and
 * re-validated inside the create action — nothing here is a permission.
 */

export type WizardService = {
  id: string;
  name: string;
  averageValue: number | null;
};

export type WizardConversionGoal = {
  id: string;
  name: string;
  type: ConversionGoalValue;
  isDefault: boolean;
};

export type ChannelCapabilities = {
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
};

export type AddLeadContext = {
  services: WizardService[];
  members: WorkspaceMember[];
  goals: WizardConversionGoal[];
  capabilities: ChannelCapabilities;
  followUp: FollowUpAvailability;
  /** Whether a service-specific qualification flow exists for each service. */
  serviceFlows: string[];
  permissions: {
    canCreateLead: boolean;
    canManageServices: boolean;
    canAssignOthers: boolean;
  };
  currencySymbol: string;
};

/** A `new_lead` automation that is enabled and has a published version. */
async function followUpAvailability(
  businessId: string,
): Promise<FollowUpAvailability> {
  const admin = createAdminClient();

  const { data: definition } = await admin
    .from("automation_definitions")
    .select("id, enabled")
    .eq("business_id", businessId)
    .eq("type", "new_lead")
    .maybeSingle();

  if (!definition) {
    return {
      automationReady: false,
      reason: "No new-lead follow-up automation has been created yet.",
    };
  }
  if (!definition.enabled) {
    return {
      automationReady: false,
      reason: "Your new-lead follow-up automation is paused.",
    };
  }

  const { data: version } = await admin
    .from("automation_versions")
    .select("id")
    .eq("business_id", businessId)
    .eq("automation_id", definition.id)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!version) {
    return {
      automationReady: false,
      reason: "Your new-lead follow-up automation has no published version.",
    };
  }

  return { automationReady: true, reason: null };
}

export async function channelCapabilities(
  businessId: string,
): Promise<ChannelCapabilities> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("provider_type, status")
    .eq("business_id", businessId);

  const connected = new Set(
    (data ?? [])
      .filter((row) => row.status === "HEALTHY" || row.status === "DEGRADED")
      .map((row) => row.provider_type),
  );

  return {
    sms: connected.has("twilio_sms"),
    whatsapp: connected.has("twilio_whatsapp"),
    email: connected.has("email"),
  };
}

export const getAddLeadContext = cache(
  async (businessId: string, role: BusinessRole): Promise<AddLeadContext> => {
    const admin = createAdminClient();

    const [
      servicesResult,
      goalsResult,
      members,
      capabilities,
      followUp,
      flowsResult,
    ] = await Promise.all([
      admin
        .from("services")
        .select("id, name, average_value")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("position", { ascending: true }),
      admin
        .from("conversion_goals")
        .select("id, name, type, is_default")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("is_default", { ascending: false }),
      getWorkspaceMembers(businessId),
      channelCapabilities(businessId),
      followUpAvailability(businessId),
      // A question scoped to one service is what makes a "service-specific"
      // qualification flow exist; without one the option is not offered.
      admin
        .from("qualification_questions")
        .select("service_id")
        .eq("business_id", businessId)
        .not("service_id", "is", null),
    ]);

    return {
      services: (servicesResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        averageValue: row.average_value,
      })),
      goals: (goalsResult.data ?? [])
        .filter((row): row is typeof row & { id: string } => Boolean(row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type as ConversionGoalValue,
          isDefault: row.is_default,
        })),
      members,
      capabilities,
      followUp,
      serviceFlows: [
        ...new Set(
          (flowsResult.data ?? [])
            .map((row) => row.service_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ],
      permissions: {
        canCreateLead: hasRole(role, "member"),
        canManageServices: hasRole(role, "admin"),
        canAssignOthers: hasRole(role, "member"),
      },
      currencySymbol: "£",
    };
  },
);
