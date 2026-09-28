import { isPlatformAdmin } from "@/lib/auth/session";
import { getMaintenanceStatus } from "@/lib/maintenance/state";
import { isOfflineLevel, LEVEL_LABEL } from "@/lib/maintenance/types";
import { BypassPill } from "./bypass-pill";

/**
 * "Maintenance bypass": shown to a platform admin who is looking at the app
 * while it is offline for everyone else, so nobody mistakes the preview for
 * the site being back. Decided server-side (the maintenance state and
 * `profiles.platform_role`), never from a client value. Fixed-position, so it
 * shifts no layout.
 */
export async function MaintenanceBypassPill() {
  const status = await getMaintenanceStatus();
  if (!isOfflineLevel(status.level)) return null;
  if (!(await isPlatformAdmin())) return null;
  return <BypassPill label={LEVEL_LABEL[status.level]} />;
}
