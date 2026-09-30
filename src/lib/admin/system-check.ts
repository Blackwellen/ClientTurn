import "server-only";
import { recordAudit } from "@/lib/audit";
import { loadSystemCheck } from "@/lib/system-check/load";
import type { SystemCheckReport } from "@/lib/system-check/types";
import { requirePlatformAdmin } from "./guard";

/**
 * Admin -> Customers -> support drawer: the customer's own System check,
 * read-only. The same rules and the same report the customer sees in
 * Settings -> System check, so support and customer never disagree about
 * why something isn't working. Platform admin only (checked server-side
 * against profiles.platform_role), and the read is audited as a support view.
 * The admin audience adds the missing voice credentials and the latest
 * dead-job error, which the customer can't act on.
 */
export async function getCustomerSystemCheck(businessId: string): Promise<SystemCheckReport> {
  const operator = await requirePlatformAdmin();
  await recordAudit({
    businessId,
    actorUserId: operator.id,
    actorType: "platform_admin",
    action: "admin.support_view",
    entityType: "business",
    entityId: businessId,
    metadata: { surface: "customer_system_check" },
  });
  return loadSystemCheck(businessId, { audience: "admin", userId: null, role: "admin" });
}
