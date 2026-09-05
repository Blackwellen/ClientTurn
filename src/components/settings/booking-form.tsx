"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { updateBookingSettings } from "@/lib/settings/actions";
import { BOOKING_MODES, type BookingSettings } from "@/lib/settings/types";

export function BookingForm({
  settings,
  readOnly,
}: {
  settings: BookingSettings;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [mode, setMode] = React.useState(settings.bookingMode);
  const [url, setUrl] = React.useState(settings.bookingUrl ?? "");
  const [duration, setDuration] = React.useState(
    String(settings.appointmentDurationMinutes),
  );
  const [buffer, setBuffer] = React.useState(String(settings.bookingBufferMinutes));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function connectedFor(value: string) {
    if (value === "calendly") return settings.calendlyConnected;
    if (value === "google_calendar") return settings.googleCalendarConnected;
    return true;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const result = await updateBookingSettings({
      bookingMode: mode,
      bookingUrl: url,
      appointmentDurationMinutes: Number(duration),
      bookingBufferMinutes: Number(buffer),
    });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Booking settings saved" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <SectionHeader
            icon={CalendarClock}
            title="How qualified leads book"
            description="Chosen the moment a lead meets every qualifying rule."
            action={
              <Badge tone="accent">
                {BOOKING_MODES.find((option) => option.value === mode)?.label ??
                  mode}
              </Badge>
            }
          />
        </CardHeader>
        <CardContent>
          <fieldset className="space-y-2">
            <legend className="sr-only">Booking method</legend>
            {BOOKING_MODES.map((option) => {
              const available = connectedFor(option.value);
              return (
                <label
                  key={option.value}
                  className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <input
                    type="radio"
                    name="bookingMode"
                    value={option.value}
                    checked={mode === option.value}
                    disabled={readOnly || !available}
                    onChange={() => setMode(option.value)}
                    className="accent-[var(--lr-accent-600)] mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-content block text-[13px] font-medium">
                      {option.label}
                    </span>
                    <span className="text-content-muted block text-[13px]">
                      {option.description}
                    </span>
                    {!available && (
                      <span className="text-warning-700 mt-1 block text-[12px]">
                        Connect {option.label} in Connections before choosing it.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <Link
            href="/app/settings/connections"
            className="text-content-accent focus-visible:outline-content-accent mt-3 inline-block rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Manage calendar connections
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Clock3}
            title="Appointment shape"
            description="Used when Client Turn offers times and when it writes a booking."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Booking link"
            htmlFor="booking-url"
            hint="The link sent to a qualified lead. Must start with https://"
          >
            <Input
              id="booking-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              disabled={readOnly}
              onChange={(event) => setUrl(event.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Appointment duration (minutes)"
              htmlFor="booking-duration"
            >
              <Input
                id="booking-duration"
                type="number"
                inputMode="numeric"
                min={5}
                max={480}
                step={5}
                required
                value={duration}
                disabled={readOnly}
                onChange={(event) => setDuration(event.target.value)}
              />
            </FormField>

            <FormField
              label="Buffer between appointments (minutes)"
              htmlFor="booking-buffer"
              hint="Travel or write-up time held after each appointment."
            >
              <Input
                id="booking-buffer"
                type="number"
                inputMode="numeric"
                min={0}
                max={240}
                step={5}
                required
                value={buffer}
                disabled={readOnly}
                onChange={(event) => setBuffer(event.target.value)}
              />
            </FormField>
          </div>

          {error && (
            <p role="alert" className="text-danger-600 text-[13px]">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" loading={saving} disabled={readOnly}>
            Save booking settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
