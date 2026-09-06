"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, Switch } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { DAYS, type BusinessHours, type DayKey } from "@/lib/settings/types";

/** Half-hour slots, the granularity booking and follow-up scheduling work in. */
const SLOTS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

function slotLabel(value: string) {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

export function BusinessHoursEditor({
  hours,
  onChange,
  readOnly,
}: {
  hours: BusinessHours;
  onChange: (day: DayKey, next: BusinessHours[DayKey]) => void;
  readOnly: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Business hours"
          description="Set when your business is available for calls, bookings and follow-ups."
        />
      </CardHeader>
      <CardContent className="space-y-1">
        {DAYS.map((day) => {
          const value = hours[day.key];
          const invalid = value.open && value.end <= value.start;

          return (
            <div
              key={day.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5"
            >
              <span className="w-[104px] shrink-0 text-[13px] font-medium text-content">
                {day.label}
              </span>

              <Select
                aria-label={`${day.label} opening time`}
                className="h-9 w-[132px]"
                value={value.open ? value.start : ""}
                disabled={readOnly || !value.open}
                aria-invalid={invalid || undefined}
                onChange={(event) =>
                  onChange(day.key, { ...value, start: event.target.value })
                }
              >
                {value.open ? (
                  SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabel(slot)}
                    </option>
                  ))
                ) : (
                  <option value="">Closed</option>
                )}
              </Select>

              <span aria-hidden className="text-content-subtle">
                &ndash;
              </span>

              <Select
                aria-label={`${day.label} closing time`}
                className="h-9 w-[132px]"
                value={value.open ? value.end : ""}
                disabled={readOnly || !value.open}
                aria-invalid={invalid || undefined}
                onChange={(event) =>
                  onChange(day.key, { ...value, end: event.target.value })
                }
              >
                {value.open ? (
                  SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabel(slot)}
                    </option>
                  ))
                ) : (
                  <option value="">Closed</option>
                )}
              </Select>

              <div className="flex items-center gap-2.5 sm:ml-8">
                <Switch
                  label={`${day.label} open`}
                  checked={value.open}
                  disabled={readOnly}
                  onCheckedChange={(open) => onChange(day.key, { ...value, open })}
                />
                <span className="w-14 text-[13px] text-content-secondary">
                  {value.open ? "Open" : "Closed"}
                </span>
              </div>

              {invalid && (
                <p role="alert" className="w-full text-[12px] text-danger-600">
                  {day.label} must close after it opens.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
