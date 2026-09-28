import * as React from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { loadVoiceSettingsView } from "@/lib/voice/ui-queries";
import { ROUTE_LABEL, TRANSFER_MODES } from "@/lib/voice/settings-model";
import { parseVoicePanel } from "@/lib/voice/settings-ui";
import { getVoicePurchaseStateAction } from "@/lib/billing/voice-actions";
import type { VoicePurchaseState } from "@/lib/billing/voice-purchase";
import { VOICE_TRIAL_NOTE } from "@/lib/marketing/voice-offer";
import { PlanLimitState } from "@/components/ui/feedback";
import { PermissionDenied } from "@/components/settings/notices";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";
import { VoiceSettingsPanels } from "@/components/settings/voice/voice-settings-panels";

/**
 * Settings -> Voice (voice P2, gap map §44). One Settings section, not a new
 * destination (V3). Progressive disclosure: one panel at a time, chosen by a
 * sub-navigation and linkable as `?section=voice&panel=<panel>`.
 *
 * Everything is read through `voice.settings_get` and written through
 * `voice.settings_update` and the number operations, which enforce the
 * section RBAC, the OD-1 identity rule and the entitlement gate server-side.
 *
 * States: loading (the page's skeleton), error, permission-denied, locked
 * (trial or no voice on the plan: an upgrade path only, never anything that
 * places a call), integration-required (calling not connected: a banner, with
 * what is missing listed for admins), plan-limit-reached (no minutes left),
 * paused by ClientTurn, read-only for members and viewers, and empty states
 * inside the panels (no number yet, nothing in the timeline).
 */
export async function VoiceSection({ panel }: { panel?: string | string[] }) {
  const workspace = await requireWorkspace();
  const href = "/app/settings?section=voice";

  let view: Awaited<ReturnType<typeof loadVoiceSettingsView>>;
  let purchase: VoicePurchaseState | null = null;
  try {
    [view, purchase] = await Promise.all([
      loadVoiceSettingsView(workspace.businessId, workspace.userId, workspace.role),
      hasRole(workspace.role, "member") ? getVoicePurchaseStateAction().catch(() => null) : Promise.resolve(null),
    ]);
  } catch (error) {
    console.error("[settings: voice] read failed", error);
    return <SectionLoadError title="Voice" href={href} />;
  }

  if (!view.ok) {
    if (view.code === "FORBIDDEN_ROLE" || view.code === "FORBIDDEN_SCOPE") {
      return <PermissionDenied description="Your role in this workspace can't see voice settings. Ask an owner or admin." />;
    }
    return <SectionLoadError title="Voice" href={href} />;
  }

  const data = view.data;
  if (data.entitlement.locked) {
    return (
      <div className="space-y-4">
        <PlanLimitState
          title="AI calling isn't on your plan"
          description={`${VOICE_TRIAL_NOTE} ${data.entitlement.message ?? "Choose a paid plan with voice, or add a minute pack, to have the AI assistant call your leads."}`}
          action={
            <Link
              href="/app/settings?section=billing"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              See plans and upgrade
            </Link>
          }
        />
        <section className="rounded-xl border border-line bg-surface px-5 py-4 shadow-xs">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Phone className="size-4 text-content-muted" aria-hidden />
            What voice does
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-content-secondary">
            <li>An AI assistant phones new leads from your own UK business number, within their calling hours.</li>
            <li>It says it is an AI calling from your business before anything else, and the recording notice when recording is on.</li>
            <li>Every call lands on the lead with a summary, transcript and next step.</li>
          </ul>
        </section>
      </div>
    );
  }

  return (
    <VoiceSettingsPanels
      view={data}
      purchase={purchase}
      initialPanel={parseVoicePanel(Array.isArray(panel) ? panel[0] : panel)}
      routeLabels={ROUTE_LABEL}
      transferModes={TRANSFER_MODES}
      trialNote={VOICE_TRIAL_NOTE}
      isOwner={hasRole(workspace.role, "owner")}
    />
  );
}
