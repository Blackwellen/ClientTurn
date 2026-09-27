import "server-only";
import { Suspense } from "react";
import { requireWorkspace } from "@/lib/auth/session";
import { loadUpsellDecision } from "@/lib/billing/upsell-service";
import { UpsellMoment } from "./upsell-moment";

/**
 * Drop-in for the Dashboard and the lead page. Renders at most one upsell
 * suggestion, decided on the server by upsell-moments.ts (owner/admin only,
 * never in a trial, frequency-capped, snoozable). Streamed behind its own
 * Suspense boundary and never throws: a failed read renders nothing.
 *
 *   * `context="dashboard"`: every moment; a blocker may be a modal.
 *   * `context="lead"` + `leadId`: only that lead's WhatsApp wait and the AI
 *     pause, as banners (a composer is on that page: never a modal there).
 */
export function UpsellMomentMount({
  context,
  leadId,
}: {
  context: "dashboard" | "lead";
  leadId?: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <UpsellMomentLoader context={context} leadId={leadId ?? null} />
    </Suspense>
  );
}

async function UpsellMomentLoader({ context, leadId }: { context: "dashboard" | "lead"; leadId: string | null }) {
  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace) return null;
  const decision = await loadUpsellDecision({
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    context,
    leadId,
  });
  if (!decision?.show) return null;
  if (context === "lead" && decision.moment.leadId && decision.moment.leadId !== leadId) return null;
  return <UpsellMoment moment={decision.moment} canBuy={workspace.role === "owner"} />;
}
