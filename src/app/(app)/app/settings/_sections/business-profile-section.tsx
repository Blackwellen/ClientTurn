import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { loadBusinessProfile } from "@/lib/business-profile/queries";
import { BusinessProfileSection } from "@/components/settings/business-profile/business-profile-section";

/**
 * Server half of Settings → Business Profile.
 *
 * Suspended by the parent, so this section's queries never delay someone
 * editing business hours on the Workspace tab.
 */
export async function BusinessProfileSectionLoader() {
  const workspace = await requireWorkspace();
  const data = await loadBusinessProfile(workspace.businessId);

  return (
    <BusinessProfileSection data={data} canManage={hasRole(workspace.role, "admin")} />
  );
}
