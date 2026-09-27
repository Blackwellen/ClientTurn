import "server-only";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { requireWorkspace } from "@/lib/auth/session";
import { loadTrialUpgradePrompt } from "@/lib/billing/trial-upgrade-service";
import { dismissalCookieName, isDismissed } from "@/lib/billing/trial-upgrade-prompt";
import { TrialUpgradePrompt } from "./trial-upgrade-prompt";

/**
 * Drop-in for the dashboard, the Inbox and the lead page. Renders nothing
 * unless the workspace is trialling, the viewer is an owner or admin, the
 * trial's SMS is used up and a lead is in a live SMS conversation
 * (trial-upgrade-prompt.ts). Never throws: a failed read renders nothing.
 *
 * Streamed behind its own Suspense boundary: the page never waits on these
 * reads, and while they run there is nothing to show (the prompt is additive,
 * so its loading state is its absence).
 *
 *   * `preferLeadId` alone (the lead page): only that lead is prompted about.
 *   * `preferLeadId` + `anyLead` (the Inbox): that lead first, else the most
 *     relevant waiting lead.
 *   * neither (the dashboard): the most relevant waiting lead.
 */
export function TrialUpgradePromptMount({
  preferLeadId,
  anyLead = false,
}: {
  preferLeadId?: string | null;
  anyLead?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <TrialUpgradePromptLoader preferLeadId={preferLeadId ?? null} anyLead={anyLead} />
    </Suspense>
  );
}

async function TrialUpgradePromptLoader({
  preferLeadId,
  anyLead,
}: {
  preferLeadId: string | null;
  anyLead: boolean;
}) {
  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace) return null;
  const prompt = await loadTrialUpgradePrompt({
    businessId: workspace.businessId,
    role: workspace.role,
    preferLeadId,
  });
  if (!prompt || !prompt.decision.show || !prompt.offer) return null;
  // On a lead's own page, only that lead's conversation is prompted about.
  if (preferLeadId && !anyLead && prompt.decision.leadId !== preferLeadId) return null;

  // Server-safe fallback for "Not now": the cookie mirror of the localStorage
  // dismissal, so the modal stays closed even where storage is blocked. The
  // banner version still renders.
  let dismissedOnServer = false;
  try {
    const jar = await cookies();
    const stored = jar.get(dismissalCookieName(workspace.userId, prompt.decision.leadId))?.value;
    dismissedOnServer = dismissedNow(stored);
  } catch {
    dismissedOnServer = false;
  }

  return (
    <TrialUpgradePrompt
      userId={workspace.userId}
      lead={{ id: prompt.decision.leadId, name: prompt.decision.leadName }}
      offer={prompt.offer}
      canUpgrade={prompt.decision.canUpgrade}
      dismissedOnServer={dismissedOnServer}
    />
  );
}

/** Outside the component: reading the clock is a side effect React's purity rule keeps out of render. */
function dismissedNow(stored: string | undefined): boolean {
  return isDismissed(stored, Date.now());
}
