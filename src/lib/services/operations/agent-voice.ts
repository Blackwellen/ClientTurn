import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { recordAudit } from "@/lib/audit";
import { parseAiAuthority } from "@/lib/commercial/ai-permissions";
import {
  CALL_APPROVAL_ITEM,
  CALL_APPROVAL_OPEN_STATUSES,
  routeForApproval,
  AGENT_VOICE_DEFAULT_DAILY_CAP,
  AGENT_VOICE_MAX_DAILY_CAP,
  agentCallingScope,
} from "@/lib/agents/voice-calls";
import { workspaceAiMayCall, workspaceVoiceStatus } from "@/lib/agents/voice-calls-guard";
import { defineOperation, runOperation, ServiceError, type HandlerInput } from "../runtime";
import { closingVerdict } from "@/lib/agents/closing-rules";
import type { GoalKey } from "@/lib/qualification-intelligence/types";

/**
 * "Phone leads with AI" on an agent (0176), and the one explicit way to turn
 * the workspace's "Phone leads" permission on from the agent screens.
 *
 * The two are deliberately separate operations. Switching an agent's calls on
 * never touches what the AI may do: if "Phone leads" is off the agent is
 * saved with calls on, the result says it will not call yet, and the screen
 * offers the second operation, which only a person in the app can run and
 * which is audited with the before and after.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/* ------------------------------------------------------ agent.set_voice_calls */

const setVoiceCallsSchema = z.object({
  agentId: z.uuid(),
  enabled: z.boolean(),
  dailyCallCap: z.number().int().min(1).max(AGENT_VOICE_MAX_DAILY_CAP).optional(),
});
type SetVoiceCallsArgs = z.infer<typeof setVoiceCallsSchema>;

type AgentVoiceRow = {
  id: string;
  name: string;
  agent_type: string;
  status: string;
  voice_calls_enabled: boolean;
  voice_daily_call_cap: number;
};

defineOperation("agent.set_voice_calls", {
  schema: setVoiceCallsSchema,
  async run({ args, context }: HandlerInput<SetVoiceCallsArgs>) {
    const read = await db()
      .from("agents")
      .select("id, name, agent_type, status, voice_calls_enabled, voice_daily_call_cap")
      .eq("business_id", context.businessId)
      .eq("id", args.agentId)
      .maybeSingle();
    if (read.error) {
      if (isSchemaLag(read.error)) {
        throw new ServiceError("UNAVAILABLE", "AI calling from agents needs database update 0176 before it can be switched on. Nothing was changed.");
      }
      throw new ServiceError("UNAVAILABLE", "That agent could not be read.");
    }
    const before = read.data as AgentVoiceRow | null;
    if (!before) throw new ServiceError("NOT_FOUND", "That agent could not be found.");

    const dailyCallCap = args.dailyCallCap ?? before.voice_daily_call_cap ?? AGENT_VOICE_DEFAULT_DAILY_CAP;

    if (args.enabled) {
      const scope = agentCallingScope(before.agent_type);
      if (!scope.applies) throw new ServiceError("POLICY_BLOCKED", scope.reason);
      // Entitlement, server-side: a workspace that cannot place a call cannot
      // switch an agent's calls on (switching off is always allowed).
      const voice = await workspaceVoiceStatus(context.businessId);
      if (!voice.usable) {
        throw new ServiceError(
          voice.locked ? "PLAN_LIMIT" : "POLICY_BLOCKED",
          voice.reason ?? "Voice isn't ready on this workspace yet. Check Settings, Voice.",
          [{ code: voice.locked ? "plan-limit-reached" : "integration-required", message: voice.reason ?? "VOICE_NOT_READY" }],
        );
      }
    }

    const { error } = await db()
      .from("agents")
      .update({ voice_calls_enabled: args.enabled, voice_daily_call_cap: dailyCallCap })
      .eq("business_id", context.businessId)
      .eq("id", before.id);
    if (error) throw new ServiceError("CONFLICT", "The agent's call settings could not be saved.");

    await db()
      .from("agent_activity_events")
      .insert({
        business_id: context.businessId,
        agent_id: before.id,
        actor_user_id: context.userId,
        event_type: "UPDATED",
        severity: "INFO",
        title: args.enabled ? "AI phone calls switched on" : "AI phone calls switched off",
        detail: args.enabled ? `Up to ${dailyCallCap} calls a day. Changed via ${context.caller}.` : `Changed via ${context.caller}.`,
      })
      .then(
        () => undefined,
        () => undefined,
      );

    // Never widened here: say so, so the caller reports something true.
    const aiMayCall = args.enabled ? await workspaceAiMayCall(context.businessId).catch(() => false) : true;
    const warnings = [
      ...(args.enabled && !aiMayCall
        ? [
            {
              code: "call_permission_off",
              message:
                "Saved, but the agent won't call yet: Phone leads is off in What the AI may do. An owner or admin must allow it.",
            },
          ]
        : []),
      ...(args.enabled && before.status !== "ACTIVE"
        ? [{ code: "agent_not_running", message: "The agent isn't running. It starts asking for calls once you start it." }]
        : []),
    ];

    return {
      data: { agentId: before.id, voiceCallsEnabled: args.enabled, dailyCallCap, aiMayCall },
      entityId: before.id,
      before: { voiceCallsEnabled: before.voice_calls_enabled, dailyCallCap: before.voice_daily_call_cap },
      after: { voiceCallsEnabled: args.enabled, dailyCallCap },
      warnings,
    };
  },
});

/* ---------------------------------------------------- ai_settings.allow_calls */

defineOperation("ai_settings.allow_calls", {
  schema: z.object({ acknowledge: z.literal(true) }),
  async run({ context }: HandlerInput<{ acknowledge: true }>) {
    if (context.caller !== "UI" || !context.userId) {
      throw new ServiceError("FORBIDDEN_SCOPE", "Only an owner or admin in the app can allow the AI to phone leads.");
    }
    const read = await db().from("commercial_authority").select("*").eq("business_id", context.businessId).maybeSingle();
    if (read.error) throw new ServiceError("UNAVAILABLE", "What the AI may do could not be read. Nothing was changed.");
    const row = read.data as { ai_permissions?: unknown; ai_discount_policy?: unknown } | null;
    const current = parseAiAuthority(row?.ai_permissions ?? null, row?.ai_discount_policy ?? null);
    if (current.capabilities.call) {
      return { data: { changed: false }, entityId: context.businessId, before: { call: true }, after: { call: true } };
    }
    // Only "call" changes; every other switch is written back as it was.
    const capabilities = { ...current.capabilities, call: true };
    const { error } = await db()
      .from("commercial_authority")
      .upsert(
        { business_id: context.businessId, ai_permissions: capabilities, ai_discount_policy: current.discount, updated_by: context.userId },
        { onConflict: "business_id" },
      );
    if (error) {
      if (isSchemaLag(error)) throw new ServiceError("UNAVAILABLE", "This needs database update 0160 before it can be saved. Nothing was changed.");
      throw new ServiceError("UNAVAILABLE", "What the AI may do could not be saved.");
    }
    // The same audit row the settings card writes, so the history reads alike.
    await recordAudit({
      businessId: context.businessId,
      actorUserId: context.userId,
      action: "commercial_authority.ai_updated",
      entityType: "business",
      entityId: context.businessId,
      metadata: {
        before: { capabilities: current.capabilities },
        after: { capabilities },
        via: "agent_voice_calls",
      },
    });
    return { data: { changed: true }, entityId: context.businessId, before: { call: false }, after: { call: true } };
  },
});

/* ------------------------------------------------------- agent.decide_call */

const decideCallSchema = z.object({
  itemId: z.uuid(),
  decision: z.enum(["APPROVE", "DECLINE"]),
});
type DecideCallArgs = z.infer<typeof decideCallSchema>;

/**
 * A person approves or declines the call a review-level agent asked for
 * (owner decision 2026-09-28: an agent on a review level never dials on its
 * own). Approving asks `voice.request_call` AS THE AGENT, so the agent's own
 * checks (running, option on, "Phone leads" permission, daily cap) and every
 * calling check still apply; it is never a person's own call, so the
 * human-takeover hold stays. The route is worked out now, from where the lead
 * is today. The item is claimed first, so two people approving call once.
 */
defineOperation("agent.decide_call", {
  schema: decideCallSchema,
  async run({ args, context }: HandlerInput<DecideCallArgs>) {
    if (context.caller !== "UI" || !context.userId) {
      throw new ServiceError("FORBIDDEN_SCOPE", "Only a person in the app can approve an agent's call.");
    }
    const now = new Date().toISOString();
    const claim = await db()
      .from("agent_queue_items")
      .update({ status: "IN_PROGRESS", started_at: now })
      .eq("business_id", context.businessId)
      .eq("id", args.itemId)
      .eq("item_type", CALL_APPROVAL_ITEM.itemType)
      .eq("subject_type", CALL_APPROVAL_ITEM.subjectType)
      .in("status", [...CALL_APPROVAL_OPEN_STATUSES])
      .select("id, agent_id, subject_id, subject_label")
      .maybeSingle();
    if (claim.error) throw new ServiceError("UNAVAILABLE", "That call request could not be read.");
    const item = claim.data as { id: string; agent_id: string; subject_id: string | null; subject_label: string | null } | null;
    if (!item || !item.subject_id) throw new ServiceError("CONFLICT", "That call is no longer waiting for a decision.");

    const settle = (patch: Record<string, unknown>) =>
      db().from("agent_queue_items").update({ completed_at: new Date().toISOString(), ...patch }).eq("business_id", context.businessId).eq("id", item.id);
    const activity = (title: string, detail: string, severity: "INFO" | "SUCCESS" | "WARNING", callId?: string | null) =>
      db()
        .from("agent_activity_events")
        .insert({
          business_id: context.businessId,
          agent_id: item.agent_id,
          actor_user_id: context.userId,
          event_type: "VOICE_CALL_DECIDED",
          severity,
          title,
          detail,
          subject_type: callId ? "voice_call" : "lead",
          subject_id: callId ?? item.subject_id,
        })
        .then(
          () => undefined,
          () => undefined,
        );
    const label = item.subject_label ?? "Call with AI";

    if (args.decision === "DECLINE") {
      await settle({ status: "CANCELLED", blocked_reason: null });
      await activity(`Declined: ${label}`, "A person declined the call. The lead is left to your normal follow-up.", "INFO");
      return { data: { decision: "DECLINE", callId: null as string | null, deferredReason: null as string | null }, entityId: item.agent_id, before: { status: "WAITING" }, after: { status: "CANCELLED", lead_id: item.subject_id } };
    }

    const route = routeForApproval(await approvalRouteFacts(context.businessId, item.subject_id));
    if (!route) {
      await settle({ status: "SKIPPED", blocked_reason: null, error_message: "The lead no longer needs this call." });
      await activity(`Not called: ${label}`, "The lead has reached its goal or was disqualified since the call was asked for.", "INFO");
      throw new ServiceError("POLICY_BLOCKED", "This lead no longer needs this call: it has reached its goal or was disqualified.");
    }

    const result = await runOperation<{ callId: string; deferredReason: string | null }>(
      "voice.request_call",
      { leadId: item.subject_id, route, agentId: item.agent_id },
      {
        businessId: context.businessId,
        // The agent's call, approved by a person: never a person's own call.
        userId: null,
        role: "member",
        caller: "AGENT",
        confirmed: true,
        confirmationSource: "person",
        correlationId: context.correlationId,
        idempotencyKey: `agent-call-approval:${item.id}`,
      },
    );
    if (!result.success) {
      await settle({ status: "FAILED", blocked_reason: null, error_message: result.message.slice(0, 500) });
      await activity(`Couldn't call: ${label}`, result.message, "WARNING");
      throw new ServiceError(result.code, result.message);
    }
    await settle({ status: "DONE", blocked_reason: null });
    await activity(`Approved: ${label}`, "A person approved the call. It is queued and re-checked just before it dials.", "SUCCESS", result.data.callId);
    return {
      data: { decision: "APPROVE", callId: result.data.callId, deferredReason: result.data.deferredReason },
      entityId: item.agent_id,
      before: { status: "WAITING" },
      after: { status: "DONE", lead_id: item.subject_id, route, call_id: result.data.callId },
    };
  },
});

/** Where the lead is now, for the approved call's route. */
async function approvalRouteFacts(businessId: string, leadId: string): Promise<{ qualificationState: string | null; stalledGoal: GoalKey | null }> {
  const lead = await db().from("leads").select("qualification_state, booked_at").eq("business_id", businessId).eq("id", leadId).maybeSingle();
  if (lead.error || !lead.data) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  const row = lead.data as { qualification_state: string | null; booked_at: string | null };
  if (row.qualification_state !== "QUALIFIED") return { qualificationState: row.qualification_state, stalledGoal: null };
  const opps = await db().from("opportunities").select("goal").eq("business_id", businessId).eq("lead_id", leadId).eq("outcome", "OPEN");
  const verdict = closingVerdict({
    booked: Boolean(row.booked_at),
    openGoals: ((opps.data ?? []) as { goal: GoalKey | null }[]).map((o) => o.goal),
    checkoutInFlight: false,
    quoteInFlight: false,
  });
  return { qualificationState: row.qualification_state, stalledGoal: verdict.stalled ? verdict.goal : null };
}
