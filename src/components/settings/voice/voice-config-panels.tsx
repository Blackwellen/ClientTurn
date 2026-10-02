"use client";

import * as React from "react";
import {
  AMBIENT_SOUNDS,
  BRITISH_VOICE_CANDIDATES,
  PREMIUM_MINUTE_FACTOR,
  VOICE_PROVIDERS,
  VOICE_PROVIDER_LABEL,
  candidateFor,
  isPremiumProvider,
  type AmbientSound,
} from "@/lib/voice/voice-profile";
import { Lock } from "lucide-react";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { TransferMode } from "@/lib/voice/settings-model";
import {
  HOURS_BOUNDS,
  STYLE_VIOLATION_TEXT,
  TRANSFER_MODE_LABEL,
  WEEK_DISPLAY,
  lockedOpenerPreview,
  validateEditableSuffix,
  windowProblem,
} from "@/lib/voice/settings-ui";
import { FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useSettingsSave } from "@/components/settings/ai-selling/use-settings-save";
import { saveVoiceSettingsAction } from "@/lib/voice/actions";
import { Notice, PanelCard, SaveFooter, SwitchRow } from "./voice-shared";

/* ------------------------------------------------------------------- agent */

export function AgentPanel({ view }: { view: VoiceSettingsView }) {
  const { save, saving } = useSettingsSave();
  const [personaName, setPersonaName] = React.useState(view.settings.personaName ?? "");
  const [suffix, setSuffix] = React.useState(view.settings.openerSuffix ?? "");
  const locked = lockedOpenerPreview(view.settings.callingAsName, view.settings.recordingEnabled);
  const violations = suffix.trim() ? validateEditableSuffix(suffix).filter((v) => v !== "EMPTY") : [];

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({ agent: { personaName: personaName.trim() || null, openerSuffix: suffix.trim() || null } }),
    );
  }

  return (
    <PanelCard
      title="How the assistant opens"
      description="The first sentences are fixed and always spoken. You can add a short line after them."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={violations.length > 0} />}
    >
      <FormField label="Assistant name (optional)" htmlFor="voice-agent-persona" hint="A first name it may use. It always says it is an AI.">
        <Input id="voice-agent-persona" value={personaName} maxLength={40} disabled={!view.canEdit} onChange={(e) => setPersonaName(e.target.value)} />
      </FormField>
      <FormField
        label="Your line after the opening (optional)"
        htmlFor="voice-agent-suffix"
        hint={`${suffix.trim().length} of 240 characters. No emoji or dashes, and it can't claim to be a person.`}
        error={violations.length ? violations.map((v) => STYLE_VIOLATION_TEXT[v]).filter(Boolean).join(" ") : undefined}
      >
        <Textarea id="voice-agent-suffix" value={suffix} maxLength={240} rows={2} disabled={!view.canEdit} onChange={(e) => setSuffix(e.target.value)} />
      </FormField>

      <div aria-live="polite">
        <p className="mb-1.5 text-[12px] font-medium text-content-muted">Preview, for an enquiry sent yesterday</p>
        {locked ? (
          <blockquote className="rounded-lg border border-line bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed">
            <span className="text-content-muted">
              <Lock className="mr-1 inline size-3 -translate-y-px" aria-label="Fixed text" />
              {locked}
            </span>
            {suffix.trim() && <span className="text-content"> {suffix.trim()}</span>}
          </blockquote>
        ) : (
          <Notice role="status">Add the name you call as in Business identity to see the opening.</Notice>
        )}
      </div>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------- voice */

/**
 * How the assistant sounds (voice-profile.ts). The voices are Retell's British
 * English ones; a premium (ElevenLabs) voice costs 20p a minute more and must
 * be accepted. No voice chosen = the platform default.
 */
export function VoicePanel({ view }: { view: VoiceSettingsView }) {
  const { save, saving } = useSettingsSave();
  const initial = view.settings.voiceProfile;
  const [voiceId, setVoiceId] = React.useState<string>(initial.voiceId ?? "");
  const [speed, setSpeed] = React.useState(initial.speed);
  const [responsiveness, setResponsiveness] = React.useState(initial.responsiveness);
  const [interruption, setInterruption] = React.useState(initial.interruptionSensitivity);
  const [backchannel, setBackchannel] = React.useState(initial.backchannel);
  const [ambient, setAmbient] = React.useState<AmbientSound>(initial.ambient);
  const [premiumAccepted, setPremiumAccepted] = React.useState(initial.premiumAccepted);
  const chosen = candidateFor(voiceId || null);
  const premium = Boolean(chosen && isPremiumProvider(chosen.provider));
  const readOnly = !view.canEdit;

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({
        voiceProfile: {
          voiceId: voiceId || null,
          speed,
          responsiveness,
          interruptionSensitivity: interruption,
          backchannel,
          backchannelFrequency: initial.backchannelFrequency,
          ambient,
          premiumAccepted: premium ? premiumAccepted : false,
        },
      }),
    );
  }

  const slider = (id: string, label: string, hint: string, value: number, set: (n: number) => void, min: number, max: number, step: number, show: (n: number) => string) => (
    <FormField label={`${label}: ${show(value)}`} htmlFor={id} hint={hint}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={readOnly}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-[var(--color-accent,#B7F34A)]"
      />
    </FormField>
  );

  return (
    <PanelCard
      title="How the assistant sounds"
      description="A British English voice and how it paces the conversation."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={premium && !premiumAccepted} />}
    >
      <FormField label="Voice" htmlFor="voice-profile-voice" hint="Standard voices are included. ElevenLabs voices are premium.">
        <select
          id="voice-profile-voice"
          value={voiceId}
          disabled={readOnly}
          onChange={(e) => setVoiceId(e.target.value)}
          className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-content"
        >
          <option value="">Platform default</option>
          {VOICE_PROVIDERS.map((provider) => {
            const voices = BRITISH_VOICE_CANDIDATES.filter((c) => c.provider === provider);
            if (!voices.length) return null;
            return (
              <optgroup key={provider} label={VOICE_PROVIDER_LABEL[provider]}>
                {voices.map((c) => (
                  <option key={c.voiceId} value={c.voiceId}>
                    {c.name} ({c.gender}, {c.age.toLowerCase()})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </FormField>
      {premium && (
        <label className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken p-3 text-[13px] text-content-secondary">
          <input type="checkbox" className="mt-0.5 size-4" checked={premiumAccepted} disabled={readOnly} onChange={(e) => setPremiumAccepted(e.target.checked)} />
          <span>
            <span className="font-medium text-content">Use a premium voice, 20p a minute more.</span> Calls on it use your minutes {PREMIUM_MINUTE_FACTOR} times as fast.
          </span>
        </label>
      )}
      {slider("voice-profile-speed", "Speaking speed", "1.0 is natural. Keep it between 0.9 and 1.1 for a real conversation.", speed, setSpeed, 0.8, 1.2, 0.05, (n) => n.toFixed(2))}
      {slider("voice-profile-responsiveness", "Reply speed", "Higher replies sooner after the lead stops talking.", responsiveness, setResponsiveness, 0, 1, 0.05, (n) => `${Math.round(n * 100)}%`)}
      {slider("voice-profile-interruption", "Lets the lead interrupt", "Higher stops talking sooner when the lead speaks.", interruption, setInterruption, 0, 1, 0.05, (n) => `${Math.round(n * 100)}%`)}
      <label className="flex items-center gap-2 text-[13px] text-content-secondary">
        <input type="checkbox" className="size-4" checked={backchannel} disabled={readOnly} onChange={(e) => setBackchannel(e.target.checked)} />
        Small listening sounds while the lead talks (&quot;mm&quot;, &quot;right&quot;)
      </label>
      <FormField label="Background sound" htmlFor="voice-profile-ambient" hint="None sounds cleanest on a phone line.">
        <select
          id="voice-profile-ambient"
          value={ambient}
          disabled={readOnly}
          onChange={(e) => setAmbient(e.target.value as AmbientSound)}
          className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-content"
        >
          {AMBIENT_SOUNDS.map((a) => (
            <option key={a} value={a}>
              {a === "none" ? "None" : a.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
      </FormField>
    </PanelCard>
  );
}

/* ------------------------------------------------------------------- hours */

type Window = { start: string; end: string } | null;

export function HoursPanel({ view }: { view: VoiceSettingsView }) {
  const { save, saving } = useSettingsSave();
  const [days, setDays] = React.useState<Window[]>(() => [...view.settings.callingHours.days]);
  const [bankHolidays, setBankHolidays] = React.useState(view.settings.callingHours.callOnBankHolidays);
  const readOnly = !view.canEdit;
  const problems = days.map((w) => (w ? windowProblem(w) : null));
  const invalid = problems.some(Boolean);

  function setDay(index: number, next: Window) {
    setDays((d) => d.map((w, i) => (i === index ? next : w)));
  }

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({
        callingHours: { days: days as [Window, Window, Window, Window, Window, Window, Window], callOnBankHolidays: bankHolidays },
      }),
    );
  }

  return (
    <PanelCard
      title="Calling hours"
      description={`In each lead's own time zone. Never before ${HOURS_BOUNDS.earliest} or after ${HOURS_BOUNDS.latest}.`}
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={invalid} />}
    >
      <ul className="divide-y divide-line-subtle">
        {WEEK_DISPLAY.map(({ index, label }) => {
          const w = days[index];
          return (
            <li key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <div className="flex w-36 items-center gap-2.5">
                <Switch
                  label={`Call on ${label}`}
                  checked={Boolean(w)}
                  disabled={readOnly}
                  onCheckedChange={(on) => setDay(index, on ? { start: "09:00", end: "17:00" } : null)}
                />
                <span className="text-[13px] font-medium text-content">{label}</span>
              </div>
              {w ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-content-secondary">
                  <Input
                    type="time"
                    aria-label={`${label} start`}
                    className="w-28"
                    min={HOURS_BOUNDS.earliest}
                    max={HOURS_BOUNDS.latest}
                    step={900}
                    value={w.start}
                    disabled={readOnly}
                    onChange={(e) => setDay(index, { ...w, start: e.target.value })}
                  />
                  <span>to</span>
                  <Input
                    type="time"
                    aria-label={`${label} end`}
                    className="w-28"
                    min={HOURS_BOUNDS.earliest}
                    max={HOURS_BOUNDS.latest}
                    step={900}
                    value={w.end}
                    disabled={readOnly}
                    onChange={(e) => setDay(index, { ...w, end: e.target.value })}
                  />
                  {problems[index] && (
                    <span role="alert" className="text-[12px] text-danger-600">
                      {problems[index]}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[13px] text-content-muted">No calls</span>
              )}
            </li>
          );
        })}
      </ul>
      <SwitchRow
        title="Call on UK bank holidays"
        hint="Off by default. Most people don't expect a business call on a bank holiday."
        control={<Switch label="Call on UK bank holidays" checked={bankHolidays} disabled={readOnly} onCheckedChange={setBankHolidays} />}
      />
    </PanelCard>
  );
}

/* ------------------------------------------------------------------ routes */

export function RoutesPanel({ view, routeLabels }: { view: VoiceSettingsView; routeLabels: Readonly<Record<string, string>> }) {
  const { save, saving } = useSettingsSave();
  const [routes, setRoutes] = React.useState(() => view.routes.map((r) => ({ ...r })));
  const readOnly = !view.canEdit;
  const total = routes.reduce((n, r) => n + (r.enabled && r.percent != null ? r.percent : 0), 0);
  const overBudget = total > 100;

  function update(route: string, patch: Partial<(typeof routes)[number]>) {
    setRoutes((rs) => rs.map((r) => (r.route === route ? { ...r, ...patch } : r)));
  }

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({ routes: routes.map((r) => ({ route: r.route, enabled: r.enabled, percent: r.percent })) }),
    );
  }

  return (
    <PanelCard
      title="Routes"
      description="What the assistant calls for, and what share of your minutes each may use. Leave a share blank for no fixed limit."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={overBudget} note={`Allocated: ${total}% of 100%`} />}
    >
      {overBudget && (
        <Notice tone="danger" role="alert">
          The shares add up to {total}%. Bring them to 100% or less.
        </Notice>
      )}
      <ul className="divide-y divide-line-subtle">
        {routes.map((r) => (
          <li key={r.route} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Switch label={`${routeLabels[r.route] ?? r.route} calls`} checked={r.enabled} disabled={readOnly} onCheckedChange={(on) => update(r.route, { enabled: on })} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-content">{routeLabels[r.route] ?? r.route}</p>
                <p className="text-[12px] text-content-muted">
                  {r.maxMinutes > r.targetMinutes
                    ? `Aims for ${r.targetMinutes} min, never more than ${r.maxMinutes} min`
                    : `Up to ${r.maxMinutes} min`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                aria-label={`${routeLabels[r.route] ?? r.route} share of minutes, percent`}
                className="w-20 text-right tabular-nums"
                value={r.percent ?? ""}
                disabled={readOnly || !r.enabled}
                onChange={(e) => {
                  const raw = e.target.value;
                  update(r.route, { percent: raw === "" ? null : Math.max(0, Math.min(100, Math.round(Number(raw)))) });
                }}
              />
              <span className="text-[13px] text-content-muted">%</span>
            </div>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}

/* ---------------------------------------------------------------- transfer */

export function TransferPanel({ view, transferModes }: { view: VoiceSettingsView; transferModes: readonly string[] }) {
  const { save, saving } = useSettingsSave();
  const [number, setNumber] = React.useState(view.settings.transferNumber ?? "");
  const [mode, setMode] = React.useState(view.settings.transferMode);
  const needsNumber = mode !== "NEVER" && !number.trim();

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({ transfer: { numberE164: number.trim() || null, mode: mode as TransferMode } }),
    );
  }

  return (
    <PanelCard
      title="Human transfer"
      description="When a lead wants a person, the assistant can put them through to your team."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={needsNumber} note={needsNumber ? "Add a number, or choose never." : null} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="When to transfer" htmlFor="voice-transfer-mode">
          <Select
            id="voice-transfer-mode"
            value={mode}
            disabled={!view.canEdit}
            onValueChange={setMode}
            options={transferModes.map((m) => ({ value: m, label: TRANSFER_MODE_LABEL[m as TransferMode] ?? m }))}
          />
        </FormField>
        <FormField label="Transfer to" htmlFor="voice-transfer-number" hint="In international format, like +447700900123.">
          <Input
            id="voice-transfer-number"
            value={number}
            inputMode="tel"
            maxLength={16}
            disabled={!view.canEdit || mode === "NEVER"}
            onChange={(e) => setNumber(e.target.value)}
            className="tabular-nums"
          />
        </FormField>
      </div>
    </PanelCard>
  );
}

/* --------------------------------------------------------------- voicemail */

export function VoicemailPanel({ view }: { view: VoiceSettingsView }) {
  const { save, saving } = useSettingsSave();
  const [enabled, setEnabled] = React.useState(view.settings.voicemailEnabled);
  const [attempts, setAttempts] = React.useState(String(view.settings.maxAttempts));

  function onSave() {
    void save(() => saveVoiceSettingsAction({ voicemail: { enabled, maxAttempts: Number(attempts) } }));
  }

  return (
    <PanelCard
      title="Voicemail and retries"
      description="What happens when a lead doesn't pick up."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} />}
    >
      <SwitchRow
        title="Leave a voicemail"
        hint="When on, the assistant leaves a short message if a call reaches voicemail."
        control={<Switch label="Leave a voicemail" checked={enabled} disabled={!view.canEdit} onCheckedChange={setEnabled} />}
      />
      <FormField label="Most attempts per lead" htmlFor="voice-attempts" hint="Every retry stays within the lead's calling hours." className="max-w-xs">
        <Select
          id="voice-attempts"
          value={attempts}
          disabled={!view.canEdit}
          onValueChange={setAttempts}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? "1 attempt" : `${n} attempts` }))}
        />
      </FormField>
    </PanelCard>
  );
}

/* --------------------------------------------------------------- recording */

export function RecordingPanel({ view }: { view: VoiceSettingsView }) {
  const { save, saving } = useSettingsSave();
  const [enabled, setEnabled] = React.useState(view.settings.recordingEnabled);
  const [days, setDays] = React.useState(String(view.settings.recordingRetentionDays));
  const n = Number(days);
  const invalid = !Number.isInteger(n) || n < 1 || n > 365;

  function onSave() {
    void save(() => saveVoiceSettingsAction({ recording: { enabled, retentionDays: n } }));
  }

  return (
    <PanelCard
      title="Recording and transcription"
      description="Calls are transcribed so the lead record shows what was said. Recording the audio is your choice."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={invalid} />}
    >
      <SwitchRow
        title="Record calls"
        hint="Recordings are stored privately and played back through a link that expires after five minutes."
        control={<Switch label="Record calls" checked={enabled} disabled={!view.canEdit} onCheckedChange={setEnabled} />}
      />
      {enabled && (
        <Notice role="status">
          When recording is on, the assistant always says so at the start of the call, straight after the opening. This notice can&apos;t be switched off.
        </Notice>
      )}
      <FormField
        label="Keep recordings for"
        htmlFor="voice-retention"
        hint="1 to 365 days."
        error={invalid ? "Enter a number of days from 1 to 365." : undefined}
        className="max-w-xs"
      >
        <div className="flex items-center gap-2">
          <Input
            id="voice-retention"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={days}
            disabled={!view.canEdit}
            onChange={(e) => setDays(e.target.value)}
            className="w-24 tabular-nums"
          />
          <span className="text-[13px] text-content-muted">days</span>
        </div>
      </FormField>
    </PanelCard>
  );
}
