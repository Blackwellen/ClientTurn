import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { loadBusinessProfile } from "@/lib/business-profile/queries";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { BusinessProfileSection } from "@/components/settings/business-profile/business-profile-section";
import { DirectCloseEditor } from "@/components/settings/business-profile/direct-close-editor";

/**
 * Server half of Settings → Business Profile.
 *
 * Suspended by the parent, so this section's queries never delay someone
 * editing business hours on the Workspace tab.
 */
export async function BusinessProfileSectionLoader() {
  const workspace = await requireWorkspace();
  const [data, authority] = await Promise.all([
    loadBusinessProfile(workspace.businessId),
    loadCommercialAuthoritySettings(workspace.businessId),
  ]);
  const canManage = hasRole(workspace.role, "admin");

  return (
    <div className="space-y-5">
      <BusinessProfileSection data={data} canManage={canManage} />
      {/* Selling: direct close (decision Q2). Owner/admin edit; the server re-checks. */}
      <DirectCloseEditor authority={authority} canEdit={canManage} />
    </div>
  );
}
