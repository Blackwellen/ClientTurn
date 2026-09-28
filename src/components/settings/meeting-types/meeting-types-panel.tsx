"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Plus } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, Select } from "@/components/ui/form";
import { EmptyState, FormError } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { archiveMeetingTypeAction, saveMeetingTypeAction } from "@/lib/settings/channel-actions";
import {
  ASSIGNEE_RULE_DESCRIPTIONS,
  ASSIGNEE_RULE_LABELS,
  ASSIGNEE_RULES,
  type AssigneeRule,
  type MeetingType,
} from "@/lib/bookings/meeting-types";

export type MeetingTypeOption = { id: string; label: string };

type Draft = {
  id?: string;
  name: string;
  durationMinutes: string;
  bufferMinutes: string;
  assigneeRule: AssigneeRule;
  eligibleUserIds: string[];
  serviceIds: string[];
  specialisms: Record<string, string[]>;
  calendarIntegrationId: string;
  isDefault: boolean;
};

function draftFrom(type: MeetingType | null, defaults: { duration: number; buffer: number }): Draft {
  return {
    id: type?.id,
    name: type?.name ?? "",
    durationMinutes: String(type?.durationMinutes ?? defaults.duration),
    bufferMinutes: String(type?.bufferMinutes ?? defaults.buffer),
    assigneeRule: type?.assigneeRule ?? "ROUND_ROBIN",
    eligibleUserIds: type?.eligibleUserIds ?? [],
    serviceIds: type?.serviceIds ?? [],
    specialisms: type?.specialisms ?? {},
    calendarIntegrationId: type?.calendarIntegrationId ?? "",
    isDefault: type?.isDefault ?? false,
  };
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((value) => value !== id);
}

function MeetingTypeForm({
  initial,
  members,
  services,
  calendars,
  onClose,
}: {
  initial: Draft;
  members: MeetingTypeOption[];
  services: MeetingTypeOption[];
  calendars: MeetingTypeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await saveMeetingTypeAction({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name,
      durationMinutes: Number(draft.durationMinutes),
      bufferMinutes: Number(draft.bufferMinutes),
      assigneeRule: draft.assigneeRule,
      eligibleUserIds: draft.eligibleUserIds,
      serviceIds: draft.serviceIds,
      specialisms: draft.assigneeRule === "SPECIALISM" ? draft.specialisms : {},
      calendarIntegrationId: draft.calendarIntegrationId || null,
      isDefault: draft.isDefault,
    });
    setSaving(false);
    if (result.ok) {
      toast({ variant: "success", title: result.message });
      onClose();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form id="meeting-type-form" onSubmit={submit} className="space-y-4">
      <FormField label="Name" htmlFor="mt-name" required>
        <Input
          id="mt-name"
          value={draft.name}
          maxLength={120}
          required
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Discovery call"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Duration (minutes)" htmlFor="mt-duration">
          <Input
            id="mt-duration"
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            required
            value={draft.durationMinutes}
            onChange={(event) => set({ durationMinutes: event.target.value })}
          />
        </FormField>
        <FormField label="Buffer after (minutes)" htmlFor="mt-buffer">
          <Input
            id="mt-buffer"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            step={5}
            required
            value={draft.bufferMinutes}
            onChange={(event) => set({ bufferMinutes: event.target.value })}
          />
        </FormField>
      </div>

      <FormField
        label="Calendar"
        htmlFor="mt-calendar"
        hint="Where free times are read from. Leave on the default to use your booking method's calendar."
      >
        <Select
          id="mt-calendar"
          value={draft.calendarIntegrationId}
          onChange={(event) => set({ calendarIntegrationId: event.target.value })}
        >
          <option value="">Default booking calendar</option>
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Who takes the meeting"
        htmlFor="mt-rule"
        hint={ASSIGNEE_RULE_DESCRIPTIONS[draft.assigneeRule]}
      >
        <Select
          id="mt-rule"
          value={draft.assigneeRule}
          onChange={(event) => set({ assigneeRule: event.target.value as AssigneeRule })}
        >
          {ASSIGNEE_RULES.map((rule) => (
            <option key={rule} value={rule}>
              {ASSIGNEE_RULE_LABELS[rule]}
            </option>
          ))}
        </Select>
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-content text-[13px] font-medium">Eligible people</legend>
        {members.length === 0 ? (
          <p className="text-content-muted text-[12px]">Invite your team in Settings → Team first.</p>
        ) : (
          members.map((member) => {
            const eligible = draft.eligibleUserIds.includes(member.id);
            return (
              <div key={member.id} className="border-line rounded-lg border px-3 py-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={eligible}
                    onChange={(event) =>
                      set({ eligibleUserIds: toggle(draft.eligibleUserIds, member.id, event.target.checked) })
                    }
                  />
                  {member.label}
                </label>
                {eligible && draft.assigneeRule === "SPECIALISM" && services.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                    {services.map((service) => (
                      <label key={service.id} className="text-content-secondary flex items-center gap-1.5 text-[12px]">
                        <Checkbox
                          checked={draft.specialisms[member.id]?.includes(service.id) ?? false}
                          onChange={(event) =>
                            set({
                              specialisms: {
                                ...draft.specialisms,
                                [member.id]: toggle(draft.specialisms[member.id] ?? [], service.id, event.target.checked),
                              },
                            })
                          }
                        />
                        {service.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="text-content-muted text-[12px]">
          With nobody chosen, bookings of this type are not assigned to anyone.
        </p>
      </fieldset>

      {services.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-content text-[13px] font-medium">For these services</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {services.map((service) => (
              <label key={service.id} className="flex items-center gap-1.5 text-[13px]">
                <Checkbox
                  checked={draft.serviceIds.includes(service.id)}
                  onChange={(event) => set({ serviceIds: toggle(draft.serviceIds, service.id, event.target.checked) })}
                />
                {service.label}
              </label>
            ))}
          </div>
          <p className="text-content-muted text-[12px]">None ticked means any service.</p>
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox checked={draft.isDefault} onChange={(event) => set({ isDefault: event.target.checked })} />
        Use this when no other meeting type fits the lead
      </label>

      <FormError message={error} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          Save meeting type
        </Button>
      </div>
    </form>
  );
}

/**
 * Meeting types and rep routing (brief §57). Without any, the workspace books
 * exactly as before: one calendar, the duration and buffer above, no assignee.
 */
export function MeetingTypesPanel({
  meetingTypes,
  members,
  services,
  calendars,
  defaults,
  readOnly,
}: {
  meetingTypes: MeetingType[];
  members: MeetingTypeOption[];
  services: MeetingTypeOption[];
  calendars: MeetingTypeOption[];
  defaults: { duration: number; buffer: number };
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [archiving, setArchiving] = React.useState<MeetingType | null>(null);
  const memberName = new Map(members.map((member) => [member.id, member.label]));

  async function archive() {
    if (!archiving) return;
    const result = await archiveMeetingTypeAction({ id: archiving.id });
    setArchiving(null);
    if (result.ok) {
      toast({ variant: "success", title: result.message });
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={CalendarRange}
          title="Meeting types"
          description="Different kinds of meeting, each with its own length, buffer, calendar and who takes it."
          action={
            readOnly ? undefined : (
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(draftFrom(null, defaults))}>
                <Plus className="size-3.5" aria-hidden />
                Add meeting type
              </Button>
            )
          }
        />
      </CardHeader>
      <CardContent>
        {meetingTypes.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="One kind of meeting"
            description="Every booking uses the appointment shape above and your booking calendar. Add a meeting type to vary the length or share bookings across your team."
          />
        ) : (
          <ul className="divide-line divide-y">
            {meetingTypes.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-content flex items-center gap-2 text-[13px] font-medium">
                    {type.name}
                    {type.isDefault && <Badge tone="accent">Default</Badge>}
                  </p>
                  <p className="text-content-muted text-[12px]">
                    {type.durationMinutes} min · {type.bufferMinutes} min buffer ·{" "}
                    {ASSIGNEE_RULE_LABELS[type.assigneeRule]}
                    {type.eligibleUserIds.length
                      ? ` · ${type.eligibleUserIds.map((id) => memberName.get(id) ?? "Former member").join(", ")}`
                      : " · Unassigned"}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(draftFrom(type, defaults))}>
                      Edit
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => setArchiving(type)}>
                      Archive
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit meeting type" : "New meeting type"}
        size="lg"
      >
        {editing && (
          <MeetingTypeForm
            key={editing.id ?? "new"}
            initial={editing}
            members={members}
            services={services}
            calendars={calendars}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title="Archive this meeting type?"
        scope={archiving?.name ?? ""}
        consequence="It will no longer be offered to leads. Bookings already made keep it."
        confirmLabel="Archive"
        variant="warning"
      />
    </Card>
  );
}
