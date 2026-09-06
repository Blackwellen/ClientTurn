"use client";

import * as React from "react";
import { Moon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { saveQuietHours } from "@/lib/automations/actions";
import { saveFollowUpTimezone } from "@/lib/follow-up/actions";
import { TIMEZONES } from "@/lib/settings/types";
import { formatTimezoneLabel } from "@/lib/dates";
import type { QuietHoursSettings } from "@/lib/automations/types";


/**
 * Quiet hours are a scheduling instruction, not a display preference: the
 * worker re-reads this window immediately before every send and moves a
 * message forward to the next permitted minute rather than dropping it.
 *
 * The window is stored on `business_settings` and the timezone on
 * `businesses` — the same values Settings → Workspace edits, so the two
 * screens can never disagree.
 */
export function QuietHoursCard({
  quietHours,
  canEdit,
}: {
  quietHours: QuietHoursSettings;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = React.useState(quietHours.enabled);
  const [start, setStart] = React.useState(quietHours.start);
  const [end, setEnd] = React.useState(quietHours.end);
  const [timezone, setTimezone] = React.useState(quietHours.timezone);
  const [saving, setSaving] = React.useState(false);

  const dirty =
    enabled !== quietHours.enabled ||
    start !== quietHours.start ||
    end !== quietHours.end ||
    timezone !== quietHours.timezone;

  const sameTime = enabled && start === end;

  async function save() {
    setSaving(true);
    try {
      if (timezone !== quietHours.timezone) {
        const zone = await saveFollowUpTimezone({ timezone });
        if (!zone.ok) {
          toast({ variant: "error", title: zone.error });
          return;
        }
      }
      const result = await saveQuietHours({ enabled, start, end });
      if (result.ok) toast({ variant: "success", title: "Quiet hours saved" });
      else toast({ variant: "error", title: result.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-0 border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          dense
          icon={Moon}
          tone="purple"
          title="Quiet hours"
          description="Messages will only be sent during this time window. Messages outside this window will be sent at the next valid time."
          action={
            canEdit ? (
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
                tone="success"
                size="lg"
                label="Hold automated messages during quiet hours"
              />
            ) : undefined
          }
        />
      </CardHeader>

      <CardContent className="space-y-3 px-5 pt-4 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="quiet-start">
              Start time
            </Label>
            <Input
              id="quiet-start"
              type="time"
              className="text-[13px]"
              value={start}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="quiet-end">
              End time
            </Label>
            <Input
              id="quiet-end"
              type="time"
              className="text-[13px]"
              value={end}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px] font-normal" htmlFor="quiet-timezone">
            Timezone
          </Label>
          <Select
            id="quiet-timezone"
            className="text-[13px]"
            value={timezone}
            disabled={!canEdit || saving}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {formatTimezoneLabel(zone)}
              </option>
            ))}
            {!TIMEZONES.includes(timezone as (typeof TIMEZONES)[number]) && (
              <option value={timezone}>{formatTimezoneLabel(timezone)}</option>
            )}
          </Select>
        </div>

        {sameTime && (
          <p className="text-danger-600 text-[12px]">
            Quiet hours cannot start and end at the same time.
          </p>
        )}

        {canEdit ? (
          // Only surfaces once something has actually changed, so the card
          // reads as settings rather than a form waiting to be submitted.
          (dirty || saving) && (
            <Button size="sm" onClick={save} loading={saving} disabled={sameTime}>
              Save quiet hours
            </Button>
          )
        ) : (
          <p className="text-content-subtle text-[12px]">
            Only an owner or admin can change quiet hours.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
