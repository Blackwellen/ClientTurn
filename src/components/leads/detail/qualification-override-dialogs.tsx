"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Gauge, PenLine, RefreshCcw, Route, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  INTENT_STATE_COPY,
  NBA_ACTION_COPY,
  NBA_OVERRIDE_ACTIONS,
  dimensionLabel,
  type NbaOverrideAction,
} from "@/lib/qualification-intelligence/explain";
import {
  INTENT_STATES,
  NBA_HANDOVER_REASONS,
  QI_DIMENSION_KEYS,
  type IntentState,
  type QiDimensionKey,
} from "@/lib/qualification-intelligence/types";
import {
  overrideIntentAction,
  overrideNextActionAction,
  requalifyLeadAction,
  setQualificationFactAction,
  type QualificationActionResult,
} from "@/lib/leads/qualification-actions";

/**
 * The Lead page's qualification corrections. Each is a registry operation
 * behind a server action, audited with the before and after, and shown in the
 * lead's qualification history. Nothing here decides: a person's correction is
 * recorded, and the engine reassesses from it.
 */

function useRun() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async (fn: () => Promise<QualificationActionResult>) => {
      setPending(true);
      try {
        const result = await fn();
        if (result.ok) {
          toast({ variant: "success", title: result.message });
          router.refresh();
        } else {
          toast({ variant: "error", title: result.error });
        }
        return result.ok;
      } catch {
        toast({ variant: "error", title: "That could not be saved. Try again." });
        return false;
      } finally {
        setPending(false);
      }
    },
    [router, toast],
  );
  return { run, pending };
}

/** A `datetime-local` value as an ISO instant, or undefined when blank. */
function isoFromLocal(value: string): string | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/**
 * A "holds until" / "resume on" time must be in the future. Checked here so it
 * is said beside the field, in words; the service refuses it too, but its
 * message ("until: The date must be in the future.") arrived as a bare toast.
 */
function pastDateError(value: string): string | null {
  const iso = isoFromLocal(value);
  if (!iso) return null;
  return new Date(iso).getTime() <= Date.now() ? "Pick a date and time in the future." : null;
}

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* --------------------------------------------------------------- requalify */

export function RequalifyButton({ leadId, disabled, size = "sm" }: { leadId: string; disabled?: boolean; size?: "xs" | "sm" }) {
  const { run, pending } = useRun();
  return (
    <Button
      size={size}
      variant="secondary"
      loading={pending}
      disabled={disabled || pending}
      onClick={() => run(() => requalifyLeadAction({ leadId, reason: "Re-run from the lead page" }))}
    >
      <RefreshCcw className="size-3.5" aria-hidden />
      Re-run qualification
    </Button>
  );
}

/* ------------------------------------------------------------------ facts */

/** Confirm or reject one inferred or conflicting value, inline. */
export function FactActions({
  leadId,
  factId,
  value,
  label,
}: {
  leadId: string;
  factId: string;
  value: string;
  label: string;
}) {
  const { run, pending } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        aria-label={`Confirm ${label}: ${value}`}
        onClick={() => run(() => setQualificationFactAction({ leadId, action: "CONFIRM", factId }))}
      >
        <Check className="size-3.5" aria-hidden />
        Confirm
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        aria-label={`Reject ${label}: ${value}`}
        onClick={() => run(() => setQualificationFactAction({ leadId, action: "REJECT", factId }))}
      >
        <X className="size-3.5" aria-hidden />
        Reject
      </Button>
    </span>
  );
}

/** Set a dimension's value outright (also resolves a conflict). */
export function SetFactDialog({
  leadId,
  dimension,
  triggerLabel = "Set a value",
}: {
  leadId: string;
  dimension?: QiDimensionKey;
  triggerLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<QiDimensionKey>(dimension ?? "TIMING");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending } = useRun();

  const submit = async () => {
    if (!value.trim()) {
      setError("Enter the value.");
      return;
    }
    const ok = await run(() =>
      setQualificationFactAction({ leadId, action: "SET", dimension: chosen, value, reason: reason || undefined }),
    );
    if (ok) {
      setOpen(false);
      setValue("");
      setReason("");
    }
  };

  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <PenLine className="size-3.5" aria-hidden />
        {triggerLabel}
      </Button>
      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title={dimension ? `Set ${dimensionLabel(dimension).toLowerCase()}` : "Set a qualification detail"}
        description="Recorded as confirmed by you. Any other live value for this detail is replaced, and the lead is reassessed."
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={submit}>
              Save value
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!dimension && (
            <FormField label="Detail" htmlFor="set-fact-dimension">
              <Select
                id="set-fact-dimension"
                value={chosen}
                onChange={(event) => setChosen(event.target.value as QiDimensionKey)}
              >
                {QI_DIMENSION_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {dimensionLabel(key)}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Value" htmlFor="set-fact-value" error={error ?? undefined} required>
            <Input
              id="set-fact-value"
              value={value}
              maxLength={500}
              placeholder="As the lead would say it, e.g. 40 staff"
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
          </FormField>
          <FormField label="Why (optional)" htmlFor="set-fact-reason" hint="Kept in the qualification history.">
            <Input id="set-fact-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
          </FormField>
        </div>
      </Modal>
    </>
  );
}

/* ----------------------------------------------------------------- intent */

export function IntentOverrideDialog({ leadId, current }: { leadId: string; current: IntentState | null }) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<IntentState>(current ?? "MEDIUM");
  const [reason, setReason] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [untilError, setUntilError] = React.useState<string | null>(null);
  const { run, pending } = useRun();
  const [minDate, setMinDate] = React.useState("");

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Say why, in a few words.");
      return;
    }
    const past = pastDateError(until);
    if (past) {
      setUntilError(past);
      return;
    }
    const ok = await run(() => overrideIntentAction({ leadId, state, reason, until: isoFromLocal(until) }));
    if (ok) setOpen(false);
  };

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setMinDate(localInputValue(new Date(Date.now() + 60_000)));
          setOpen(true);
        }}
      >
        <Gauge className="size-3.5" aria-hidden />
        Override intent
      </Button>
      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title="Override buying intent"
        description="Use this when you know something the messages do not show, such as a phone call. It is recorded with your name and reason."
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={submit}>
              Save override
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Intent" htmlFor="intent-override-state" hint={INTENT_STATE_COPY[state].description}>
            <Select id="intent-override-state" value={state} onChange={(event) => setState(event.target.value as IntentState)}>
              {INTENT_STATES.map((key) => (
                <option key={key} value={key}>
                  {INTENT_STATE_COPY[key].label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reason" htmlFor="intent-override-reason" error={error ?? undefined} required>
            <Textarea
              id="intent-override-reason"
              value={reason}
              maxLength={200}
              rows={2}
              placeholder="e.g. Spoke on the phone; they want to start in March"
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </FormField>
          <FormField
            label={state === "NOT_NOW" ? "Resume on" : "Holds until (optional)"}
            htmlFor="intent-override-until"
            error={untilError ?? undefined}
            hint={
              state === "NOT_NOW"
                ? "Follow-up waits until then. Left blank, it waits 60 days."
                : "After this date the engine's own assessment applies again."
            }
          >
            <Input
              id="intent-override-until"
              type="datetime-local"
              min={minDate}
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
                setUntilError(null);
              }}
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------- next best action */

const HANDOVER_REASON_COPY: Record<(typeof NBA_HANDOVER_REASONS)[number], string> = {
  QUALIFICATION_REVIEW: "Qualification needs review",
  LOW_CONFIDENCE: "Low confidence",
  HIGH_VALUE: "High-value deal",
  NO_NEXT_QUESTION: "No useful question left",
  READY_TO_BUY: "Ready to buy",
  POLICY: "Workspace policy",
  HUMAN_REQUESTED: "The lead asked for a person",
  COMPLAINT: "Complaint",
};

export function NbaOverrideDialog({
  leadId,
  intentState,
}: {
  leadId: string;
  intentState: IntentState | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [action, setAction] = React.useState<NbaOverrideAction>("ESCALATE");
  const [reason, setReason] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [handover, setHandover] = React.useState<(typeof NBA_HANDOVER_REASONS)[number]>("POLICY");
  const [error, setError] = React.useState<string | null>(null);
  const [untilError, setUntilError] = React.useState<string | null>(null);
  const { run, pending } = useRun();
  const [minDate, setMinDate] = React.useState("");
  const negative = intentState === "NEGATIVE";
  const options = NBA_OVERRIDE_ACTIONS.filter((a) => !(negative && a.startsWith("CTA_")));

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Say why, in a few words.");
      return;
    }
    if (action === "WAIT" && !until) {
      setUntilError("Say when to resume.");
      return;
    }
    const past = pastDateError(until);
    if (past) {
      setUntilError(past);
      return;
    }
    const ok = await run(() =>
      overrideNextActionAction({
        leadId,
        action,
        reason,
        until: isoFromLocal(until),
        handoverReason: action === "ESCALATE" ? handover : undefined,
      }),
    );
    if (ok) setOpen(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setMinDate(localInputValue(new Date(Date.now() + 60_000)));
          setOpen(true);
        }}
      >
        <Route className="size-3.5" aria-hidden />
        Override
      </Button>
      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title="Override the next best action"
        description="Choose what should happen next instead. It is recorded with your name and reason, and holds until the lead does something new."
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={submit}>
              Save override
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Next action" htmlFor="nba-override-action" hint={NBA_ACTION_COPY[action].description}>
            <Select id="nba-override-action" value={action} onChange={(event) => setAction(event.target.value as NbaOverrideAction)}>
              {options.map((key) => (
                <option key={key} value={key}>
                  {NBA_ACTION_COPY[key].label}
                </option>
              ))}
            </Select>
          </FormField>
          {negative && (
            <p className="text-[12px] text-content-muted">
              This lead is marked not interested, so meeting, checkout and sign-up offers are not available.
            </p>
          )}
          {action === "ESCALATE" && (
            <FormField label="Why a person is needed" htmlFor="nba-override-handover">
              <Select
                id="nba-override-handover"
                value={handover}
                onChange={(event) => setHandover(event.target.value as (typeof NBA_HANDOVER_REASONS)[number])}
              >
                {NBA_HANDOVER_REASONS.map((key) => (
                  <option key={key} value={key}>
                    {HANDOVER_REASON_COPY[key]}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Reason" htmlFor="nba-override-reason" error={error ?? undefined} required>
            <Textarea
              id="nba-override-reason"
              value={reason}
              maxLength={200}
              rows={2}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </FormField>
          <FormField
            label={action === "WAIT" ? "Resume on" : "Holds until (optional)"}
            htmlFor="nba-override-until"
            required={action === "WAIT"}
            error={untilError ?? undefined}
          >
            <Input
              id="nba-override-until"
              type="datetime-local"
              min={minDate}
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
                setUntilError(null);
              }}
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
