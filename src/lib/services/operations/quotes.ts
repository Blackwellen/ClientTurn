import "server-only";
import { z } from "zod";
import { liveQuoteDeps } from "@/lib/quotes/effects";
import { QUOTE_STATES } from "@/lib/quotes/lifecycle";
import {
  approveQuote,
  calculateQuoteDraft,
  createQuote,
  getQuote,
  listQuotes,
  presentQuote,
  presentRevision,
  rejectQuote,
  reviseQuote,
  sendQuote,
  submitForApproval,
  updateDraft,
  withdrawQuote,
  QuoteServiceError,
  type QuoteActor,
} from "@/lib/quotes/service-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentTermsSchema, quoteDiscountSchema, quoteLineInputSchema } from "@/lib/quotes/types";
import { aiDiscountPolicyFromAuthority, type DiscountPolicy, type WorkspaceRole } from "@/lib/quotes/discount-policy";
import { applyQuoteDiscount } from "@/lib/quotes/discount-core";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { claimCommercialAction } from "@/lib/commercial/lead-lock";
import { createAdminClient } from "@/lib/supabase/admin";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import type { ServiceContext } from "../types";

/**
 * Quote operations (P2). Thin: each handler builds the actor from the
 * context, calls the core in lib/quotes/service-core.ts with the live store
 * and effects, and maps a core refusal onto the service envelope. The logic,
 * and every test of it, lives in the core.
 */

function actorFor(context: ServiceContext): QuoteActor {
  const kind = context.caller === "AGENT" ? "AI" : context.caller === "UI" || context.caller === "COPILOT" ? "HUMAN" : context.caller === "SYSTEM" ? "SYSTEM" : "API";
  return { kind, userId: context.userId, role: context.role as WorkspaceRole };
}

/**
 * The discount policy the assistant is held to: the workspace's quote policy
 * plus the owner's AI limits (commercial authority v2). Read server-side on
 * every AGENT call, never passed in by the caller.
 */
async function aiPolicyFor(businessId: string): Promise<DiscountPolicy> {
  const [settings, authority] = await Promise.all([loadQuoteSettings(businessId), loadCommercialAuthoritySettings(businessId)]);
  return aiDiscountPolicyFromAuthority(settings.discountPolicy, authority, aiAuthorityOf(authority));
}

/** Only the agent runtime (trusted code, never the model) supplies the objection and concession context. */
const agentContextSchema = z
  .object({ afterObjection: z.boolean(), priorAiConcessions: z.number().int().min(0).max(10) })
  .optional();

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

async function leadOfOpportunity(businessId: string, opportunityId: string): Promise<string | null> {
  const { data } = await db().from("opportunities").select("lead_id").eq("business_id", businessId).eq("id", opportunityId).maybeSingle();
  return (data as { lead_id: string | null } | null)?.lead_id ?? null;
}

async function leadOfQuote(businessId: string, quoteId: string): Promise<string | null> {
  const { data } = await db().from("quotes").select("opportunity_id").eq("business_id", businessId).eq("id", quoteId).maybeSingle();
  const opportunityId = (data as { opportunity_id: string } | null)?.opportunity_id;
  return opportunityId ? leadOfOpportunity(businessId, opportunityId) : null;
}

/**
 * One actor at a time on a lead (commercial/locks.ts): a person's quote
 * action takes the lead's lease, and is refused while the assistant is in the
 * middle of one. The assistant's own calls claim it in agent/tools.ts.
 */
async function claimForPerson(context: ServiceContext, leadId: string | null, kind: "QUOTE_CREATE" | "QUOTE_SEND", actionKey: string): Promise<void> {
  if (!leadId || (context.caller !== "UI" && context.caller !== "COPILOT")) return;
  const claim = await claimCommercialAction({
    businessId: context.businessId,
    leadId,
    holder: "HUMAN",
    holderRef: context.userId,
    kind,
    actionKey: `human:${kind}:${actionKey}:${context.correlationId}`,
  });
  if (!claim.ok && claim.reason === "HELD") {
    throw new ServiceError("CONFLICT", "The assistant is working on a quote for this lead right now. Try again in a minute.");
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof QuoteServiceError) throw new ServiceError(error.code, error.message);
    throw error;
  }
}

const lines = z.array(quoteLineInputSchema).min(1).max(200);
const contentSchema = {
  lines,
  quoteDiscount: quoteDiscountSchema.optional(),
  payment: paymentTermsSchema.optional(),
  customerNote: z.string().trim().max(2000).nullable().optional(),
};

defineOperation("quote.calculate", {
  schema: z.object(contentSchema),
  async run({ args, context }: HandlerInput<z.infer<z.ZodObject<typeof contentSchema>>>) {
    const deps = liveQuoteDeps(context.businessId);
    const result = await guarded(() => calculateQuoteDraft(deps, context.businessId, actorFor(context), args));
    return { data: result, entityId: null };
  },
});

const createSchema = z.object({
  ...contentSchema,
  opportunityId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  /** The message, tool call or API request this quote answers (idempotency). Defaults to the call's idempotency key. */
  requestId: z.string().trim().min(1).max(200).optional(),
  internalNote: z.string().trim().max(5000).nullable().optional(),
  aiRationale: z.string().trim().max(5000).nullable().optional(),
  /** AGENT callers only (ignored otherwise): the conversation's objection and concession context. */
  agent: agentContextSchema,
});

defineOperation("quote.create", {
  schema: createSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof createSchema>>) {
    const requestId = args.requestId ?? context.idempotencyKey;
    if (!requestId) throw new ServiceError("INVALID_INPUT", "requestId: a request id is required so a retry does not create a second quote.");
    const actor = actorFor(context);
    await claimForPerson(context, await leadOfOpportunity(context.businessId, args.opportunityId), "QUOTE_CREATE", requestId);
    // The assistant is held to its own policy, read here (never from the caller).
    const ai =
      actor.kind === "AI"
        ? { afterObjection: args.agent?.afterObjection ?? false, priorAiConcessions: args.agent?.priorAiConcessions ?? 0, policy: await aiPolicyFor(context.businessId) }
        : undefined;
    const { agent: _agent, ...content } = args;
    void _agent;
    const result = await guarded(() =>
      createQuote(liveQuoteDeps(context.businessId), context.businessId, actor, {
        ...content,
        requestId,
        aiRationale: actor.kind === "AI" ? args.aiRationale : null,
        ai,
      }),
    );
    const internal = actor.role === "owner" || actor.role === "admin";
    return {
      data: {
        quote: presentQuote(result.quote),
        revision: result.revision ? presentRevision(result.revision, internal) : null,
        duplicate: result.duplicate,
      },
      entityId: result.quote.id,
      after: { status: result.quote.status, number: result.quote.number },
      warnings: result.duplicate
        ? [{ code: "already_created", message: "A quote for this request already exists; it was returned instead of a second one." }]
        : result.revision?.approvalRequired
          ? [{ code: "approval_required", message: "This quote needs approval before it can be sent." }]
          : [],
    };
  },
});

const updateSchema = z.object({
  quoteId: z.string().uuid(),
  lines: lines.optional(),
  quoteDiscount: quoteDiscountSchema.nullable().optional(),
  payment: paymentTermsSchema.nullable().optional(),
  customerNote: z.string().trim().max(2000).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  internalNote: z.string().trim().max(5000).nullable().optional(),
  expectedRevisionId: z.string().uuid().optional(),
});

defineOperation("quote.update_draft", {
  schema: updateSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof updateSchema>>) {
    const actor = actorFor(context);
    const result = await guarded(() =>
      updateDraft(liveQuoteDeps(context.businessId), context.businessId, actor, {
        ...args,
        quoteDiscount: args.quoteDiscount === null ? undefined : args.quoteDiscount,
        payment: args.payment === null ? undefined : args.payment,
      }),
    );
    const internal = actor.role === "owner" || actor.role === "admin";
    return {
      data: { quote: presentQuote(result.quote), revision: presentRevision(result.revision, internal), approval: result.approval },
      entityId: result.quote.id,
      after: { totalGrossMinor: result.revision.calculation.totals.grossMinor, approvalRequired: result.revision.approvalRequired },
    };
  },
});

const noteSchema = z.object({ quoteId: z.string().uuid(), note: z.string().trim().max(2000).nullable().optional() });

defineOperation("quote.submit_for_approval", {
  schema: noteSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof noteSchema>>) {
    const result = await guarded(() => submitForApproval(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.quoteId, after: { status: result.status } };
  },
});

defineOperation("quote.approve", {
  schema: noteSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof noteSchema>>) {
    const result = await guarded(() => approveQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.quoteId, before: { status: "PENDING_APPROVAL" }, after: { status: result.status } };
  },
});

defineOperation("quote.reject", {
  schema: noteSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof noteSchema>>) {
    const result = await guarded(() => rejectQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.quoteId, before: { status: "PENDING_APPROVAL" }, after: { status: result.status } };
  },
});

const sendSchema = z.object({ quoteId: z.string().uuid(), channel: z.enum(["email", "link"]).default("email") });

defineOperation("quote.send", {
  schema: sendSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof sendSchema>>) {
    await claimForPerson(context, await leadOfQuote(context.businessId, args.quoteId), "QUOTE_SEND", args.quoteId);
    const result = await guarded(() => sendQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return {
      data: result,
      entityId: args.quoteId,
      after: { status: result.status, validUntil: result.validUntil },
      warnings: [
        ...(result.delivery.queued ? [{ code: "queued", message: result.delivery.detail }] : []),
        ...(args.channel === "email" && !result.delivery.queued ? [{ code: "not_emailed", message: `${result.delivery.detail} Copy the link instead.` }] : []),
      ],
    };
  },
});

const applyDiscountSchema = z.object({
  quoteId: z.string().uuid(),
  /** A whole-quote percentage in basis points (1 = 0.01%). */
  bps: z.number().int().min(1).max(10_000),
  dryRun: z.boolean().default(false),
  agent: agentContextSchema,
});

defineOperation("quote.apply_discount", {
  schema: applyDiscountSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof applyDiscountSchema>>) {
    const actor = actorFor(context);
    const ai =
      actor.kind === "AI"
        ? { afterObjection: args.agent?.afterObjection ?? false, priorAiConcessions: args.agent?.priorAiConcessions ?? 0, policy: await aiPolicyFor(context.businessId) }
        : undefined;
    const result = await guarded(() =>
      applyQuoteDiscount(liveQuoteDeps(context.businessId), context.businessId, actor, {
        quoteId: args.quoteId,
        discount: { type: "PERCENT", bps: args.bps, scope: "ALL" },
        ai,
        dryRun: args.dryRun,
      }),
    );
    return {
      data: result,
      entityId: args.quoteId,
      after: { revisionId: result.revisionId, approvalRequired: result.approval.required, bps: args.bps, dryRun: result.dryRun },
      warnings: result.revised ? [{ code: "link_revoked", message: "The customer's previous link no longer works until the new revision is sent." }] : [],
    };
  },
});

const idSchema = z.object({ quoteId: z.string().uuid() });

defineOperation("quote.revise", {
  schema: idSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof idSchema>>) {
    const result = await guarded(() => reviseQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return {
      data: result,
      entityId: args.quoteId,
      after: { status: result.status, revisionNo: result.revisionNo },
      warnings: [{ code: "link_revoked", message: "The customer's previous link no longer works. Send the new revision when it is ready." }],
    };
  },
});

const withdrawSchema = z.object({ quoteId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

defineOperation("quote.withdraw", {
  schema: withdrawSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof withdrawSchema>>) {
    const result = await guarded(() => withdrawQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.quoteId, before: { status: result.from }, after: { status: result.status } };
  },
});

defineOperation("quote.get", {
  schema: idSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof idSchema>>) {
    const result = await guarded(() => getQuote(liveQuoteDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.quoteId };
  },
});

const listSchema = z.object({
  opportunityId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  status: z.enum(QUOTE_STATES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

defineOperation("quote.list", {
  schema: listSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof listSchema>>) {
    const result = await guarded(() => listQuotes(liveQuoteDeps(context.businessId), context.businessId, { ...args, limit: args.limit ?? 25 }));
    return { data: result, entityId: null };
  },
});
