import "server-only";
import {
  REFERRAL_EVIDENCE_MESSAGE,
  referralEvidenceSufficient,
} from "@/lib/policy/types";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { ingestLead } from "@/lib/ingest/service";
import { closeLeadOpportunity, OpportunityCloseError } from "@/lib/opportunities/service";
import { enqueue } from "@/lib/jobs/queue";
import { logWriteError } from "@/lib/supabase/write-result";
import { orIlike } from "@/lib/supabase/ilike";
import { manualRescoreTrigger } from "@/lib/leads/detail-page";
import { resumeFollowUpBlock } from "@/lib/leads/resume-rule";
import {
  conversationReleasePatch,
  handoffReleasePatch,
  OPEN_HANDOFF_STATUSES,
  RELEASABLE_CONVERSATION_OWNERS,
} from "@/lib/leads/resume-release";
import { recordPermission } from "@/lib/policy/service";
import { leadSearchIntentFilters } from "@/lib/qualification-intelligence/op-schemas";
import { INCOMPLETE_BELOW, STRONG_INTENT_STATES } from "@/lib/qualification-intelligence/explain";
import type { IntentState, NbaAction } from "@/lib/qualification-intelligence/types";
import {
  hasWhatsAppOptIn,
  MAX_OPT_IN_DETAIL,
  optInProblem,
  WHATSAPP_OPT_IN_SOURCES,
  withWhatsAppScope,
} from "@/lib/leads/whatsapp-opt-in";
import { defineOperation, ServiceError } from "../runtime";
import {
  CLOSED_LEAD_STATUSES,
  leadStatusTransition,
  OVERRIDE_REASON_MIN,
  overridePermitted,
} from "@/lib/leads/status-transitions";
import type { HandlerInput, HandlerOutcome } from "../runtime";

/**
 * Lead operations (Programme §2).
 *
 * The first domain ported onto the core service layer, and the pattern the rest
 * follow.
 *
 * Three rules the shape of this file enforces:
 *
 *   1. **Every write reads the row first, scoped to the workspace.** That single
 *      read does three jobs: it proves the record exists, it proves it belongs
 *      to this workspace — a caller cannot reach another tenant's lead by
 *      guessing an id, whatever it claims about itself — and it captures the
 *      `before` the envelope reports.
 *   2. **Every write is conditional on what was read.** The update repeats the
 *      workspace filter, so a race that moved the row between the read and the
 *      write changes nothing rather than writing across it.
 *   3. **Handlers state facts; the runtime draws conclusions.** Nothing here
 *      writes an audit row, meters usage, or decides whether a person confirmed.
 *      A handler that could do those could also forge them.
 */

/* ----------------------------------------------------------------- shapes */

/**
 * One literal string, not a concatenation: the Supabase client parses this at
 * the type level to shape the row it returns, and it can only do that for a
 * literal. `qualified_at` and the other lifecycle stamps are here because
 * `lead.set_status` is first-set-wins on them — without reading them it would
 * overwrite when a lead was first won.
 */
const LEAD_FIELDS =
  "id, business_id, first_name, last_name, email, phone, phone_normalized, postcode, status, qualification_state, assigned_user_id, needs_attention, attention_reason, automation_active, human_takeover, opted_out, service_id, source_id, archived_at, archived_by, created_at, updated_at, last_contact_at, qualified_at, booked_at, won_at, lost_at, intent_state, intent_score, qualification_completeness, next_action, assessed_at";

type LeadRow = {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  qualification_state: string;
  assigned_user_id: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
  automation_active: boolean;
  human_takeover: boolean;
  opted_out: boolean;
  archived_at: string | null;
  [key: string]: unknown;
};

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFIED",
  "BOOKED",
  "WON",
  "LOST",
] as const;

/**
 * The subset of a lead reported as `before` and `after`.
 *
 * Deliberately not the whole row. A diff is read by people and by models, and
 * one that includes every timestamp buries the field that actually changed.
 * Contact details are included because changing them is exactly the kind of
 * edit someone needs to see reported back.
 */
function snapshot(row: LeadRow): Record<string, unknown> {
  return {
    status: row.status,
    qualification_state: row.qualification_state,
    assigned_user_id: row.assigned_user_id,
    needs_attention: row.needs_attention,
    attention_reason: row.attention_reason,
    automation_active: row.automation_active,
    human_takeover: row.human_takeover,
    opted_out: row.opted_out,
    archived_at: row.archived_at,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
  };
}

/**
 * Reads one lead inside the caller's workspace, or refuses.
 *
 * The workspace filter is the tenant boundary for this whole file. It is
 * applied here rather than in each handler so it cannot be forgotten in one of
 * them, and a lead in another workspace is reported as NOT_FOUND rather than
 * FORBIDDEN — telling a caller that an id exists but is not theirs is itself a
 * disclosure.
 */
async function loadLeadOrFail(businessId: string, leadId: string): Promise<LeadRow> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select(LEAD_FIELDS)
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) {
    throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  }
  return data as LeadRow;
}

/**
 * Applies a patch and returns the row as it now is.
 *
 * `.eq("business_id")` is repeated on the write on purpose. The read already
 * proved ownership, but a filter that only exists on the read is one refactor
 * away from a cross-tenant write.
 */
async function patchLead(
  businessId: string,
  leadId: string,
  patch: Record<string, unknown>,
): Promise<LeadRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    // `as never` matches how the rest of the codebase passes a dynamically
    // assembled patch to the generated client. The keys are not arbitrary: each
    // handler builds them from its own validated schema.
    .update(patch as never)
    .eq("id", leadId)
    .eq("business_id", businessId)
    .select(LEAD_FIELDS)
    .maybeSingle();

  if (error || !data) {
    throw new ServiceError("CONFLICT", "That lead could not be updated.");
  }
  return data as LeadRow;
}

/** The standard write outcome: a diff plus the row the caller asked about. */
function changed(before: LeadRow, after: LeadRow): HandlerOutcome<{ lead: LeadRow }> {
  return {
    data: { lead: after },
    entityId: after.id,
    before: snapshot(before),
    after: snapshot(after),
  };
}

/* -------------------------------------------------------------------- get */

defineOperation("lead.get", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const lead = await loadLeadOrFail(context.businessId, args.leadId);

    // The registry promises "its recent activity", and the operation returned
    // the lead alone. The last 20 messages, newest first, bodies trimmed: the
    // conversation is what a caller asking about one lead almost always needs
    // next.
    const admin = createAdminClient();
    const { data: messages, error } = await admin
      .from("messages")
      .select("id, direction, channel, status, body, created_at, sent_at")
      .eq("business_id", context.businessId)
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_ACTIVITY_LIMIT);
    if (error) throw new ServiceError("UNAVAILABLE", "The lead's recent activity could not be read.");

    const recentActivity = (messages ?? []).map((message) => ({
      type: "message" as const,
      id: message.id,
      direction: message.direction,
      channel: message.channel,
      status: message.status,
      body: message.body.length > 500 ? `${message.body.slice(0, 497)}...` : message.body,
      at: message.sent_at ?? message.created_at,
    }));

    return { data: { lead, recent_activity: recentActivity }, entityId: lead.id };
  },
});

/** How much of a lead's history `lead.get` returns. */
const RECENT_ACTIVITY_LIMIT = 20;

/* ----------------------------------------------------------------- search */

defineOperation("lead.search", {
  schema: z.object({
    query: z.string().trim().max(200).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    needsAttention: z.boolean().optional(),
    /** Archived leads are excluded unless asked for by name. */
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    // Qualification intelligence (§B.19): "show strong intent but incomplete
    // qualification", by intent state, score, completeness or next action.
    // Read from the lead's denormalised columns, which only
    // record_lead_assessment() writes, so the list and the Lead page agree.
    ...leadSearchIntentFilters,
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    query?: string;
    status?: (typeof LEAD_STATUSES)[number];
    needsAttention?: boolean;
    includeArchived?: boolean;
    limit?: number;
    intentStateIn?: IntentState[];
    minIntentScore?: number;
    maxCompleteness?: number;
    nextActionIn?: NbaAction[];
    strongIntentIncomplete?: boolean;
  }>) {
    const admin = createAdminClient();
    let query = admin
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 20);

    if (!args.includeArchived) query = query.is("archived_at", null);
    if (args.status) query = query.eq("status", args.status);
    if (args.needsAttention !== undefined) {
      query = query.eq("needs_attention", args.needsAttention);
    }

    if (args.intentStateIn?.length) query = query.in("intent_state", args.intentStateIn);
    if (args.minIntentScore !== undefined) query = query.gte("intent_score", args.minIntentScore);
    if (args.maxCompleteness !== undefined) query = query.lte("qualification_completeness", args.maxCompleteness);
    if (args.nextActionIn?.length) query = query.in("next_action", args.nextActionIn);
    if (args.strongIntentIncomplete) {
      query = query
        .in("intent_state", [...STRONG_INTENT_STATES])
        .lt("qualification_completeness", INCOMPLETE_BELOW);
    }

    if (args.query) {
      // Quoted and LIKE-escaped by `orIlike`: a comma or a parenthesis in the
      // search term would otherwise be read as PostgREST filter syntax rather
      // than as text somebody typed.
      const or = orIlike(["first_name", "last_name", "email", "phone"], args.query);
      if (or) query = query.or(or);
    }

    const { data } = await query;
    const leads = (data ?? []) as LeadRow[];
    return { data: { leads, count: leads.length }, entityId: null };
  },
});

/* ----------------------------------------------------------------- update */

defineOperation("lead.update", {
  schema: z
    .object({
      leadId: z.string().uuid(),
      firstName: z.string().trim().max(120).nullable().optional(),
      lastName: z.string().trim().max(120).nullable().optional(),
      email: z.string().trim().email().max(320).nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      postcode: z.string().trim().max(16).nullable().optional(),
    })
    // A patch with nothing in it is a caller mistake, not a no-op success: it
    // would otherwise produce an audit row recording that nothing happened.
    .refine((value) => Object.keys(value).length > 1, {
      message: "Give at least one field to change.",
    }),
  async run({ args, context }: HandlerInput<Record<string, unknown>>) {
    const leadId = args.leadId as string;
    const before = await loadLeadOrFail(context.businessId, leadId);

    if (before.archived_at) {
      throw new ServiceError(
        "CONFLICT",
        "That lead is archived. Restore it before making changes.",
      );
    }

    const patch: Record<string, unknown> = {};
    if ("firstName" in args) patch.first_name = args.firstName;
    if ("lastName" in args) patch.last_name = args.lastName;
    if ("email" in args) patch.email = args.email;
    if ("phone" in args) patch.phone = args.phone;
    if ("postcode" in args) patch.postcode = args.postcode;

    const after = await patchLead(context.businessId, leadId, patch);
    const outcome = changed(before, after);

    // Changing where a message would go is worth saying out loud, because the
    // permission recorded against this lead was recorded against the old
    // address. The policy engine re-checks at send time, but a caller reporting
    // the edit should mention it rather than let it be discovered later.
    if ("email" in patch && patch.email !== before.email) {
      outcome.warnings = [
        {
          code: "contact_changed",
          message:
            "The email address changed. Contact permission is re-checked against the new address before anything is sent.",
        },
      ];
    }

    return outcome;
  },
});

/* ----------------------------------------------------------------- assign */

defineOperation("lead.assign", {
  schema: z.object({
    leadId: z.string().uuid(),
    /** Null unassigns. */
    userId: z.string().uuid().nullable(),
  }),
  async run({ args, context }: HandlerInput<{ leadId: string; userId: string | null }>) {
    const admin = createAdminClient();
    const before = await loadLeadOrFail(context.businessId, args.leadId);

    // An assignee must be a live member of *this* workspace. Without this a
    // caller could park a lead with someone who cannot see it, and the lead
    // would silently stop being worked.
    if (args.userId) {
      const { data: membership } = await admin
        .from("business_members")
        .select("user_id, status")
        .eq("business_id", context.businessId)
        .eq("user_id", args.userId)
        .maybeSingle();

      if (!membership || membership.status !== "active") {
        throw new ServiceError(
          "INVALID_INPUT",
          "That person is not an active member of this workspace.",
        );
      }
    }

    const after = await patchLead(context.businessId, args.leadId, {
      assigned_user_id: args.userId,
    });

    // The assignment history is a separate record from the lead's current
    // owner: "who has held this lead" is a different question from "who holds
    // it now", and only one of them survives being overwritten.
    if (before.assigned_user_id !== args.userId) {
      await admin
        .from("lead_assignments")
        .update({ unassigned_at: new Date().toISOString() })
        .eq("business_id", context.businessId)
        .eq("lead_id", args.leadId)
        .is("unassigned_at", null);

      if (args.userId) {
        await admin.from("lead_assignments").insert({
          business_id: context.businessId,
          lead_id: args.leadId,
          user_id: args.userId,
          assigned_by: context.userId,
        });
      }
    }

    return changed(before, after);
  },
});

/* ------------------------------------------------------------- set_status */

defineOperation("lead.set_status", {
  schema: z.object({
    leadId: z.string().uuid(),
    status: z.enum(LEAD_STATUSES),
    /** Why a lead was won or lost; recorded on its opportunity (decision Q3). */
    reason: z.string().trim().min(1).max(500).optional(),
    /**
     * Admin override for a transition the state machine refuses (§51), e.g.
     * reopening a WON lead. Owner/admin, from the app only, with a reason;
     * the override and its reason are written into the audit row.
     */
    overrideReason: z.string().trim().min(OVERRIDE_REASON_MIN).max(500).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    leadId: string;
    status: (typeof LEAD_STATUSES)[number];
    reason?: string;
    overrideReason?: string;
  }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);

    // The state machine (leads/status-transitions.ts). A refused move is a
    // CONFLICT with the reason, unless an admin overrides it with a reason.
    const verdict = leadStatusTransition(before.status, args.status);
    let override: { from: string; to: string; reason: string } | null = null;
    if (!verdict.allowed) {
      if (!args.overrideReason) throw new ServiceError("CONFLICT", verdict.reason);
      if (!overridePermitted({ role: context.role, caller: context.caller, reason: args.overrideReason })) {
        throw new ServiceError("FORBIDDEN_ROLE", "Only an owner or admin can override a status rule, from the app, with a reason.");
      }
      override = { from: before.status, to: args.status, reason: args.overrideReason };
    }

    if (before.status === args.status) {
      // Not an error, and not a write. Reporting it as a change would put a
      // meaningless row in the audit trail.
      return {
        data: { lead: before, unchanged: true },
        entityId: before.id,
        warnings: [
          { code: "no_change", message: `That lead is already ${args.status}.` },
        ],
      };
    }

    const patch: Record<string, unknown> = { status: args.status };
    const now = new Date().toISOString();

    // The lifecycle timestamps are first-set-wins: they record when a lead
    // first reached a state, and attribution reports read them. Moving a lead
    // back and forth must not rewrite when it was won.
    if (args.status === "QUALIFIED" && !before.qualified_at) patch.qualified_at = now;
    if (args.status === "BOOKED" && !before.booked_at) patch.booked_at = now;
    if (args.status === "WON" && !before.won_at) patch.won_at = now;
    if (args.status === "LOST" && !before.lost_at) patch.lost_at = now;

    // WON and LOST live on the opportunity; the lead's status is its
    // projection (decision Q3). Both move in one transaction through
    // close_opportunity, so they cannot disagree whoever set them.
    let after: LeadRow;
    if (args.status === "WON" || args.status === "LOST") {
      try {
        await closeLeadOpportunity({
          businessId: context.businessId,
          leadId: args.leadId,
          outcome: args.status,
          reason: args.reason ?? `Marked ${args.status.toLowerCase()} from the lead's status.`,
        });
      } catch (error) {
        if (error instanceof OpportunityCloseError) {
          throw new ServiceError(error.code, error.message);
        }
        throw error;
      }
      after = await loadLeadOrFail(context.businessId, args.leadId);
    } else {
      after = await patchLead(context.businessId, args.leadId, patch);
    }
    const outcome = changed(before, after);
    if (override) {
      // Carried in `after`, which the runtime writes into the audit row.
      outcome.after = { ...(outcome.after ?? {}), transition_override: override };
    }

    // A terminal status stops the sequence at the guard, not here — see
    // `automation/scheduler.ts`. Saying so is the caller's job, so the warning
    // travels in the envelope rather than being left for someone to notice.
    if (["BOOKED", "WON", "LOST"].includes(args.status)) {
      outcome.warnings = [
        {
          code: "follow_up_stopped",
          message: `Follow-up stops for a lead marked ${args.status.toLowerCase()}.`,
        },
      ];
    }
    if (override) {
      outcome.warnings = [
        ...(outcome.warnings ?? []),
        {
          code: "transition_overridden",
          message: CLOSED_LEAD_STATUSES.includes(override.from as "WON")
            ? "Status rule overridden. The lead's closed opportunity stays closed; open a new one if the deal is live again."
            : "Status rule overridden and recorded in the audit log.",
        },
      ];
    }

    // Emitted here rather than at each call site, so the event fires whoever
    // moved the lead — a person in the app, Copilot, an agent, or a customer's
    // own software through the API. A status change made through one caller and
    // invisible to the others is precisely the drift the service layer exists
    // to prevent.
    await emitWebhookEvent({
      businessId: context.businessId,
      type: "lead.status_changed",
      data: {
        lead_id: after.id,
        from: before.status,
        to: after.status,
        changed_by: context.caller,
        user_id: context.userId,
      },
    });

    return outcome;
  },
});

/* --------------------------------------------------------------- add_note */

defineOperation("lead.add_note", {
  schema: z.object({
    leadId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  }),
  async run({ args, context }: HandlerInput<{ leadId: string; body: string }>) {
    const admin = createAdminClient();
    await loadLeadOrFail(context.businessId, args.leadId);

    const { data, error } = await admin
      .from("lead_notes")
      .insert({
        business_id: context.businessId,
        lead_id: args.leadId,
        body: args.body,
        author_user_id: context.userId,
        // Recorded so a timeline can distinguish a note a person typed from one
        // an assistant added on their behalf.
        author_kind: context.caller,
      })
      .select("id, body, created_at")
      .single();

    if (error || !data) {
      throw new ServiceError("CONFLICT", "That note could not be saved.");
    }

    return {
      data: { note: data },
      entityId: args.leadId,
      before: null,
      after: { note_id: data.id, note_added: true },
    };
  },
});

/* -------------------------------------------------------- flag_attention */

defineOperation("lead.flag_attention", {
  schema: z.object({
    leadId: z.string().uuid(),
    needsAttention: z.boolean(),
    reason: z.string().trim().max(120).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ leadId: string; needsAttention: boolean; reason?: string }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);
    const after = await patchLead(context.businessId, args.leadId, {
      needs_attention: args.needsAttention,
      attention_reason: args.needsAttention ? (args.reason ?? "flagged") : null,
    });
    return changed(before, after);
  },
});

/* ------------------------------------------------- record_whatsapp_opt_in */

const whatsappOptInSchema = z.object({
  leadId: z.string().uuid(),
  optedInOn: z.string().trim().max(10),
  source: z.enum(WHATSAPP_OPT_IN_SOURCES),
  detail: z.string().trim().max(MAX_OPT_IN_DETAIL).optional(),
});

defineOperation("lead.record_whatsapp_opt_in", {
  schema: whatsappOptInSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof whatsappOptInSchema>>) {
    const lead = await loadLeadOrFail(context.businessId, args.leadId);
    const problem = optInProblem(args);
    if (problem) throw new ServiceError("INVALID_INPUT", problem);
    // WhatsApp only ever goes to a mobile the person gave us themselves.
    if (!lead.phone) {
      throw new ServiceError("CONFLICT", "This lead has no mobile number, so there is nothing to opt in to WhatsApp.");
    }

    const admin = createAdminClient();
    const { data: existing, error } = await admin
      .from("contact_permissions")
      .select("id, consent_scope")
      .eq("business_id", context.businessId)
      .eq("subject_type", "LEAD")
      .eq("subject_id", lead.id)
      .maybeSingle();
    if (error) throw new ServiceError("UNAVAILABLE", "The permission record could not be read.");

    const already = hasWhatsAppOptIn(existing?.consent_scope);
    if (existing && !already) {
      const { error: updateError } = await admin
        .from("contact_permissions")
        .update({ consent_scope: withWhatsAppScope(existing.consent_scope) })
        .eq("id", existing.id)
        .eq("business_id", context.businessId);
      if (updateError) throw new ServiceError("CONFLICT", "The opt-in could not be saved.");
    } else if (!existing) {
      // A lead with no permission record: the opt-in is the only fact known.
      await recordPermission({
        businessId: context.businessId,
        subject: { type: "LEAD", id: lead.id },
        relationshipType: "UNKNOWN",
        consentSource: `whatsapp_opt_in:${args.source.toLowerCase()}`,
        email: lead.email,
        phone: lead.phone,
        recordedBy: context.userId,
        consentScope: ["WHATSAPP"],
      });
    }

    // Recorded even when the scope already held WhatsApp: a later, evidenced
    // opt-in is still worth having in the trail.
    return {
      data: { leadId: lead.id, whatsappOptIn: true, alreadyRecorded: already },
      entityId: lead.id,
      before: { whatsapp_opt_in: already },
      after: {
        whatsapp_opt_in: true,
        opted_in_on: args.optedInOn,
        source: args.source,
        detail: args.detail || null,
      },
    } satisfies HandlerOutcome<{ leadId: string; whatsappOptIn: boolean; alreadyRecorded: boolean }>;
  },
});

/* ---------------------------------------------------------------- archive */

defineOperation("lead.archive", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);

    if (before.archived_at) {
      throw new ServiceError("CONFLICT", "That lead is already archived.");
    }

    // Archiving stops follow-up as well as hiding the lead. Leaving the
    // automation live would keep messaging someone the workspace has decided it
    // is finished with, which is the opposite of what archiving means.
    const after = await patchLead(context.businessId, args.leadId, {
      archived_at: new Date().toISOString(),
      archived_by: context.userId,
      automation_active: false,
      needs_attention: false,
      attention_reason: null,
    });

    return {
      ...changed(before, after),
      warnings: [
        {
          code: "follow_up_stopped",
          message: "Follow-up for this lead has stopped. Its history is kept.",
        },
      ],
    };
  },
});

/* ---------------------------------------------------------------- restore */

defineOperation("lead.restore", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);

    if (!before.archived_at) {
      throw new ServiceError("CONFLICT", "That lead is not archived.");
    }

    // Restoring returns the lead to the list. It deliberately does *not* restart
    // follow-up: time has passed, and resuming a sequence into a months-old
    // conversation is a decision for a person, not a side effect of unarchiving.
    const after = await patchLead(context.businessId, args.leadId, {
      archived_at: null,
      archived_by: null,
    });

    return {
      ...changed(before, after),
      warnings: [
        {
          code: "follow_up_not_resumed",
          message:
            "The lead is back in your list. Follow-up stays paused until someone restarts it.",
        },
      ],
    };
  },
});

/* ---------------------------------------------------------------- rescore */

/**
 * Queues the deterministic scorer for this lead now. The trigger is unique per
 * request (`manual:<userId>:<ms>`), so a deliberate re-score is never mistaken
 * for a repeat of an earlier one, while the job's own idempotency key keeps a
 * retried enqueue of *this* request to one score.
 */
defineOperation("lead.rescore", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const lead = await loadLeadOrFail(context.businessId, args.leadId);
    if (lead.archived_at) {
      throw new ServiceError("CONFLICT", "That lead is archived. Restore it before re-scoring.");
    }
    const triggerEvent = manualRescoreTrigger(context.userId);
    let jobId: string | null;
    try {
      jobId = await enqueue(
        "lead.score",
        { leadId: lead.id, triggerEvent },
        {
          businessId: context.businessId,
          priority: 40,
          idempotencyKey: `lead.score:${lead.id}:${triggerEvent}`,
        },
      );
    } catch {
      throw new ServiceError("UNAVAILABLE", "The re-score could not be queued.");
    }
    return {
      data: { queued: true, jobId, triggerEvent },
      entityId: lead.id,
      after: { rescore_requested: triggerEvent },
      warnings: [
        {
          code: "rescore_queued",
          message: "The lead is being re-scored. The new score appears in a few seconds.",
        },
      ],
    };
  },
});

/* --------------------------------------------------------------- takeover */

defineOperation("lead.takeover", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);
    if (before.human_takeover && !before.automation_active) {
      return {
        data: { lead: before, unchanged: true },
        entityId: before.id,
        warnings: [{ code: "no_change", message: "This conversation is already with a person." }],
      };
    }

    const after = await patchLead(context.businessId, args.leadId, {
      human_takeover: true,
      automation_active: false,
      needs_attention: true,
      attention_reason: "human_requested",
    });

    // Stop the running sequence too. The scheduler's guard would refuse the
    // next step anyway, but a STOPPED run is what the timeline and the stop
    // reason report read.
    const admin = createAdminClient();
    const { error } = await admin
      .from("automation_runs")
      .update({
        state: "STOPPED",
        stopped_at: new Date().toISOString(),
        stopped_reason: "human_takeover",
      })
      .eq("lead_id", before.id)
      .eq("business_id", context.businessId)
      .eq("state", "ACTIVE");
    logWriteError({ error }, "lead.takeover: stop automation runs", {
      businessId: context.businessId,
      leadId: before.id,
    });

    return {
      ...changed(before, after),
      warnings: [
        {
          code: "follow_up_stopped",
          message: "Automated follow-up has stopped. Nothing more is sent until someone resumes it.",
        },
      ],
    };
  },
});

/* ------------------------------------------------------ resume_follow_up */

defineOperation("lead.resume_follow_up", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ leadId: string }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);

    // The one rule, shared with the lead page and drawer (resume-rule.ts).
    const block = resumeFollowUpBlock({
      status: before.status,
      optedOut: before.opted_out,
      archived: Boolean(before.archived_at),
    });
    if (block) throw new ServiceError(block.serviceCode, block.message);

    const after = await patchLead(context.businessId, args.leadId, {
      human_takeover: false,
      automation_active: true,
      needs_attention: false,
      attention_reason: null,
    });

    // H3b: an agent hand-off also left the conversation HANDED_OVER and a
    // hand-off open, and the run gate refuses every turn while a person owns
    // the conversation. Release both, exactly as "Return to assistant" does
    // (resume-release.ts); a CLOSED conversation is left closed.
    const admin = createAdminClient();
    const releasedAt = new Date().toISOString();
    const { data: released, error: releaseError } = await admin
      .from("conversations")
      .update(conversationReleasePatch(releasedAt, context.userId))
      .eq("business_id", context.businessId)
      .eq("lead_id", before.id)
      .in("owner", [...RELEASABLE_CONVERSATION_OWNERS])
      .select("id");
    if (releaseError) {
      throw new ServiceError("UNAVAILABLE", "The conversation could not be handed back to the assistant. Try again.");
    }
    const { data: resolvedHandoffs, error: handoffError } = await admin
      .from("agent_handoffs")
      .update(handoffReleasePatch(releasedAt, context.userId))
      .eq("business_id", context.businessId)
      .eq("lead_id", before.id)
      .in("status", [...OPEN_HANDOFF_STATUSES])
      .select("id");
    logWriteError({ error: handoffError }, "lead.resume_follow_up: resolve hand-offs", {
      businessId: context.businessId,
      leadId: before.id,
    });

    // The next step is re-checked against stop conditions, suppression and
    // quiet hours by the scheduler before anything is sent.
    try {
      await enqueue("automation.advance", { leadId: before.id }, { businessId: context.businessId });
    } catch {
      throw new ServiceError("UNAVAILABLE", "Follow-up could not be restarted. Try again.");
    }

    const outcome = changed(before, after);
    return {
      ...outcome,
      after: {
        ...(outcome.after ?? {}),
        conversations_released: (released ?? []).length,
        handoffs_resolved: (resolvedHandoffs ?? []).length,
      },
      warnings: [
        {
          code: "follow_up_resumed",
          message: "Automated follow-up is running again. Each message is re-checked before it is sent.",
        },
      ],
    };
  },
});

/* ------------------------------------------------------------ lead.create */

/**
 * The public API's lead create (`POST /api/v1/leads`), which is ingestLead().
 *
 * The relationship must be stated and must be warm: a contact the caller
 * merely found is a prospect, never a lead, exactly as in the wizard and over
 * MCP. The outcome is the ingest contract (CREATED, MERGED, DUPLICATE,
 * SUPPRESSED, INVALID, REVIEW, REJECTED), returned as data rather than
 * flattened into success or failure, so a caller can act on each.
 */
const createLeadSchema = z.object({
  first_name: z.string().trim().max(120).optional(),
  last_name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(60).optional(),
  company_name: z.string().trim().max(200).optional(),
  role_title: z.string().trim().max(200).optional(),
  postcode: z.string().trim().max(20).optional(),
  relationship: z.enum([
    "THEY_CONTACTED_US",
    "EXISTING_CUSTOMER",
    "REFERRAL",
    "REQUESTED_INFORMATION",
    "EXPLICIT_MARKETING_CONSENT",
    "EXISTING_BUSINESS_RELATIONSHIP",
  ]),
  source: z
    .object({
      type: z.enum(["WEB_FORM", "API", "CRM", "CONNECTOR"]).default("API"),
      provider: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9_.-]{1,60}$/)
        .default("api"),
      record_id: z.string().trim().min(1).max(300).optional(),
      form_id: z.string().trim().max(300).optional(),
      form_name: z.string().trim().max(300).optional(),
      campaign_id: z.string().trim().max(300).optional(),
      campaign_name: z.string().trim().max(300).optional(),
      utm_source: z.string().trim().max(200).optional(),
      utm_medium: z.string().trim().max(200).optional(),
      utm_campaign: z.string().trim().max(200).optional(),
      utm_term: z.string().trim().max(200).optional(),
      utm_content: z.string().trim().max(200).optional(),
      gclid: z.string().trim().max(300).optional(),
      fbclid: z.string().trim().max(300).optional(),
      referrer: z.string().trim().max(2000).optional(),
      landing_url: z.string().trim().max(2000).optional(),
      submitted_at: z.string().trim().max(60).optional(),
    })
    .default({ type: "API", provider: "api" }),
  answers: z.record(z.string().trim().min(1).max(200), z.string().max(2000)).optional(),
  consent: z
    .object({
      marketing: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      evidence: z.string().trim().max(2000).optional(),
    })
    .optional(),
  service_id: z.uuid().optional(),
});

type CreateLeadArgs = z.infer<typeof createLeadSchema>;

defineOperation("lead.create", {
  schema: createLeadSchema,
  async run({ args, context }: HandlerInput<CreateLeadArgs>) {
    const s = args.source;

    // The same referral rule as the wizard, the import and MCP.
    if (args.relationship === "REFERRAL" && !referralEvidenceSufficient(args.consent?.evidence)) {
      throw new ServiceError("INVALID_INPUT", `${REFERRAL_EVIDENCE_MESSAGE} Send it as consent.evidence.`);
    }

    const result = await ingestLead(
      {
        businessId: context.businessId,
        idempotencyKey: context.idempotencyKey,
        source: {
          type: s.type,
          provider: s.provider,
          providerRecordId: s.record_id,
          formId: s.form_id,
          formName: s.form_name,
          campaignId: s.campaign_id,
          campaignName: s.campaign_name,
          utm: {
            source: s.utm_source,
            medium: s.utm_medium,
            campaign: s.utm_campaign,
            term: s.utm_term,
            content: s.utm_content,
          },
          gclid: s.gclid,
          fbclid: s.fbclid,
          referrer: s.referrer,
          landingUrl: s.landing_url,
          submittedAt: s.submitted_at,
          caller: { type: "API_KEY", id: context.userId ?? undefined },
        },
        person: {
          firstName: args.first_name,
          lastName: args.last_name,
          email: args.email,
          phone: args.phone,
          companyName: args.company_name,
          roleTitle: args.role_title,
          postcode: args.postcode,
        },
        answers: args.answers,
        consent: args.consent,
        relationship: args.relationship,
        serviceId: args.service_id,
      },
      {
        // A suppressed contact is refused, not recorded: the caller is
        // creating a record, and 409 REJECTED ("nothing stored") is the honest
        // answer. An ad form's enquiry is still recorded -- that path is the
        // pollers', not this one.
        onSuppressed: "REFUSE",
        // Never auto-started from the API: a person chooses to message.
        insertExtras: {
          automation_active: false,
          created_by_user_id: context.userId,
        },
        permission: { recordedBy: context.userId, source: `api:${s.provider}` },
      },
    );

    const data = {
      outcome: result.outcome,
      lead_id: result.leadId,
      touch_id: result.touchId,
      matched_by: result.matchedBy,
      reasons: result.reasons,
      ...(result.originalOutcome ? { original_outcome: result.originalOutcome } : {}),
    };

    return {
      data,
      entityId: result.leadId,
      after: { outcome: result.outcome, matched_by: result.matchedBy },
    } satisfies HandlerOutcome<typeof data>;
  },
});
