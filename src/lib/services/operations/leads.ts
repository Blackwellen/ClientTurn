import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { defineOperation, ServiceError } from "../runtime";
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
  "id, business_id, first_name, last_name, email, phone, phone_normalized, postcode, status, qualification_state, assigned_user_id, needs_attention, attention_reason, automation_active, human_takeover, opted_out, service_id, source_id, archived_at, archived_by, created_at, updated_at, last_contact_at, qualified_at, booked_at, won_at, lost_at";

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
    return { data: { lead }, entityId: lead.id };
  },
});

/* ----------------------------------------------------------------- search */

defineOperation("lead.search", {
  schema: z.object({
    query: z.string().trim().max(200).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    needsAttention: z.boolean().optional(),
    /** Archived leads are excluded unless asked for by name. */
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
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

    if (args.query) {
      // Escaped before interpolation: a comma or a parenthesis in the search
      // term would otherwise be read as PostgREST filter syntax rather than as
      // text somebody typed.
      const term = args.query.replace(/[%,()\\]/g, "");
      if (term) {
        query = query.or(
          `first_name.ilike.%${term}%,last_name.ilike.%${term}%,` +
            `email.ilike.%${term}%,phone.ilike.%${term}%`,
        );
      }
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
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ leadId: string; status: (typeof LEAD_STATUSES)[number] }>) {
    const before = await loadLeadOrFail(context.businessId, args.leadId);

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

    const after = await patchLead(context.businessId, args.leadId, patch);
    const outcome = changed(before, after);

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
