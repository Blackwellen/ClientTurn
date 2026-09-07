import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { getV4Analytics, rangeBounds } from "@/lib/analytics/v4-queries";
import { getCampaignPerformance } from "@/lib/analytics/v4-extras";
import { getUsageOverview } from "@/lib/billing/usage-service";
import { loadBusinessProfile } from "@/lib/business-profile/queries";
import {
  setCampaignStateAction,
  setCampaignPriorityAction,
  createCampaignDraftAction,
} from "@/lib/outreach/campaign-actions";
import { saveFact } from "@/lib/business-profile/actions";
import { createSupportTicket } from "@/lib/support/actions";
import { runOperation, serviceOperation } from "@/lib/services";
import { copilotTool, roleAllows, type ToolDeclaration } from "./types";

/**
 * CopilotToolService — the boundary between what a model asks for and what the
 * product actually does (V4 §28.6-§28.10).
 *
 * Four rules, enforced here and not anywhere else, so there is exactly one
 * place to audit:
 *
 *  1. **Copilot calls domain services, never tables.** Every write below
 *     delegates to the same server action the normal UI uses, so validation,
 *     state machines, budgets, suppression and contactability all apply
 *     unchanged. There is no Supabase write in this file.
 *
 *  2. **Copilot inherits the user's permissions.** The role comes from the
 *     session, the required scope from the tool declaration, and a caller who
 *     could not do this by hand cannot do it by asking.
 *
 *  3. **High-impact actions need a human.** `requiresConfirmation` is checked
 *     against a flag the browser can only set by showing the dialog — and a
 *     request that lies about it still fails, because the tool refuses rather
 *     than trusting the caller.
 *
 *  4. **Every invocation is logged**, before it runs and again with its
 *     outcome, including the ones that were denied.
 */

export type ToolContext = {
  businessId: string;
  userId: string;
  role: string;
  sessionId: string | null;
};

export type ToolOutcome =
  | {
      ok: true;
      summary: string;
      data: unknown;
      /**
       * Present when the tool was a service-layer operation.
       *
       * This is what lets Copilot *report* rather than narrate. "I've archived
       * that lead" is a claim; the same sentence carrying the before and after
       * values, the audit row id and any warnings is a claim that can be
       * checked. Copilot must never assert a change without one of these.
       */
      envelope?: {
        entityId: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        auditEventId: string | null;
        warnings: { code: string; message: string }[];
        billingEffect: { metric: string; quantity: number }[];
        correlationId: string;
      };
    }
  | { ok: false; error: string; denied?: boolean; needsConfirmation?: boolean };

/* ------------------------------------------------------------------ audit */

async function openAction(
  context: ToolContext,
  tool: ToolDeclaration,
  summary: string,
  objectId: string | null,
  confirmed: boolean,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("copilot_actions")
    .insert({
      business_id: context.businessId,
      session_id: context.sessionId,
      user_id: context.userId,
      tool_name: tool.name,
      kind: tool.kind,
      object_type: objectTypeFor(tool.name),
      object_id: objectId,
      request_summary: summary,
      confirmed,
      outcome: "PENDING",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

async function closeAction(
  actionId: string | null,
  outcome: "SUCCESS" | "DENIED" | "FAILED",
  errorLabel?: string,
) {
  if (!actionId) return;
  const admin = createAdminClient();
  await admin
    .from("copilot_actions")
    .update({ outcome, error_label: errorLabel ?? null })
    .eq("id", actionId);
}

function objectTypeFor(tool: string): string | null {
  if (tool.includes("Campaign")) return "outreach_campaign";
  if (tool.includes("Lead")) return "lead";
  if (tool.includes("Prospect")) return "prospect";
  if (tool.includes("Fact")) return "business_memory_fact";
  if (tool.includes("Ticket")) return "support_ticket";
  return null;
}

/* ------------------------------------------------------------- dispatcher */

/**
 * The single entry point. Nothing calls a tool implementation directly.
 */
export async function runTool(
  context: ToolContext,
  name: string,
  args: Record<string, unknown>,
  confirmed: boolean,
): Promise<ToolOutcome> {
  const tool = copilotTool(name);

  // An unknown tool is not an error to explain away — it is a request for
  // something that does not exist, and is refused without being logged as a
  // real action against a real object.
  if (!tool) {
    return { ok: false, error: "That action is not available." };
  }

  if (!roleAllows(context.role, tool.scope)) {
    const actionId = await openAction(context, tool, tool.summary, null, confirmed);
    await closeAction(actionId, "DENIED", "insufficient_role");
    await recordAudit({
      businessId: context.businessId,
      actorUserId: context.userId,
      action: "copilot.action_denied",
      entityType: "copilot_action",
      entityId: actionId,
      metadata: { tool: name, reason: "insufficient_role", role: context.role },
    });
    return {
      ok: false,
      denied: true,
      error: `You do not have permission to ${tool.summary.toLowerCase()}.`,
    };
  }

  // The confirmation gate. Checked before anything is opened as an action, so
  // an unconfirmed high-impact request never even reaches the domain service.
  if (tool.requiresConfirmation && !confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      error: tool.effect ?? "This action needs your confirmation.",
    };
  }

  const objectId =
    typeof args.id === "string"
      ? args.id
      : typeof args.campaignId === "string"
        ? args.campaignId
        : null;

  const actionId =
    tool.kind === "WRITE"
      ? await openAction(context, tool, tool.summary, objectId, confirmed)
      : null;

  try {
    const outcome = await execute(context, tool, args, confirmed);

    if (tool.kind === "WRITE") {
      await closeAction(
        actionId,
        outcome.ok ? "SUCCESS" : "FAILED",
        outcome.ok ? undefined : "domain_service_refused",
      );

      // Logged to the workspace audit trail as well as the Copilot log: a
      // campaign that stopped sending should be explicable from the audit
      // trail alone, without anyone knowing to look at Copilot.
      await recordAudit({
        businessId: context.businessId,
        actorUserId: context.userId,
        action: outcome.ok ? "copilot.action_executed" : "copilot.action_denied",
        entityType: objectTypeFor(tool.name) ?? "copilot_action",
        entityId: objectId ?? actionId,
        metadata: {
          tool: tool.name,
          confirmed,
          summary: outcome.ok ? outcome.summary : outcome.error,
        },
      });
    }

    return outcome;
  } catch {
    await closeAction(actionId, "FAILED", "unexpected_error");
    // The real error is never returned to the caller: it may name internal
    // infrastructure, and a model does not need it to recover.
    return { ok: false, error: "That action could not be completed." };
  }
}

/* -------------------------------------------------------- implementations */

/**
 * Runs a service-layer operation on Copilot's behalf.
 *
 * Copilot supplies no permission of its own: the acting user's live role goes
 * in, `caller` says who is asking, and the runtime decides. `confirmed` is
 * passed through from the dialog the person actually saw — Copilot cannot set
 * it for itself, which is why a destructive operation cannot be talked into
 * running.
 */
async function delegate(
  context: ToolContext,
  tool: ToolDeclaration,
  args: Record<string, unknown>,
  confirmed: boolean,
): Promise<ToolOutcome> {
  const result = await runOperation(tool.name, args, {
    businessId: context.businessId,
    userId: context.userId,
    role: context.role as "owner" | "admin" | "member" | "viewer",
    caller: "COPILOT",
    confirmed,
    correlationId: randomUUID(),
  });

  if (!result.success) {
    return {
      ok: false,
      error: result.message,
      denied: result.code === "FORBIDDEN_ROLE" || result.code === "FORBIDDEN_SCOPE",
      needsConfirmation: result.code === "NEEDS_CONFIRMATION",
    };
  }

  // The warning travels into the summary rather than being dropped: a caller
  // that says "done" while the envelope says follow-up stopped has told the
  // customer less than it knew.
  const summary = result.warnings.length
    ? `${tool.summary}. ${result.warnings.map((w) => w.message).join(" ")}`
    : tool.summary;

  return {
    ok: true,
    summary,
    data: result.data,
    envelope: {
      entityId: result.entityId,
      before: result.before,
      after: result.after,
      auditEventId: result.auditEventId,
      warnings: result.warnings,
      billingEffect: result.billingEffect.map((b) => ({
        metric: b.metric,
        quantity: b.quantity,
      })),
      correlationId: result.correlationId,
    },
  };
}

async function execute(
  context: ToolContext,
  tool: ToolDeclaration,
  args: Record<string, unknown>,
  confirmed: boolean,
): Promise<ToolOutcome> {
  // Ported domains go to the one implementation. Anything still listed below is
  // a surface the service layer has not taken over yet.
  if (serviceOperation(tool.name)) {
    return delegate(context, tool, args, confirmed);
  }

  switch (tool.name) {
    /* ---------------------------------------------------------- reads */
    case "getProspects":
      return getProspects(context, args);
    case "getCampaign":
      return getCampaign(context, args);
    case "getCampaignPerformance":
      return campaignPerformance(context);
    case "getAnalytics":
      return analytics(context, args);
    case "getBusinessProfile":
      return businessProfile(context);
    case "getIntentSignals":
      return intentSignals(context);
    case "getUsage":
      return usage(context);
    case "getAttentionItems":
      return attentionItems(context);

    /* --------------------------------------------------------- writes */
    case "pauseCampaign":
      return campaignState(context, args, "PAUSED");
    case "resumeCampaign":
      return campaignState(context, args, "ACTIVE");
    case "updateCampaignPriority":
      return campaignPriority(args);
    case "createCampaignDraft":
      return campaignDraft();
    case "updateBusinessFact":
      return updateFact(args);
    case "createSupportTicket":
      return supportTicket(args);

    default:
      return { ok: false, error: "That action is not available yet." };
  }
}

/* ------------------------------------------------------------------ reads */

async function getProspects(context: ToolContext, args: Record<string, unknown>) {
  const limit = z.number().int().min(1).max(50).catch(20).parse(args.limit ?? 20);
  const admin = createAdminClient();

  const { data } = await admin
    .from("prospects")
    .select("id, full_name, role_title, grade, score, status, verification_status, created_at")
    .eq("business_id", context.businessId)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    ok: true as const,
    summary: `${data?.length ?? 0} prospects`,
    data: data ?? [],
  };
}

async function getCampaign(context: ToolContext, args: Record<string, unknown>) {
  const id = z.uuid().parse(args.id);
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaigns")
    .select("id, name, status, priority, minimum_grade, daily_contact_cap, monthly_contact_cap")
    .eq("id", id)
    .eq("business_id", context.businessId)
    .maybeSingle();

  if (!data) return { ok: false as const, error: "That campaign could not be found." };
  return { ok: true as const, summary: `Campaign ${data.name}`, data };
}

async function campaignPerformance(context: ToolContext) {
  const rows = await getCampaignPerformance(context.businessId, 10);
  return {
    ok: true as const,
    summary: `${rows.length} campaigns compared`,
    data: rows,
  };
}

async function analytics(context: ToolContext, args: Record<string, unknown>) {
  const view = z
    .enum(["overview", "acquisition", "outreach", "conversion"])
    .catch("overview")
    .parse(args.view ?? "overview");
  const range = z.enum(["7d", "30d", "90d", "12m"]).catch("30d").parse(args.range ?? "30d");

  // The canonical analytics service, so Copilot quotes the same numbers the
  // Analytics page shows rather than deriving its own.
  const data = await getV4Analytics(context.businessId, view, rangeBounds(range));
  return { ok: true as const, summary: `${view} analytics, ${range}`, data };
}

async function businessProfile(context: ToolContext) {
  const data = await loadBusinessProfile(context.businessId);
  return { ok: true as const, summary: "Business profile loaded", data };
}

async function intentSignals(context: ToolContext) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospect_intent_matches")
    .select("prospect_id, intent_category_id, observed_at, expires_at")
    .eq("business_id", context.businessId)
    .gt("expires_at", new Date().toISOString())
    .order("observed_at", { ascending: false })
    .limit(50);

  return {
    ok: true as const,
    summary: `${data?.length ?? 0} live intent signals`,
    data: data ?? [],
  };
}

async function usage(context: ToolContext) {
  const data = await getUsageOverview(context.businessId);
  return { ok: true as const, summary: "Usage loaded", data };
}

async function attentionItems(context: ToolContext) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, first_name, last_name, attention_reason, updated_at")
    .eq("business_id", context.businessId)
    .eq("is_test", false)
    .eq("needs_attention", true)
    .order("updated_at", { ascending: false })
    .limit(25);

  return {
    ok: true as const,
    summary: `${data?.length ?? 0} leads need attention`,
    data: data ?? [],
  };
}

/* ----------------------------------------------------------------- writes */

/**
 * Campaign state changes go through `setCampaignStateAction`, which owns the
 * campaign state machine. Copilot cannot move a campaign into a state the UI
 * would refuse, because it is asking the same function.
 */
async function campaignState(
  context: ToolContext,
  args: Record<string, unknown>,
  status: "PAUSED" | "ACTIVE",
) {
  const id = z.uuid().parse(args.id ?? args.campaignId);
  const result = await setCampaignStateAction({ campaignId: id, status });

  return result.ok
    ? {
        ok: true as const,
        summary: status === "PAUSED" ? "Campaign paused" : "Campaign resumed",
        data: { id, status },
      }
    : { ok: false as const, error: result.error };
}

async function campaignPriority(args: Record<string, unknown>) {
  const id = z.uuid().parse(args.id ?? args.campaignId);
  const priority = z.number().int().min(1).max(10).parse(args.priority);
  const result = await setCampaignPriorityAction({ campaignId: id, priority });

  return result.ok
    ? { ok: true as const, summary: "Campaign priority updated", data: { id, priority } }
    : { ok: false as const, error: result.error };
}

async function campaignDraft() {
  const result = await createCampaignDraftAction();
  return result.ok
    ? {
        ok: true as const,
        summary: "Campaign draft created",
        data: { id: result.data.id },
      }
    : { ok: false as const, error: result.error };
}

/**
 * Business facts go through `saveFact`, which refuses to overwrite a locked
 * fact. That refusal is the point: a locked fact is the customer's statement
 * about their own business, and nothing automated may overrule it.
 */
async function updateFact(args: Record<string, unknown>) {
  const result = await saveFact({
    factKey: args.factKey,
    value: args.value,
    source: "AI",
  });

  return result.ok
    ? { ok: true as const, summary: "Business fact updated", data: { id: result.id } }
    : { ok: false as const, error: result.error };
}

async function supportTicket(args: Record<string, unknown>) {
  const result = await createSupportTicket({
    category: args.category ?? "OTHER",
    subject: args.subject,
    description: args.description,
    includeContext: false,
    attachmentKeys: [],
  });

  return result.ok
    ? {
        ok: true as const,
        summary: `Ticket ${result.data.reference} created`,
        data: result.data,
      }
    : { ok: false as const, error: result.error };
}
