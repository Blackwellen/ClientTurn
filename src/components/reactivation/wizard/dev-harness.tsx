"use client";

import * as React from "react";
import type { AudiencePreview } from "@/lib/campaigns/types";
import { MessageTimingStep, type ChannelOption } from "./message-timing-step";
import { ReviewLaunchStep } from "./review-launch-step";
import { initialWizardState, type WizardChannel, type WizardState } from "./state";

/**
 * Development-only. Renders Step 2 or Step 3 against a fixed audience estimate
 * so both layouts can be reviewed without a database — Step 1 will not clear
 * until the server confirms at least one eligible contact, which a local
 * preview has no way to do. Imported only by `/dev/wizard-steps`.
 */

const QUIET_HOURS = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  timezone: "Europe/London",
};

const OPTIONS = {
  services: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Roof Repair" },
    { id: "22222222-2222-4222-8222-222222222222", name: "New Roof" },
  ],
  sources: [
    { id: "55555555-5555-4555-8555-555555555555", label: "Meta Lead Ads" },
    { id: "66666666-6666-4666-8666-666666666666", label: "Website" },
  ],
};

function fixturePreview(): AudiencePreview {
  const bucket = (label: string, count: number, share: number) => ({
    key: label,
    label,
    count,
    share,
  });

  return {
    totalLeads: 8420,
    matched: 3180,
    eligible: 2480,
    suppressedTotal: 700,
    cooldownDays: 30,
    suppressed: [
      { reason: "opted_out", label: "Opted out", count: 210 },
      { reason: "invalid_number", label: "Invalid number", count: 96 },
      { reason: "contacted_recently", label: "Recently contacted (30 days)", count: 184 },
      { reason: "already_booked", label: "Already booked", count: 122 },
      { reason: "won", label: "Won customers", count: 88 },
    ],
    breakdowns: {
      service: [
        bucket("Roof Repair", 1240, 50),
        bucket("New Roof", 620, 25),
        bucket("Gutter Cleaning", 372, 15),
        bucket("Chimney Work", 248, 10),
      ],
      source: [
        bucket("Meta Lead Ads", 1488, 60),
        bucket("Website", 744, 30),
        bucket("Referral", 248, 10),
      ],
      status: [bucket("Contacted", 1736, 70), bucket("Lost", 744, 30)],
      age: [
        bucket("3-6 months", 992, 40),
        bucket("6-12 months", 744, 30),
        bucket("1-2 years", 496, 20),
        bucket("Over 2 years", 248, 10),
      ],
    },
    sample: [],
    excludedSample: [],
    cappedAt: null,
    truncated: false,
  };
}

function seed(channel: WizardChannel): WizardState {
  return {
    ...initialWizardState(channel),
    campaignName: "Autumn Roof Check",
    description: "Re-engage past quote requests with a seasonal roof check offer.",
    audienceLabel: "Past quote requests",
    tags: "Seasonal, Roofing",
    subject:
      channel === "email" ? "Still thinking about your {{service_name}}?" : "",
    initialMessage:
      channel === "email"
        ? "Hi {{first_name}},\n\nWe quoted you for {{service_name}} a while back and I wanted to check whether it is still something you are considering.\n\nIf it is, reply to this email and I will get you a fresh price this week.\n\nThanks,\n{{business_name}}"
        : "Hi {{first_name}}, it's {{business_name}}. You asked about {{service_name}} a while back — still need a hand? Reply YES for a fresh quote.",
    followUpEnabled: true,
    followUpSubject: channel === "email" ? "One last check on your roof" : "",
    followUpMessage:
      channel === "email"
        ? "Hi {{first_name}},\n\nJust closing the loop on this. If the timing is not right, no problem at all — reply STOP and I will not chase again.\n\n{{business_name}}"
        : "Hi {{first_name}}, just closing the loop — still want that {{service_name}} quote? Reply STOP to opt out.",
    followUpDelayDays: 3,
  };
}

export function WizardStepsHarness({
  step,
  channel,
}: {
  step: 2 | 3;
  channel: WizardChannel;
}) {
  const [state, setState] = React.useState<WizardState>(() => seed(channel));
  const preview = React.useMemo(() => fixturePreview(), []);

  const patch = React.useCallback((next: Partial<WizardState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const channels: ChannelOption[] = [
    { value: "sms", label: "SMS", available: true },
    { value: "whatsapp", label: "WhatsApp", available: true },
    { value: "email", label: "Email", available: true },
  ];

  if (step === 3) {
    return (
      <ReviewLaunchStep
        state={state}
        preview={preview}
        loading={false}
        businessName="Blackwellen Roofing & Exteriors"
        quietHours={QUIET_HOURS}
        options={OPTIONS}
        providerConnected
        messageValid
        timingValid
        revalidationNotice={null}
      />
    );
  }

  return (
    <MessageTimingStep
      state={state}
      patch={patch}
      preview={preview}
      loading={false}
      businessName="Blackwellen Roofing & Exteriors"
      quietHours={QUIET_HOURS}
      channels={channels}
      fieldErrors={{}}
    />
  );
}
