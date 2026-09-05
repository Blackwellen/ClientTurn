import * as React from "react";
import { Building2 } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  getBookingSettings,
  getBusinessProfile,
  getMessagingSettings,
  listServices,
} from "@/lib/settings/queries";
import { EmptyState } from "@/components/ui/feedback";
import { BusinessForm } from "@/components/settings/business-form";
import { BusinessHoursCard } from "@/components/settings/business-hours-card";
import { ServicesView } from "@/components/settings/services-view";
import { MessagingForm } from "@/components/settings/messaging-form";
import { BookingForm } from "@/components/settings/booking-form";
import { DangerZone } from "@/components/settings/danger-zone";
import { ReadOnlyNotice } from "@/components/settings/notices";

export const dynamic = "force-dynamic";

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-content-subtle pt-2 text-[11px] font-medium uppercase tracking-wide">
      {children}
    </p>
  );
}

export default async function WorkspaceSettingsPage() {
  const workspace = await requireWorkspace();
  const [profile, messaging, services, booking, entitlements] = await Promise.all([
    getBusinessProfile(workspace.businessId),
    getMessagingSettings(workspace.businessId),
    listServices(workspace.businessId),
    getBookingSettings(workspace.businessId),
    getEntitlements(workspace.businessId),
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
  const isOwner = workspace.role === "owner";

  return (
    <div className="space-y-8">
      {readOnly && (
        <ReadOnlyNotice message="Only an owner or admin can change workspace settings." />
      )}

      <div className="space-y-4">
        <BusinessForm profile={profile} readOnly={readOnly} />
        <BusinessHoursCard
          settings={messaging}
          readOnly={readOnly}
          timezone={workspace.timezone}
        />
      </div>

      <div className="space-y-4">
        <SubsectionLabel>Services</SubsectionLabel>
        <ServicesView services={services} canManage={canManage} />
      </div>

      <div className="space-y-4">
        <SubsectionLabel>Messaging</SubsectionLabel>
        <MessagingForm
          settings={messaging}
          readOnly={readOnly}
          whatsappEnabled={entitlements.whatsappEnabled}
          timezone={workspace.timezone}
        />
      </div>

      <div className="space-y-4">
        <SubsectionLabel>Booking</SubsectionLabel>
        <BookingForm settings={booking} readOnly={readOnly} />
      </div>

      <div className="space-y-4">
        <SubsectionLabel>Danger zone</SubsectionLabel>
        {isOwner ? (
          <DangerZone workspaceName={workspace.businessName} />
        ) : (
          <ReadOnlyNotice message="Exporting or deleting a workspace can only be done by its owner. Ask them if you need either." />
        )}
      </div>
    </div>
  );
}
