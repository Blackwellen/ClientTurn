"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/tabs";
import { scheduleMaintenance, updateMaintenance } from "@/lib/maintenance/actions";
import { formatLondon, londonLocalToUtc, utcToLondonLocal } from "@/lib/maintenance/schedule";
import {
  LEVEL_DESCRIPTION,
  LEVEL_LABEL,
  MAINTENANCE_LEVELS,
  MESSAGE_MAX,
  isOfflineLevel,
  type MaintenanceLevel,
} from "@/lib/maintenance/types";
import type { AdminMaintenanceWindow, MaintenanceFormInput } from "@/lib/maintenance/admin-types";
import { useSiteAction } from "./use-site-action";

/**
 * Schedule (or edit) one maintenance window. Every time is typed and shown in
 * Europe/London whatever the operator's machine is set to; the server stores
 * UTC. Saving opens a confirmation that spells out the effect, and for
 * APP_OFFLINE / SITE_OFFLINE it will not proceed until the level's name is
 * typed back exactly. The server checks the same thing again (authz.ts).
 */
export function MaintenanceForm({
  editing,
  onDone,
}: {
  editing?: AdminMaintenanceWindow | null;
  onDone?: () => void;
}) {
  const isEdit = !!editing;
  const active = editing?.phase === "ACTIVE";
  const [level, setLevel] = React.useState<MaintenanceLevel>(editing?.level ?? "READ_ONLY");
  const [startMode, setStartMode] = React.useState<"now" | "scheduled">(isEdit ? "scheduled" : "scheduled");
  const [startsAt, setStartsAt] = React.useState(utcToLondonLocal(editing?.startsAt));
  const [endsAt, setEndsAt] = React.useState(utcToLondonLocal(editing?.endsAt));
  const [expectedBack, setExpectedBack] = React.useState(utcToLondonLocal(editing?.expectedBackAt));
  const [message, setMessage] = React.useState(editing?.message ?? "");
  const [reason, setReason] = React.useState(editing?.reason ?? "");
  const [keepQuote, setKeepQuote] = React.useState(editing?.keepQuotePagesOnline ?? true);
  const [keepAutomation, setKeepAutomation] = React.useState(editing?.keepAutomationRunning ?? false);
  const [announce, setAnnounce] = React.useState(editing?.announceBanner ?? true);
  const [notify, setNotify] = React.useState(editing?.notifyOwners ?? false);
  const [confirming, setConfirming] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, stepUpDialog } = useSiteAction();
  const ids = React.useId();

  const offline = isOfflineLevel(level);
  const needsTyping = offline && (!isEdit || editing?.level !== level || editing?.phase === "SCHEDULED");

  function validate(): string | null {
    if (!active && startMode === "scheduled") {
      const start = londonLocalToUtc(startsAt);
      if (!start) return "Choose when maintenance starts.";
      if (Date.parse(start) <= Date.now()) return "The start must be in the future, or choose Start now.";
    }
    const startIso = active ? editing!.startsAt : startMode === "now" ? new Date().toISOString() : londonLocalToUtc(startsAt);
    if (endsAt) {
      const end = londonLocalToUtc(endsAt);
      if (!end) return "The end time is not valid.";
      if (startIso && Date.parse(end) <= Date.parse(startIso)) return "The end must be after the start.";
    }
    if (expectedBack && !londonLocalToUtc(expectedBack)) return "The expected-back time is not valid.";
    return null;
  }

  function input(): MaintenanceFormInput {
    return {
      level,
      startMode: active ? "now" : startMode,
      startsAtLocal: startMode === "scheduled" && !active ? startsAt : undefined,
      endsAtLocal: endsAt || undefined,
      expectedBackLocal: expectedBack || undefined,
      message: message.trim() || undefined,
      reason: reason.trim() || undefined,
      keepQuotePagesOnline: keepQuote,
      keepAutomationRunning: keepAutomation,
      announceBanner: announce,
      notifyOwners: notify,
      confirmText: needsTyping ? typed : undefined,
    };
  }

  async function submit() {
    const ok = await run("save", () =>
      isEdit ? updateMaintenance({ ...input(), id: editing!.id }) : scheduleMaintenance(input()),
    );
    if (ok) {
      setConfirming(false);
      setTyped("");
      onDone?.();
    }
  }

  const summaryStart = active
    ? `started ${formatLondon(editing!.startsAt)}`
    : startMode === "now"
      ? "starting immediately"
      : `starting ${formatLondon(londonLocalToUtc(startsAt))}`;

  return (
    <>
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const problem = validate();
        setError(problem);
        if (!problem) setConfirming(true);
      }}
      className="space-y-5"
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-content">Level</legend>
        <SegmentedControl
          items={MAINTENANCE_LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] }))}
          value={level}
          onChange={(value) => setLevel(value as MaintenanceLevel)}
          className="max-w-full flex-wrap"
        />
        <p className={cn("text-[12.5px]", offline ? "font-medium text-danger-700" : "text-content-muted")}>
          {LEVEL_DESCRIPTION[level]}
        </p>
      </fieldset>

      {!active ? (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-content">Start</legend>
          {!isEdit ? (
            <SegmentedControl
              size="sm"
              items={[
                { value: "scheduled", label: "Schedule" },
                { value: "now", label: "Start now" },
              ]}
              value={startMode}
              onChange={(value) => setStartMode(value as "now" | "scheduled")}
            />
          ) : null}
          {startMode === "scheduled" ? (
            <FormField label="Starts (UK time)" htmlFor={`${ids}-start`} hint="Europe/London. Stored as UTC.">
              <Input
                id={`${ids}-start`}
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                className="max-w-[260px]"
              />
            </FormField>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-[12.5px] text-content-muted">Started {formatLondon(editing!.startsAt)}. The start of an active window cannot change.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Ends automatically (UK time)"
          htmlFor={`${ids}-end`}
          hint="Leave empty to run until someone ends it."
        >
          <Input id={`${ids}-end`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </FormField>
        <FormField
          label="Expected back (UK time)"
          htmlFor={`${ids}-back`}
          hint="Shown on the maintenance page. Defaults to the end."
        >
          <Input
            id={`${ids}-back`}
            type="datetime-local"
            value={expectedBack}
            onChange={(event) => setExpectedBack(event.target.value)}
          />
        </FormField>
      </div>

      <FormField
        label="Message for customers"
        htmlFor={`${ids}-message`}
        hint={`Plain text, shown on the maintenance page, the status page and the notice. ${message.length}/${MESSAGE_MAX}`}
      >
        <Textarea
          id={`${ids}-message`}
          value={message}
          maxLength={MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="We're upgrading our database. Leads keep arriving and nothing is lost."
        />
      </FormField>

      <FormField label="Internal reason" htmlFor={`${ids}-reason`} hint="Only operators see this, in the history.">
        <Input id={`${ids}-reason`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </FormField>

      <fieldset className="space-y-2.5">
        <legend className="text-[13px] font-medium text-content">Options</legend>
        <CheckRow
          id={`${ids}-quote`}
          checked={keepQuote}
          onChange={setKeepQuote}
          label="Keep public quote pages online"
          hint="/q/* links your customers sent stay reachable (and signable) while the app is offline."
        />
        <CheckRow
          id={`${ids}-automation`}
          checked={keepAutomation}
          onChange={setKeepAutomation}
          label="Keep automated follow-up running"
          hint="Offline levels hold outbound sends until maintenance ends. Tick to keep sending. Read only never holds sends."
        />
        <CheckRow
          id={`${ids}-announce`}
          checked={announce}
          onChange={setAnnounce}
          label="Show an upcoming-maintenance banner 24 hours before"
          hint="In the app for every level, and on the website for Site offline."
        />
        <CheckRow
          id={`${ids}-notify`}
          checked={notify}
          onChange={setNotify}
          disabled={!!editing?.noticeQueuedAt}
          label="Email workspace owners about this maintenance"
          hint={
            editing?.noticeQueuedAt
              ? `Queued ${formatLondon(editing.noticeQueuedAt)}. Sent once per window.`
              : "One email per owner, once per window, counted against each workspace's daily system-email cap."
          }
        />
      </fieldset>

      {error ? (
        <p role="alert" className="text-[12.5px] font-medium text-danger-600">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={offline ? "danger" : "primary"} loading={pending === "save"}>
          {isEdit ? "Save changes" : startMode === "now" ? `Turn on ${LEVEL_LABEL[level].toLowerCase()}` : "Schedule maintenance"}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>

      <Modal
        open={confirming}
        onClose={() => (pending ? undefined : setConfirming(false))}
        title={isEdit ? "Save maintenance changes?" : startMode === "now" ? `Turn on ${LEVEL_LABEL[level]} now?` : "Schedule maintenance?"}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={!!pending}>
              Go back
            </Button>
            <Button
              variant={offline ? "danger" : "primary"}
              size="sm"
              loading={pending === "save"}
              disabled={needsTyping && typed.trim() !== level}
              onClick={submit}
            >
              {offline ? `Confirm ${LEVEL_LABEL[level]}` : "Confirm"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px]">
          <p className="text-content">
            <strong>{LEVEL_LABEL[level]}</strong>, {summaryStart}
            {endsAt ? `, ending ${formatLondon(londonLocalToUtc(endsAt))}` : ", until someone ends it"}.
          </p>
          <p className="text-content-muted">{LEVEL_DESCRIPTION[level]}</p>
          <ul className="list-disc space-y-1 pl-5 text-content-muted">
            <li>Admin, the status page, provider webhooks, the worker and legal pages stay up.</li>
            <li>
              {level === "READ_ONLY" || keepAutomation
                ? "Automated follow-up keeps sending."
                : "Outbound sends wait until maintenance ends, then go out as normal."}
            </li>
            {notify && !editing?.noticeQueuedAt ? <li>Every workspace owner is emailed once.</li> : null}
          </ul>
          {needsTyping ? (
            <div className="rounded-lg border border-danger-100 bg-danger-50 p-3">
              <p className="flex items-center gap-1.5 font-medium text-danger-700">
                <AlertTriangle className="size-4" aria-hidden />
                This takes {level === "SITE_OFFLINE" ? "the whole site" : "the app"} away from customers.
              </p>
              <FormField
                label={`Type ${level} to confirm`}
                htmlFor={`${ids}-typed`}
                className="mt-2"
              >
                <Input
                  id={`${ids}-typed`}
                  value={typed}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setTyped(event.target.value)}
                  className="font-mono"
                />
              </FormField>
              <p className="mt-2 text-[12px] text-content-muted">Your password is asked for again if you have not confirmed it in the last 30 minutes.</p>
            </div>
          ) : null}
        </div>
      </Modal>
      {stepUpDialog}
    </>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-content">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-[12px] text-content-muted">
          {hint}
        </p>
      </div>
    </div>
  );
}
