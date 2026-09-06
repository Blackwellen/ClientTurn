import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  conversionGoalMeta,
  defaultOptimizationConfig,
  optimizationConfigSchema,
  successEventLabel,
  type ConversionGoal,
  type Grade,
  type OptimizationConfig,
} from "../campaign-draft";
import { EMPTY_FUNNEL, type CampaignFunnel, type CampaignStatus } from "../types";
import { loadCampaignBudgetUsage } from "./budget";
import type { CampaignBudgetUsage } from "../campaign-budget";

/**
 * Campaign Detail reads (V4 section 18).
 *
 * Every figure on this page is an aggregate the database produced, never a
 * count taken by pulling rows into the app. Overview must stay cheap on a
 * campaign with fifty thousand recipients, which rules out loading membership
 * to count it.
 *
 * Loaders are separate per tab so opening Overview does not pay for the
 * audience table nobody is looking at.
 */

export type CampaignHeader = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  priority: number;
  archivedAt: string | null;
  conversionGoal: ConversionGoal | null;
  conversionGoalLabel: string | null;
  successEventLabel: string | null;
  serviceName: string | null;
  minimumGrade: Grade;
  autoOptimize: boolean;
  reviewBeforeOutreach: boolean;
  dailyContactCap: number;
  monthlyContactCap: number;
  prospectsPerRun: number;
  senderEmail: string | null;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string | null;
  launchedAt: string | null;
  pauseReason: string | null;
  optimization: OptimizationConfig;
};

export type CampaignKpis = {
  prospects: number;
  contactsSent: number;
  replies: number;
  qualified: number;
  booked: number;
  /** Contacts sent against what the campaign set out to contact. */
  targetProspects: number;
};

export type FunnelStage = {
  key: string;
  label: string;
  value: number;
  /** Share of the stage above it, so each bar answers "how many got through". */
  percent: number | null;
};

export type CampaignOverview = {
  header: CampaignHeader;
  funnel: CampaignFunnel;
  kpis: CampaignKpis;
  stages: FunnelStage[];
  budget: CampaignBudgetUsage;
  series: DailyPoint[];
  replies: RecentReply[];
  attention: AttentionItem[];
};

export type DailyPoint = {
  day: string;
  contactsSent: number;
  replies: number;
  qualified: number;
  booked: number;
};

export type RecentReply = {
  messageId: string;
  prospectId: string;
  name: string;
  company: string | null;
  classification: string | null;
  /** A short preview only. The full message stays in the conversation. */
  snippet: string;
  receivedAt: string;
};

export type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  tone: "warning" | "danger" | "accent";
  action: { label: string; href: string } | null;
};

/* ---------------------------------------------------------------- header */

export async function loadCampaignHeader(
  businessId: string,
  campaignId: string,
): Promise<CampaignHeader | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaigns")
    .select(
      `id, name, description, status, priority, archived_at, conversion_goal_type,
       success_event, minimum_grade, auto_optimize, auto_optimize_config,
       review_before_outreach, daily_contact_cap, monthly_contact_cap, prospects_per_run,
       created_at, created_by, updated_at, launched_at, pause_reason,
       services ( name ), sender_identities ( email )`,
    )
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!data) return null;

  const service = data.services as unknown as { name: string } | null;
  const sender = data.sender_identities as unknown as { email: string } | null;
  const goal = (data.conversion_goal_type ?? null) as ConversionGoal | null;

  const { data: creator } = data.created_by
    ? await admin
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", data.created_by)
        .maybeSingle()
    : { data: null };

  const parsedConfig = optimizationConfigSchema.safeParse(data.auto_optimize_config);

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    status: data.status as CampaignStatus,
    priority: data.priority,
    archivedAt: data.archived_at,
    conversionGoal: goal,
    conversionGoalLabel: goal ? (conversionGoalMeta(goal)?.label ?? null) : null,
    successEventLabel: data.success_event ? successEventLabel(data.success_event) : null,
    serviceName: service?.name ?? null,
    minimumGrade: data.minimum_grade as Grade,
    autoOptimize: data.auto_optimize,
    reviewBeforeOutreach: data.review_before_outreach,
    dailyContactCap: data.daily_contact_cap,
    monthlyContactCap: data.monthly_contact_cap,
    prospectsPerRun: data.prospects_per_run,
    senderEmail: sender?.email ?? null,
    createdAt: data.created_at,
    createdByName: creator
      ? [creator.first_name, creator.last_name].filter(Boolean).join(" ") || null
      : null,
    updatedAt: data.updated_at,
    launchedAt: data.launched_at,
    pauseReason: data.pause_reason,
    // A stored config that no longer parses falls back to the safe default
    // rather than being honoured as-is.
    optimization: parsedConfig.success
      ? parsedConfig.data
      : {
          ...defaultOptimizationConfig(data.minimum_grade as Grade),
          enabled: data.auto_optimize,
        },
  };
}

/* -------------------------------------------------------------- overview */

export async function loadCampaignOverview(
  businessId: string,
  campaignId: string,
  days = 30,
): Promise<CampaignOverview | null> {
  const header = await loadCampaignHeader(businessId, campaignId);
  if (!header) return null;

  const admin = createAdminClient();

  const [results, bookings, budget, series, replies, attention] = await Promise.all([
    admin.rpc("outreach_campaign_results", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
    }),
    admin.rpc("outreach_campaign_bookings", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
    }),
    loadCampaignBudgetUsage(businessId, campaignId),
    admin.rpc("outreach_campaign_daily_series", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
      p_days: days,
    }),
    loadRecentReplies(businessId, campaignId, 5),
    Promise.resolve([] as AttentionItem[]),
  ]);

  const row = Array.isArray(results.data) ? results.data[0] : null;
  const funnel: CampaignFunnel = row
    ? {
        audience: row.audience_count,
        contacted: row.contacted_count,
        delivered: row.delivered_count,
        bounced: row.bounced_count,
        replies: row.reply_count,
        positiveReplies: row.positive_reply_count,
        optOuts: row.opt_out_count,
        promoted: row.promoted_count,
        converted: row.converted_count,
        stopped: row.stopped_count,
        pending: row.pending_count,
      }
    : EMPTY_FUNNEL;

  const booked = Number(bookings.data ?? 0);
  const attentionItems = await buildAttentionItems({
    businessId,
    campaignId,
    funnel,
    budget,
    header,
  });

  return {
    header,
    funnel,
    budget,
    kpis: {
      prospects: funnel.audience,
      contactsSent: funnel.contacted,
      replies: funnel.replies,
      qualified: funnel.promoted,
      booked,
      targetProspects: header.prospectsPerRun,
    },
    stages: buildFunnelStages(header, funnel, booked),
    series: ((series.data ?? []) as Record<string, unknown>[]).map((point) => ({
      day: String(point.day),
      contactsSent: Number(point.contacts_sent ?? 0),
      replies: Number(point.replies ?? 0),
      qualified: Number(point.qualified ?? 0),
      booked: Number(point.booked ?? 0),
    })),
    replies,
    attention: attentionItems.length > 0 ? attentionItems : attention,
  };
}

/**
 * The funnel, with each stage a strict subset of the one above it.
 *
 * "Qualified" is a prospect promoted to a lead and "Converted" is one that
 * reached the campaign's own goal, so the bars narrow monotonically and a
 * customer can reconcile the last one against Leads and Bookings.
 */
function buildFunnelStages(
  header: CampaignHeader,
  funnel: CampaignFunnel,
  booked: number,
): FunnelStage[] {
  const target = Math.max(header.prospectsPerRun, funnel.audience);
  const goalLabel = header.conversionGoalLabel ?? "Converted";

  const raw = [
    { key: "target", label: "Target prospects", value: target },
    { key: "sent", label: "Sent", value: funnel.contacted },
    { key: "replies", label: "Replies", value: funnel.replies },
    { key: "qualified", label: "Qualified", value: funnel.promoted },
    { key: "goal", label: goalLabel, value: funnel.converted },
    { key: "booked", label: "Booked", value: booked },
  ];

  return raw.map((stage, index) => {
    if (index === 0) return { ...stage, percent: null };
    const above = raw[index - 1].value;
    return {
      ...stage,
      percent: above > 0 ? (stage.value / above) * 100 : null,
    };
  });
}

/* --------------------------------------------------------- recent replies */

export async function loadRecentReplies(
  businessId: string,
  campaignId: string,
  limit: number,
): Promise<RecentReply[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("messages")
    .select(
      `id, body, reply_classification, created_at, prospect_id,
       prospects ( first_name, last_name, prospect_companies ( name ) )`,
    )
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .eq("direction", "inbound")
    .not("prospect_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const prospect = row.prospects as unknown as
      | { first_name: string | null; last_name: string | null; prospect_companies: { name: string } | null }
      | null;
    const company = prospect?.prospect_companies as unknown as { name: string } | null;
    const name =
      [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ") || "Unknown";

    return {
      messageId: row.id,
      prospectId: row.prospect_id as string,
      name,
      company: company?.name ?? null,
      classification: row.reply_classification,
      // A preview, not the message. The whole reply lives in the conversation,
      // where reading it is a deliberate act rather than a side effect of
      // glancing at a dashboard.
      snippet: (row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      receivedAt: row.created_at,
    };
  });
}

/* -------------------------------------------------------- attention items */

async function buildAttentionItems(input: {
  businessId: string;
  campaignId: string;
  funnel: CampaignFunnel;
  budget: CampaignBudgetUsage;
  header: CampaignHeader;
}): Promise<AttentionItem[]> {
  const admin = createAdminClient();
  const items: AttentionItem[] = [];

  const { count: needsReview } = await admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .or("status.eq.REVIEW,outreach_eligibility.eq.REVIEW");

  if ((needsReview ?? 0) > 0) {
    items.push({
      key: "review",
      title: `${needsReview} prospect${needsReview === 1 ? "" : "s"} need review`,
      detail: "Below score threshold or missing verification.",
      tone: "warning",
      action: {
        label: "Review",
        href: `/app/find-leads?view=prospects&quick=review&campaign=${input.campaignId}`,
      },
    });
  }

  if (input.funnel.bounced > 0) {
    items.push({
      key: "bounces",
      title: `${input.funnel.bounced} hard bounce${input.funnel.bounced === 1 ? "" : "s"}`,
      detail: "Email addresses marked as invalid.",
      tone: "danger",
      action: {
        label: "View",
        href: `/app/find-leads/campaigns/${input.campaignId}?view=audience&filter=suppressed`,
      },
    });
  }

  const percent = input.budget.percentUsed;
  if (percent !== null && percent >= 70) {
    items.push({
      key: "budget",
      title: `Budget at ${percent}%`,
      detail:
        percent >= 100
          ? "This campaign has reached its budget and has stopped spending."
          : "You are approaching your budget limit.",
      tone: percent >= 100 ? "danger" : "accent",
      // "Increase" still goes through the same ceiling checks as everything
      // else; it opens the control, it does not raise anything by itself.
      action: {
        label: "Increase",
        href: `/app/find-leads/campaigns/${input.campaignId}?view=performance#budget`,
      },
    });
  }

  if (input.header.pauseReason) {
    items.push({
      key: "paused",
      title: "This campaign was paused automatically",
      detail: input.header.pauseReason,
      tone: "danger",
      action: { label: "View", href: "/app/settings?view=connections" },
    });
  }

  return items;
}

/* ------------------------------------------------------------- audience */

export type CampaignAudienceRow = {
  prospectId: string;
  name: string;
  company: string | null;
  role: string | null;
  grade: Grade | null;
  score: number | null;
  intentSignals: number;
  status: string;
  sendState: string;
  stepsSent: number;
  replyClassification: string | null;
  promotedLeadId: string | null;
  eligibility: string;
  nextSendAt: string | null;
};

export const AUDIENCE_FILTERS = [
  "all",
  "ready",
  "contacted",
  "replied",
  "review",
  "suppressed",
  "promoted",
] as const;

export type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

const FILTER_STATES: Partial<Record<AudienceFilter, string[]>> = {
  ready: ["PENDING", "SCHEDULED"],
  contacted: ["ACTIVE", "COMPLETED"],
  replied: ["REPLIED"],
  suppressed: ["SUPPRESSED", "BOUNCED", "STOPPED"],
};

export async function loadCampaignAudience(input: {
  businessId: string;
  campaignId: string;
  filter: AudienceFilter;
  page: number;
  pageSize: number;
}): Promise<{ rows: CampaignAudienceRow[]; total: number }> {
  const admin = createAdminClient();
  const from = (input.page - 1) * input.pageSize;

  let query = admin
    .from("prospects")
    .select(
      `id, first_name, last_name, role_title, grade, score, status, outreach_eligibility,
       promoted_to_lead_id,
       prospect_companies ( name ),
       outreach_recipient_runs ( status, steps_sent, next_send_at )`,
      { count: "exact" },
    )
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .order("score", { ascending: false, nullsFirst: false })
    .range(from, from + input.pageSize - 1);

  if (input.filter === "review") {
    query = query.or("status.eq.REVIEW,outreach_eligibility.eq.REVIEW");
  } else if (input.filter === "promoted") {
    query = query.not("promoted_to_lead_id", "is", null);
  }

  const { data, count } = await query;
  const states = FILTER_STATES[input.filter];

  const rows = (data ?? [])
    .map((row) => {
      const company = row.prospect_companies as unknown as { name: string } | null;
      const runs = (row.outreach_recipient_runs ?? []) as unknown as {
        status: string;
        steps_sent: number;
        next_send_at: string | null;
      }[];
      const run = runs[0] ?? null;

      return {
        prospectId: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
        company: company?.name ?? null,
        role: row.role_title,
        grade: row.grade as Grade | null,
        score: row.score === null ? null : Number(row.score),
        intentSignals: 0,
        status: row.status,
        sendState: run?.status ?? "NOT_ENROLLED",
        stepsSent: run?.steps_sent ?? 0,
        replyClassification: null,
        promotedLeadId: row.promoted_to_lead_id,
        eligibility: row.outreach_eligibility,
        nextSendAt: run?.next_send_at ?? null,
      };
    })
    .filter((row) => !states || states.includes(row.sendState));

  return { rows, total: count ?? rows.length };
}

/* -------------------------------------------------------------- sequence */

export type CampaignSequenceStep = {
  position: number;
  delayDays: number;
  subject: string | null;
  body: string;
  enabled: boolean;
  sent: number;
  replies: number;
};

export type CampaignSequenceView = {
  version: number;
  status: string;
  publishedAt: string | null;
  steps: CampaignSequenceStep[];
  variants: {
    stepPosition: number | null;
    label: string;
    allocationPercent: number;
    sent: number;
    replies: number;
    positiveReplies: number;
  }[];
  /** True when the campaign is live, so edits create a new version rather
   *  than rewriting what has already been sent. */
  frozen: boolean;
};

export async function loadCampaignSequence(
  businessId: string,
  campaignId: string,
): Promise<CampaignSequenceView | null> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("status, active_sequence_id")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return null;

  const { data: sequence } = await admin
    .from("outreach_sequences")
    .select("id, version, status, published_at")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sequence) return null;

  const [steps, sends, variants] = await Promise.all([
    admin
      .from("outreach_steps")
      .select("id, position, delay_seconds, subject_template, body_template, enabled")
      .eq("business_id", businessId)
      .eq("sequence_id", sequence.id)
      .order("position", { ascending: true }),
    admin
      .from("messages")
      .select("outreach_step_id, direction")
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .not("outreach_step_id", "is", null)
      .limit(5000),
    admin
      .from("campaign_variants")
      .select(
        "label, allocation_percent, sent_count, reply_count, positive_reply_count, step_id",
      )
      .eq("business_id", businessId)
      .eq("active", true),
  ]);

  const sentByStep = new Map<string, number>();
  const repliesByStep = new Map<string, number>();
  for (const message of sends.data ?? []) {
    const key = message.outreach_step_id as string;
    const bucket = message.direction === "inbound" ? repliesByStep : sentByStep;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  const stepPositionById = new Map<string, number>();
  for (const step of steps.data ?? []) stepPositionById.set(step.id, step.position);

  return {
    version: sequence.version,
    status: sequence.status,
    publishedAt: sequence.published_at,
    frozen: campaign.status === "ACTIVE" || campaign.status === "OPTIMIZING",
    steps: (steps.data ?? []).map((step) => ({
      position: step.position,
      delayDays: Math.round(Number(step.delay_seconds) / 86400),
      subject: step.subject_template,
      body: step.body_template,
      enabled: step.enabled,
      sent: sentByStep.get(step.id) ?? 0,
      replies: repliesByStep.get(step.id) ?? 0,
    })),
    variants: (variants.data ?? []).map((variant) => ({
      stepPosition: variant.step_id ? (stepPositionById.get(variant.step_id) ?? null) : null,
      label: variant.label,
      allocationPercent: Number(variant.allocation_percent),
      sent: variant.sent_count,
      replies: variant.reply_count,
      positiveReplies: variant.positive_reply_count,
    })),
  };
}

/* ----------------------------------------------------------- performance */

export type CampaignPerformanceView = {
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positiveReplies: number;
  qualified: number;
  promoted: number;
  booked: number;
  optOuts: number;
  /** Qualified over contacted, or null when nothing was sent. */
  conversionRate: number | null;
  budget: CampaignBudgetUsage;
  /** Pence per reply, null when there have been none. */
  costPerReplyMinor: number | null;
  costPerQualifiedMinor: number | null;
  series: DailyPoint[];
};

export async function loadCampaignPerformance(
  businessId: string,
  campaignId: string,
  days = 30,
): Promise<CampaignPerformanceView | null> {
  const admin = createAdminClient();

  const [results, bookings, budget, series] = await Promise.all([
    admin.rpc("outreach_campaign_results", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
    }),
    admin.rpc("outreach_campaign_bookings", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
    }),
    loadCampaignBudgetUsage(businessId, campaignId),
    admin.rpc("outreach_campaign_daily_series", {
      p_business_id: businessId,
      p_campaign_id: campaignId,
      p_days: days,
    }),
  ]);

  const row = Array.isArray(results.data) ? results.data[0] : null;
  if (!row) return null;

  const contacted = row.contacted_count;
  const replies = row.reply_count;
  const promoted = row.promoted_count;

  return {
    sent: contacted,
    delivered: row.delivered_count,
    bounced: row.bounced_count,
    replies,
    positiveReplies: row.positive_reply_count,
    qualified: promoted,
    promoted,
    booked: Number(bookings.data ?? 0),
    optOuts: row.opt_out_count,
    conversionRate: contacted > 0 ? promoted / contacted : null,
    budget,
    // Null rather than zero: dividing by nothing is unknown, and "£0 per
    // reply" on a campaign with no replies reads as a bargain.
    costPerReplyMinor: replies > 0 ? Math.round(budget.spentMinor / replies) : null,
    costPerQualifiedMinor: promoted > 0 ? Math.round(budget.spentMinor / promoted) : null,
    series: ((series.data ?? []) as Record<string, unknown>[]).map((point) => ({
      day: String(point.day),
      contactsSent: Number(point.contacts_sent ?? 0),
      replies: Number(point.replies ?? 0),
      qualified: Number(point.qualified ?? 0),
      booked: Number(point.booked ?? 0),
    })),
  };
}

/* -------------------------------------------------------------- activity */

export type CampaignActivityEntry = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  actorName: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function loadCampaignActivity(
  businessId: string,
  campaignId: string,
  limit = 100,
): Promise<CampaignActivityEntry[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaign_events")
    .select(
      "id, event_type, from_status, to_status, actor_type, actor_user_id, summary, metadata, created_at",
    )
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const actorIds = [
    ...new Set((data ?? []).map((row) => row.actor_user_id).filter(Boolean)),
  ] as string[];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", actorIds);
    for (const profile of profiles ?? []) {
      names.set(
        profile.id,
        [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Someone",
      );
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorType: row.actor_type,
    actorName: row.actor_user_id ? (names.get(row.actor_user_id) ?? null) : null,
    summary: row.summary,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

/** Optimiser adjustments, newest first, for the Activity and Overview cards. */
export async function loadOptimizationHistory(
  businessId: string,
  campaignId: string,
  limit = 10,
): Promise<
  { id: string; actionType: string; rationale: string | null; createdAt: string }[]
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("optimization_actions")
    .select("id, action_type, rationale, created_at, applied")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .eq("applied", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    actionType: row.action_type,
    rationale: row.rationale,
    createdAt: row.created_at,
  }));
}
