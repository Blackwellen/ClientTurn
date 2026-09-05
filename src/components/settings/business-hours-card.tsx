"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock3, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { updateMessagingSettings } from "@/lib/settings/actions";
import { DAYS, type BusinessHours, type MessagingSettings } from "@/lib/settings/types";

/**
 * Business hours and service-area coverage. These are workspace identity
 * fields per the product spec, not messaging behaviour — but they are
 * stored on the same `business_settings` row as the messaging fields, so
 * every save here round-trips the untouched messaging values from `settings`
 * to avoid clobbering them. See MessagingForm for the counterpart.
 */
export function BusinessHoursCard({
  settings,
  readOnly,
  timezone,
}: {
  settings: MessagingSettings;
  readOnly: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [serviceArea, setServiceArea] = React.useState(
    settings.serviceAreaDescription ?? "",
  );
  const [hours, setHours] = React.useState<BusinessHours>(settings.businessHours);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const result = await updateMessagingSettings({
      defaultChannel: settings.defaultChannel,
      fallbackChannel: settings.fallbackChannel ?? "",
      quietHoursEnabled: settings.quietHoursEnabled,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      messageSignature: settings.messageSignature ?? "",
      serviceAreaDescription: serviceArea,
      businessHours: hours,
    });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Business hours saved" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const disabled = readOnly || saving;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <SectionHeader
            icon={MapPinned}
            title="Service area"
            description="Plain wording a lead can understand, used when explaining coverage."
          />
        </CardHeader>
        <CardContent>
          <FormField label="Service area description" htmlFor="service-area">
            <Textarea
              id="service-area"
              maxLength={400}
              value={serviceArea}
              disabled={disabled}
              onChange={(event) => setServiceArea(event.target.value)}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Clock3}
            title="Business hours"
            description={`When a human is available to take over a conversation, in ${timezone}.`}
          />
        </CardHeader>
        <CardContent className="space-y-2">
          {DAYS.map((day) => {
            const value = hours[day.key];
            return (
              <div key={day.key} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex w-32 items-center gap-2">
                  <Checkbox
                    id={`day-${day.key}`}
                    checked={value.open}
                    disabled={disabled}
                    onChange={(event) =>
                      setHours({
                        ...hours,
                        [day.key]: { ...value, open: event.target.checked },
                      })
                    }
                  />
                  <label htmlFor={`day-${day.key}`} className="text-content text-[13px]">
                    {day.label}
                  </label>
                </div>
                <Input
                  type="time"
                  aria-label={`${day.label} opening time`}
                  className="h-8 w-28"
                  value={value.start}
                  disabled={disabled || !value.open}
                  onChange={(event) =>
                    setHours({
                      ...hours,
                      [day.key]: { ...value, start: event.target.value },
                    })
                  }
                />
                <span className="text-content-subtle text-[13px]">to</span>
                <Input
                  type="time"
                  aria-label={`${day.label} closing time`}
                  className="h-8 w-28"
                  value={value.end}
                  disabled={disabled || !value.open}
                  onChange={(event) =>
                    setHours({
                      ...hours,
                      [day.key]: { ...value, end: event.target.value },
                    })
                  }
                />
              </div>
            );
          })}

          {error && (
            <p role="alert" className="text-danger-600 text-[13px]">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" loading={saving} disabled={readOnly}>
            Save business hours
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
