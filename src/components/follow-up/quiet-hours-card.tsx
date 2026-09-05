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
import type { QuietHoursSettings } from "@/lib/automations/types";

const TIMEZONE_LABEL: Record<string, string> = {
  "Europe/London": "(GMT+00:00) United Kingdom",
  "Europe/Dublin": "(GMT+00:00) Ireland",
  "Europe/Lisbon": "(GMT+00:00) Portugal",
  "Europe/Paris": "(GMT+01:00) Central European Time",
  "Europe/Madrid": "(GMT+01:00) Spain",
  UTC: "(GMT+00:00) Coordinated Universal Time",
};

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
      <CardHeader className="flex-col items-stretch gap-0">
        <SectionHeader
          icon={Moon}
          tone="info"
          title="Quiet hours"
          description="Messages will only be sent during this time window. Messages outside this window will be sent at the next valid time."
          action={
            canEdit ? (
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
                label="Hold automated messages during quiet hours"
              />
            ) : undefined
          }
        />
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="quiet-start">Start time</Label>
            <Input
              id="quiet-start"
              type="time"
              value={start}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quiet-end">End time</Label>
            <Input
              id="quiet-end"
              type="time"
              value={end}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quiet-timezone">Timezone</Label>
          <Select
            id="quiet-timezone"
            value={timezone}
            disabled={!canEdit || saving}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {TIMEZONE_LABEL[zone] ?? zone}
              </option>
            ))}
            {!TIMEZONES.includes(timezone as (typeof TIMEZONES)[number]) && (
              <option value={timezone}>{timezone}</option>
            )}
          </Select>
          <p className="text-content-subtle text-[12px]">
            Times are in the business timezone, not the timezone of whoever is
            looking at this screen.
          </p>
        </div>

        {sameTime && (
          <p className="text-danger-600 text-[12px]">
            Quiet hours cannot start and end at the same time.
          </p>
        )}

        {canEdit ? (
          <Button
            size="sm"
            onClick={save}
            loading={saving}
            disabled={!dirty || sameTime}
          >
            Save quiet hours
          </Button>
        ) : (
          <p className="text-content-subtle text-[12px]">
            Only an owner or admin can change quiet hours.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
