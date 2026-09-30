import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation } from "@/lib/services";
import { getEntitlements } from "@/lib/billing/entitlements";
import { explainLead, type LeadWhy } from "./model";

/**
 * The lead page's "Why hasn't anything happened?": the facts for one lead,
 * explained by `explainLead` (./model.ts) with the send guard's own stop rule
 * and the policy engine's per-channel verdicts.
 *
 * Called after `requireWorkspace()` for a lead the page has already loaded in
 * that workspace; every read below is filtered by `business_id` as well.
 * Reading it records nothing: `lead.contactability` evaluates permission only.
 */
export async function loadLeadWhy(
  viewer: { businessId: string; userId: string; role: "owner" | "admin" | "member" | "viewer" },
  leadId: string,
  now = new Date(),
): Promise<LeadWhy | null> {
  const db = createAdminClient();
  const { businessId } = viewer;

  const [lead, business, settings, ai, entitlements, runs, lastOut, lastIn, failed, calls, contactability] = await Promise.all([
    db
      .from("leads")
      .select("status, opted_out, human_takeover, automation_active, first_replied_at, archived_at, anonymised_at")
      .eq("business_id", businessId)
      .eq("id", leadId)
      .maybeSingle(),
    db.from("businesses").select("timezone").eq("id", businessId).maybeSingle(),
    db.from("business_settings").select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end, ai_assist_enabled").eq("business_id", businessId).maybeSingle(),
    db.from("business_ai_settings").select("agent_mode").eq("business_id", businessId).maybeSingle(),
    getEntitlements(businessId).catch(() => null),
    db
      .from("automation_runs")
      .select("state, next_run_at, stopped_reason, stopped_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("messages").select("created_at").eq("business_id", businessId).eq("lead_id", leadId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("messages").select("created_at").eq("business_id", businessId).eq("lead_id", leadId).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db
      .from("messages")
      .select("failed_at, channel, error_message")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("direction", "outbound")
      .not("failed_at", "is", null)
      .order("failed_at", { ascending: false })
      .limit(3),
    db
      .from("voice_calls")
      .select("created_at, state, eligibility_reasons, disconnection_reason")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .in("state", ["CANCELLED", "FAILED"])
      .order("created_at", { ascending: false })
      .limit(3),
    runOperation<{ channels: { channel: string; decision: string; reason: string }[] }>(
      "lead.contactability",
      { leadId },
      { businessId, userId: viewer.userId, role: viewer.role, caller: "UI", correlationId: randomUUID() },
    ).catch(() => null),
  ]);

  if (lead.error) throw new Error(lead.error.message);
  const row = lead.data;
  if (!row) return null;

  const timezone = (business.data as { timezone: string | null } | null)?.timezone || "Europe/London";
  const s = settings.data as { quiet_hours_enabled: boolean | null; quiet_hours_start: string | null; quiet_hours_end: string | null; ai_assist_enabled: boolean | null } | null;
  const aiOn = Boolean(s?.ai_assist_enabled) && Boolean(entitlements?.aiAssistAllowed);
  const mode = (["OFF", "SUGGEST_ONLY", "AUTO_REPLY"] as const).find((m) => m === (ai.data as { agent_mode?: string } | null)?.agent_mode) ?? "OFF";

  return explainLead(
    {
      lead: {
        status: row.status,
        optedOut: row.opted_out,
        humanTakeover: row.human_takeover,
        automationActive: row.automation_active,
        firstRepliedAt: row.first_replied_at,
        archived: Boolean(row.archived_at),
        anonymised: Boolean(row.anonymised_at),
      },
      // A billing read failure is not "billing paused": unknown is treated as allowed here,
      // and the send guard still checks it at the moment of sending.
      sendingAllowed: entitlements ? entitlements.sendingAllowed : true,
      quietHours: {
        enabled: s?.quiet_hours_enabled ?? true,
        start: (s?.quiet_hours_start ?? "20:00").slice(0, 5),
        end: (s?.quiet_hours_end ?? "08:00").slice(0, 5),
        timezone,
      },
      aiMode: entitlements ? (aiOn ? mode : "OFF") : "UNAVAILABLE",
      runs: (runs.data ?? []).map((r) => ({ state: r.state, nextRunAt: r.next_run_at, stoppedReason: r.stopped_reason, stoppedAt: r.stopped_at })),
      channels: contactability && contactability.success ? contactability.data.channels : null,
      lastOutboundAt: (lastOut.data as { created_at: string } | null)?.created_at ?? null,
      lastInboundAt: (lastIn.data as { created_at: string } | null)?.created_at ?? null,
      failedSends: ((failed.data ?? []) as { failed_at: string; channel: string; error_message: string | null }[]).map((m) => ({ at: m.failed_at, channel: m.channel, error: m.error_message })),
      failedCalls: ((calls.data ?? []) as { created_at: string; state: string; eligibility_reasons: string[] | null; disconnection_reason: string | null }[]).map((c) => ({
        at: c.created_at,
        state: c.state,
        reasons: c.eligibility_reasons ?? [],
        disconnection: c.disconnection_reason,
      })),
    },
    now,
  );
}
