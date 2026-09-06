"use client";

import * as React from "react";
import { CalendarDays, Plus } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Select, Switch, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { MergeFieldMenu } from "@/components/follow-up/merge-field-menu";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import {
  createAutomation,
  setAutomationEnabled,
  updateFollowUpSequence,
} from "@/lib/automations/actions";
import type { AutomationDetail, AutomationListItem } from "@/lib/automations/types";
import {
  DEFAULT_REMINDER_MINUTES,
  REMINDER_OFFSETS,
  nearestReminderOffset,
} from "@/lib/follow-up/types";

const DEFAULT_REMINDER_BODY =
  "Hi {{first_name}}, just a reminder about your upcoming appointment with {{business_name}} tomorrow. We look forward to seeing you!";

/**
 * Booking reminders reuse the same automation entity, versioning and worker as
 * every other sequence — they are simply presented as one timing plus one
 * message, because that is all this particular automation ever is.
 *
 * The scheduler owns the lifecycle: a reminder is cancelled when the booking
 * is cancelled and re-scheduled when the appointment moves, so nothing here
 * needs to duplicate that.
 */
export function BookingReminderCard({
  item,
  detail,
  canEdit,
  creatable,
}: {
  item: AutomationListItem | null;
  detail: AutomationDetail | null;
  canEdit: boolean;
  creatable: boolean;
}) {
  const { toast } = useToast();
  const step = detail?.steps[0] ?? null;

  const [minutes, setMinutes] = React.useState(() =>
    step
      ? nearestReminderOffset(Math.round(step.delaySeconds / 60))
      : DEFAULT_REMINDER_MINUTES,
  );
  const [body, setBody] = React.useState(step?.template ?? DEFAULT_REMINDER_BODY);
  const [saving, setSaving] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Re-seed when the server sends a newer reminder (after a save, or someone
  // else's change being revalidated in). Adjusting state during render is the
  // supported way to derive from props without a cascading effect.
  const signature = `${step?.delaySeconds ?? ""}|${step?.template ?? ""}`;
  const [seeded, setSeeded] = React.useState(signature);
  if (seeded !== signature) {
    setSeeded(signature);
    if (step) {
      setMinutes(nearestReminderOffset(Math.round(step.delaySeconds / 60)));
      setBody(step.template);
    }
  }

  const unknown = findUnknownMergeFields(body);
  const dirty =
    step !== null && (minutes * 60 !== step.delaySeconds || body !== step.template);
  const invalid = body.trim() === "" || unknown.length > 0;

  async function create() {
    setCreating(true);
    try {
      const result = await createAutomation({ type: "booking_reminder" });
      if (result.ok) {
        toast({ variant: "success", title: "Booking reminders set up" });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!detail) return;
    setSaving(true);
    try {
      const result = await updateFollowUpSequence({
        automationId: detail.id,
        name: detail.name,
        steps: [
          {
            // Stored as a delay in seconds, like every other step; the label
            // "24 hours before" is the reading, the scheduler does the offset.
            delaySeconds: minutes * 60,
            channel: step?.channel ?? "sms",
            template: body,
            enabled: true,
          },
        ],
      });
      if (result.ok) {
        toast({ variant: "success", title: "Booking reminder updated" });
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    if (!item) return;
    setToggling(true);
    try {
      const result = await setAutomationEnabled({
        automationId: item.id,
        enabled: !item.enabled,
      });
      if (result.ok) {
        toast({
          variant: "success",
          title: item.enabled ? "Booking reminders paused" : "Booking reminders on",
        });
        setConfirming(false);
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setToggling(false);
    }
  }

  if (!item) {
    return (
      <Card>
        <CardHeader className="flex-col items-stretch gap-0 border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
          dense
            icon={CalendarDays}
            tone="success"
            title="Booking reminders"
            description="Send a reminder to leads who have booked an appointment."
          />
        </CardHeader>
        <CardContent className="px-5 pt-4 pb-5">
          {creatable && canEdit ? (
            <Button size="sm" onClick={create} loading={creating}>
              <Plus className="size-3.5" />
              Set up booking reminders
            </Button>
          ) : (
            <p className="text-content-subtle text-[12px]">
              {canEdit
                ? "Not available on this plan yet."
                : "Only an owner or admin can set this up."}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-stretch gap-0 border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
          dense
            icon={CalendarDays}
            tone="success"
            title="Booking reminders"
            description="Send a reminder to leads who have booked an appointment."
            action={
              canEdit ? (
                <Switch
                  checked={item.enabled}
                  disabled={toggling}
                  tone="success"
                  size="lg"
                  onCheckedChange={() => setConfirming(true)}
                  label="Send booking reminders"
                />
              ) : undefined
            }
          />
        </CardHeader>

        <CardContent className="space-y-3 px-5 pt-4 pb-5">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="reminder-offset">
              Send reminder
            </Label>
            <Select
              id="reminder-offset"
              className="text-[13px]"
              value={String(minutes)}
              disabled={!canEdit || saving}
              onChange={(event) => setMinutes(Number(event.target.value))}
            >
              {REMINDER_OFFSETS.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="reminder-body">
              Message
            </Label>
            <div className="flex items-start gap-2">
              <Textarea
                id="reminder-body"
                ref={bodyRef}
                rows={3}
                maxLength={1200}
                value={body}
                disabled={!canEdit || saving}
                aria-invalid={invalid || undefined}
                className="min-h-[4.75rem] flex-1 px-2.5 py-1.5 text-[12px] leading-[1.4]"
                onChange={(event) => setBody(event.target.value)}
              />
              <MergeFieldMenu
                targetRef={bodyRef}
                value={body}
                disabled={!canEdit || saving}
                label="Insert a merge field into the reminder"
                onInsert={setBody}
              />
            </div>
            {unknown.length > 0 && (
              <p className="text-danger-600 text-[12px]">
                Unknown merge {unknown.length === 1 ? "field" : "fields"}:{" "}
                {unknown.map((token) => `{{${token}}}`).join(", ")}
              </p>
            )}
          </div>

          {canEdit && (dirty || saving) && (
            <Button size="sm" onClick={save} loading={saving} disabled={invalid}>
              Save reminder
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={toggle}
        loading={toggling}
        variant={item.enabled ? "warning" : "default"}
        title={
          item.enabled ? "Pause booking reminders?" : "Activate booking reminders?"
        }
        scope={`${item.leadsInSequence} ${
          item.leadsInSequence === 1 ? "booking has" : "bookings have"
        } a reminder queued`}
        consequence={
          item.enabled
            ? "No further reminder is sent. Queued reminders are held rather than deleted."
            : "New bookings get a reminder at the configured offset, and every stop condition is re-checked before each send."
        }
        confirmLabel={item.enabled ? "Pause" : "Activate"}
      />
    </>
  );
}
