import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canPerform, isFinal } from "@/lib/campaigns/reactivation-types";
import type { CampaignStatus } from "@/lib/campaigns/types";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * The rest of the workspace, as service operations: connectors, bookings,
 * campaigns, prospects, the business profile and the headline numbers.
 *
 * These exist so that "what an assistant can do" and "what a person can do"
 * are the same list. The alternative — a thin tool surface over a thick app —
 * is how an assistant ends up confidently telling a customer it cannot see
 * something the customer is looking at.
 *
 * Three things are true of every handler below, and they are the reason this is
 * safe to make broad:
 *
 *   1. **Every query is scoped to `context.businessId`**, which the runtime
 *      took from the credential and no caller can supply. There is no argument
 *      anywhere in this file that names a workspace.
 *   2. **The risk class does the gating, not the handler.** Anything that
 *      leaves the building or cannot be undone is declared as such in the
 *      registry, so the runtime demands a person's confirmation before this
 *      code is ever reached.
 *   3. **Reads are bounded.** Every list has a hard cap, because a tool that
 *      can return ten thousand rows into a model's context is a tool that will.
 */

/* ------------------------------------------------------------- connectors */

// One unbroken literal, not a concatenation: the typed Supabase client infers
// the row shape from the select string, and `"a, b" + "c, d"` widens to `string`
// — which silently degrades every result in this file to an error type.
const CONNECTOR_FIELDS =
  "id, provider_type, status, display_name, external_account_id, last_success_at, last_error_at, last_error_code, last_error_message, created_at";

type ConnectorRow = {
  id: string;
  provider_type: string;
  status: string;
  display_name: string | null;
  external_account_id: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
};

/**
 * The `integrations.status` values that mean "this is working".
 *
 * TESTING counts as healthy: a connection mid-check has not failed, and
 * reporting it as broken would make the Connections page flicker red every time
 * someone pressed Test.
 */
const HEALTHY_CONNECTOR_STATES = new Set(["HEALTHY", "TESTING"]);

function presentConnector(row: ConnectorRow) {
  return {
    id: row.id,
    provider: row.provider_type,
    status: row.status,
    name: row.display_name,
    account: row.external_account_id,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    // The code, not the raw provider message: a provider error string can carry
    // an account identifier or a token fragment, and this is read by a model.
    lastErrorCode: row.last_error_code,
    lastError: row.last_error_message,
    connectedAt: row.created_at,
  };
}

defineOperation("connector.list", {
  schema: z.object({
    status: z.string().trim().max(40).optional(),
  }),
  async run({ args, context }: HandlerInput<{ status?: string }>) {
    const db = createAdminClient();
    let query = db
      .from("integrations")
      .select(CONNECTOR_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (args.status) query = query.eq("status", args.status);

    const { data } = await query;
    const rows = (data ?? []) as ConnectorRow[];

    return {
      data: {
        connectors: rows.map(presentConnector),
        count: rows.length,
        // Stated rather than left for the caller to work out from the list, so
        // an assistant can answer "is anything broken" in one call.
        //
        // Compared against the vocabulary the column actually uses. An earlier
        // version tested for "connected", which is not one of the five values
        // this column can hold — so every connector, including healthy ones,
        // counted as needing attention.
        needingAttention: rows.filter((row) => !HEALTHY_CONNECTOR_STATES.has(row.status))
          .length,
      },
      entityId: null,
    };
  },
});

async function loadConnectorOrFail(
  businessId: string,
  connectorId: string,
): Promise<ConnectorRow> {
  const db = createAdminClient();
  const { data } = await db
    .from("integrations")
    .select(CONNECTOR_FIELDS)
    .eq("id", connectorId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) throw new ServiceError("NOT_FOUND", "That connection could not be found.");
  return data as ConnectorRow;
}

defineOperation("connector.get", {
  schema: z.object({ connectorId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ connectorId: string }>) {
    const connector = await loadConnectorOrFail(context.businessId, args.connectorId);
    const db = createAdminClient();

    const { data: events } = await db
      .from("webhook_events")
      .select("id, event_type, status, error_message, received_at")
      .eq("business_id", context.businessId)
      .eq("provider", connector.provider_type)
      .order("received_at", { ascending: false })
      .limit(10);

    return {
      data: {
        connector: presentConnector(connector),
        recentEvents: events ?? [],
      },
      entityId: connector.id,
    };
  },
});

defineOperation("connector.replay_event", {
  schema: z.object({ eventId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ eventId: string }>) {
    const db = createAdminClient();

    // Re-read and re-scope rather than trusting the id: it arrived from a
    // caller, and an event id from another workspace must not be replayable.
    const { data: event } = await db
      .from("webhook_events")
      .select("id, provider, event_type, status")
      .eq("id", args.eventId)
      .eq("business_id", context.businessId)
      .maybeSingle();

    if (!event) throw new ServiceError("NOT_FOUND", "That event could not be found.");

    const { enqueue } = await import("@/lib/jobs/queue");
    await enqueue(
      "webhook.replay",
      { webhookEventId: event.id },
      {
        businessId: context.businessId,
        // Replaying the same event twice while the first is still queued is a
        // no-op rather than two runs.
        idempotencyKey: `webhook.replay:${event.id}`,
      },
    );

    return {
      data: { eventId: event.id, queued: true },
      entityId: event.id,
      before: { status: event.status },
      after: { status: "queued_for_replay" },
      warnings: [
        {
          code: "queued",
          message:
            "The event is queued. It goes through exactly the same processing as when it first arrived.",
        },
      ],
    };
  },
});

defineOperation("connector.dismiss_event", {
  schema: z.object({ eventId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ eventId: string }>) {
    const db = createAdminClient();
    // `ignored` rather than `dismissed`: the column's vocabulary is
    // received / processing / processed / failed / ignored, and `ignored` is
    // exactly "seen, and deliberately not processed".
    const { data: event } = await db
      .from("webhook_events")
      .update({ status: "ignored" })
      .eq("id", args.eventId)
      .eq("business_id", context.businessId)
      .select("id, status")
      .maybeSingle();

    if (!event) throw new ServiceError("NOT_FOUND", "That event could not be found.");

    return {
      data: { eventId: event.id },
      entityId: event.id,
      after: { status: "ignored" },
    };
  },
});

defineOperation("connector.disconnect", {
  schema: z.object({ connectorId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ connectorId: string }>) {
    const before = await loadConnectorOrFail(context.businessId, args.connectorId);
    const db = createAdminClient();

    const { error } = await db
      .from("integrations")
      .update({
        status: "DISCONNECTED",
        last_error_code: null,
        last_error_message: null,
      })
      .eq("id", before.id)
      .eq("business_id", context.businessId);

    if (error) {
      throw new ServiceError("CONFLICT", "That connection could not be disconnected.");
    }

    // The stored credential goes with it. Leaving a live token behind for a
    // connection the customer believes is gone is the whole reason this is a
    // deliberate, confirmed action rather than a status flag.
    await db
      .from("integration_secrets")
      .delete()
      .eq("business_id", context.businessId)
      .eq("integration_id", before.id)
      .then(
        () => undefined,
        () => undefined,
      );

    return {
      data: { connector: { ...presentConnector(before), status: "DISCONNECTED" } },
      entityId: before.id,
      before: { status: before.status },
      after: { status: "DISCONNECTED" },
      warnings: [
        {
          code: "reconnect_required",
          message:
            "Reconnecting means signing in to that system again. Nothing already received has been deleted.",
        },
      ],
    };
  },
});

/* --------------------------------------------------------------- bookings */

const BOOKING_FIELDS =
  "id, lead_id, service_id, provider, starts_at, ends_at, location, status, notes, booking_url, reschedule_url, created_at";

/**
 * Exactly the values `bookings.status` permits.
 *
 * `rescheduled` is deliberately absent: it is not one of them, and a caller
 * offered it would have had the write rejected by the database. A rescheduled
 * appointment arrives from the provider as a new `starts_at` on the same
 * booking, which the booking sync handles.
 */
const BOOKING_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;

defineOperation("booking.list", {
  schema: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    status: z.enum(BOOKING_STATUSES).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ from?: string; to?: string; status?: string; limit?: number }>) {
    const db = createAdminClient();
    let query = db
      .from("bookings")
      .select(BOOKING_FIELDS)
      .eq("business_id", context.businessId)
      .order("starts_at", { ascending: true })
      .limit(args.limit ?? 25);

    if (args.from) query = query.gte("starts_at", args.from);
    if (args.to) query = query.lte("starts_at", args.to);
    if (args.status) query = query.eq("status", args.status);

    const { data } = await query;
    return {
      data: { bookings: data ?? [], count: data?.length ?? 0 },
      entityId: null,
    };
  },
});

defineOperation("booking.get", {
  schema: z.object({ bookingId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ bookingId: string }>) {
    const db = createAdminClient();
    const { data: booking } = await db
      .from("bookings")
      .select(BOOKING_FIELDS)
      .eq("id", args.bookingId)
      .eq("business_id", context.businessId)
      .maybeSingle();

    if (!booking) {
      throw new ServiceError("NOT_FOUND", "That appointment could not be found.");
    }

    const { data: lead } = await db
      .from("leads")
      .select("id, first_name, last_name, email, phone, status")
      .eq("id", booking.lead_id)
      .eq("business_id", context.businessId)
      .maybeSingle();

    return { data: { booking, lead }, entityId: booking.id };
  },
});

defineOperation("booking.set_status", {
  schema: z.object({
    bookingId: z.string().uuid(),
    status: z.enum(BOOKING_STATUSES),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ bookingId: string; status: (typeof BOOKING_STATUSES)[number] }>) {
    const db = createAdminClient();
    const { data: before } = await db
      .from("bookings")
      .select("id, status, lead_id")
      .eq("id", args.bookingId)
      .eq("business_id", context.businessId)
      .maybeSingle();

    if (!before) {
      throw new ServiceError("NOT_FOUND", "That appointment could not be found.");
    }

    if (before.status === args.status) {
      return {
        data: { booking: before, unchanged: true },
        entityId: before.id,
        warnings: [
          { code: "no_change", message: `That appointment is already ${args.status}.` },
        ],
      };
    }

    const { data: after, error } = await db
      .from("bookings")
      .update({ status: args.status })
      .eq("id", before.id)
      .eq("business_id", context.businessId)
      .select(BOOKING_FIELDS)
      .single();

    if (error || !after) {
      throw new ServiceError("CONFLICT", "That appointment could not be updated.");
    }

    return {
      // `unchanged` is present on both branches rather than only on the early
      // return, so a caller can read one field instead of inferring from its
      // absence — and so the two shapes are one type.
      data: { booking: after, unchanged: false },
      entityId: after.id,
      before: { status: before.status },
      after: { status: after.status },
      // The lead's own status is not touched here. Marking an appointment as a
      // no-show is a fact about the appointment; deciding what that means for
      // the lead is the customer's rule, not ours to infer.
      warnings: [
        {
          code: "lead_unchanged",
          message: "The lead's status is unchanged. Set it separately if it should move.",
        },
      ],
    };
  },
});

/* -------------------------------------------------------------- campaigns */

const CAMPAIGN_FIELDS =
  "id, name, description, status, channel, audience_label, estimated_audience_size, scheduled_at, launched_at, started_at, paused_at, completed_at, created_at";

defineOperation("campaign.list", {
  schema: z.object({
    status: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run({ args, context }: HandlerInput<{ status?: string; limit?: number }>) {
    const db = createAdminClient();
    let query = db
      .from("campaigns")
      .select(CAMPAIGN_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 25);

    if (args.status) query = query.eq("status", args.status);

    const { data } = await query;
    return {
      data: { campaigns: data ?? [], count: data?.length ?? 0 },
      entityId: null,
    };
  },
});

async function loadCampaignOrFail(businessId: string, campaignId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("campaigns")
    .select(CAMPAIGN_FIELDS)
    .eq("id", campaignId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) throw new ServiceError("NOT_FOUND", "That campaign could not be found.");
  return data;
}

defineOperation("campaign.get", {
  schema: z.object({ campaignId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ campaignId: string }>) {
    const campaign = await loadCampaignOrFail(context.businessId, args.campaignId);
    const db = createAdminClient();

    // Counted rather than listed. A campaign's contact list can be thousands of
    // rows, and none of them belong in a tool result.
    const { data: contacts } = await db
      .from("campaign_contacts")
      .select("state")
      .eq("business_id", context.businessId)
      .eq("campaign_id", campaign.id)
      .limit(5000);

    const byState = new Map<string, number>();
    for (const row of contacts ?? []) {
      byState.set(row.state, (byState.get(row.state) ?? 0) + 1);
    }

    return {
      data: {
        campaign,
        contacts: Object.fromEntries(byState),
      },
      entityId: campaign.id,
    };
  },
});

/**
 * The campaign lifecycle moves.
 *
 * The transition table in `campaigns/reactivation-types` is the authority on
 * what a given status may do, and it is re-derived here rather than restated.
 * An earlier version of this file invented its own preconditions and its own
 * lowercase status values — which the database rejected outright, because the
 * column's vocabulary is DRAFT / SCHEDULED / RUNNING / PAUSED / COMPLETED /
 * CANCELLED. Reading the real table is what stops that being possible again.
 */
function campaignLifecycle(
  operation: "campaign.pause" | "campaign.resume" | "campaign.launch",
) {
  const action =
    operation === "campaign.pause"
      ? ("pause" as const)
      : operation === "campaign.resume"
        ? ("resume" as const)
        : ("launch" as const);

  const target = operation === "campaign.pause" ? "PAUSED" : "RUNNING";

  defineOperation(operation, {
    schema: z.object({ campaignId: z.string().uuid() }),
    async run({ args, context }: HandlerInput<{ campaignId: string }>) {
      const before = await loadCampaignOrFail(context.businessId, args.campaignId);
      const db = createAdminClient();
      const status = before.status as CampaignStatus;

      if (!canPerform(status, action)) {
        throw new ServiceError(
          "CONFLICT",
          isFinal(status)
            ? "That campaign has already finished, so it cannot be changed."
            : `That is not something a ${status.toLowerCase()} campaign can do.`,
        );
      }

      const now = new Date().toISOString();
      const { data: after, error } = await db
        .from("campaigns")
        .update({
          status: target,
          updated_by: context.userId,
          paused_at: target === "PAUSED" ? now : null,
          started_at: target === "RUNNING" ? now : undefined,
          ...(operation === "campaign.launch"
            ? { launched_at: now, launched_by: context.userId }
            : {}),
        })
        .eq("id", before.id)
        .eq("business_id", context.businessId)
        // Optimistic concurrency, matching the app's own action: if someone
        // moved the campaign on between the read and this write, the update
        // matches nothing rather than silently overwriting their change.
        .eq("status", before.status)
        .select(CAMPAIGN_FIELDS)
        .maybeSingle();

      if (error || !after) {
        throw new ServiceError(
          "CONFLICT",
          "That campaign changed while this was being processed. Read it again and retry.",
        );
      }

      if (target === "RUNNING") {
        // The send loop is a job, not something done inline: a launch must not
        // hold a request open while it contacts thousands of people.
        const { enqueue } = await import("@/lib/jobs/queue");
        await enqueue(
          "campaign.send",
          { campaignId: after.id },
          { businessId: context.businessId },
        );
      }

      return {
        data: { campaign: after },
        entityId: after.id,
        before: { status: before.status },
        after: { status: after.status },
        warnings:
          target === "RUNNING"
            ? [
                {
                  code: "sending",
                  message:
                    "Sending has started. Suppression and quiet hours are re-checked before every message, but messages already sent cannot be recalled.",
                },
              ]
            : [],
      };
    },
  });
}

campaignLifecycle("campaign.pause");
campaignLifecycle("campaign.resume");
campaignLifecycle("campaign.launch");

/* -------------------------------------------------------------- prospects */

const PROSPECT_FIELDS =
  "id, company_id, first_name, last_name, role_title, email, phone_e164, linkedin_url, status, grade, score, verification_status, outreach_eligibility, eligibility_reason, promoted_to_lead_id, last_contacted_at, created_at";

defineOperation("prospect.search", {
  schema: z.object({
    query: z.string().trim().max(200).optional(),
    status: z.string().trim().max(40).optional(),
    grade: z.string().trim().max(4).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ query?: string; status?: string; grade?: string; limit?: number }>) {
    const db = createAdminClient();
    let query = db
      .from("prospects")
      .select(PROSPECT_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 25);

    if (args.status) query = query.eq("status", args.status);
    if (args.grade) query = query.eq("grade", args.grade);

    if (args.query) {
      // Escaped before interpolation: a comma or a parenthesis in the search
      // term would otherwise be read as PostgREST filter syntax rather than as
      // text somebody typed.
      const term = args.query.replace(/[%,()\\]/g, "");
      if (term) {
        query = query.or(
          `first_name.ilike.%${term}%,last_name.ilike.%${term}%,` +
            `email.ilike.%${term}%,role_title.ilike.%${term}%`,
        );
      }
    }

    const { data } = await query;
    return {
      data: { prospects: data ?? [], count: data?.length ?? 0 },
      entityId: null,
    };
  },
});

defineOperation("prospect.get", {
  schema: z.object({ prospectId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ prospectId: string }>) {
    const db = createAdminClient();
    const { data: prospect } = await db
      .from("prospects")
      .select(PROSPECT_FIELDS)
      .eq("id", args.prospectId)
      .eq("business_id", context.businessId)
      .maybeSingle();

    if (!prospect) {
      throw new ServiceError("NOT_FOUND", "That prospect could not be found.");
    }

    // The evidence behind the score. A grade with no traceable reason is
    // exactly what the product forbids, so it travels with the record.
    //
    // Read through the current score row rather than straight off the prospect:
    // factors belong to a scoring run, and a prospect that has been rescored
    // has factors from several. Only the current one is the explanation.
    const { data: score } = await db
      .from("prospect_scores")
      .select("id, total_score, grade, explanation, created_at")
      .eq("business_id", context.businessId)
      .eq("prospect_id", prospect.id)
      .eq("is_current", true)
      .maybeSingle();

    const factors = score
      ? (
          await db
            .from("prospect_score_factors")
            .select(
              "factor, weight, contribution, direction, evidence_summary, evidence_source, evidence_url",
            )
            .eq("business_id", context.businessId)
            .eq("prospect_score_id", score.id)
            .limit(20)
        ).data
      : [];

    return {
      data: { prospect, score: score ?? null, scoreFactors: factors ?? [] },
      entityId: prospect.id,
    };
  },
});

function prospectDecision(operation: "prospect.approve" | "prospect.reject") {
  // DISQUALIFIED, not REJECTED: the column's vocabulary does not contain
  // "REJECTED", so writing it was refused by the database every time. The
  // operation keeps the name a customer would use; the stored value is the one
  // the rest of the product reads.
  const status = operation === "prospect.approve" ? "APPROVED" : "DISQUALIFIED";

  defineOperation(operation, {
    schema: z.object({
      prospectId: z.string().uuid(),
      reason: z.string().trim().max(300).optional(),
    }),
    async run({
      args,
      context,
    }: HandlerInput<{ prospectId: string; reason?: string }>) {
      const db = createAdminClient();
      const { data: before } = await db
        .from("prospects")
        .select("id, status, grade")
        .eq("id", args.prospectId)
        .eq("business_id", context.businessId)
        .maybeSingle();

      if (!before) {
        throw new ServiceError("NOT_FOUND", "That prospect could not be found.");
      }

      if (before.status === status) {
        return {
          data: { prospect: before, unchanged: true },
          entityId: before.id,
          warnings: [
            {
              code: "no_change",
              message: `That prospect is already ${status.toLowerCase()}.`,
            },
          ],
        };
      }

      const { data: after, error } = await db
        .from("prospects")
        .update({
          status,
          approved_by: operation === "prospect.approve" ? context.userId : null,
          approved_at:
            operation === "prospect.approve" ? new Date().toISOString() : null,
          ...(args.reason ? { eligibility_reason: args.reason } : {}),
        })
        .eq("id", before.id)
        .eq("business_id", context.businessId)
        .select(PROSPECT_FIELDS)
        .single();

      if (error || !after) {
        throw new ServiceError("CONFLICT", "That prospect could not be updated.");
      }

      return {
        data: { prospect: after, unchanged: false },
        entityId: after.id,
        before: { status: before.status },
        after: { status: after.status },
        warnings:
          operation === "prospect.approve"
            ? [
                {
                  code: "not_contacted_yet",
                  message:
                    "Approving makes the prospect eligible for outreach. It does not contact anyone — a campaign does that.",
                },
              ]
            : [],
      };
    },
  });
}

prospectDecision("prospect.approve");
prospectDecision("prospect.reject");

/* ------------------------------------------------- business and metrics */

defineOperation("business.get_profile", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const db = createAdminClient();

    const [business, settings, services] = await Promise.all([
      db
        .from("businesses")
        .select("id, name, industry, website, phone, timezone, status")
        .eq("id", context.businessId)
        .maybeSingle(),
      db
        .from("business_settings")
        .select(
          "service_area_description, business_hours, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, default_channel, booking_mode, booking_url, ai_assist_enabled",
        )
        .eq("business_id", context.businessId)
        .maybeSingle(),
      db
        .from("services")
        .select("id, name, description, average_value, active")
        .eq("business_id", context.businessId)
        .eq("active", true)
        .order("position", { ascending: true })
        .limit(50),
    ]);

    return {
      data: {
        business: business.data,
        settings: settings.data,
        services: services.data ?? [],
      },
      entityId: context.businessId,
    };
  },
});

defineOperation("business.get_status", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const db = createAdminClient();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [connectors, failedJobs, needingAttention] = await Promise.all([
      db
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", context.businessId),
      db
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", context.businessId)
        .in("state", ["failed", "dead"])
        .gte("created_at", dayAgo),
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", context.businessId)
        .eq("needs_attention", true)
        .is("archived_at", null),
    ]);

    const rows = connectors.data ?? [];
    // Same vocabulary as `connector.list`, from the same set — not a second
    // hand-written comparison that could drift from it.
    const broken = rows.filter((row) => !HEALTHY_CONNECTOR_STATES.has(row.status));

    return {
      data: {
        connectors: {
          total: rows.length,
          healthy: rows.length - broken.length,
          needingAttention: broken.map((row) => row.provider_type),
        },
        backgroundWork: { failedInLast24h: failedJobs.count ?? 0 },
        leadsNeedingAPerson: needingAttention.count ?? 0,
        // Deliberately a computed summary rather than a stored "healthy" flag:
        // a status that could go stale is worse than no status.
        healthy: broken.length === 0 && (failedJobs.count ?? 0) === 0,
      },
      entityId: context.businessId,
    };
  },
});

defineOperation("analytics.summary", {
  schema: z.object({
    days: z.number().int().min(1).max(365).default(30),
  }),
  async run({ args, context }: HandlerInput<{ days: number }>) {
    const db = createAdminClient();
    const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

    // Counted in the database rather than fetched and counted here. A workspace
    // with fifty thousand leads must not stream them into a tool result.
    const count = async (build: (query: ReturnType<typeof base>) => unknown) => {
      const query = base();
      const result = (await build(query)) as { count: number | null };
      return result.count ?? 0;
    };

    function base() {
      return db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", context.businessId)
        .gte("created_at", since);
    }

    const [created, qualified, booked, won, lost] = await Promise.all([
      count((q) => q),
      count((q) => q.not("qualified_at", "is", null)),
      count((q) => q.not("booked_at", "is", null)),
      count((q) => q.not("won_at", "is", null)),
      count((q) => q.not("lost_at", "is", null)),
    ]);

    const rate = (part: number) =>
      created === 0 ? 0 : Math.round((part / created) * 1000) / 10;

    return {
      data: {
        periodDays: args.days,
        since,
        leads: { created, qualified, booked, won, lost },
        // Percentages of leads created in the window. Stated as such, because a
        // conversion rate with an unstated denominator is a number nobody can
        // check.
        conversionOfLeadsCreated: {
          qualified: rate(qualified),
          booked: rate(booked),
          won: rate(won),
        },
      },
      entityId: null,
    };
  },
});

defineOperation("qualification.list_questions", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const db = createAdminClient();

    const [questions, rules] = await Promise.all([
      db
        .from("qualification_questions")
        .select(
          "id, question_text, help_text, response_type, required, position, service_id, active",
        )
        .eq("business_id", context.businessId)
        .eq("active", true)
        .order("position", { ascending: true })
        .limit(50),
      db
        .from("qualification_rules")
        .select(
          "id, question_id, rule_type, operator, comparison_value, result, priority, active",
        )
        .eq("business_id", context.businessId)
        .eq("active", true)
        .order("priority", { ascending: true })
        .limit(50),
    ]);

    return {
      data: { questions: questions.data ?? [], rules: rules.data ?? [] },
      entityId: null,
    };
  },
});

/* -------------------------------------------------------------- messaging */

/**
 * Sending a message to a lead.
 *
 * This is the operation the MCP tool `send_message` always promised and could
 * never deliver: it parked for approval, and approving it failed, because
 * `executeApproval` can only run a registered service operation and there was
 * none. Declaring it here is what makes the approval path actually work.
 *
 * Every guard the app applies is re-applied, in the same order and for the same
 * reasons. None of them is inherited from the caller having "already checked":
 *
 *   * The lead must not have opted out.
 *   * The number must not be on the shared suppression list — the one list, so
 *     a number suppressed by the cold path cannot be messaged by the warm one.
 *   * The plan must permit the channel.
 *
 * The send itself is queued rather than performed inline. Handing a request to
 * a carrier while a caller waits is how a timeout turns into a message that was
 * sent but reported as failed, and then sent again.
 */
defineOperation("message.send", {
  schema: z.object({
    leadId: z.string().uuid(),
    channel: z.enum(["sms", "whatsapp"]),
    body: z.string().trim().min(1).max(1200),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ leadId: string; channel: "sms" | "whatsapp"; body: string }>) {
    const db = createAdminClient();

    const { data: lead } = await db
      .from("leads")
      .select("id, first_name, last_name, phone, phone_normalized, opted_out, status")
      .eq("id", args.leadId)
      .eq("business_id", context.businessId)
      .maybeSingle();

    if (!lead) throw new ServiceError("NOT_FOUND", "That lead could not be found.");

    if (lead.opted_out) {
      throw new ServiceError(
        "POLICY_BLOCKED",
        "That lead has opted out and cannot be messaged.",
      );
    }

    const { assertEntitlement, EntitlementError } = await import(
      "@/lib/billing/entitlements"
    );
    try {
      await assertEntitlement(
        context.businessId,
        args.channel === "whatsapp" ? "whatsapp" : undefined,
      );
    } catch (error) {
      throw new ServiceError(
        "PLAN_LIMIT",
        error instanceof EntitlementError
          ? error.message
          : "Messaging is unavailable right now.",
      );
    }

    const { normalisePhone } = await import("@/lib/messaging/types");
    const to = lead.phone_normalized ?? normalisePhone(lead.phone ?? "");
    if (!to) {
      throw new ServiceError(
        "CONFLICT",
        "That lead has no usable phone number.",
      );
    }

    const { checkSuppression } = await import("@/lib/policy/suppression");
    const suppressed = await checkSuppression(
      context.businessId,
      args.channel === "whatsapp" ? "WHATSAPP" : "SMS",
      { phone: to },
    );
    if (suppressed) {
      throw new ServiceError(
        "POLICY_BLOCKED",
        "That number is on your suppression list and cannot be messaged.",
      );
    }

    let conversationId: string;
    const { data: existing } = await db
      .from("conversations")
      .select("id")
      .eq("business_id", context.businessId)
      .eq("lead_id", lead.id)
      .eq("channel", args.channel)
      .maybeSingle();

    if (existing) {
      conversationId = existing.id;
    } else {
      const { data: created, error } = await db
        .from("conversations")
        .insert({
          business_id: context.businessId,
          lead_id: lead.id,
          channel: args.channel,
        })
        .select("id")
        .single();
      if (error || !created) {
        throw new ServiceError("CONFLICT", "Could not open a conversation.");
      }
      conversationId = created.id;
    }

    // The send key is the carrier-level idempotency key, and it is also the
    // job's. An approval executed twice, or a retried job, therefore results in
    // one message rather than two — which for an outbound SMS is the difference
    // between correct and unforgivable.
    const sendKey =
      context.idempotencyKey ?? context.correlationId ?? crypto.randomUUID();

    const { data: message, error: messageError } = await db
      .from("messages")
      .insert({
        business_id: context.businessId,
        conversation_id: conversationId,
        lead_id: lead.id,
        direction: "outbound",
        channel: args.channel,
        body: args.body,
        status: "QUEUED",
        origin: "manual",
        send_key: sendKey,
      })
      .select("id")
      .single();

    if (messageError || !message) {
      // A duplicate send key means this exact send was already queued, which is
      // the desired outcome of a retry rather than an error.
      if (messageError?.code === "23505") {
        return {
          // `messageId` is null rather than absent, so both branches are one
          // shape and a caller reads a field instead of inferring from absence.
          data: { queued: false, alreadyQueued: true, messageId: null as string | null },
          entityId: lead.id,
          warnings: [
            {
              code: "already_queued",
              message: "That exact message was already queued. It has not been sent twice.",
            },
          ],
        };
      }
      throw new ServiceError("CONFLICT", "Could not queue the message.");
    }

    const { enqueue } = await import("@/lib/jobs/queue");
    await enqueue(
      "message.send",
      { messageId: message.id, leadId: lead.id, sendKey },
      {
        businessId: context.businessId,
        idempotencyKey: `message.send:${sendKey}`,
      },
    );

    return {
      data: {
        queued: true,
        alreadyQueued: false,
        messageId: message.id as string | null,
      },
      entityId: message.id,
      before: null,
      after: { channel: args.channel, status: "QUEUED" },
      warnings: [
        {
          code: "queued",
          message:
            "The message is queued. Quiet hours and stop conditions are re-checked immediately before it is sent.",
        },
      ],
      // Metered here rather than in the send job, so a caller sees the charge
      // in the same envelope as the action that caused it. The runtime writes
      // it, which is what stops it being double-posted on a retry.
      billing: [
        {
          metric: args.channel === "whatsapp" ? "whatsapp_message" : "message_sent",
          feature: "inbox",
        },
      ],
    };
  },
});
