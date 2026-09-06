/**
 * The reference campaign set from the Reactivation design screens.
 *
 * Two consumers share it so they can never drift apart: the dev-only visual
 * preview at `/dev/reactivation-preview`, and the workspace seeder. It is
 * fixture data for development — the real page never reads this file.
 */

import {
  campaignIconKey,
  type ReactivationCampaignDetail,
  type ReactivationCampaignRow,
  type ReactivationSummary,
} from "./reactivation-types.ts";
import type { CampaignStatus } from "./types.ts";

export type ReactivationFixture = {
  slug: string;
  name: string;
  description: string;
  status: CampaignStatus;
  audienceLabel: string;
  channel: "sms" | "whatsapp";
  sent: number;
  replies: number;
  qualified: number;
  booked: number;
  progress: number;
  /** ISO day the campaign was created. */
  created: string;
  /** How long ago it was last touched, in hours. */
  updatedHoursAgo: number;
  tags: string[];
};

export const REACTIVATION_FIXTURES: ReactivationFixture[] = [
  {
    slug: "autumn-roof-check",
    name: "Autumn Roof Check",
    description:
      "Re-engage past quote requests with a seasonal roof check offer.",
    status: "RUNNING",
    audienceLabel: "Past quote requests",
    channel: "sms",
    sent: 2480,
    replies: 412,
    qualified: 86,
    booked: 32,
    progress: 68,
    created: "2024-10-10",
    updatedHoursAgo: 2,
    tags: ["Seasonal", "Roofing", "Past Quotes"],
  },
  {
    slug: "guttering-reminder",
    name: "Guttering Reminder",
    description: "Follow up on expired guttering quotes before winter.",
    status: "SCHEDULED",
    audienceLabel: "Guttering enquiries",
    channel: "whatsapp",
    sent: 1920,
    replies: 210,
    qualified: 54,
    booked: 18,
    progress: 0,
    created: "2024-10-22",
    updatedHoursAgo: 24,
    tags: ["Seasonal", "Guttering"],
  },
  {
    slug: "dormant-leads-q3",
    name: "Dormant Leads Q3",
    description: "Re-engage older leads with a general services check-in.",
    status: "PAUSED",
    audienceLabel: "All dormant leads",
    channel: "sms",
    sent: 3145,
    replies: 580,
    qualified: 112,
    booked: 36,
    progress: 42,
    created: "2024-09-15",
    updatedHoursAgo: 72,
    tags: ["Dormant"],
  },
  {
    slug: "new-roof-follow-up",
    name: "New Roof Follow Up",
    description:
      "Final attempt to re-engage new roof enquiries from earlier this year.",
    status: "COMPLETED",
    audienceLabel: "New roof enquiries",
    channel: "sms",
    sent: 1842,
    replies: 320,
    qualified: 78,
    booked: 28,
    progress: 100,
    created: "2024-08-03",
    updatedHoursAgo: 24 * 7,
    tags: ["Roofing"],
  },
  {
    slug: "spring-maintenance",
    name: "Spring Maintenance",
    description: "Reactivation campaign for general maintenance enquiries.",
    status: "DRAFT",
    audienceLabel: "General enquiries",
    channel: "sms",
    sent: 0,
    replies: 0,
    qualified: 0,
    booked: 0,
    progress: 0,
    created: "2024-10-28",
    updatedHoursAgo: 2,
    tags: ["Seasonal"],
  },
  {
    slug: "commercial-outreach",
    name: "Commercial Outreach",
    description: "Re-engage previous commercial property enquiries.",
    status: "RUNNING",
    audienceLabel: "Commercial leads",
    channel: "sms",
    sent: 1184,
    replies: 214,
    qualified: 66,
    booked: 22,
    progress: 55,
    created: "2024-10-05",
    updatedHoursAgo: 5,
    tags: ["Commercial"],
  },
  {
    slug: "emergency-repair",
    name: "Emergency Repair",
    description:
      "Reactivation for emergency repair enquiries (no longer active).",
    status: "CANCELLED",
    audienceLabel: "Emergency enquiries",
    channel: "sms",
    sent: 892,
    replies: 96,
    qualified: 18,
    booked: 4,
    progress: 100,
    created: "2024-07-12",
    updatedHoursAgo: 24 * 14,
    tags: ["Emergency"],
  },
  {
    slug: "quote-follow-up",
    name: "Quote Follow Up",
    description: "Follow up on quotes that expired 30+ days ago.",
    status: "RUNNING",
    audienceLabel: "Expired quotes",
    channel: "sms",
    sent: 1971,
    replies: 310,
    qualified: 76,
    booked: 24,
    progress: 61,
    created: "2024-09-28",
    updatedHoursAgo: 24,
    tags: ["Past Quotes"],
  },
];

const OWNER = "Jamahl Thomas";

function iso(day: string) {
  return new Date(day + "T09:34:00.000Z").toISOString();
}

function hoursAgo(hours: number, now: number) {
  return new Date(now - hours * 3600_000).toISOString();
}

export function fixtureRows(now = Date.now()): ReactivationCampaignRow[] {
  return REACTIVATION_FIXTURES.map((fixture) => ({
    id: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    status: fixture.status,
    channel: fixture.channel,
    audienceLabel: fixture.audienceLabel,
    icon: campaignIconKey({
      status: fixture.status,
      channel: fixture.channel,
      audienceLabel: fixture.audienceLabel,
      name: fixture.name,
    }),
    audience: fixture.sent,
    sent: fixture.sent,
    replies: fixture.replies,
    qualified: fixture.qualified,
    booked: fixture.booked,
    progress: fixture.progress,
    tags: fixture.tags,
    createdAt: iso(fixture.created),
    updatedAt: hoursAgo(fixture.updatedHoursAgo, now),
    scheduledAt: fixture.status === "SCHEDULED" ? hoursAgo(-48, now) : null,
    createdByName: OWNER,
  }));
}

/**
 * The KPI figures from the reference screen, verbatim.
 *
 * They are stated rather than summed from the eight cards above because the
 * design's headline numbers are larger than those eight campaigns account for
 * — the strip covers the whole workspace, including campaigns beyond the
 * first page. In production every one of these comes from
 * `getReactivationSummary`, which does derive them from live data.
 */
export function fixtureSummary(): ReactivationSummary {
  return {
    eligibleLeads: 12486,
    eligibleThresholdDays: 90,
    totalCampaigns: REACTIVATION_FIXTURES.length,
    runningCampaigns: 3,
    scheduledCampaigns: 2,
    replies: 2842,
    repliesTrend: { value: "+12%", direction: "up" },
    qualified: 612,
    qualificationRate: 21.5,
    qualifiedTrend: { value: "+18%", direction: "up" },
    booked: 184,
    bookingRate: 6.5,
    bookedTrend: { value: "+24%", direction: "up" },
    revenue: 24680,
  };
}

const AUDIENCE_PREVIEW: {
  name: string;
  service: string;
  contact: string;
  label: string;
  eligibility: "eligible" | "contacted" | "converted" | "excluded";
  hoursAgo: number;
}[] = [
  {
    name: "Sarah Whitfield",
    service: "Roof repair",
    contact: "07700 900142",
    label: "Booked",
    eligibility: "converted",
    hoursAgo: 6,
  },
  {
    name: "Daniel Okafor",
    service: "Roof replacement",
    contact: "07700 900318",
    label: "Replied",
    eligibility: "converted",
    hoursAgo: 11,
  },
  {
    name: "Priya Raman",
    service: "Guttering & fascias",
    contact: "07700 900677",
    label: "Delivered",
    eligibility: "contacted",
    hoursAgo: 20,
  },
  {
    name: "Tom Bexley",
    service: "Flat roof / GRP",
    contact: "07700 900254",
    label: "Contacted",
    eligibility: "contacted",
    hoursAgo: 26,
  },
  {
    name: "Alice Moreau",
    service: "Chimney works",
    contact: "07700 900931",
    label: "Eligible",
    eligibility: "eligible",
    hoursAgo: 48,
  },
  {
    name: "Gareth Pyle",
    service: "Roof repair",
    contact: "07700 900488",
    label: "Suppressed",
    eligibility: "excluded",
    hoursAgo: 72,
  },
];

export function fixtureDetail(
  slug: string,
  now = Date.now(),
): ReactivationCampaignDetail | null {
  const fixture = REACTIVATION_FIXTURES.find((item) => item.slug === slug);
  if (!fixture) return null;

  const delivered = Math.round(fixture.sent * 0.97);
  const pending =
    fixture.progress >= 100
      ? 0
      : Math.round(fixture.sent * ((100 - fixture.progress) / 100));

  return {
    id: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    status: fixture.status,
    channel: fixture.channel,
    icon: campaignIconKey({
      status: fixture.status,
      channel: fixture.channel,
      audienceLabel: fixture.audienceLabel,
      name: fixture.name,
    }),
    audienceLabel: fixture.audienceLabel + " (90+ days)",
    estimatedAudienceSize: fixture.sent,
    tags: fixture.tags,
    sendWindow: "8:00 AM – 8:00 PM (ET)",
    createdAt: iso(fixture.created),
    createdByName: OWNER,
    updatedAt: hoursAgo(fixture.updatedHoursAgo, now),
    updatedByName: OWNER,
    scheduledAt: null,
    startedAt: iso(fixture.created),
    pausedAt: fixture.status === "PAUSED" ? hoursAgo(72, now) : null,
    completedAt: fixture.status === "COMPLETED" ? hoursAgo(168, now) : null,
    cancelledAt: fixture.status === "CANCELLED" ? hoursAgo(336, now) : null,
    totals: {
      audience: fixture.sent,
      sent: fixture.sent,
      delivered,
      replies: fixture.replies,
      qualified: fixture.qualified,
      booked: fixture.booked,
      failed: fixture.sent - delivered,
      stopped: fixture.status === "CANCELLED" ? 214 : 0,
      pending,
      revenue: fixture.booked * 1850,
    },
    progress: fixture.progress,
    eligibilityRules: [
      {
        label: "Dormant for 90+ days",
        detail: "Leads contacted more recently than this are left alone.",
      },
      {
        label: "Not already booked or won",
        detail: "A lead that converted is never re-contacted by a campaign.",
      },
      {
        label: "Has not opted out",
        detail:
          "Opt-outs and the suppression list are re-checked before every send.",
      },
      {
        label: "Has a reachable SMS contact",
        detail:
          "Leads without a usable number are excluded when the audience is built.",
      },
      {
        label: "Not in a live conversation",
        detail:
          "Leads under human takeover, or mid new-lead follow-up, are held back so the two flows never overlap.",
      },
    ],
    audienceSample: AUDIENCE_PREVIEW.map((row, index) => ({
      id: fixture.slug + "-" + index,
      leadId: "lead-" + index,
      name: row.name,
      service: row.service,
      lastActivityAt: hoursAgo(row.hoursAgo, now),
      channel: fixture.channel,
      contact: row.contact,
      eligibility: row.eligibility,
      eligibilityLabel: row.label,
    })),
    audienceSampleTotal: fixture.sent,
    messages: [
      {
        position: 1,
        label: "Opening message",
        channel: fixture.channel,
        timing: "When the campaign reaches the lead",
        enabled: true,
        body:
          "Hi {{first_name}}, it's {{business_name}}. We're booking autumn roof " +
          "checks in your area — would you like us to take another look at " +
          "yours? Reply STOP to opt out.",
        sent: fixture.sent,
      },
      {
        position: 2,
        label: "Follow-up",
        channel: fixture.channel,
        timing: "+48 hours, if there is no reply",
        enabled: true,
        body:
          "Hi {{first_name}}, just checking you saw this — we still have a " +
          "couple of slots left this month. {{business_phone}}",
        sent: Math.round(fixture.sent * 0.42),
      },
    ],
    activity: [
      {
        id: "a1",
        action: "campaign.launched",
        label: "Campaign started",
        actor: OWNER,
        at: iso(fixture.created),
      },
      {
        id: "a2",
        action: "campaign.created",
        label: "Campaign created",
        actor: OWNER,
        at: iso(fixture.created),
      },
    ],
    providerConnected: true,
  };
}
