"use client";

import * as React from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { VoiceSettingsSection } from "@/lib/voice/settings-model";
import type { VoicePurchaseState } from "@/lib/billing/voice-purchase";
import { VOICE_PANELS, identityProblemText, voiceStatus } from "@/lib/voice/settings-ui";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/form";
import { PlanLimitState } from "@/components/ui/feedback";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { useSettingsSave } from "@/components/settings/ai-selling/use-settings-save";
import { saveVoiceSettingsAction } from "@/lib/voice/actions";
import { Fact, Notice, PanelCard, SwitchRow } from "./voice-shared";
import { IdentityPanel } from "./voice-identity-panel";
import { NumberPanel } from "./voice-number-panel";
import { AgentPanel, HoursPanel, RecordingPanel, RoutesPanel, TransferPanel, VoicemailPanel, VoicePanel } from "./voice-config-panels";
import { BudgetPanel } from "./voice-budget-panel";

export type VoicePanelsProps = {
  view: VoiceSettingsView;
  purchase: VoicePurchaseState | null;
  initialPanel: VoiceSettingsSection;
  routeLabels: Readonly<Record<string, string>>;
  transferModes: readonly string[];
  trialNote: string;
  isOwner: boolean;
};

/**
 * Settings -> Voice, client side: a panel navigation (a vertical list on wide
 * screens, a scrolling row on a phone) and one panel at a time. The chosen
 * panel is kept in the URL (`&panel=`) with history.replaceState, so a link
 * or a reload lands on it without a server round trip on every click.
 */
export function VoiceSettingsPanels(props: VoicePanelsProps) {
  const { view } = props;
  const [panel, setPanel] = React.useState<VoiceSettingsSection>(props.initialPanel);
  const tabsId = React.useId();

  const select = React.useCallback((next: VoiceSettingsSection) => {
    setPanel(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "voice");
      url.searchParams.set("panel", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // URL state is a convenience; the panel still changes.
    }
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = VOICE_PANELS.findIndex((p) => p.key === panel);
    let next = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % VOICE_PANELS.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + VOICE_PANELS.length) % VOICE_PANELS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = VOICE_PANELS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(VOICE_PANELS[next].key);
    document.getElementById(`${tabsId}-tab-${VOICE_PANELS[next].key}`)?.focus();
  }

  return (
    <div className="space-y-4">
      {!view.canEdit && (
        <ReadOnlyNotice message="Only an owner or admin can change voice settings. You can see every setting here." />
      )}
      {view.settings.adminKillSwitch && (
        <Notice tone="danger" role="alert">
          <span className="font-semibold">AI calling is paused for this workspace by ClientTurn.</span> No calls will be placed until it is resumed. Contact support if you weren&apos;t expecting this.
        </Notice>
      )}
      {!view.integration.ready && (
        <Notice tone="warning" role="status">
          <span className="font-semibold">Calling isn&apos;t connected on this environment yet.</span> You can set everything up here; calls start once it is connected.
          {view.integration.missing.length > 0 && (
            <span className="mt-1 block">Missing: {view.integration.missing.join(", ")}.</span>
          )}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start">
        <div
          role="tablist"
          aria-label="Voice settings"
          onKeyDown={onKeyDown}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:rounded-xl lg:border lg:border-line lg:bg-surface lg:p-1.5 lg:shadow-xs"
        >
          {VOICE_PANELS.map((p) => {
            const active = p.key === panel;
            return (
              <button
                key={p.key}
                id={`${tabsId}-tab-${p.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${tabsId}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => select(p.key)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] font-medium",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  "border lg:border-transparent",
                  active
                    ? "border-accent-500 bg-accent-50/60 text-content lg:border-transparent"
                    : "border-line bg-surface text-content-secondary hover:bg-surface-hover lg:bg-transparent",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${panel}`} className="min-w-0 space-y-4">
          {panel === "overview" && <OverviewPanel {...props} onNavigate={select} />}
          {panel === "identity" && <IdentityPanel view={view} />}
          {panel === "number" && <NumberPanel view={view} onNavigate={select} />}
          {panel === "agent" && (
            <>
              <AgentPanel view={view} />
              <VoicePanel view={view} />
            </>
          )}
          {panel === "hours" && <HoursPanel view={view} />}
          {panel === "routes" && <RoutesPanel view={view} routeLabels={props.routeLabels} />}
          {panel === "transfer" && <TransferPanel view={view} transferModes={props.transferModes} />}
          {panel === "voicemail" && <VoicemailPanel view={view} />}
          {panel === "recording" && <RecordingPanel view={view} />}
          {panel === "budget" && (
            <BudgetPanel view={view} purchase={props.purchase} isOwner={props.isOwner} routeLabels={props.routeLabels} onNavigate={select} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function OverviewPanel({ view, trialNote, onNavigate }: VoicePanelsProps & { onNavigate: (p: VoiceSettingsSection) => void }) {
  const { save, saving } = useSettingsSave();
  const status = voiceStatus({
    locked: view.entitlement.locked,
    adminKillSwitch: view.settings.adminKillSwitch,
    integrationReady: view.integration.ready,
    voiceEnabled: view.settings.voiceEnabled,
    allowed: view.entitlement.allowed,
  });
  const minutesLeft = view.minutes.includedRemainingMin + view.minutes.packRemainingMin;
  const noMinutes = !view.minutes.available || minutesLeft <= 0;

  const checklist: { done: boolean; label: string; panel: VoiceSettingsSection }[] = [
    { done: view.identity.ready, label: "Business identity complete", panel: "identity" },
    { done: view.regulatory.ready, label: "Business details for your number", panel: "identity" },
    { done: view.number.stage === "ACTIVE", label: "Dedicated number active", panel: "number" },
    { done: !noMinutes, label: "Minutes available", panel: "budget" },
    { done: view.settings.voiceEnabled, label: "Voice calling switched on", panel: "overview" },
    // Every call tool runs through the AI assistant: with it off, a call can't
    // record answers or arrange anything (live call 2026-09-28). Fixed in
    // Settings, Workspace, so no "Open" here; the notice below says where.
    { done: !view.entitlement.reasons.includes("AI_ASSISTANT_OFF"), label: "AI assistant switched on (Settings, Workspace)", panel: "overview" },
  ];

  function toggle(next: boolean) {
    void save(() => saveVoiceSettingsAction({ voiceEnabled: next }));
  }

  return (
    <>
      <PanelCard
        title="Voice calling"
        description="An AI assistant phones your leads from your own number, within their calling hours."
        aside={<StatusBadge kind="voice_status" value={status} />}
      >
        <SwitchRow
          title="AI calls for this workspace"
          hint={
            view.identity.ready
              ? "When on, the assistant can call leads who are eligible. Every call is checked again just before it dials."
              : "Complete your business identity before switching this on."
          }
          control={
            <Switch
              label="AI calls for this workspace"
              checked={view.settings.voiceEnabled}
              disabled={!view.canEdit || saving || (!view.settings.voiceEnabled && !view.identity.ready)}
              onCheckedChange={toggle}
              tone="success"
            />
          }
        />
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Number">
            {view.number.e164 ? <span className="tabular-nums">{view.number.e164}</span> : view.number.stageLabel}
          </Fact>
          <Fact label="Minutes left">
            <span className="tabular-nums">{minutesLeft.toLocaleString("en-GB")}</span>
            <span className="font-normal text-content-muted">
              {" "}({view.minutes.includedRemainingMin} included, {view.minutes.packRemainingMin} from packs)
            </span>
          </Fact>
          <Fact label="Included minutes reset">{view.minutes.periodEnd ? formatDate(view.minutes.periodEnd) : "Not on a voice plan"}</Fact>
        </dl>
        {/* Only a trialling workspace needs the trial rule; a trial is shown the locked
            state instead of these panels, so this is normally absent (QA 2026-09-30:
            a paid Pro workspace was told "trials don't place live calls"). */}
        {view.entitlement.reasons.includes("TRIAL_ACCOUNT") && <p className="text-[12.5px] text-content-muted">{trialNote}</p>}
      </PanelCard>

      {noMinutes && (
        <PlanLimitState
          title="No voice minutes left"
          description="Calls stay queued until you have minutes. Included minutes reset each month; a minute pack tops you up now and never expires."
          action={
            <Button size="sm" variant="secondary" onClick={() => onNavigate("budget")}>
              Buy minutes
            </Button>
          }
        />
      )}

      {!view.entitlement.allowed && view.entitlement.message && !noMinutes && (
        <Notice tone="warning" role="status">
          <span className="font-semibold">Why calls aren&apos;t placed yet:</span> {view.entitlement.message}
        </Notice>
      )}

      <PanelCard title="Set-up" description="What voice needs before the assistant can call.">
        <ul className="space-y-2">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                {item.done ? (
                  <Check className="size-4 shrink-0 text-success-600" aria-hidden />
                ) : (
                  <Circle className="size-4 shrink-0 text-content-subtle" aria-hidden />
                )}
                <span className={item.done ? "text-content-secondary" : "text-content"}>{item.label}</span>
                <span className="sr-only">{item.done ? "(done)" : "(to do)"}</span>
              </span>
              {!item.done && item.panel !== "overview" && (
                <Button size="xs" variant="ghost" onClick={() => onNavigate(item.panel)}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!view.identity.ready && view.identity.problems.length > 0 && (
          <ul className="list-disc pl-5 text-[12.5px] text-content-muted">
            {view.identity.problems.map((p) => (
              <li key={p}>{identityProblemText(p)}</li>
            ))}
          </ul>
        )}
      </PanelCard>
    </>
  );
}
