import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { getEntitlements } from "@/lib/billing/entitlements";
import { runTask } from "@/lib/ai/model-router";
import type { SocialMessageResult } from "@/lib/ai/schemas";
import { enqueue } from "@/lib/jobs/queue";
import { socialAddress } from "@/lib/messaging/types";
import { composeDraft, type DraftBusiness, type DraftSubject } from "./compose";
import {
  linkedInThreadKey,
  settingsFromRow,
  type ChannelMoveLead,
  type LinkedInAssistSettings,
  type LinkedInContactState,
  type LinkedInStopReason,
  type LinkedInTaskKind,
  type LinkedInTaskStatus,
  type ScheduledTask,
} from "./types";

/**
 * LinkedIn Assist data access. Server-only; every query is scoped to the
 * business id it is given, and the callers (the service operations and the
 * `linkedin_assist.draft` job) have already established that the caller
 * belongs to it.
 */

// 0171 post-dates the generated types.
export function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type ContactRow = {
  id: string;
  business_id: string;
  owner_user_id: string;
  lead_id: string | null;
  prospect_id: string | null;
  profile_url: string;
  first_touch: "CONNECTION_NOTE" | "INMAIL";
  state: LinkedInContactState;
  stopped_reason: LinkedInStopReason | null;
  conversation_id: string | null;
  replied_at: string | null;
};

export type TaskRow = {
  id: string;
  business_id: string;
  contact_id: string;
  assignee_user_id: string;
  lead_id: string | null;
  prospect_id: string | null;
  kind: LinkedInTaskKind;
  step: number;
  status: LinkedInTaskStatus;
  due_on: string;
  snooze_count: number;
  body: string | null;
  body_source: "TEMPLATE" | "AI" | "AGENT" | "PERSON" | null;
  fallback_reason: string | null;
  draft_message_id: string | null;
  inbound_body: string | null;
  completed_at: string | null;
  created_at: string;
};

export const CONTACT_COLUMNS =
  "id, business_id, owner_user_id, lead_id, prospect_id, profile_url, first_touch, state, stopped_reason, conversation_id, replied_at";
export const TASK_COLUMNS =
  "id, business_id, contact_id, assignee_user_id, lead_id, prospect_id, kind, step, status, due_on, snooze_count, body, body_source, fallback_reason, draft_message_id, inbound_body, completed_at, created_at";

/* ================================================================ settings */

export type WorkspaceHold = { reason: string; heldAt: string };

/**
 * A platform admin's hold on this workspace's LinkedIn Assist (0175), or
 * null. Fails open to "not held" only when the table does not exist yet;
 * any other read error throws, so a hold is never silently ignored.
 */
export async function loadWorkspaceHold(businessId: string): Promise<WorkspaceHold | null> {
  const { data, error } = await db()
    .from("linkedin_assist_workspace_holds")
    .select("reason, held_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    if (isSchemaLag(error)) return null;
    throw error;
  }
  const row = data as { reason: string; held_at: string } | null;
  return row ? { reason: row.reason, heldAt: row.held_at } : null;
}

/**
 * A person's settings, with the workspace hold folded in: while a platform
 * admin holds the workspace, every list is paused (replies only), whatever
 * the person chose. `personPaused` is their own switch, for the settings form.
 */
export async function loadSettings(businessId: string, userId: string): Promise<{
  settings: LinkedInAssistSettings;
  configured: boolean;
  personPaused: boolean;
  workspaceHold: WorkspaceHold | null;
}> {
  const [{ data, error }, workspaceHold] = await Promise.all([
    db()
      .from("linkedin_assist_settings")
      .select("*")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
    loadWorkspaceHold(businessId),
  ]);
  if (error) throw error;
  const own = settingsFromRow(data);
  return {
    settings: workspaceHold ? { ...own, paused: true } : own,
    configured: Boolean(data),
    personPaused: own.paused,
    workspaceHold,
  };
}

/* ================================================================ subjects */

export type SubjectSnapshot = {
  name: string;
  subtitle: string | null;
  optedOut: boolean;
  leadStatus: string | null;
  draft: DraftSubject;
  moveLead: ChannelMoveLead | null;
  linkedinUrl: string | null;
};

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  email_origin: string | null;
  phone: string | null;
  phone_source: string | null;
  phone_type: string | null;
  opted_out: boolean;
  status: string;
  promoted_from_prospect_id: string | null;
  human_takeover: boolean;
};

type ProspectRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  outreach_eligibility: string;
  status: string;
  promoted_to_lead_id: string | null;
  prospect_companies: { name: string | null; industry: string | null } | null;
};

const LEAD_COLUMNS =
  "id, first_name, last_name, company_name, email, email_origin, phone, phone_source, phone_type, opted_out, status, promoted_from_prospect_id, human_takeover";
const PROSPECT_COLUMNS =
  "id, first_name, last_name, role_title, linkedin_url, outreach_eligibility, status, promoted_to_lead_id, prospect_companies ( name, industry )";

function fullName(first: string | null, last: string | null, fallback: string): string {
  return [first, last].filter(Boolean).join(" ").trim() || fallback;
}

export async function loadLeads(businessId: string, ids: string[]): Promise<Map<string, LeadRow>> {
  const map = new Map<string, LeadRow>();
  if (ids.length === 0) return map;
  const { data, error } = await db().from("leads").select(LEAD_COLUMNS).eq("business_id", businessId).in("id", ids);
  if (error) throw error;
  for (const row of (data ?? []) as LeadRow[]) map.set(row.id, row);
  return map;
}

export async function loadProspects(businessId: string, ids: string[]): Promise<Map<string, ProspectRow>> {
  const map = new Map<string, ProspectRow>();
  if (ids.length === 0) return map;
  const { data, error } = await db()
    .from("prospects")
    .select(PROSPECT_COLUMNS)
    .eq("business_id", businessId)
    .in("id", ids);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as ProspectRow[]) map.set(row.id, row);
  return map;
}

export function snapshotFrom(lead: LeadRow | undefined, prospect: ProspectRow | undefined): SubjectSnapshot | null {
  if (lead) {
    return {
      name: fullName(lead.first_name, lead.last_name, lead.company_name ?? "Lead"),
      subtitle: lead.company_name,
      optedOut: lead.opted_out,
      leadStatus: lead.status,
      draft: {
        firstName: lead.first_name,
        lastName: lead.last_name,
        roleTitle: prospect?.role_title ?? null,
        companyName: lead.company_name ?? prospect?.prospect_companies?.name ?? null,
        industry: prospect?.prospect_companies?.industry ?? null,
      },
      moveLead: {
        email: lead.email,
        emailOrigin: lead.email_origin,
        phone: lead.phone,
        phoneSource: lead.phone_source,
        phoneType: lead.phone_type,
        optedOut: lead.opted_out,
      },
      linkedinUrl: prospect?.linkedin_url ?? null,
    };
  }
  if (prospect) {
    const company = prospect.prospect_companies;
    return {
      name: fullName(prospect.first_name, prospect.last_name, company?.name ?? "Prospect"),
      subtitle: [prospect.role_title, company?.name].filter(Boolean).join(" · ") || null,
      optedOut: prospect.outreach_eligibility === "SUPPRESSED" || prospect.status === "SUPPRESSED",
      leadStatus: null,
      draft: {
        firstName: prospect.first_name,
        lastName: prospect.last_name,
        roleTitle: prospect.role_title,
        companyName: company?.name ?? null,
        industry: company?.industry ?? null,
      },
      moveLead: null,
      linkedinUrl: prospect.linkedin_url,
    };
  }
  return null;
}

/** The subject of one contact, re-read fresh. */
export async function subjectFor(contact: Pick<ContactRow, "business_id" | "lead_id" | "prospect_id">): Promise<SubjectSnapshot | null> {
  const [leads, prospects] = await Promise.all([
    loadLeads(contact.business_id, contact.lead_id ? [contact.lead_id] : []),
    loadProspects(contact.business_id, contact.prospect_id ? [contact.prospect_id] : []),
  ]);
  let prospect = contact.prospect_id ? prospects.get(contact.prospect_id) : undefined;
  const lead = contact.lead_id ? leads.get(contact.lead_id) : undefined;
  if (lead && !prospect && lead.promoted_from_prospect_id) {
    prospect = (await loadProspects(contact.business_id, [lead.promoted_from_prospect_id])).get(
      lead.promoted_from_prospect_id,
    );
  }
  return snapshotFrom(lead, prospect);
}

/* ================================================================ business */

export async function draftBusiness(businessId: string): Promise<{ business: DraftBusiness; aiEnabled: boolean }> {
  const admin = createAdminClient();
  const [{ data: business }, { data: services }, { data: settings }, entitlements] = await Promise.all([
    admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    admin
      .from("services")
      .select("name")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("position", { ascending: true })
      .limit(2),
    admin.from("business_settings").select("ai_assist_enabled").eq("business_id", businessId).maybeSingle(),
    getEntitlements(businessId),
  ]);
  return {
    business: {
      name: business?.name ?? "our team",
      serviceLine: (services ?? []).map((row) => row.name).filter(Boolean).join(" and ") || null,
    },
    // The same two gates every AI feature reads: the workspace toggle and the plan.
    aiEnabled: Boolean(settings?.ai_assist_enabled) && entitlements.aiAssistAllowed,
  };
}

/* ================================================================== tasks */

export async function loadTask(businessId: string, taskId: string): Promise<TaskRow | null> {
  const { data, error } = await db()
    .from("linkedin_assist_tasks")
    .select(TASK_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return (data as TaskRow | null) ?? null;
}

export async function loadContact(businessId: string, contactId: string): Promise<ContactRow | null> {
  const { data, error } = await db()
    .from("linkedin_assist_contacts")
    .select(CONTACT_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  return (data as ContactRow | null) ?? null;
}

/**
 * Schedules one task. Idempotent on (business, dedupe_key): a retried action
 * or a double tap finds the task the first attempt created. Returns its id.
 */
export async function scheduleTask(contact: ContactRow, task: ScheduledTask & { body?: string | null; bodySource?: TaskRow["body_source"]; inboundBody?: string | null; fallbackReason?: string | null }): Promise<string | null> {
  const row = {
    business_id: contact.business_id,
    contact_id: contact.id,
    assignee_user_id: contact.owner_user_id,
    lead_id: contact.lead_id,
    prospect_id: contact.prospect_id,
    kind: task.kind,
    step: task.step,
    due_on: task.dueOn,
    dedupe_key: task.dedupeKey,
    body: task.body ?? null,
    body_source: task.bodySource ?? null,
    inbound_body: task.inboundBody ?? null,
    fallback_reason: task.fallbackReason ?? null,
  };
  const { data, error } = await db().from("linkedin_assist_tasks").insert(row).select("id").maybeSingle();
  if (error?.code === "23505") {
    const { data: existing } = await db()
      .from("linkedin_assist_tasks")
      .select("id")
      .eq("business_id", contact.business_id)
      .eq("dedupe_key", task.dedupeKey)
      .maybeSingle();
    return (existing?.id as string | undefined) ?? null;
  }
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

/** Cancels every OPEN task on a contact, optionally sparing replies. */
export async function cancelOpenTasks(
  businessId: string,
  contactId: string,
  reason: string,
  options: { keepReplies?: boolean } = {},
): Promise<void> {
  let query = db()
    .from("linkedin_assist_tasks")
    .update({ status: "CANCELLED", cancelled_reason: reason.slice(0, 200) })
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .eq("status", "OPEN");
  if (options.keepReplies) query = query.neq("kind", "REPLY");
  const { error } = await query;
  if (error) throw error;
}

export async function setContactState(
  businessId: string,
  contactId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db()
    .from("linkedin_assist_contacts")
    .update(patch)
    .eq("business_id", businessId)
    .eq("id", contactId);
  if (error) throw error;
}

/** Queues the AI draft for a task. The job re-reads the task before writing. */
export async function enqueueDraft(businessId: string, taskId: string): Promise<void> {
  await enqueue(
    "linkedin_assist.draft",
    { taskId },
    { businessId, idempotencyKey: `linkedin_assist.draft:${taskId}` },
  );
}

/**
 * Writes the draft for one outreach task. Retry-safe: re-reads the task, and
 * does nothing unless it is still OPEN, is not a reply, and (unless forced)
 * has not been drafted by the model already or written by the person.
 */
export async function draftTask(
  businessId: string,
  taskId: string,
  options: { force?: boolean } = {},
): Promise<{ drafted: boolean; source: "TEMPLATE" | "AI" | null; fallbackReason: string | null }> {
  const task = await loadTask(businessId, taskId);
  if (!task || task.status !== "OPEN" || task.kind === "REPLY") {
    return { drafted: false, source: null, fallbackReason: null };
  }
  if (!options.force && (task.body_source === "AI" || task.body_source === "PERSON")) {
    return { drafted: false, source: null, fallbackReason: null };
  }
  const contact = await loadContact(businessId, task.contact_id);
  if (!contact) return { drafted: false, source: null, fallbackReason: null };
  const [subject, { business, aiEnabled: aiAllowed }, hold] = await Promise.all([
    subjectFor(contact),
    draftBusiness(businessId),
    loadWorkspaceHold(businessId),
  ]);
  if (!subject) return { drafted: false, source: null, fallbackReason: null };
  // A platform admin's hold (0175): no model call; the template stands.
  const aiEnabled = aiAllowed && !hold;

  const composed = await composeDraft({
    kind: task.kind as Exclude<LinkedInTaskKind, "REPLY">,
    step: task.step,
    subject: subject.draft,
    business,
    aiEnabled,
    // Stable per task (and per forced redraft), so a retried job is billed once.
    idempotencyKey: options.force ? `linkedin-assist:${taskId}:redraft:${Date.now()}` : `linkedin-assist:${taskId}`,
    generate: async ({ context, idempotencyKey, maxOutputTokens }) => {
      const result = await runTask<SocialMessageResult>({
        taskType: "social_message",
        businessId,
        leadId: contact.lead_id,
        idempotencyKey,
        maxOutputTokens,
        context,
      });
      return { data: result.data, skippedReason: result.skippedReason ?? null };
    },
  });

  const { error } = await db()
    .from("linkedin_assist_tasks")
    .update({ body: composed.body, body_source: composed.source, fallback_reason: composed.fallbackReason })
    .eq("business_id", businessId)
    .eq("id", taskId)
    .eq("status", "OPEN");
  if (error) throw error;
  return { drafted: true, source: composed.source, fallbackReason: composed.fallbackReason };
}

/* =========================================================== conversations */

/**
 * The lead's LinkedIn conversation, created on first use. Its thread address
 * (`li_urn:profile:<slug>`) is what the conversation agent reads as the
 * destination and what a suppression on this channel is filed against.
 */
export async function ensureLinkedInConversation(contact: ContactRow): Promise<string | null> {
  if (!contact.lead_id) return contact.conversation_id;
  const address = socialAddress("linkedin", linkedInThreadKey(contact.profile_url));
  const admin = db();

  let conversationId = contact.conversation_id;
  if (!conversationId) {
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("business_id", contact.business_id)
      .eq("lead_id", contact.lead_id)
      .eq("channel", "linkedin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    conversationId = (existing?.id as string | undefined) ?? null;
  }

  if (!conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .insert({
        business_id: contact.business_id,
        lead_id: contact.lead_id,
        channel: "linkedin",
        external_thread_id: address,
      })
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") {
      const { data: raced } = await admin
        .from("conversations")
        .select("id")
        .eq("business_id", contact.business_id)
        .eq("channel", "linkedin")
        .eq("external_thread_id", address)
        .maybeSingle();
      conversationId = (raced?.id as string | undefined) ?? null;
    } else if (error) {
      throw error;
    } else {
      conversationId = (data?.id as string | undefined) ?? null;
    }
  } else {
    // A thread created by the prospect reply path has no address yet; the
    // agent's destination check needs one.
    await admin
      .from("conversations")
      .update({ external_thread_id: address, lead_id: contact.lead_id })
      .eq("business_id", contact.business_id)
      .eq("id", conversationId)
      .is("external_thread_id", null);
  }

  if (conversationId && conversationId !== contact.conversation_id) {
    await setContactState(contact.business_id, contact.id, { conversation_id: conversationId });
  }
  return conversationId;
}

/** The newest outbound DRAFT (the assistant's suggested reply) on a conversation since a time. */
export async function latestAgentDraft(
  businessId: string,
  conversationId: string,
  since: string,
): Promise<{ id: string; body: string } | null> {
  const { data } = await db()
    .from("messages")
    .select("id, body, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("status", "DRAFT")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, body: data.body as string } : null;
}
