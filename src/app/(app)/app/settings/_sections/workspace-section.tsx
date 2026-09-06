import * as React from "react";
import { Building2 } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getAiBehaviour, isEmailChannelConnected } from "@/lib/ai-settings/queries";
import {
  getBookingSettings,
  getBusinessProfile,
  getMessagingSettings,
  listServices,
} from "@/lib/settings/queries";
import { EmptyState } from "@/components/ui/feedback";
import { WorkspaceSettings } from "@/components/settings/workspace/workspace-settings";
import { MessagingForm } from "@/components/settings/messaging-form";
import { BookingForm } from "@/components/settings/booking-form";
import { AiAgentForm } from "@/components/settings/ai-agent-form";
import { DangerZone } from "@/components/settings/danger-zone";
import { ReadOnlyNotice } from "@/components/settings/notices";

export async function WorkspaceSection() {
  const workspace = await requireWorkspace();
  const [profile, messaging, services, booking, entitlements, aiBehaviour, emailConnected] =
    await Promise.all([
      getBusinessProfile(workspace.businessId),
      getMessagingSettings(workspace.businessId),
      listServices(workspace.businessId),
      getBookingSettings(workspace.businessId),
      getEntitlements(workspace.businessId),
      getAiBehaviour(workspace.businessId),
      isEmailChannelConnected(workspace.businessId),
    ]);

  if (!profile) {
    return (
      <EmptyState
        icon={Building2}
        title="Workspace details are unavailable"
        description="We could not load this workspace. Refresh the page, and contact support if it keeps happening."
      />
    );
  }

  const canManage = hasRole(workspace.role, "admin");
  const readOnly = !canManage;

  return (
    <WorkspaceSettings
      profile={profile}
      serviceAreaDescription={messaging.serviceAreaDescription}
      businessHours={messaging.businessHours}
      services={services}
      canManage={canManage}
    >
      {/* Messaging behaviour, booking behaviour and the workspace danger zone
          stay inside Workspace: the V3 IA removed their standalone pages, and
          quiet hours and booking mode still have to be configurable. */}
      <MessagingForm
        settings={messaging}
        readOnly={readOnly}
        whatsappEnabled={entitlements.whatsappEnabled}
        timezone={workspace.timezone}
      />
      <BookingForm settings={booking} readOnly={readOnly} />
      {/* The AI assistant sits with the other "how this workspace behaves"
          controls rather than getting a nav entry of its own — the V3 IA caps
          the customer app at five destinations. */}
      <AiAgentForm
        settings={aiBehaviour}
        readOnly={readOnly}
        aiAssistAllowed={entitlements.aiAssistAllowed}
        whatsappEnabled={entitlements.whatsappEnabled}
        emailConnected={emailConnected}
      />
      {workspace.role === "owner" ? (
        <DangerZone workspaceName={workspace.businessName} />
      ) : (
        <ReadOnlyNotice message="Exporting or deleting a workspace can only be done by its owner. Ask them if you need either." />
      )}
    </WorkspaceSettings>
  );
}
