"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/form";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { Popover } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/modal";
import { MergeFieldMenu } from "@/components/follow-up/merge-field-menu";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import {
  CHANNELS,
  CHANNEL_LABEL,
  MAX_EMAIL_SUBJECT_LENGTH,
  type Channel,
} from "@/lib/automations/types";
import {
  DELAY_UNITS,
  DELAY_UNIT_META,
  formatStepDelay,
  joinDelay,
  splitDelay,
  type DelayUnit,
} from "@/lib/follow-up/types";
import { cn } from "@/lib/cn";

export type DraftStep = {
  key: string;
  delaySeconds: number;
  channel: Channel;
  /** Email only; null on SMS and WhatsApp. */
  subject: string | null;
  template: string;
  senderIdentityId: string | null;
  enabled: boolean;
};

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  sms: MessageSquare,
  whatsapp: MessageCircle,
  email: Mail,
};

/**
 * The Follow-Up sequence list (V4 §19.4).
 *
 * Controlled: the draft lives in `FollowUpWorkspace` so the message preview,
 * the usage estimate and the save bar all read the same unsaved state. This
 * component renders and mutates it, and owns nothing.
 *
 * One compact row per step — timing, channel, subject (email only), message,
 * on/off — because what is being configured is a short list of messages, not a
 * workflow graph.
 */
export function SequenceEditor({
  steps,
  canEdit,
  available,
  whatsappEnabled,
  onChange,
  onAdd,
}: {
  steps: DraftStep[];
  canEdit: boolean;
  /** Which channels the workspace can currently offer at all. */
  available: Record<Channel, boolean>;
  whatsappEnabled: boolean;
  onChange: (next: DraftStep[]) => void;
  onAdd: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = React.useState<DraftStep | null>(null);
  const templateRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});

  function patch(key: string, next: Partial<DraftStep>) {
    onChange(
      steps.map((row) => {
        if (row.key !== key) return row;
        const merged = { ...row, ...next };
        // A subject only exists on email. Switching away from email drops it
        // rather than carrying dead data that the schema would then reject.
        if (merged.channel !== "email") merged.subject = null;
        else if (merged.subject === null) merged.subject = "";
        return merged;
      }),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function duplicate(index: number) {
    const source = steps[index];
    onChange([
      ...steps.slice(0, index + 1),
      { ...source, key: `step-${crypto.randomUUID()}` },
      ...steps.slice(index + 1),
    ]);
  }

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No steps yet"
        description="A sequence needs at least one message. The first step usually goes out immediately, while the enquiry is still fresh."
        action={
          canEdit ? (
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-3.5" />
              Add the first step
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <SequenceRow
            key={step.key}
            step={step}
            index={index}
            total={steps.length}
            canEdit={canEdit}
            available={available}
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

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          onChange(steps.filter((row) => row.key !== confirmRemove?.key));
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

/* ---------------------------------------------------------- delay editor */

/**
 * The timing reads as a sentence in the row and opens an editor on click.
 * Keeping the amount and the unit out of the row is what lets five steps fit
 * on one screen without the eye having to parse five pairs of form controls.
 */
function DelayEditor({
  step,
  index,
  canEdit,
  onPatch,
}: {
  step: DraftStep;
  index: number;
  canEdit: boolean;
  onPatch: (next: Partial<DraftStep>) => void;
}) {
  const { value, unit } = splitDelay(step.delaySeconds);
  const fieldId = `delay-${step.key}`;

  const summary = (
    <>
      <span className="text-content block text-[12.5px] font-semibold whitespace-nowrap">
        {formatStepDelay(step.delaySeconds)}
      </span>
      <span className="text-content-subtle block text-[10px] whitespace-nowrap">
        {index === 0 ? "Send right away" : "After previous message"}
      </span>
    </>
  );

  if (!canEdit) return <div className="min-w-0">{summary}</div>;

  return (
    <Popover
      align="start"
      label={`Timing for step ${index + 1}`}
      trigger={
        <button
          type="button"
          title="Change the timing"
          className={cn(
            "-m-1 min-w-0 rounded-md p-1 text-left",
            "hover:bg-surface-hover transition-colors duration-[var(--lr-duration-fast)]",
            "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-1",
          )}
        >
          {summary}
          <span className="sr-only">Change the timing</span>
        </button>
      }
    >
      <p className="text-content text-[13px] font-medium">
        {index === 0 ? "Send this step" : "Send after the previous message"}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {unit !== "immediate" && (
          <>
            <label className="sr-only" htmlFor={`${fieldId}-value`}>
              Amount
            </label>
            <Input
              id={`${fieldId}-value`}
              type="number"
              min={1}
              max={30}
              value={value}
              className="h-9 w-20"
              onChange={(event) =>
                onPatch({
                  delaySeconds: joinDelay(Number(event.target.value) || 1, unit),
                })
              }
            />
          </>
        )}
        <label className="sr-only" htmlFor={`${fieldId}-unit`}>
          Unit
        </label>
        <Select
          id={`${fieldId}-unit`}
          className="h-9"
          value={unit}
          onChange={(event) =>
            onPatch({
              delaySeconds: joinDelay(
                Math.max(value, 1),
                event.target.value as DelayUnit,
              ),
            })
          }
        >
          {DELAY_UNITS.map((option) => (
            <option key={option} value={option}>
              {DELAY_UNIT_META[option].plural}
            </option>
          ))}
        </Select>
      </div>
      {index > 0 && (
        <p className="text-content-subtle mt-2 text-[11.5px]">
          Counted from the moment the previous message was sent.
        </p>
      )}
    </Popover>
  );
}

/* ------------------------------------------------------------------- row */

function SequenceRow({
  step,
  index,
  total,
  canEdit,
  available,
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
  available: Record<Channel, boolean>;
  whatsappEnabled: boolean;
  textareaRef: (element: HTMLTextAreaElement | null) => void;
  getRef: () => React.RefObject<HTMLTextAreaElement | null>;
  onPatch: (next: Partial<DraftStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const isEmail = step.channel === "email";
  const unknown = [
    ...new Set([
      ...findUnknownMergeFields(step.template),
      ...(step.subject ? findUnknownMergeFields(step.subject) : []),
    ]),
  ];
  const ChannelIcon = CHANNEL_ICON[step.channel];
  const empty = step.template.trim() === "";
  const missingSubject = isEmail && (step.subject ?? "").trim() === "";
  const invalid = unknown.length > 0 || empty || missingSubject;
  const rowId = `step-${step.key}`;

  return (
    <li
      className={cn(
        "border-line bg-surface rounded-lg border px-3 py-2",
        "transition-colors duration-[var(--lr-duration-fast)]",
        invalid && "border-danger-500/60",
        !step.enabled && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start">
        {/* number + timing */}
        <div className="flex items-start gap-2 xl:w-[8.5rem] xl:shrink-0 xl:pt-1">
          <span
            aria-hidden
            className="bg-surface-sunken border-line text-content lr-tabular flex size-7 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold"
          >
            {index + 1}
          </span>
          <DelayEditor
            step={step}
            index={index}
            canEdit={canEdit}
            onPatch={onPatch}
          />
        </div>

        {/* channel */}
        <div className="xl:w-[8.25rem] xl:shrink-0 xl:pt-0.5">
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
              className="h-9 pr-6 pl-7 text-[12.5px]"
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
          {/* Configuring a channel is not the same as it being usable. Say so
              on the row rather than only in the policy card. */}
          {!available[step.channel] && (
            <p className="mt-1 text-[11px] leading-tight text-warning-700">
              Not available right now — ClientTurn evaluates each lead before
              sending.
            </p>
          )}
        </div>

        {/* subject + message */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {isEmail && (
            <div>
              <label className="sr-only" htmlFor={`${rowId}-subject`}>
                {`Step ${index + 1} subject`}
              </label>
              <Input
                id={`${rowId}-subject`}
                value={step.subject ?? ""}
                disabled={!canEdit}
                maxLength={MAX_EMAIL_SUBJECT_LENGTH}
                required
                aria-invalid={missingSubject || undefined}
                placeholder="Subject line…"
                className="h-8 px-2.5 text-[12px] font-medium"
                onChange={(event) => onPatch({ subject: event.target.value })}
              />
            </div>
          )}

          <label className="sr-only" htmlFor={`${rowId}-template`}>
            {`Step ${index + 1} message`}
          </label>
          <div className="flex items-start gap-1.5">
            <Textarea
              id={`${rowId}-template`}
              ref={textareaRef}
              rows={4}
              // Email bodies are longer than an SMS by nature; the schema
              // permits 5,000 characters and the control should not be the
              // thing that disagrees.
              maxLength={isEmail ? 5000 : 1200}
              value={step.template}
              disabled={!canEdit}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${rowId}-error` : undefined}
              placeholder={
                isEmail
                  ? "Write the email this step sends. Plain text and links only."
                  : "Write the message this step sends…"
              }
              className="min-h-[4.75rem] flex-1 resize-y px-2.5 py-1 text-[12px] leading-[1.35]"
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
            <p id={`${rowId}-error`} className="text-danger-600 text-[12px]">
              {missingSubject
                ? "Every email step needs a subject line."
                : empty
                  ? "This step has no message."
                  : `Unknown merge ${
                      unknown.length === 1 ? "field" : "fields"
                    }: ${unknown.map((token) => `{{${token}}}`).join(", ")}`}
            </p>
          )}
        </div>

        {/* toggle + menu */}
        <div className="flex shrink-0 items-center gap-0.5 xl:pt-1.5">
          <Switch
            checked={step.enabled}
            disabled={!canEdit}
            tone="success"
            size="lg"
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
