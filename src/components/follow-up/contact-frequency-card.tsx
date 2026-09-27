"use client";

import * as React from "react";
import { Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveContactFrequency } from "@/lib/follow-up/actions";
import { FREQUENCY_CAP_BOUNDS, type FrequencyCaps } from "@/lib/reengagement/frequency";

/**
 * Contact frequency & re-engagement. The caps apply to every automated
 * message a lead gets, from every loop together (sequences, reactivation
 * campaigns, check-ins, win-back, no-show messages, checkout nudges), and are
 * enforced immediately before each send. Your own messages and replies to a
 * lead who wrote in are never limited.
 */
export function ContactFrequencyCard({
  caps,
  notNowEnabled,
  noShowEnabled,
  winBackEnabled,
  canEdit,
}: {
  caps: FrequencyCaps;
  notNowEnabled: boolean;
  noShowEnabled: boolean;
  winBackEnabled: boolean;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [values, setValues] = React.useState({
    perDay: String(caps.perDay),
    perWeek: String(caps.perWeek),
    per30Days: String(caps.per30Days),
    deadAfter: String(caps.deadAfter),
  });
  const [toggles, setToggles] = React.useState({ notNowEnabled, noShowEnabled, winBackEnabled });
  const disabled = !canEdit || pending;

  function save() {
    startTransition(async () => {
      const result = await saveContactFrequency({
        perDay: Number(values.perDay),
        perWeek: Number(values.perWeek),
        per30Days: Number(values.per30Days),
        deadAfter: Number(values.deadAfter),
        ...toggles,
      });
      toast(result.ok ? { variant: "success", title: "Contact frequency saved." } : { variant: "error", title: result.error });
    });
  }

  const number = (key: keyof typeof values, label: string, hint: string) => (
    <FormField label={label} hint={hint} htmlFor={`freq-${key}`}>
      <Input
        id={`freq-${key}`}
        type="number"
        inputMode="numeric"
        min={FREQUENCY_CAP_BOUNDS[key].min}
        max={FREQUENCY_CAP_BOUNDS[key].max}
        value={values[key]}
        disabled={disabled}
        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
      />
    </FormField>
  );

  const toggle = (key: keyof typeof toggles, title: string, help: string) => (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-medium text-content">{title}</p>
        <p className="mt-0.5 text-[12px] leading-[1.45] text-content-muted">{help}</p>
      </div>
      <Switch
        checked={toggles[key]}
        disabled={disabled}
        onCheckedChange={(value) => setToggles((current) => ({ ...current, [key]: value }))}
        label={title}
      />
    </div>
  );

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-info-100 bg-info-50 text-info-600"
        >
          <Gauge className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-content">Contact frequency &amp; re-engagement</h3>
          <p className="text-[12.5px] text-content-muted">One limit across every automated message a lead gets.</p>
        </div>
      </div>

      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {number("perDay", "Per day", "Automated messages per lead")}
          {number("perWeek", "Per week", "Rolling 7 days")}
          {number("per30Days", "Per 30 days", "Rolling 30 days")}
          {number("deadAfter", "Stop after", "Unanswered in a row")}
        </div>
        <p className="text-[11.5px] leading-[1.45] text-content-subtle">
          A message over the daily limit waits until the next day; one over the weekly or 30-day limit is skipped and the reason is recorded on it. After the &ldquo;stop after&rdquo; number of automated messages in a row with no reply (and no open, where we can see opens) from a lead showing little interest, automated follow-up stops until they respond. You can always message them yourself. The first three days after an enquiry follow your sequence&apos;s own timing.
        </p>

        <div className="space-y-3 border-t border-line-subtle pt-3">
          {toggle(
            "notNowEnabled",
            "Check in when the lead asked",
            "When a lead says “not now, try in March” or names a date, we check in then, in the conversation, referring to what they said.",
          )}
          {toggle(
            "noShowEnabled",
            "Rebook no-shows",
            "When a meeting is marked as a no-show, the lead gets a rebooking message with fresh times within the hour, then one reminder a day later.",
          )}
          {toggle(
            "winBackEnabled",
            "Win back lost deals",
            "One message after a delay chosen by the loss reason: price about 75 days, timing when they said, a competitor about 120 days. Never for “no need” or anyone who asked not to be contacted.",
          )}
        </div>

        {canEdit && (
          <Button size="sm" onClick={save} loading={pending}>
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
