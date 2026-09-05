"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Copy,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Select, Switch, Textarea } from "@/components/ui/form";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { MergeFieldMenu } from "@/components/follow-up/merge-field-menu";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import {
  createAutomation,
  updateFollowUpSequence,
} from "@/lib/automations/actions";
import {
  CHANNELS,
  CHANNEL_LABEL,
  type AutomationDetail,
  type Channel,
  type StepInput,
} from "@/lib/automations/types";
import {
  DELAY_UNITS,
  DELAY_UNIT_META,
  MAX_SEQUENCE_STEPS,
  formatStepDelay,
  joinDelay,
  splitDelay,
  validateSequence,
  type DelayUnit,
} from "@/lib/follow-up/types";
import { cn } from "@/lib/cn";

type DraftStep = {
  key: string;
  delaySeconds: number;
  channel: Channel;
  template: string;
  enabled: boolean;
};

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  sms: MessageSquare,
  whatsapp: MessageCircle,
};

function newKey() {
  return `step-${Math.random().toString(36).slice(2, 10)}`;
}

function toDraft(steps: AutomationDetail["steps"]): DraftStep[] {
  return steps.map((step) => ({
    key: step.id,
    delaySeconds: step.delaySeconds,
    channel: step.channel,
    template: step.template,
    enabled: step.enabled,
  }));
}

function toInputs(rows: DraftStep[]): StepInput[] {
  return rows.map((row) => ({
    delaySeconds: row.delaySeconds,
    channel: row.channel,
    template: row.template,
    enabled: row.enabled,
  }));
}

/**
 * The Follow-Up sequence editor.
 *
 * One compact row per step — delay, channel, message, merge fields, on/off —
 * because the thing being configured is a short list of messages, not a
 * workflow graph. "Update sequence" saves the draft and publishes it in one
 * press; the underlying versioning is unchanged, so leads part-way through a
 * sequence still finish on the version they started.
 */
export function SequenceEditor({
  automation,
  canEdit,
  whatsappEnabled,
}: {
  automation: AutomationDetail | null;
  canEdit: boolean;
  whatsappEnabled: boolean;
}) {
  const { toast } = useToast();
  const [steps, setSteps] = React.useState<DraftStep[]>(() =>
    automation ? toDraft(automation.steps) : [],
  );
  const [saving, setSaving] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState<DraftStep | null>(null);
  const templateRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});
  const focusNext = React.useRef<string | null>(null);

  // Re-seed when the server sends a new version of the sequence (after a
  // publish, or when the user opens a different sequence).
  const signature = React.useMemo(
    () => JSON.stringify(automation ? toInputs(toDraft(automation.steps)) : []),
    [automation],
  );
  const [seeded, setSeeded] = React.useState(signature);
  if (seeded !== signature) {
    setSeeded(signature);
    setSteps(automation ? toDraft(automation.steps) : []);
  }

  const dirty = JSON.stringify(toInputs(steps)) !== signature;

  // Focus a newly added or duplicated step so the keyboard stays in flow.
  React.useEffect(() => {
    if (!focusNext.current) return;
    templateRefs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });

  const issues = validateSequence(steps, {
    unknownTokensFor: findUnknownMergeFields,
    whatsappEnabled,
  });

  function patch(key: string, next: Partial<DraftStep>) {
    setSteps((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...next } : row)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((rows) => {
      const target = index + direction;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStep() {
    if (steps.length >= MAX_SEQUENCE_STEPS) {
      toast({
        variant: "error",
        title: `A sequence can hold at most ${MAX_SEQUENCE_STEPS} steps.`,
      });
      return;
    }
    const key = newKey();
    focusNext.current = key;
    setSteps((rows) => [
      ...rows,
      {
        key,
        // The first step normally fires while the enquiry is still warm;
        // anything after it defaults to a day later.
        delaySeconds: rows.length === 0 ? 0 : 86400,
        channel: "sms",
        template: "",
        enabled: true,
      },
    ]);
  }

  function duplicate(index: number) {
    const source = steps[index];
    const key = newKey();
    focusNext.current = key;
    setSteps((rows) => [
      ...rows.slice(0, index + 1),
      { ...source, key },
      ...rows.slice(index + 1),
    ]);
  }

  async function createSequence() {
    setCreating(true);
    try {
      const result = await createAutomation({ type: "new_lead" });
      if (result.ok) {
        toast({ variant: "success", title: "Follow-up sequence created" });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setCreating(false);
    }
  }

  async function publish() {
    if (!automation) return;
    setSaving(true);
    try {
      const result = await updateFollowUpSequence({
        automationId: automation.id,
        name: automation.name,
        steps: toInputs(steps),
      });
      if (result.ok) {
        toast({ variant: "success", title: "Follow-up sequence updated" });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setSaving(false);
    }
  }

  if (!automation) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={MessageSquare}
            title="No follow-up sequence yet"
            description="A sequence chases every new lead automatically until they reply, book, or the sequence ends. Nothing sends until you publish it."
            action={
              canEdit ? (
                <Button onClick={createSequence} loading={creating}>
                  <Plus className="size-3.5" />
                  Create follow-up sequence
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <SectionHeader
            icon={MessageSquare}
            tone="info"
            title="Follow-up sequence"
            description="Send a series of automated messages to new leads who haven't booked yet."
          />
        </CardHeader>

        <CardContent className="space-y-2.5 pt-4">
          {steps.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No steps yet"
              description="A sequence needs at least one message. The first step usually goes out immediately, while the enquiry is still fresh."
              action={
                canEdit ? (
                  <Button size="sm" onClick={addStep}>
                    <Plus className="size-3.5" />
                    Add the first step
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ol className="space-y-2.5">
              {steps.map((step, index) => (
                <SequenceRow
                  key={step.key}
                  step={step}
                  index={index}
                  total={steps.length}
                  canEdit={canEdit}
                  whatsappEnabled={whatsappEnabled}
                  textareaRef={(element) => {
                    templateRefs.current[step.key] = element;
                  }}
                  getRef={() => ({ current: templateRefs.current[step.key] ?? null })}
                  onPatch={(next) => patch(step.key, next)}
                  onMove={(direction) => move(index, direction)}
                  onDuplicate={() => duplicate(index)}
                  onRemove={() => setConfirmRemove(step)}
                />
              ))}
            </ol>
          )}

          {canEdit && steps.length > 0 && (
            <button
              type="button"
              onClick={addStep}
              className={cn(
                "border-line-strong text-content-secondary hover:bg-surface-hover hover:text-content",
                "flex h-10 w-auto items-center gap-2 rounded-lg border px-4 text-[13px] font-medium",
                "transition-colors duration-[var(--lr-duration-fast)]",
                "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
              )}
            >
              <Plus className="size-4" aria-hidden />
              Add another step
            </button>
          )}

          {steps.length > 0 && (
            <SequenceFooter
              issues={issues}
              canEdit={canEdit}
              dirty={dirty}
              saving={saving}
              onPublish={publish}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          setSteps((rows) => rows.filter((row) => row.key !== confirmRemove?.key));
          setConfirmRemove(null);
        }}
        variant="danger"
        title="Remove this step?"
        scope={
          confirmRemove
            ? `${formatStepDelay(confirmRemove.delaySeconds)} · ${
                CHANNEL_LABEL[confirmRemove.channel]
              }`
            : ""
        }
        consequence="The step is removed from your draft. Nothing changes for leads until you press Update sequence."
        confirmLabel="Remove step"
      />
    </>
  );
}

/* ------------------------------------------------------------------- row */

function SequenceRow({
  step,
  index,
  total,
  canEdit,
  whatsappEnabled,
  textareaRef,
  getRef,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  step: DraftStep;
  index: number;
  total: number;
  canEdit: boolean;
  whatsappEnabled: boolean;
  textareaRef: (element: HTMLTextAreaElement | null) => void;
  getRef: () => React.RefObject<HTMLTextAreaElement | null>;
  onPatch: (next: Partial<DraftStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { value, unit } = splitDelay(step.delaySeconds);
  const unknown = findUnknownMergeFields(step.template);
  const ChannelIcon = CHANNEL_ICON[step.channel];
  const empty = step.template.trim() === "";
  const invalid = unknown.length > 0 || empty;
  const rowId = `step-${step.key}`;

  return (
    <li
      className={cn(
        "border-line bg-surface rounded-lg border p-3",
        "focus-within:border-accent-500 transition-colors duration-[var(--lr-duration-fast)]",
        invalid && "border-danger-500/60",
        !step.enabled && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* number + timing */}
        <div className="flex items-center gap-2.5 lg:w-[9.5rem] lg:shrink-0 lg:pt-1.5">
          <span
            aria-hidden
            className="bg-surface-sunken border-line text-content lr-tabular flex size-7 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold"
          >
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-content text-[13px] font-semibold">
              {formatStepDelay(step.delaySeconds)}
            </p>
            <p className="text-content-subtle text-[12px]">
              {index === 0 ? "Send right away" : "After previous message"}
            </p>
          </div>
        </div>

        {/* delay editor */}
        <div className="flex items-start gap-2 lg:w-[11rem] lg:shrink-0">
          <label className="sr-only" htmlFor={`${rowId}-unit`}>
            {`Step ${index + 1} delay unit`}
          </label>
          {unit !== "immediate" && (
            <>
              <label className="sr-only" htmlFor={`${rowId}-value`}>
                {`Step ${index + 1} delay amount`}
              </label>
              <input
                id={`${rowId}-value`}
                type="number"
                min={1}
                max={999}
                inputMode="numeric"
                value={value}
                disabled={!canEdit}
                onChange={(event) =>
                  onPatch({
                    delaySeconds: joinDelay(
                      Math.max(1, Number(event.target.value) || 1),
                      unit,
                    ),
                  })
                }
                className={cn(
                  "bg-surface text-content border-line-strong shadow-xs h-9 w-14 rounded-md border px-2 text-center text-[13px]",
                  "focus:border-accent-500 focus:ring-[var(--lr-ring)] focus:ring-2 focus:outline-none",
                  "disabled:bg-surface-sunken disabled:text-content-muted",
                )}
              />
            </>
          )}
          <Select
            id={`${rowId}-unit`}
            className="h-9 text-[13px]"
            value={unit}
            disabled={!canEdit}
            onChange={(event) => {
              const next = event.target.value as DelayUnit;
              onPatch({ delaySeconds: joinDelay(value || 1, next) });
            }}
          >
            {DELAY_UNITS.map((option) => (
              <option
                key={option}
                value={option}
                // Only the opening step may fire with no delay; anything else
                // would send two messages in the same instant.
                disabled={option === "immediate" && index > 0}
              >
                {option === "immediate"
                  ? "Immediately"
                  : DELAY_UNIT_META[option].plural}
              </option>
            ))}
          </Select>
        </div>

        {/* channel */}
        <div className="lg:w-[8.5rem] lg:shrink-0">
          <label className="sr-only" htmlFor={`${rowId}-channel`}>
            {`Step ${index + 1} channel`}
          </label>
          <div className="relative">
            <ChannelIcon
              aria-hidden
              className="text-content-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Select
              id={`${rowId}-channel`}
              className="h-9 pl-8 text-[13px]"
              value={step.channel}
              disabled={!canEdit}
              onChange={(event) =>
                onPatch({ channel: event.target.value as Channel })
              }
            >
              {CHANNELS.map((channel) => (
                <option
                  key={channel}
                  value={channel}
                  disabled={channel === "whatsapp" && !whatsappEnabled}
                >
                  {CHANNEL_LABEL[channel]}
                  {channel === "whatsapp" && !whatsappEnabled
                    ? " — Growth plan"
                    : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* message */}
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor={`${rowId}-template`}>
            {`Step ${index + 1} message`}
          </label>
          <div className="flex items-start gap-2">
            <Textarea
              id={`${rowId}-template`}
              ref={textareaRef}
              rows={3}
              maxLength={1200}
              value={step.template}
              disabled={!canEdit}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${rowId}-error` : undefined}
              placeholder="Write the message this step sends…"
              className="min-h-[4.75rem] flex-1 text-[13px] leading-[1.45]"
              onChange={(event) => onPatch({ template: event.target.value })}
            />
            <MergeFieldMenu
              targetRef={getRef()}
              value={step.template}
              disabled={!canEdit}
              label={`Insert a merge field into step ${index + 1}`}
              onInsert={(next) => onPatch({ template: next })}
            />
          </div>
          {invalid && (
            <p id={`${rowId}-error`} className="text-danger-600 mt-1 text-[12px]">
              {empty
                ? "This step has no message."
                : `Unknown merge ${
                    unknown.length === 1 ? "field" : "fields"
                  }: ${unknown.map((token) => `{{${token}}}`).join(", ")}`}
            </p>
          )}
        </div>

        {/* toggle + menu */}
        <div className="flex shrink-0 items-center gap-1 lg:pt-1.5">
          <Switch
            checked={step.enabled}
            disabled={!canEdit}
            onCheckedChange={(next) => onPatch({ enabled: next })}
            label={`Send step ${index + 1}`}
          />
          {canEdit && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  size="sm"
                  label={`Options for step ${index + 1}`}
                >
                  <MoreVertical className="size-4" />
                </IconButton>
              }
            >
              <DropdownItem icon={Copy} onSelect={onDuplicate}>
                Duplicate step
              </DropdownItem>
              <DropdownItem
                icon={ArrowUp}
                disabled={index === 0}
                onSelect={() => onMove(-1)}
              >
                Move up
              </DropdownItem>
              <DropdownItem
                icon={ArrowDown}
                disabled={index === total - 1}
                onSelect={() => onMove(1)}
              >
                Move down
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={Trash2} destructive onSelect={onRemove}>
                Delete step
              </DropdownItem>
            </DropdownMenu>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- footer */

function SequenceFooter({
  issues,
  canEdit,
  dirty,
  saving,
  onPublish,
}: {
  issues: { key: string; message: string }[];
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onPublish: () => void;
}) {
  const valid = issues.length === 0;

  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3.5",
        valid
          ? "border-success-100 bg-success-50"
          : "border-danger-100 bg-danger-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
          valid ? "bg-success-500" : "bg-danger-500",
        )}
      >
        {valid ? (
          <CircleCheck className="size-4" />
        ) : (
          <TriangleAlert className="size-4" />
        )}
      </span>

      <div className="min-w-[12rem] flex-1">
        {valid ? (
          <>
            <p className="text-content text-[13px] font-semibold">
              Sequence looks good!
            </p>
            <p className="text-content-secondary mt-0.5 text-[13px]">
              All steps are properly configured.
            </p>
          </>
        ) : (
          <>
            <p className="text-danger-700 text-[13px] font-semibold">
              {issues.length === 1
                ? "One thing to fix before publishing"
                : `${issues.length} things to fix before publishing`}
            </p>
            <ul className="text-content-secondary mt-1 space-y-0.5 text-[13px]">
              {issues.slice(0, 4).map((issue) => (
                <li key={issue.key}>{issue.message}</li>
              ))}
              {issues.length > 4 && (
                <li className="text-content-subtle">
                  and {issues.length - 4} more.
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {canEdit && (
        <div className="shrink-0 text-right">
          <Button onClick={onPublish} loading={saving} disabled={!valid || !dirty}>
            Update sequence
          </Button>
          <p className="text-content-subtle mt-1 text-[12px]">
            {dirty
              ? "Your changes will be published immediately."
              : "No unpublished changes."}
          </p>
        </div>
      )}
    </div>
  );
}
