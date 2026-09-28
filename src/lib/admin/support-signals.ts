import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { countOpenPaymentReviews } from "@/lib/invoicing/payment-review-store";
import { REVIEW_KIND_LABEL, type ReviewKind } from "@/lib/invoicing/payment-review";
import { adminRead, unique } from "./shared";
import { requirePlatformAdmin } from "./guard";
import {
  linkedInSentCounts,
  memberPermissionRow,
  type CommercialRuleSignals,
  type LinkedInAssistSignals,
  type MemberPermissionRow,
  type PaymentReviewSignals,
  type SignalLoad,
  type SupportSignals,
} from "./support-signals-types";

/**
 * Admin -> Customers -> support drawer: read-only support signals for one
 * workspace. Platform admin only (`adminRead` checks profiles.platform_role
 * server-side). Opening it reads a tenant's team and settings, so the read is
 * itself audited as `admin.support_view`, like opening a support ticket.
 *
 * Each block loads on its own and degrades on its own: a migration that is
 * not applied shows "not installed", an error shows "unavailable", and the
 * rest of the drawer still renders. No secret, token, message body or drafted
 * text is ever selected.
 */

export * from "./support-signals-types";

function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

async function members(db: SupabaseClient, businessId: string): Promise<SignalLoad<MemberPermissionRow[]>> {
  const { data, error } = await db
    .from("business_members")
    .select("id, user_id, role, status, can_send_outbound, can_manage_integrations, can_manage_billing")
    .eq("business_id", businessId)
    .neq("status", "removed")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    return isSchemaLag(error)
      ? { state: "not_installed", note: "Per-person permissions need migration 0172." }
      : { state: "error" };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = unique(rows.map((row) => row.user_id as string));
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, email, first_name, last_name").in("id", ids)
    : { data: [] };
  const byId = new Map(((profiles ?? []) as { id: string; email: string | null; first_name: string | null; last_name: string | null }[]).map((p) => [p.id, p]));
  return {
    state: "ok",
    data: rows.map((row) => {
      const profile = byId.get(row.user_id as string);
      return memberPermissionRow({
        memberId: String(row.id),
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Pending invite",
        email: profile?.email ?? "—",
        role: String(row.role),
        status: String(row.status),
        row,
      });
    }),
  };
}

async function linkedIn(db: SupabaseClient, businessId: string, now: Date): Promise<SignalLoad<LinkedInAssistSignals>> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [settings, contacts, open, sent, hold] = await Promise.all([
    db.from("linkedin_assist_settings").select("paused").eq("business_id", businessId).limit(500),
    db
      .from("linkedin_assist_contacts")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("state", ["NOT_STARTED", "INVITED", "MESSAGED", "REPLIED"]),
    db.from("linkedin_assist_tasks").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "OPEN"),
    db
      .from("linkedin_assist_tasks")
      .select("kind, completed_at")
      .eq("business_id", businessId)
      .eq("status", "SENT")
      .gte("completed_at", since)
      .limit(5000),
    db.from("linkedin_assist_workspace_holds").select("reason, held_at").eq("business_id", businessId).maybeSingle(),
  ]);
  const first = settings.error ?? contacts.error ?? open.error ?? sent.error;
  if (first) {
    return isSchemaLag(first)
      ? { state: "not_installed", note: "LinkedIn Assist needs migration 0171." }
      : { state: "error" };
  }
  if (hold.error && !isSchemaLag(hold.error)) return { state: "error" };
  const people = (settings.data ?? []) as { paused: boolean }[];
  const holdRow = hold.error ? null : (hold.data as { reason: string; held_at: string } | null);
  return {
    state: "ok",
    data: {
      hold: holdRow ? { reason: holdRow.reason, heldAt: holdRow.held_at } : null,
      holdAvailable: !hold.error,
      people: people.length,
      pausedPeople: people.filter((p) => p.paused).length,
      activeContacts: contacts.count ?? 0,
      openTasks: open.count ?? 0,
      ...linkedInSentCounts((sent.data ?? []) as { kind: string; completed_at: string | null }[], now),
    },
  };
}

async function paymentReviews(businessId: string): Promise<SignalLoad<PaymentReviewSignals>> {
  const result = await countOpenPaymentReviews(businessId);
  if (result.state === "not_installed") return { state: "not_installed", note: "The payment review queue needs migration 0175." };
  if (result.state === "error") return { state: "error" };
  return {
    state: "ok",
    data: {
      total: result.data.total,
      byKind: Object.entries(result.data.byKind)
        .map(([kind, count]) => ({ kind, label: REVIEW_KIND_LABEL[kind as ReviewKind] ?? kind, count: count ?? 0 }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

async function commercial(db: SupabaseClient, businessId: string): Promise<SignalLoad<CommercialRuleSignals>> {
  const [competitors, agents] = await Promise.all([
    db.from("workspace_competitors").select("enabled").eq("business_id", businessId).limit(500),
    db.from("agents").select("offer_scope").eq("business_id", businessId).limit(500),
  ]);
  const first = competitors.error ?? agents.error;
  if (first) {
    return isSchemaLag(first)
      ? { state: "not_installed", note: "Commercial rules need migration 0174." }
      : { state: "error" };
  }
  const rows = (competitors.data ?? []) as { enabled: boolean }[];
  const agentRows = (agents.data ?? []) as { offer_scope: string }[];
  return {
    state: "ok",
    data: {
      competitors: rows.length,
      enabledCompetitors: rows.filter((row) => row.enabled).length,
      agents: agentRows.length,
      agentsWithSelectedOffers: agentRows.filter((row) => row.offer_scope === "SELECTED").length,
    },
  };
}

function settle<T>(result: PromiseSettledResult<SignalLoad<T>>): SignalLoad<T> {
  return result.status === "fulfilled" ? result.value : { state: "error" };
}

export async function getCustomerSupportSignals(businessId: string, now = new Date()): Promise<SupportSignals> {
  const operator = await requirePlatformAdmin();
  const db = untyped(await adminRead());

  // A privileged read of a tenant's team and settings: recorded as one.
  await recordAudit({
    businessId,
    actorUserId: operator.id,
    actorType: "platform_admin",
    action: "admin.support_view",
    entityType: "business",
    entityId: businessId,
    metadata: { surface: "customer_support_signals" },
  });

  const [m, l, p, c] = await Promise.allSettled([
    members(db, businessId),
    linkedIn(db, businessId, now),
    paymentReviews(businessId),
    commercial(db, businessId),
  ]);
  return { members: settle(m), linkedIn: settle(l), paymentReviews: settle(p), commercial: settle(c) };
}
