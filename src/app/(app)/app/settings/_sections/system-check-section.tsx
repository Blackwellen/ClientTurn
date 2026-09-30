import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { loadSystemCheck } from "@/lib/system-check/load";
import { SYSTEM_CHECK_HREF } from "@/lib/system-check/types";
import { SystemCheckReportView } from "@/components/system-check/system-check-report";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";

/**
 * Settings -> System check (troubleshooting). A live, server-computed
 * checklist per engine: status, the plain-English reason, and a link to the
 * exact setting that changes it. Recomputed on every visit (the page is
 * force-dynamic); "Check again" reloads it.
 *
 * States: loading (the page's skeleton), error (the whole read failed),
 * per-engine "couldn't check" (one engine's read failed), read-only for
 * members and viewers (they see every reason; the fixes need an owner or
 * admin), and integration-required / plan-limit reasons as rows, each
 * linking to Connections or Billing. There is no empty state: every
 * workspace has every engine, even if it is off.
 */
export async function SystemCheckSection() {
  const workspace = await requireWorkspace();
  let report: Awaited<ReturnType<typeof loadSystemCheck>>;
  try {
    report = await loadSystemCheck(workspace.businessId, {
      audience: "customer",
      userId: workspace.userId,
      role: workspace.role,
    });
  } catch (error) {
    console.error("[settings: system check] read failed", error);
    return <SectionLoadError title="System check" href={SYSTEM_CHECK_HREF} />;
  }

  return (
    <div className="space-y-4" data-tour="settings-system-check">
      {!hasRole(workspace.role, "admin") && (
        <ReadOnlyNotice message="You can see why each part is or isn't working. Most fixes need an owner or admin; share this page with one." />
      )}
      <SystemCheckReportView report={report} refreshHref={SYSTEM_CHECK_HREF} />
    </div>
  );
}
