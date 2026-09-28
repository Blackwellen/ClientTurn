import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import { ruleInputSchema, TAG_PATTERN, type RuleInput } from "@/lib/automation/rules";
import {
  DEFAULT_SEMANTIC_MAP,
  changedFromDefault,
  semanticMapSchema,
  type SemanticMap,
} from "@/lib/opportunities/pipeline-semantics";
import { loadSemanticMap } from "@/lib/opportunities/pipeline-apply";

/**
 * Automation rules (gap map §45), the pipeline mapping (§46), and the two
 * small operations rules need that did not exist: tagging a lead and
 * notifying the team. Rules are stored here and run by
 * lib/automation/rule-runner.ts.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const PENDING = "Automation rules need a database update that has not been applied yet (migration 0163).";

/** The table is missing until 0163 is applied (Postgres 42P01, PostgREST PGRST205). */
function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205"));
}

/* ------------------------------------------------------------ rules */

export type RuleRunView = {
  id: string;
  eventId: string;
  actionIndex: number;
  actionType: string | null;
  status: string;
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
};

export type RuleView = {
  id: string;
  name: string;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  frequency: string;
  enabled: boolean;
  acknowledgeExternal: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
  updatedAt: string;
  recentRuns: RuleRunView[];
};

defineOperation("automation_rule.list", {
  schema: z.object({}).default({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const { data, error } = await db()
      .from("automation_rules")
      .select("id, name, trigger_event, conditions, actions, frequency, enabled, acknowledge_external, enabled_by, enabled_at, updated_at")
      .eq("business_id", context.businessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) {
      if (isMissingTable(error)) return { data: { rules: [] as RuleView[], pendingMigration: true }, entityId: null };
      throw new ServiceError("UNAVAILABLE", "Automation rules could not be read.");
    }
    const rows = (data ?? []) as {
      id: string; name: string; trigger_event: string; conditions: unknown; actions: unknown; frequency: string;
      enabled: boolean; acknowledge_external: boolean; enabled_by: string | null; enabled_at: string | null; updated_at: string;
    }[];
    const runs = new Map<string, RuleRunView[]>();
    if (rows.length > 0) {
      const { data: runRows } = await db()
        .from("automation_rule_runs")
        .select("id, rule_id, automation_event_id, action_index, action_type, status, reason_code, reason, created_at")
        .eq("business_id", context.businessId)
        .in("rule_id", rows.map((r) => r.id))
        .order("created_at", { ascending: false })
        .limit(300);
      for (const run of (runRows ?? []) as {
        id: string; rule_id: string; automation_event_id: string; action_index: number; action_type: string | null;
        status: string; reason_code: string | null; reason: string | null; created_at: string;
      }[]) {
        const list = runs.get(run.rule_id) ?? [];
        if (list.length < 12) {
          list.push({
            id: run.id,
            eventId: run.automation_event_id,
            actionIndex: run.action_index,
            actionType: run.action_type,
            status: run.status,
            reasonCode: run.reason_code,
            reason: run.reason,
            createdAt: run.created_at,
          });
        }
        runs.set(run.rule_id, list);
      }
    }
    const rules: RuleView[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      trigger: row.trigger_event,
      conditions: row.conditions,
      actions: row.actions,
      frequency: row.frequency,
      enabled: row.enabled,
      acknowledgeExternal: row.acknowledge_external,
      enabledBy: row.enabled_by,
      enabledAt: row.enabled_at,
      updatedAt: row.updated_at,
      recentRuns: runs.get(row.id) ?? [],
    }));
    return { data: { rules, pendingMigration: false }, entityId: null };
  },
});

defineOperation("automation_rule.save", {
  schema: ruleInputSchema,
  async run({ args, context }: HandlerInput<RuleInput>) {
    const now = new Date().toISOString();
    const values = {
      name: args.name,
      trigger_event: args.trigger,
      conditions: args.conditions,
      actions: args.actions,
      frequency: args.frequency,
      enabled: args.enabled,
      acknowledge_external: args.acknowledgeExternal,
      // Saving an enabled rule is the saver taking responsibility for it: the
      // rule acts on their authority, re-checked on every run.
      enabled_by: args.enabled ? context.userId : null,
      enabled_at: args.enabled ? now : null,
    };

    if (args.id) {
      const { data: before, error: readError } = await db()
        .from("automation_rules")
        .select("id, name, trigger_event, enabled, actions")
        .eq("business_id", context.businessId)
        .eq("id", args.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (isMissingTable(readError)) throw new ServiceError("UNAVAILABLE", PENDING);
      if (!before) throw new ServiceError("NOT_FOUND", "That rule could not be found.");
      const { error } = await db().from("automation_rules").update(values).eq("business_id", context.businessId).eq("id", args.id);
      if (error) throw new ServiceError("UNAVAILABLE", "The rule could not be saved.");
      return {
        data: { id: args.id, enabled: args.enabled },
        entityId: args.id,
        before: before as Record<string, unknown>,
        after: { name: args.name, trigger_event: args.trigger, enabled: args.enabled, actions: args.actions.map((a) => a.type) },
      };
    }

    const { data, error } = await db()
      .from("automation_rules")
      .insert({ ...values, business_id: context.businessId, created_by: context.userId })
      .select("id")
      .single();
    if (isMissingTable(error)) throw new ServiceError("UNAVAILABLE", PENDING);
    if (error || !data) throw new ServiceError("UNAVAILABLE", "The rule could not be saved.");
    const id = (data as { id: string }).id;
    return {
      data: { id, enabled: args.enabled },
      entityId: id,
      after: { name: args.name, trigger_event: args.trigger, enabled: args.enabled, actions: args.actions.map((a) => a.type) },
    };
  },
});

defineOperation("automation_rule.set_enabled", {
  schema: z.object({ ruleId: z.uuid(), enabled: z.boolean(), acknowledgeExternal: z.boolean().optional() }),
  async run({ args, context }: HandlerInput<{ ruleId: string; enabled: boolean; acknowledgeExternal?: boolean }>) {
    const { data: before, error: readError } = await db()
      .from("automation_rules")
      .select("id, trigger_event, actions, enabled, acknowledge_external, name, conditions, frequency")
      .eq("business_id", context.businessId)
      .eq("id", args.ruleId)
      .is("deleted_at", null)
      .maybeSingle();
    if (isMissingTable(readError)) throw new ServiceError("UNAVAILABLE", PENDING);
    if (!before) throw new ServiceError("NOT_FOUND", "That rule could not be found.");
    const row = before as { enabled: boolean; acknowledge_external: boolean; name: string; trigger_event: string; actions: unknown; conditions: unknown; frequency: string };
    const acknowledge = args.acknowledgeExternal ?? row.acknowledge_external;
    if (args.enabled) {
      // Turning on re-validates the whole rule, including the customer-contact acknowledgement.
      const check = ruleInputSchema.safeParse({
        name: row.name,
        trigger: row.trigger_event,
        conditions: row.conditions,
        actions: row.actions,
        frequency: row.frequency,
        enabled: true,
        acknowledgeExternal: acknowledge,
      });
      if (!check.success) throw new ServiceError("INVALID_INPUT", check.error.issues[0]?.message ?? "This rule cannot be turned on as it stands.");
    }
    const now = new Date().toISOString();
    const { error } = await db()
      .from("automation_rules")
      .update({
        enabled: args.enabled,
        acknowledge_external: acknowledge,
        enabled_by: args.enabled ? context.userId : null,
        enabled_at: args.enabled ? now : null,
      })
      .eq("business_id", context.businessId)
      .eq("id", args.ruleId);
    if (error) throw new ServiceError("UNAVAILABLE", "The rule could not be changed.");
    return { data: { id: args.ruleId, enabled: args.enabled }, entityId: args.ruleId, before: { enabled: row.enabled }, after: { enabled: args.enabled } };
  },
});

defineOperation("automation_rule.delete", {
  schema: z.object({ ruleId: z.uuid() }),
  async run({ args, context }: HandlerInput<{ ruleId: string }>) {
    const { data, error } = await db()
      .from("automation_rules")
      .update({ deleted_at: new Date().toISOString(), enabled: false, enabled_by: null, enabled_at: null })
      .eq("business_id", context.businessId)
      .eq("id", args.ruleId)
      .is("deleted_at", null)
      .select("id, name")
      .maybeSingle();
    if (isMissingTable(error)) throw new ServiceError("UNAVAILABLE", PENDING);
    if (!data) throw new ServiceError("NOT_FOUND", "That rule could not be found.");
    return { data: { id: args.ruleId }, entityId: args.ruleId, before: data as Record<string, unknown> };
  },
});

/* ------------------------------------------------------------ tags */

defineOperation("lead.add_tag", {
  schema: z.object({
    leadId: z.uuid(),
    tag: z.string().trim().toUpperCase().regex(TAG_PATTERN, "Capital letters and underscores, 2-50 characters"),
    reason: z.string().trim().min(3).max(200).default("Added by a team member"),
  }),
  async run({ args, context }: HandlerInput<{ leadId: string; tag: string; reason: string }>) {
    const { data: lead } = await db()
      .from("leads")
      .select("id, anonymised_at")
      .eq("business_id", context.businessId)
      .eq("id", args.leadId)
      .maybeSingle();
    if (!lead) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
    if ((lead as { anonymised_at: string | null }).anonymised_at) throw new ServiceError("CONFLICT", "That lead has been anonymised.");
    const { error } = await db().from("lead_tags").insert({
      business_id: context.businessId,
      lead_id: args.leadId,
      tag: args.tag,
      reason: args.reason,
      confidence: 1,
      source_event: context.caller === "AUTOMATION" ? "automation_rule" : `manual:${context.caller.toLowerCase()}`,
      rule_version: "custom-1",
    });
    // 23505: the tag is already active on the lead.
    if (error?.code === "23505") {
      return { data: { tag: args.tag, added: false }, entityId: args.leadId, warnings: [{ code: "no_change", message: `The lead already has the ${args.tag} tag.` }] };
    }
    if (error) throw new ServiceError("UNAVAILABLE", "The tag could not be added.");
    return { data: { tag: args.tag, added: true }, entityId: args.leadId, after: { tag: args.tag } };
  },
});

/* ------------------------------------------------------------ notify */

defineOperation("team.notify", {
  schema: z.object({
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().max(500).default(""),
    leadId: z.uuid().nullable().default(null),
  }),
  async run({ args, context }: HandlerInput<{ title: string; body: string; leadId: string | null }>) {
    const { queueNotification } = await import("@/lib/jobs/handlers/shared");
    await queueNotification({
      businessId: context.businessId,
      type: args.leadId ? "lead_attention" : "usage_limit",
      severity: "info",
      title: args.title,
      body: args.body || undefined,
      linkUrl: args.leadId ? `/app/leads/${args.leadId}` : "/app/follow-up?tab=rules",
      ...(args.leadId ? { entityType: "lead", entityId: args.leadId } : {}),
      dedupeKey: context.idempotencyKey ? `team.notify:${context.idempotencyKey}` : undefined,
    });
    return { data: { queued: true }, entityId: null, after: { title: args.title } };
  },
});

/* ------------------------------------------------------------ pipeline */

defineOperation("pipeline.get_mapping", {
  schema: z.object({}).default({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const { map, stored } = await loadSemanticMap(context.businessId);
    return { data: { mapping: map, defaults: DEFAULT_SEMANTIC_MAP, stored, changed: changedFromDefault(map) }, entityId: null };
  },
});

defineOperation("pipeline.set_mapping", {
  schema: z.object({ mapping: semanticMapSchema }),
  async run({ args, context }: HandlerInput<{ mapping: SemanticMap }>) {
    const { map: before } = await loadSemanticMap(context.businessId);
    const { error } = await db()
      .from("pipeline_stage_maps")
      .upsert(
        { business_id: context.businessId, mapping: args.mapping, updated_by: context.userId, updated_at: new Date().toISOString() },
        { onConflict: "business_id" },
      );
    if (isMissingTable(error)) throw new ServiceError("UNAVAILABLE", "The pipeline mapping needs a database update that has not been applied yet (migration 0163). The defaults are in use.");
    if (error) throw new ServiceError("UNAVAILABLE", "The mapping could not be saved.");
    return {
      data: { mapping: args.mapping, changed: changedFromDefault(args.mapping) },
      entityId: null,
      before: before as unknown as Record<string, unknown>,
      after: args.mapping as unknown as Record<string, unknown>,
    };
  },
});
