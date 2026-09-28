import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  anonymiseSubject,
  deleteSubject,
  recordDataRightsAction,
  SubjectNotFoundError,
  suppressSubject,
  type ActorContext,
} from "@/lib/data-rights/executor";
import { exportLead, exportSummary } from "@/lib/data-rights/export";
import {
  createWorkspaceRequest,
  listWorkspaceRequests,
  RequestInputError,
  updateWorkspaceRequest,
} from "@/lib/data-rights/privacy-requests";
import { PRIVACY_REQUEST_STATUSES, PRIVACY_REQUEST_TYPES } from "@/lib/data-rights/types";
import { describeOutcome, suppressionOutcome } from "@/lib/data-rights/wording";
import type { ServiceContext } from "../types";
import { defineOperation, ServiceError } from "../runtime";
import type { HandlerInput } from "../runtime";

/**
 * Data-rights operations (Phase 6).
 *
 * Every one delegates to `lib/data-rights`, which is the only executor: the
 * lead drawer, Copilot, MCP, the public API and the retention job all end up
 * in the same SQL functions.
 *
 * `before` and `after` in these envelopes carry no personal data. The runtime
 * writes them into audit_log, and an erasure that copied the person's email
 * into the audit row describing their erasure would defeat itself.
 */

function actorFrom(context: ServiceContext, extra: { reason?: string | null; privacyRequestId?: string | null } = {}): ActorContext {
  return {
    businessId: context.businessId,
    requestedBy: context.userId,
    // AUTOMATION never reaches a data-rights operation (not in its callers); narrowed for the type.
    caller: context.caller === "AUTOMATION" ? "SYSTEM" : context.caller,
    reason: extra.reason ?? null,
    privacyRequestId: extra.privacyRequestId ?? null,
  };
}

/** Workspace-scoped existence check; another tenant's id reads as not found. */
async function requireLead(businessId: string, leadId: string): Promise<{ anonymised_at: string | null }> {
  // Untyped: `anonymised_at` (0124) post-dates the generated types.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from("leads")
    .select("id, anonymised_at")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  return { anonymised_at: (data as { anonymised_at: string | null }).anonymised_at ?? null };
}

function rethrow(error: unknown): never {
  if (error instanceof SubjectNotFoundError) {
    throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  }
  if (error instanceof RequestInputError) {
    throw new ServiceError("INVALID_INPUT", error.message);
  }
  throw error;
}

const reasonSchema = z.string().trim().max(500).optional();
const requestIdSchema = z.string().uuid().optional();

/* ---------------------------------------------------------------- suppress */

type SuppressArgs = {
  leadId: string;
  channel: "ALL" | "EMAIL" | "SMS" | "WHATSAPP" | "SOCIAL";
  reason: "MANUAL" | "OPT_OUT" | "LEGAL";
  note?: string;
  privacyRequestId?: string;
};

defineOperation("lead.suppress", {
  schema: z.object({
    leadId: z.string().uuid(),
    channel: z.enum(["ALL", "EMAIL", "SMS", "WHATSAPP", "SOCIAL"]).default("ALL"),
    /**
     * MANUAL: the workspace's decision. OPT_OUT: the person asked. LEGAL: a
     * restriction of processing (Art 18), always on every channel.
     */
    reason: z.enum(["MANUAL", "OPT_OUT", "LEGAL"]).default("MANUAL"),
    note: reasonSchema,
    privacyRequestId: requestIdSchema,
  }),
  async run({ args, context }: HandlerInput<SuppressArgs>) {
    await requireLead(context.businessId, args.leadId);
    try {
      const result = await suppressSubject(
        "LEAD",
        args.leadId,
        { channel: args.channel, reason: args.reason, note: args.note ?? null },
        actorFrom(context, { reason: args.note, privacyRequestId: args.privacyRequestId }),
      );
      const message = suppressionOutcome(result);
      return {
        data: { ...result, message },
        entityId: args.leadId,
        before: null,
        after: {
          suppressed: true,
          mode: result.mode,
          channel: result.channel,
          entries_added: result.entriesAdded,
        },
        warnings:
          result.status === "NO_DESTINATION"
            ? [{ code: "no_destination", message }]
            : [],
      };
    } catch (error) {
      rethrow(error);
    }
  },
});

/* --------------------------------------------------------------- anonymise */

type ErasureArgs = {
  leadId: string;
  reason?: string;
  privacyRequestId?: string;
  alsoRemoveFromCrm?: boolean;
};

const erasureSchema = z.object({
  leadId: z.string().uuid(),
  reason: reasonSchema,
  privacyRequestId: requestIdSchema,
  /** Also remove the person from a connected CRM, where the adapter can. */
  alsoRemoveFromCrm: z.boolean().optional(),
});

defineOperation("lead.anonymise", {
  schema: erasureSchema,
  async run({ args, context }: HandlerInput<ErasureArgs>) {
    const before = await requireLead(context.businessId, args.leadId);
    try {
      const result = await anonymiseSubject(
        "LEAD",
        args.leadId,
        actorFrom(context, args),
        { propagateToCrm: args.alsoRemoveFromCrm === true },
      );
      const outcome = describeOutcome("ANONYMISE", result.counts);
      return {
        data: { ...result, outcome },
        entityId: args.leadId,
        before: { anonymised: Boolean(before.anonymised_at) },
        after: { anonymised: true, data_rights_action_id: result.actionId },
        warnings: before.anonymised_at
          ? [{ code: "already_anonymised", message: "This lead was already anonymised; anything left over has now been removed." }]
          : [],
      };
    } catch (error) {
      rethrow(error);
    }
  },
});

/* ------------------------------------------------------------------ delete */

defineOperation("lead.delete", {
  schema: erasureSchema,
  async run({ args, context }: HandlerInput<ErasureArgs>) {
    // Owner or admin: the registry's minimumRole, re-checked by the runtime.
    await requireLead(context.businessId, args.leadId);
    try {
      const result = await deleteSubject(
        "LEAD",
        args.leadId,
        actorFrom(context, args),
        { propagateToCrm: args.alsoRemoveFromCrm === true },
      );
      const outcome = describeOutcome("DELETE", result.counts);
      const crmProblems = result.crm.filter((report) => report.outcome === "FAILED" || report.outcome === "MANUAL");
      return {
        data: { ...result, outcome },
        entityId: args.leadId,
        before: { exists: true },
        after: { erased: true, data_rights_action_id: result.actionId },
        warnings: crmProblems.map((report) => ({ code: `crm_${report.outcome.toLowerCase()}`, message: report.detail })),
      };
    } catch (error) {
      rethrow(error);
    }
  },
});

/* ------------------------------------------------------------------ export */

defineOperation("lead.export", {
  schema: z.object({
    leadId: z.string().uuid(),
    privacyRequestId: requestIdSchema,
  }),
  async run({ args, context }: HandlerInput<{ leadId: string; privacyRequestId?: string }>) {
    try {
      const document = await exportLead(context.businessId, args.leadId);
      // A READ is not audited by the runtime, but handing over everything
      // held on a person is a data-rights act and is recorded as one.
      await recordDataRightsAction({
        action: "EXPORT",
        subjectType: "LEAD",
        subjectId: args.leadId,
        actor: actorFrom(context, { privacyRequestId: args.privacyRequestId }),
        summary: { sections: exportSummary(document), format: document.format },
      });
      return { data: { export: document }, entityId: args.leadId };
    } catch (error) {
      rethrow(error);
    }
  },
});

/* -------------------------------------------------------- privacy requests */

defineOperation("privacy_request.list", {
  schema: z.object({ limit: z.number().int().min(1).max(200).optional() }),
  async run({ args, context }: HandlerInput<{ limit?: number }>) {
    const requests = await listWorkspaceRequests(context.businessId, args.limit ?? 50);
    return { data: { requests, count: requests.length }, entityId: null };
  },
});

type CreateArgs = {
  type: (typeof PRIVACY_REQUEST_TYPES)[number];
  subjectName?: string;
  subjectEmail?: string;
  subjectPhone?: string;
  leadId?: string;
  details?: string;
  identityVerified: boolean;
  receivedAt?: string;
};

defineOperation("privacy_request.create", {
  schema: z.object({
    type: z.enum(PRIVACY_REQUEST_TYPES),
    subjectName: z.string().trim().max(200).optional(),
    subjectEmail: z.string().trim().max(320).pipe(z.email()).optional(),
    subjectPhone: z.string().trim().max(40).optional(),
    leadId: z.string().uuid().optional(),
    details: z.string().trim().max(4000).optional(),
    identityVerified: z.boolean().default(false),
    /** When the person actually asked, if earlier than now. ISO 8601. */
    receivedAt: z.string().datetime({ offset: true }).optional(),
  }),
  async run({ args, context }: HandlerInput<CreateArgs>) {
    if (!args.subjectEmail && !args.leadId && !args.subjectName) {
      throw new ServiceError("INVALID_INPUT", "Say who the request is from: an email, a name or a lead.");
    }
    if (args.receivedAt && new Date(args.receivedAt).getTime() > Date.now() + 60_000) {
      throw new ServiceError("INVALID_INPUT", "A request cannot have been received in the future.");
    }
    try {
      const request = await createWorkspaceRequest(context.businessId, context.userId, {
        type: args.type,
        subjectName: args.subjectName ?? null,
        subjectEmail: args.subjectEmail ?? null,
        subjectPhone: args.subjectPhone ?? null,
        subjectLeadId: args.leadId ?? null,
        details: args.details ?? null,
        identityVerified: args.identityVerified,
        receivedAt: args.receivedAt ?? null,
      });
      return {
        data: { request },
        entityId: request.id,
        before: null,
        // Reference and clocks only: the subject's details stay out of the audit row.
        after: {
          reference: request.reference,
          type: request.type,
          acknowledge_by: request.acknowledgeBy,
          due_at: request.dueAt,
        },
      };
    } catch (error) {
      rethrow(error);
    }
  },
});

type UpdateArgs = {
  requestId: string;
  status?: (typeof PRIVACY_REQUEST_STATUSES)[number];
  acknowledged?: boolean;
  identityVerified?: boolean;
  leadId?: string | null;
  note?: string;
};

defineOperation("privacy_request.update", {
  schema: z
    .object({
      requestId: z.string().uuid(),
      status: z.enum(PRIVACY_REQUEST_STATUSES).optional(),
      acknowledged: z.boolean().optional(),
      identityVerified: z.boolean().optional(),
      leadId: z.string().uuid().nullable().optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine((value) => Object.keys(value).length > 1, {
      message: "Give at least one change.",
    }),
  async run({ args, context }: HandlerInput<UpdateArgs>) {
    try {
      const { before, after } = await updateWorkspaceRequest(
        context.businessId,
        context.userId,
        args.requestId,
        {
          status: args.status,
          acknowledged: args.acknowledged,
          identityVerified: args.identityVerified,
          subjectLeadId: args.leadId,
          note: args.note,
        },
      );

      // Closing a rectification that names a lead is the moment the
      // correction is on record as done.
      if (
        args.status === "COMPLETED" &&
        after.type === "RECTIFICATION" &&
        after.subjectLeadId
      ) {
        await recordDataRightsAction({
          action: "RECTIFY",
          subjectType: "LEAD",
          subjectId: after.subjectLeadId,
          actor: actorFrom(context, { privacyRequestId: after.id, reason: args.note ?? null }),
          summary: { reference: after.reference },
        });
      }

      const snap = (r: typeof before) => ({
        status: r.status,
        verification: r.verificationStatus,
        acknowledged_at: r.acknowledgedAt,
        subject_lead_id: r.subjectLeadId,
      });
      return { data: { request: after }, entityId: after.id, before: snap(before), after: snap(after) };
    } catch (error) {
      rethrow(error);
    }
  },
});
