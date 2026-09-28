"use client";

import { FormError } from "@/components/ui/feedback";
import { unlockPlanLabel } from "@/lib/billing/plans";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Clock3,
  Hash,
  Info,
  Lock,
  MessageSquare,
  Repeat,
  ShieldCheck,
  Signature,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  updateMessagingSettings,
  updateSlackChannel,
  updateSlackNotificationPreferences,
} from "@/lib/settings/actions";
import type { MessagingSettings } from "@/lib/settings/types";

function SlackChannelCard({
  channelId,
  readOnly,
}: {
  channelId: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = React.useState(channelId ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    const result = await updateSlackChannel({ channelId: value });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Slack channel saved" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    // Anchored so the Slack card in Settings -> Connections can link here.
    <Card id="slack-alerts">
      <CardHeader>
        <SectionHeader
          icon={Hash}
          title="Slack alerts"
          description="Which channel receives new-lead, handover, booking and warm-prospect alerts."
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField
          label="Slack channel ID"
          htmlFor="slack-channel"
          hint="In Slack, invite the bot to the channel first. Type /invite @ClientTurn in that channel. Then open its About panel to find the channel ID (for example C0123456789) and paste it here. Without the invite, alerts fail silently."
        >
          <Input
            id="slack-channel"
            maxLength={20}
            value={value}
            disabled={readOnly || saving}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
        <FormError message={error} />
      </CardContent>
      <CardFooter className="justify-end">
        <Button size="sm" loading={saving} disabled={readOnly} onClick={onSave}>
          Save Slack channel
        </Button>
      </CardFooter>
    </Card>
  );
}

const SLACK_PREFERENCE_ITEMS = [
  {
    key: "newLead" as const,
    label: "New lead",
    description: "A lead arrives and follow-up starts.",
  },
  {
    key: "handover" as const,
    label: "Handover",
    description: "A conversation needs a person. Human or AI-triggered.",
  },
  {
    key: "booking" as const,
    label: "Booking",
    description: "A lead books an appointment.",
  },
  {
    key: "warmProspect" as const,
    label: "Warm prospect",
    description: "A Find Leads run surfaces contactable prospects.",
  },
];

/**
 * Independent of the channel card above: which of the four event kinds
 * actually post to Slack. Kept separate from the in-app notification
 * preferences (Account → Notifications) since Slack and in-app are different
 * channels a team may want tuned differently — muting Slack for routine
 * new-lead pings while keeping the in-app badge, say.
 */
function SlackPreferencesCard({
  preferences,
  readOnly,
}: {
  preferences: {
    newLead: boolean;
    handover: boolean;
    booking: boolean;
    warmProspect: boolean;
    digest: boolean;
  };
  readOnly: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(preferences);
  const [saving, setSaving] = React.useState(false);

  async function onSave() {
    setSaving(true);
    const result = await updateSlackNotificationPreferences(values);
    setSaving(false);
    if (result.ok) {
      toast({ variant: "success", title: "Slack alert settings saved" });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Could not save", description: result.error });
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Bell}
          title="What goes to Slack"
          description="Turn off any alert type this channel doesn't need to see."
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {SLACK_PREFERENCE_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start gap-2">
            <Checkbox
              id={`slack-pref-${item.key}`}
              className="mt-0.5"
              checked={values[item.key]}
              disabled={readOnly || saving}
              onChange={(event) =>
                setValues({ ...values, [item.key]: event.target.checked })
              }
            />
            <label htmlFor={`slack-pref-${item.key}`} className="text-content text-[13px]">
              {item.label}
              <span className="text-content-muted block text-[12px]">{item.description}</span>
            </label>
          </div>
        ))}
        <div className="border-line mt-1 border-t pt-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="slack-pref-digest"
              className="mt-0.5"
              checked={values.digest}
              disabled={readOnly || saving}
              onChange={(event) =>
                setValues({ ...values, digest: event.target.checked })
              }
            />
            <label htmlFor="slack-pref-digest" className="text-content text-[13px]">
              Daily digest
              <span className="text-content-muted block text-[12px]">
                One summary message each morning, leads in, booked, handovers,
                assistant activity, instead of (or alongside) the per-event alerts above.
              </span>
            </label>
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button size="sm" loading={saving} disabled={readOnly} onClick={onSave}>
          Save Slack alert settings
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Messaging automation behaviour — channel preference, quiet hours, sender
 * signature, opt-out wording and Slack alerts. Business hours and service
 * area live in BusinessHoursCard even though they share the same
 * `business_settings` row; every save here round-trips those untouched
 * values from `settings` so the two forms never clobber each other.
 */
export function MessagingForm({
  settings,
  readOnly,
  whatsappEnabled,
  timezone,
}: {
  settings: MessagingSettings;
  readOnly: boolean;
  whatsappEnabled: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [values, setValues] = React.useState({
    defaultChannel: settings.defaultChannel,
    fallbackChannel: settings.fallbackChannel ?? "",
    quietHoursEnabled: settings.quietHoursEnabled,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    messageSignature: settings.messageSignature ?? "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateMessagingSettings({
      ...values,
      serviceAreaDescription: settings.serviceAreaDescription ?? "",
      businessHours: settings.businessHours,
    });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "Messaging settings saved" });
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
            icon={MessageSquare}
            title="Channels"
            description="How ClientTurn reaches a new lead, and what it falls back to."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default channel" htmlFor="default-channel">
              <Select
                id="default-channel"
                value={values.defaultChannel}
                disabled={disabled}
                onChange={(event) =>
                  setValues({ ...values, defaultChannel: event.target.value })
                }
              >
                <option value="sms">SMS</option>
                <option value="whatsapp" disabled={!whatsappEnabled}>
                  WhatsApp{whatsappEnabled ? "" : `: ${unlockPlanLabel("whatsapp")} and above`}
                </option>
              </Select>
            </FormField>

            <FormField
              label="Fallback channel"
              htmlFor="fallback-channel"
              hint="Used when the default channel cannot deliver."
            >
              <Select
                id="fallback-channel"
                value={values.fallbackChannel}
                disabled={disabled}
                onChange={(event) =>
                  setValues({ ...values, fallbackChannel: event.target.value })
                }
              >
                <option value="">No fallback</option>
                <option value="sms">SMS</option>
                <option value="whatsapp" disabled={!whatsappEnabled}>
                  WhatsApp{whatsappEnabled ? "" : `: ${unlockPlanLabel("whatsapp")} and above`}
                </option>
              </Select>
            </FormField>
          </div>

          {!whatsappEnabled && (
            <p className="border-warning-100 bg-warning-50 text-content-secondary flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]">
              <Lock className="text-warning-600 mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                WhatsApp is available on the {unlockPlanLabel("whatsapp")} and above.{" "}
                <Link
                  href="/app/settings?section=billing"
                  className="text-content-accent font-medium"
                >
                  Compare plans
                </Link>
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Signature}
            title="Sender identity"
            description="Appended to outbound messages so a lead knows who is writing."
          />
        </CardHeader>
        <CardContent>
          <FormField
            label="Message signature"
            htmlFor="signature"
            hint="Up to 160 characters. Keep it short. It is counted in every SMS."
          >
            <Input
              id="signature"
              maxLength={160}
              value={values.messageSignature}
              disabled={disabled}
              onChange={(event) =>
                setValues({ ...values, messageSignature: event.target.value })
              }
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Clock3}
            title="Quiet hours"
            description={`Nothing is sent during these times, in ${timezone}.`}
          />
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2">
            <Checkbox
              id="quiet-hours"
              className="mt-0.5"
              checked={values.quietHoursEnabled}
              disabled={disabled}
              onChange={(event) =>
                setValues({ ...values, quietHoursEnabled: event.target.checked })
              }
            />
            <label htmlFor="quiet-hours" className="text-content text-[13px]">
              Hold messages during quiet hours
              <span className="text-content-muted block text-[12px]">
                Nothing is sent between these times. The check is repeated
                immediately before every send.
              </span>
            </label>
          </div>

          <div className="mt-4 grid max-w-sm gap-4 sm:grid-cols-2">
            <FormField label="Quiet from" htmlFor="quiet-start">
              <Input
                id="quiet-start"
                type="time"
                value={values.quietHoursStart}
                disabled={disabled || !values.quietHoursEnabled}
                onChange={(event) =>
                  setValues({ ...values, quietHoursStart: event.target.value })
                }
              />
            </FormField>
            <FormField label="Quiet until" htmlFor="quiet-end">
              <Input
                id="quiet-end"
                type="time"
                value={values.quietHoursEnd}
                disabled={disabled || !values.quietHoursEnabled}
                onChange={(event) =>
                  setValues({ ...values, quietHoursEnd: event.target.value })
                }
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {settings.slackConnected && (
        <>
          <SlackChannelCard channelId={settings.slackChannelId} readOnly={readOnly} />
          <SlackPreferencesCard
            preferences={{
              newLead: settings.slackNotifyNewLead,
              handover: settings.slackNotifyHandover,
              booking: settings.slackNotifyBooking,
              warmProspect: settings.slackNotifyWarmProspect,
              digest: settings.slackDigestEnabled,
            }}
            readOnly={readOnly}
          />
        </>
      )}

      <Card>
        <CardHeader>
          <SectionHeader
            icon={ShieldCheck}
            title="Opt-out wording"
            description="Required by UK marketing rules. It cannot be removed."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="border-line bg-surface-sunken text-content rounded-lg border px-3 py-2.5 text-[13px]">
            {settings.optOutWording}
          </p>
          <p className="text-content-muted flex items-start gap-2 text-[13px]">
            <Info className="text-content-subtle mt-0.5 size-3.5 shrink-0" aria-hidden />
            Every first outbound message carries this wording, and a lead who
            replies STOP is opted out straight away. STOP by SMS or WhatsApp stops
            that channel until they text START on it; STOPALL, or asking in words
            to stop, covers every channel. This is a legal requirement, so it is
            fixed and cannot be edited or switched off.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Repeat}
            title="Follow-up cadence"
            description="How many messages are sent, and when."
          />
        </CardHeader>
        <CardContent>
          <p className="text-content-muted text-[13px]">
            The cadence is part of your automation, not a messaging setting, so it
            lives with the sequence it belongs to.
          </p>
          <Link
            href="/app/follow-up"
            className="text-content-accent focus-visible:outline-content-accent mt-2 inline-block rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Open Follow-Up
          </Link>
        </CardContent>
      </Card>

      <FormError message={error} />

      <Card>
        <CardFooter className="justify-end rounded-xl border-t-0">
          <Button type="submit" size="sm" loading={saving} disabled={readOnly}>
            Save messaging settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
