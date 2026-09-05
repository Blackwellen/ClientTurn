"use client";

import * as React from "react";
import { Clock, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveQuietHours } from "@/lib/automations/actions";
import { QUIET_HOURS_NOTE, type QuietHoursSettings } from "@/lib/automations/types";

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
  const [saving, setSaving] = React.useState(false);

  const dirty =
    enabled !== quietHours.enabled ||
    start !== quietHours.start ||
    end !== quietHours.end;

  async function save() {
    setSaving(true);
    try {
      const result = await saveQuietHours({ enabled, start, end });
      if (result.ok) toast({ variant: "success", title: "Quiet hours saved" });
      else toast({ variant: "error", title: result.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="text-content-muted size-4" />
          Quiet hours
        </CardTitle>
        <p className="text-content-muted mt-1 text-[13px]">{QUIET_HOURS_NOTE}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <p className="text-content-secondary bg-surface-sunken border-line flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]">
          <Globe className="text-content-muted size-3.5 shrink-0" aria-hidden />
          <span>
            Times are in the business timezone{" "}
            <span className="text-content font-medium">
              {quietHours.timezone}
            </span>
            , not the timezone of whoever is looking at this screen.
          </span>
        </p>

        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canEdit || saving}
          label="Hold automated messages during quiet hours"
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quiet from" htmlFor="quiet-start">
            <Input
              id="quiet-start"
              type="time"
              value={start}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setStart(event.target.value)}
            />
          </FormField>
          <FormField label="Quiet until" htmlFor="quiet-end">
            <Input
              id="quiet-end"
              type="time"
              value={end}
              disabled={!canEdit || !enabled || saving}
              onChange={(event) => setEnd(event.target.value)}
            />
          </FormField>
        </div>

        {canEdit ? (
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
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
