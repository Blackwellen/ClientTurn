import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  FOLLOW_UP_PAGE_TITLE,
  FOLLOW_UP_VIEW_META,
  parseFollowUpFilters,
} from "@/lib/follow-up/types";
import { PageHeader } from "@/components/app/page-header";
import { SegmentedViewSwitch } from "@/components/follow-up/view-switch";
import { FollowUpView } from "@/components/follow-up/follow-up-view";
import { QualificationView } from "@/components/follow-up/qualification-view";

export const metadata: Metadata = { title: "Follow-Up · Client Turn" };
export const dynamic = "force-dynamic";

/**
 * One route, two views. Follow-Up and Qualification live together because
 * they are two halves of the same decision — who to chase, and who is worth
 * chasing — and the switch between them is URL state, so each is linkable.
 */
export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFollowUpFilters(params);
  const workspace = await requireWorkspace();
  const canEdit = hasRole(workspace.role, "admin");
  const entitlements = await getEntitlements(workspace.businessId);

  return (
    <div className="space-y-5">
      <PageHeader
        size="lg"
        title={FOLLOW_UP_PAGE_TITLE}
        description={FOLLOW_UP_VIEW_META[filters.view].description}
        action={<SegmentedViewSwitch value={filters.view} />}
      />

      {filters.view === "qualification" ? (
        <QualificationView
          businessId={workspace.businessId}
          canEdit={canEdit}
          entitlements={entitlements}
        />
      ) : (
        <FollowUpView
          businessId={workspace.businessId}
          timezone={workspace.timezone}
          canEdit={canEdit}
          entitlements={entitlements}
          filters={filters}
          currentParams={params}
        />
      )}
    </div>
  );
}
