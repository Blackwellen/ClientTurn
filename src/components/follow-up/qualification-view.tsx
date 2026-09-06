import Link from "next/link";
import {
  getQualificationConfig,
  getQualificationMeta,
  getQualificationStats,
} from "@/lib/qualification/queries";
import { toDraftQuestions } from "@/lib/qualification/draft";
import type { Entitlements } from "@/lib/billing/entitlements";
import { PlanLimitState } from "@/components/ui/feedback";
import { QualificationOverview } from "@/components/qualification/qualification-overview";
import { QualificationEditor } from "@/components/qualification/qualification-editor";

/**
 * `QualificationView` — what a good enquiry looks like, and what has happened
 * to the ones that arrived. The overview is read-only live data; everything
 * below it is the draft-then-publish editor.
 */
export async function QualificationView({
  businessId,
  canEdit,
  entitlements,
}: {
  businessId: string;
  canEdit: boolean;
  entitlements: Entitlements;
}) {
  const [config, stats, meta] = await Promise.all([
    getQualificationConfig(businessId),
    getQualificationStats(businessId),
    getQualificationMeta(businessId),
  ]);

  const questions = toDraftQuestions(config.questions, config.rules);

  return (
    <div className="space-y-4">
      {!entitlements.active && (
        <PlanLimitState
          title="Subscription inactive"
          description="Qualification still runs on incoming leads, but changes to questions and rules are paused while the subscription is inactive."
          action={
            <Link
              href="/app/settings?section=billing"
              className="text-content-accent text-[13px] font-medium"
            >
              Review billing
            </Link>
          }
        />
      )}

      {!canEdit && (
        <div className="border-line bg-surface-sunken rounded-lg border px-4 py-3">
          <p className="text-content text-[13px] font-medium">Read-only access</p>
          <p className="text-content-muted mt-0.5 text-[13px]">
            You can see every question, its routing and the live preview outcome.
            Only an owner or admin can change or publish them.
          </p>
        </div>
      )}

      <QualificationOverview stats={stats} />

      <QualificationEditor
        initialQuestions={questions}
        services={config.services}
        serviceArea={config.serviceArea}
        meta={meta}
        canEdit={canEdit && entitlements.active}
      />
    </div>
  );
}
