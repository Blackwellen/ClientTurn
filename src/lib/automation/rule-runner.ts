import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { runOperation } from "@/lib/services";
import { maintenanceWriteBlock } from "@/lib/maintenance/state";
import { capabilitiesFor } from "@/lib/billing/capabilities";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { AI_PERMISSIONS, aiMay, type AiPermission } from "@/lib/commercial/ai-permissions";
import { recordCheckoutAttempt, trackCheckoutLink } from "@/lib/payments/attempts";
import { loadWorkspaceMotion } from "@/lib/opportunities/service";
import { semanticForEvent } from "@/lib/opportunities/pipeline-semantics";
import {
  applyPipelineSemantic,
  loadSemanticMap,
  resolveOpportunity,
  stagesForDeal,
} from "@/lib/opportunities/pipeline-apply";
import type { BusinessRoleName } from "@/lib/services/types";
import { emitAutomationEvent } from "./events";
import {
  ACTION_META,
  conditionsMatch,
  frequencyAllows,
  outcomeFromRefusal,
  planAction,
  ruleActionSchema,
  ruleConditionsSchema,
  RULE_FREQUENCIES,
  type ActionGate,
  type RuleAction,
  type RuleFrequency,
  type RuleSubjectRefs,
} from "./rules";

/**
 * The `automation.dispatch` job (gap map §45-46): one per automation event
 * that the pipeline mapping, a derived trigger or an enabled rule cares about
 * (queued by emitAutomationEvent).
 *
 *   1. **Pipeline**: the event's semantic (Quoted, Payment pending, Won...)
 *      moves the deal per the workspace's mapping (pipeline-apply.ts).
 *   2. **Derived triggers**: a reply or booking from a lead in a reactivation
 *      campaign is a `reactivation.succeeded`.
 *   3. **Rules**: each enabled rule for the trigger checks its conditions and
 *      frequency, then runs its actions in order through runOperation with
 *      caller AUTOMATION and the enabling admin's LIVE role. Every action ends
 *      as one `automation_rule_runs` row: SUCCEEDED, SKIPPED with the reason,
 *      FAILED, or SCHEDULED (a delayed call, resumed by a later dispatch).
 *
 * Retry-safe: the run rows are unique per (rule, event, action), an action
 * already SUCCEEDED or SKIPPED is never repeated, and the operation's
 * idempotency key is derived from the same triple, so a retried send or quote
 * is the same send or quote. State is re-read on every run, never trusted
 * from the event.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const dispatchPayload = z.object({
  eventId: z.uuid(),
  /** A delayed action's continuation: run `ruleId` from `fromIndex`. */
  resume: z.object({ ruleId: z.uuid(), fromIndex: z.number().int().min(0).max(4) }).optional(),
});

type EventRow = {
  id: string;
  business_id: string;
  lead_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
};

type RuleRow = {
  id: string;
  business_id: string;
  name: string;
  trigger_event: string;
  conditions: unknown;
  actions: unknown;
  frequency: string;
  enabled: boolean;
  acknowledge_external: boolean;
  enabled_by: string | null;
};

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/* ------------------------------------------------------------- the subject */

/** The lead, quote, invoice and deal the event is about, from the payload and the database. */
async function resolveRefs(event: EventRow): Promise<RuleSubjectRefs> {
  const p = event.payload ?? {};
  let leadId = event.lead_id ?? str(p.leadId) ?? str(p.lead_id);
  const quoteId = str(p.quoteId);
  const invoiceId = str(p.invoiceId);
  let opportunityId = str(p.opportunityId);

  if (!opportunityId && quoteId) {
    const { data } = await db().from("quotes").select("opportunity_id").eq("business_id", event.business_id).eq("id", quoteId).maybeSingle();
    opportunityId = (data as { opportunity_id: string } | null)?.opportunity_id ?? null;
  }
  if (!opportunityId && invoiceId) {
    const { data } = await db().from("invoices").select("opportunity_id").eq("business_id", event.business_id).eq("id", invoiceId).maybeSingle();
    opportunityId = (data as { opportunity_id: string } | null)?.opportunity_id ?? null;
  }
  if (!leadId && opportunityId) {
    const { data } = await db().from("opportunities").select("lead_id").eq("business_id", event.business_id).eq("id", opportunityId).maybeSingle();
    leadId = (data as { lead_id: string | null } | null)?.lead_id ?? null;
  }
  let quote = quoteId;
  if (!quote && invoiceId) {
    const { data } = await db().from("invoices").select("quote_id").eq("business_id", event.business_id).eq("id", invoiceId).maybeSingle();
    quote = (data as { quote_id: string | null } | null)?.quote_id ?? null;
  }
  return { leadId, quoteId: quote, invoiceId, opportunityId };
}

/* ------------------------------------------------------------ the pipeline */

async function applyPipeline(event: EventRow, refs: RuleSubjectRefs): Promise<void> {
  let quoteStatus: string | null = null;
  if (event.event_type === "invoice.paid" && refs.quoteId) {
    const { data } = await db().from("quotes").select("status").eq("business_id", event.business_id).eq("id", refs.quoteId).maybeSingle();
    quoteStatus = (data as { status: string } | null)?.status ?? null;
  }
  const semantic = semanticForEvent(event.event_type, { quoteStatus });
  if (!semantic) return;
  await applyPipelineSemantic({ businessId: event.business_id, semantic, opportunityId: refs.opportunityId, leadId: refs.leadId });
}

/* ------------------------------------------------------ derived triggers */

const REACTIVATION_WINDOW_DAYS = 30;

/** A reply or booking from a lead a reactivation campaign reached recently, once per campaign. */
async function deriveReactivationSuccess(event: EventRow, refs: RuleSubjectRefs): Promise<void> {
  if (!refs.leadId || (event.event_type !== "lead.replied" && event.event_type !== "booking.created")) return;
  const since = new Date(Date.now() - REACTIVATION_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: contacts } = await db()
    .from("campaign_contacts")
    .select("campaign_id, sent_at, state")
    .eq("business_id", event.business_id)
    .eq("lead_id", refs.leadId)
    .in("state", ["sent", "delivered", "replied"])
    .gte("sent_at", since)
    .limit(5);
  const campaign = (contacts ?? [])[0] as { campaign_id: string } | undefined;
  if (!campaign) return;

  const { data: lead } = await db().from("leads").select("opted_out").eq("business_id", event.business_id).eq("id", refs.leadId).maybeSingle();
  if ((lead as { opted_out: boolean } | null)?.opted_out) return;

  const { data: already } = await db()
    .from("automation_events")
    .select("id")
    .eq("business_id", event.business_id)
    .eq("lead_id", refs.leadId)
    .eq("event_type", "reactivation.succeeded")
    .contains("payload", { campaignId: campaign.campaign_id })
    .limit(1);
  if ((already ?? []).length > 0) return;

  await emitAutomationEvent({
    businessId: event.business_id,
    leadId: refs.leadId,
    eventType: "reactivation.succeeded",
    payload: { leadId: refs.leadId, campaignId: campaign.campaign_id, via: event.event_type },
  });
}

/* ---------------------------------------------------------------- the rules */

async function authorRole(businessId: string, userId: string | null): Promise<BusinessRoleName | null> {
  if (!userId) return null;
  const { data } = await db()
    .from("business_members")
    .select("role, status")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { role: BusinessRoleName; status: string | null } | null;
  if (!row || (row.status && row.status !== "active")) return null;
  return row.role;
}

async function voiceOn(businessId: string): Promise<boolean> {
  const { data } = await db().from("voice_settings").select("voice_enabled, admin_kill_switch").eq("business_id", businessId).maybeSingle();
  const row = data as { voice_enabled: boolean; admin_kill_switch: boolean } | null;
  return Boolean(row?.voice_enabled && !row.admin_kill_switch);
}

type WorkspaceGate = Omit<ActionGate, "authorRole" | "standingConfirmation" | "stageFor" | "checkoutLinks" | "mergeValues"> & {
  rawCheckoutLinks: { id: string; url: string; label: string; price_text: string }[];
  businessName: string;
  businessPhone: string | null;
};

async function workspaceGate(businessId: string): Promise<WorkspaceGate> {
  const [maintenance, capabilities, authority, voice, business, settings] = await Promise.all([
    maintenanceWriteBlock(),
    capabilitiesFor(businessId),
    loadCommercialAuthoritySettings(businessId),
    voiceOn(businessId),
    db().from("businesses").select("name, phone").eq("id", businessId).maybeSingle(),
    db().from("business_settings").select("booking_url").eq("business_id", businessId).maybeSingle(),
  ]);
  const ai = aiAuthorityOf(authority);
  const aiPermissions = Object.fromEntries(AI_PERMISSIONS.map((p) => [p, aiMay(ai, p)])) as Record<AiPermission, boolean>;
  const caps: Record<string, boolean> = Object.fromEntries(
    Object.entries(capabilities).map(([key, decision]) => [key, Boolean(decision.allowed)]),
  );
  caps.voice_enabled = voice && Boolean(capabilities.voice_sales_enabled?.allowed);
  return {
    maintenance,
    aiPermissions,
    capabilities: caps,
    bookingLink: (settings.data as { booking_url: string | null } | null)?.booking_url ?? null,
    rawCheckoutLinks: authority.approved_checkout_links as WorkspaceGate["rawCheckoutLinks"],
    businessName: (business.data as { name: string | null } | null)?.name ?? "",
    businessPhone: (business.data as { phone: string | null } | null)?.phone ?? null,
  };
}

async function recordRun(row: {
  businessId: string;
  ruleId: string;
  eventId: string;
  leadId: string | null;
  actionIndex: number;
  actionType: string | null;
  operation: string | null;
  status: "SUCCEEDED" | "SKIPPED" | "FAILED" | "SCHEDULED";
  reasonCode?: string | null;
  reason?: string | null;
  entityId?: string | null;
  auditEventId?: string | null;
  runAt?: string | null;
}): Promise<void> {
  const { error } = await db()
    .from("automation_rule_runs")
    .upsert(
      {
        business_id: row.businessId,
        rule_id: row.ruleId,
        automation_event_id: row.eventId,
        lead_id: row.leadId,
        action_index: row.actionIndex,
        action_type: row.actionType,
        operation: row.operation,
        status: row.status,
        reason_code: row.reasonCode ?? null,
        reason: row.reason ? row.reason.slice(0, 500) : null,
        entity_id: row.entityId && /^[0-9a-f-]{36}$/.test(row.entityId) ? row.entityId : null,
        audit_event_id: row.auditEventId ?? null,
        run_at: row.runAt ?? null,
      },
      { onConflict: "rule_id,automation_event_id,action_index" },
    );
  if (error) console.error("[automation] run row not written", { ruleId: row.ruleId, code: error.code, message: error.message });
}

async function priorRuns(ruleId: string, eventId: string): Promise<Map<number, string>> {
  const { data } = await db()
    .from("automation_rule_runs")
    .select("action_index, status")
    .eq("rule_id", ruleId)
    .eq("automation_event_id", eventId);
  return new Map(((data ?? []) as { action_index: number; status: string }[]).map((r) => [r.action_index, r.status]));
}

/** When this rule fired for this lead before (its first action attempted), newest first. */
async function previousFires(rule: RuleRow, leadId: string | null, eventId: string): Promise<Date[]> {
  let query = db()
    .from("automation_rule_runs")
    .select("created_at, automation_event_id")
    .eq("rule_id", rule.id)
    .eq("action_index", 0)
    .order("created_at", { ascending: false })
    .limit(20);
  query = leadId ? query.eq("lead_id", leadId) : query.is("lead_id", null);
  const { data } = await query;
  return ((data ?? []) as { created_at: string; automation_event_id: string }[])
    .filter((row) => row.automation_event_id !== eventId)
    .map((row) => new Date(row.created_at));
}

export type RuleOutcome = { ruleId: string; fired: boolean; failed: number };

async function runRule(input: {
  rule: RuleRow;
  event: EventRow;
  refs: RuleSubjectRefs;
  workspace: WorkspaceGate;
  fromIndex: number;
}): Promise<RuleOutcome> {
  const { rule, event, refs, workspace } = input;
  const base = { businessId: event.business_id, ruleId: rule.id, eventId: event.id, leadId: refs.leadId };

  const actionsParsed = z.array(ruleActionSchema).safeParse(rule.actions);
  if (!actionsParsed.success) {
    await recordRun({ ...base, actionIndex: -1, actionType: null, operation: null, status: "SKIPPED", reasonCode: "INVALID_RULE", reason: "This rule's actions could not be read. Open and save it again." });
    return { ruleId: rule.id, fired: false, failed: 0 };
  }
  const actions: RuleAction[] = actionsParsed.data;
  const done = await priorRuns(rule.id, event.id);

  if (input.fromIndex === 0) {
    if (done.has(-1)) return { ruleId: rule.id, fired: false, failed: 0 };
    const conditions = ruleConditionsSchema.parse(rule.conditions ?? {});
    let leadStatus: string | null = null;
    if (refs.leadId) {
      const { data } = await db().from("leads").select("status").eq("business_id", event.business_id).eq("id", refs.leadId).maybeSingle();
      leadStatus = (data as { status: string } | null)?.status ?? null;
    }
    const match = conditionsMatch(conditions, rule.trigger_event, { leadStatus, payload: event.payload ?? {} });
    if (!match.ok) {
      await recordRun({ ...base, actionIndex: -1, actionType: null, operation: null, status: "SKIPPED", reasonCode: "CONDITIONS", reason: match.reason });
      return { ruleId: rule.id, fired: false, failed: 0 };
    }
    if (!done.has(0)) {
      const frequency = ((RULE_FREQUENCIES as readonly string[]).includes(rule.frequency) ? rule.frequency : "ONCE_PER_DAY") as RuleFrequency;
      const allowed = frequencyAllows(frequency, await previousFires(rule, refs.leadId, event.id), new Date());
      if (!allowed.ok) {
        await recordRun({ ...base, actionIndex: -1, actionType: null, operation: null, status: "SKIPPED", reasonCode: "FREQUENCY", reason: allowed.reason });
        return { ruleId: rule.id, fired: false, failed: 0 };
      }
    }
  }

  // Re-read per rule run: the enabler's role, the deal and the lead as they are now.
  const role = await authorRole(event.business_id, rule.enabled_by);
  const opportunity = await resolveOpportunity(event.business_id, { opportunityId: refs.opportunityId, leadId: refs.leadId });
  // Actions on "the deal" act on an OPEN deal only; quote actions use the quote.
  const refsNow: RuleSubjectRefs = { ...refs, opportunityId: opportunity && opportunity.outcome === "OPEN" ? opportunity.id : null };
  const [{ map }, motion] = await Promise.all([
    loadSemanticMap(event.business_id),
    opportunity?.motion ? Promise.resolve(opportunity.motion) : loadWorkspaceMotion(event.business_id),
  ]);
  let firstName = "";
  if (refs.leadId) {
    const { data } = await db().from("leads").select("first_name").eq("business_id", event.business_id).eq("id", refs.leadId).maybeSingle();
    firstName = (data as { first_name: string | null } | null)?.first_name ?? "";
  }

  let failed = 0;
  for (let index = input.fromIndex; index < actions.length; index += 1) {
    const action = actions[index];
    const meta = ACTION_META[action.type];
    const previous = done.get(index);
    if (previous === "SUCCEEDED" || previous === "SKIPPED") continue;
    // A SCHEDULED action waits for its own continuation; only that runs it.
    if (previous === "SCHEDULED" && input.fromIndex !== index) break;

    const idempotencyKey = `automation:${rule.id}:${event.id}:${index}`;
    const checkoutLinks =
      action.type === "send_payment_link"
        ? await Promise.all(
            workspace.rawCheckoutLinks
              .filter((link) => link.id === action.checkoutLinkId)
              .map(async (link) => {
                const tracked = await trackCheckoutLink({ sendKey: idempotencyKey, link: link as never });
                return { id: link.id, url: tracked.tracked_url, label: link.label, priceText: link.price_text };
              }),
          )
        : [];
    const gate: ActionGate = {
      ...workspace,
      authorRole: role,
      standingConfirmation: rule.acknowledge_external,
      checkoutLinks,
      mergeValues: {
        first_name: firstName,
        business_name: workspace.businessName,
        booking_link: workspace.bookingLink ?? "",
        business_phone: workspace.businessPhone ?? "",
      },
      stageFor: stagesForDeal(map, motion, opportunity),
    };
    const plan = planAction(action, refsNow, gate);

    if (plan.kind === "SKIP") {
      await recordRun({ ...base, actionIndex: index, actionType: action.type, operation: meta.operation, status: "SKIPPED", reasonCode: plan.code, reason: plan.reason });
      continue;
    }

    if (plan.delayMinutes > 0 && input.fromIndex !== index) {
      const runAt = new Date(Date.now() + plan.delayMinutes * 60_000);
      await recordRun({ ...base, actionIndex: index, actionType: action.type, operation: meta.operation, status: "SCHEDULED", reason: `Waiting ${plan.delayMinutes} minutes; everything is re-checked then.`, runAt: runAt.toISOString() });
      const { enqueue } = await import("@/lib/jobs/queue");
      await enqueue(
        "automation.dispatch",
        { eventId: event.id, resume: { ruleId: rule.id, fromIndex: index } },
        { businessId: event.business_id, runAt, idempotencyKey: `automation.dispatch:${event.id}:${rule.id}:${index}` },
      );
      break;
    }

    const result = await runOperation<Record<string, unknown>>(plan.operation, plan.args, {
      businessId: event.business_id,
      userId: rule.enabled_by,
      role: role ?? "viewer",
      caller: "AUTOMATION",
      confirmed: plan.confirmed,
      confirmationSource: plan.confirmed ? "standing_permission" : undefined,
      correlationId: randomUUID(),
      idempotencyKey,
    });

    if (result.success) {
      await recordRun({ ...base, actionIndex: index, actionType: action.type, operation: plan.operation, status: "SUCCEEDED", entityId: result.entityId, auditEventId: result.auditEventId, reason: result.warnings[0]?.message ?? null });
      if (action.type === "send_payment_link" && refs.leadId && checkoutLinks[0]) {
        const link = workspace.rawCheckoutLinks.find((l) => l.id === action.checkoutLinkId);
        if (link) {
          await recordCheckoutAttempt({
            businessId: event.business_id,
            leadId: refs.leadId,
            link: { ...(link as never as object), tracked_url: checkoutLinks[0].url } as never,
            channel: action.channel,
            sendKey: idempotencyKey,
            messageId: str(result.data?.messageId),
            agentRunId: null,
            opportunityId: refsNow.opportunityId,
          });
        }
      }
      continue;
    }

    const status = outcomeFromRefusal(result.code);
    await recordRun({ ...base, actionIndex: index, actionType: action.type, operation: plan.operation, status, reasonCode: result.code, reason: result.message });
    if (status === "FAILED") failed += 1;
  }

  return { ruleId: rule.id, fired: true, failed };
}

/* ------------------------------------------------------------------ the job */

export async function handleAutomationDispatch(job: ClaimedJob): Promise<void> {
  const payload = dispatchPayload.parse(job.payload);
  const { data } = await db()
    .from("automation_events")
    .select("id, business_id, lead_id, event_type, payload, occurred_at")
    .eq("id", payload.eventId)
    .maybeSingle();
  const event = data as EventRow | null;
  if (!event) return;

  const refs = await resolveRefs(event);

  if (!payload.resume) {
    await applyPipeline(event, refs);
    await deriveReactivationSuccess(event, refs);
  }

  let query = db()
    .from("automation_rules")
    .select("id, business_id, name, trigger_event, conditions, actions, frequency, enabled, acknowledge_external, enabled_by")
    .eq("business_id", event.business_id)
    .eq("trigger_event", event.event_type)
    .eq("enabled", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (payload.resume) query = query.eq("id", payload.resume.ruleId);
  const { data: rules, error } = await query;
  // 0163 not applied: no rules exist yet.
  if (error || !rules || rules.length === 0) return;

  const workspace = await workspaceGate(event.business_id);
  let failed = 0;
  for (const rule of rules as RuleRow[]) {
    try {
      const outcome = await runRule({ rule, event, refs, workspace, fromIndex: payload.resume?.fromIndex ?? 0 });
      failed += outcome.failed;
    } catch (error) {
      failed += 1;
      console.error("[automation] rule run threw", { ruleId: rule.id, eventId: event.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // A retryable failure (a provider or the database) re-runs the job; every
  // action that already SUCCEEDED or was SKIPPED is left alone.
  if (failed > 0) throw new Error(`${failed} automation action(s) failed and will be retried`);
}
