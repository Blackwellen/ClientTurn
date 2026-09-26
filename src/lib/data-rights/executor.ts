import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import "@/lib/integrations/providers/all";
import { findCrmAdapter } from "@/lib/integrations/providers/crm-registry";
import type { ScrubCounts } from "./wording";

/**
 * Data-rights executors (Phase 6).
 *
 * Every destructive act is one SQL call (migration 0124) so it is atomic and
 * records its own `data_rights_actions` row in the same transaction. This
 * module is the only TypeScript that calls those functions: the service
 * operations, the retention job and the privacy-request workflow all come
 * through here, so there is exactly one executor.
 *
 * The untyped client is deliberate and scoped to this file: the 0123/0124
 * tables and functions post-date the generated `database.types.ts`.
 */

export type SubjectType = "LEAD" | "PROSPECT";

export type ActorContext = {
  businessId: string;
  requestedBy: string | null;
  caller: "UI" | "COPILOT" | "AGENT" | "MCP" | "API" | "SYSTEM";
  reason?: string | null;
  privacyRequestId?: string | null;
};

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export class SubjectNotFoundError extends Error {
  constructor() {
    super("That record could not be found.");
    this.name = "SubjectNotFoundError";
  }
}

/* ------------------------------------------------------------- erasure */

export type ErasureResult = {
  mode: "ANONYMISE" | "DELETE";
  actionId: string;
  leadId: string | null;
  prospectIds: string[];
  counts: ScrubCounts;
  retained: string[];
  crm: CrmErasureReport[];
};

type RpcErasure = {
  status: "DONE" | "NOT_FOUND";
  action_id?: string;
  lead_id?: string | null;
  prospect_ids?: string[];
  counts?: ScrubCounts;
  retained?: string[];
};

async function runErasure(
  fn: "data_rights_anonymise" | "data_rights_delete",
  subjectType: SubjectType,
  subjectId: string,
  actor: ActorContext,
): Promise<RpcErasure> {
  const result = await db().rpc(fn, {
    p_business_id: actor.businessId,
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_requested_by: actor.requestedBy,
    p_caller: actor.caller,
    p_reason: actor.reason ?? null,
    p_privacy_request_id: actor.privacyRequestId ?? null,
  });
  // A failed erasure must surface: the caller must never report it as done.
  assertWrite(result, fn, { businessId: actor.businessId, subjectId });
  const data = result.data as RpcErasure | null;
  if (!data || data.status === "NOT_FOUND") throw new SubjectNotFoundError();
  return data;
}

/**
 * Anonymise one person. Idempotent: a second call finds nothing left to
 * change and records an action with zero counts.
 */
export async function anonymiseSubject(
  subjectType: SubjectType,
  subjectId: string,
  actor: ActorContext,
  options: { propagateToCrm?: boolean } = {},
): Promise<ErasureResult> {
  const crmTargets = options.propagateToCrm
    ? await crmTargetsFor(actor.businessId, subjectType, subjectId)
    : [];

  const data = await runErasure("data_rights_anonymise", subjectType, subjectId, actor);
  const crm = options.propagateToCrm ? await eraseInCrm(crmTargets) : [];

  return {
    mode: "ANONYMISE",
    actionId: data.action_id ?? "",
    leadId: data.lead_id ?? null,
    prospectIds: data.prospect_ids ?? [],
    counts: data.counts ?? {},
    retained: data.retained ?? [],
    crm,
  };
}

/**
 * Anonymise, then hard-delete what has no retention need.
 *
 * The CRM ids are read *before* the delete, because `crm_push_records`
 * cascades away with the lead and the ids would otherwise be lost.
 */
export async function deleteSubject(
  subjectType: SubjectType,
  subjectId: string,
  actor: ActorContext,
  options: { propagateToCrm?: boolean } = {},
): Promise<ErasureResult> {
  const crmTargets = options.propagateToCrm
    ? await crmTargetsFor(actor.businessId, subjectType, subjectId)
    : [];

  const data = await runErasure("data_rights_delete", subjectType, subjectId, actor);
  const crm = options.propagateToCrm ? await eraseInCrm(crmTargets) : [];

  return {
    mode: "DELETE",
    actionId: data.action_id ?? "",
    leadId: data.lead_id ?? null,
    prospectIds: data.prospect_ids ?? [],
    counts: data.counts ?? {},
    retained: data.retained ?? [],
    crm,
  };
}

/* ------------------------------------------------------------ suppression */

export type SuppressionChannel = "ALL" | "EMAIL" | "SMS" | "WHATSAPP" | "SOCIAL";

export type SuppressResult = {
  mode: "SUPPRESS" | "RESTRICT";
  status: "DONE" | "NO_DESTINATION";
  actionId: string;
  channel: SuppressionChannel;
  entriesAdded: number;
  destinations: { email: number; phone: number; social: number };
};

/**
 * Suppress (or, with reason LEGAL, restrict) every destination held for the
 * person. Calls the SQL directly rather than `policy/suppression.ts`, because
 * it must also write the data_rights_actions row in the same transaction.
 */
export async function suppressSubject(
  subjectType: SubjectType,
  subjectId: string,
  input: { channel: SuppressionChannel; reason: "MANUAL" | "OPT_OUT" | "LEGAL"; note?: string | null },
  actor: ActorContext,
): Promise<SuppressResult> {
  const result = await db().rpc("data_rights_suppress", {
    p_business_id: actor.businessId,
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_channel: input.channel,
    p_reason: input.reason,
    p_requested_by: actor.requestedBy,
    p_caller: actor.caller,
    p_note: input.note ?? actor.reason ?? null,
    p_privacy_request_id: actor.privacyRequestId ?? null,
  });
  assertWrite(result, "data_rights_suppress", { businessId: actor.businessId, subjectId });

  const data = result.data as {
    status: "DONE" | "NO_DESTINATION" | "NOT_FOUND";
    action_id?: string;
    mode?: "SUPPRESS" | "RESTRICT";
    channel?: SuppressionChannel;
    entries_added?: number;
    destinations?: { email: number; phone: number; social: number };
  } | null;
  if (!data || data.status === "NOT_FOUND") throw new SubjectNotFoundError();

  return {
    mode: data.mode ?? (input.reason === "LEGAL" ? "RESTRICT" : "SUPPRESS"),
    status: data.status,
    actionId: data.action_id ?? "",
    channel: data.channel ?? input.channel,
    entriesAdded: data.entries_added ?? 0,
    destinations: data.destinations ?? { email: 0, phone: 0, social: 0 },
  };
}

/* ------------------------------------------------------ recorded actions */

/** For the acts that are not themselves SQL executors: EXPORT, RECTIFY, ARCHIVE. */
export async function recordDataRightsAction(input: {
  action: "EXPORT" | "RECTIFY" | "ARCHIVE";
  subjectType: SubjectType;
  subjectId: string;
  actor: ActorContext;
  summary: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await db()
    .from("data_rights_actions")
    .insert({
      business_id: input.actor.businessId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      action: input.action,
      requested_by: input.actor.requestedBy,
      caller: input.actor.caller,
      reason: input.actor.reason ?? null,
      privacy_request_id: input.actor.privacyRequestId ?? null,
      summary: input.summary,
    })
    .select("id")
    .single();
  assertWrite({ error }, "data_rights_actions insert", { subjectId: input.subjectId });
  return (data as { id: string } | null)?.id ?? null;
}

/* ------------------------------------------------------------------ CRM */

export type CrmErasureReport = {
  provider: string;
  outcome: "DELETED" | "RECYCLED" | "NOT_FOUND" | "MANUAL" | "FAILED";
  detail: string;
};

type CrmTarget = {
  provider: string;
  integrationId: string | null;
  externalContactId: string | null;
  externalDealId: string | null;
};

async function crmTargetsFor(
  businessId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<CrmTarget[]> {
  let leadId: string | null = subjectType === "LEAD" ? subjectId : null;
  if (!leadId) {
    const { data } = await db()
      .from("prospects")
      .select("promoted_to_lead_id")
      .eq("business_id", businessId)
      .eq("id", subjectId)
      .maybeSingle();
    leadId = (data as { promoted_to_lead_id: string | null } | null)?.promoted_to_lead_id ?? null;
  }
  if (!leadId) return [];

  const client = db();
  const [records, integrations] = await Promise.all([
    client
      .from("crm_push_records")
      .select("provider_type, external_contact_id, external_deal_id")
      .eq("business_id", businessId)
      .eq("lead_id", leadId),
    client
      .from("integrations")
      .select("id, provider_type, status")
      .eq("business_id", businessId)
      .in("provider_type", ["hubspot", "salesforce", "zoho_crm"])
      .neq("status", "DISCONNECTED"),
  ]);

  const byProvider = new Map<string, string>();
  for (const row of (integrations.data ?? []) as { id: string; provider_type: string }[]) {
    byProvider.set(row.provider_type, row.id);
  }

  return ((records.data ?? []) as {
    provider_type: string;
    external_contact_id: string | null;
    external_deal_id: string | null;
  }[]).map((row) => ({
    provider: row.provider_type,
    integrationId: byProvider.get(row.provider_type) ?? null,
    externalContactId: row.external_contact_id,
    externalDealId: row.external_deal_id,
  }));
}

const CRM_NAMES: Record<string, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  zoho_crm: "Zoho CRM",
};

/**
 * One report per CRM the person was pushed to. A failure in one system is
 * reported and does not stop the others; nothing here can undo the erasure
 * already committed in ClientTurn.
 */
async function eraseInCrm(targets: CrmTarget[]): Promise<CrmErasureReport[]> {
  const reports: CrmErasureReport[] = [];
  for (const target of targets) {
    const name = CRM_NAMES[target.provider] ?? target.provider;
    const adapter = findCrmAdapter(target.provider);

    if (!target.externalContactId) {
      reports.push({
        provider: target.provider,
        outcome: "MANUAL",
        detail: `No ${name} record id was stored for this person. Search ${name} for them and remove the record by hand.`,
      });
      continue;
    }
    if (!adapter?.erase || !target.integrationId) {
      reports.push({
        provider: target.provider,
        outcome: "MANUAL",
        detail: !target.integrationId
          ? `${name} is no longer connected. Remove record ${target.externalContactId} in ${name} by hand.`
          : `${name} removal is not automated. Remove record ${target.externalContactId} in ${name} by hand.`,
      });
      continue;
    }
    try {
      const result = await adapter.erase({
        integrationId: target.integrationId,
        externalContactId: target.externalContactId,
        externalDealId: target.externalDealId,
      });
      reports.push({ provider: target.provider, outcome: result.outcome, detail: result.detail });
    } catch (error) {
      console.error(`[data-rights] ${target.provider} erase failed`, {
        message: error instanceof Error ? error.message : String(error),
      });
      reports.push({
        provider: target.provider,
        outcome: "FAILED",
        detail: `${name} did not accept the removal. Remove record ${target.externalContactId} in ${name} by hand.`,
      });
    }
  }
  return reports;
}

/** Which connected CRMs would be asked, for the confirmation dialog. */
export async function crmSystemsFor(businessId: string, leadId: string): Promise<string[]> {
  const targets = await crmTargetsFor(businessId, "LEAD", leadId);
  return targets.map((target) => CRM_NAMES[target.provider] ?? target.provider);
}

