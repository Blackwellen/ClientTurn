import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import { anonymiseSubject, SubjectNotFoundError, type SubjectType } from "./executor";
import type { RetentionPreview } from "./types";

/**
 * Enforcing the workspace's `retain_*_days` settings (0066).
 *
 * The dry run and the enforcement share one SQL predicate
 * (`data_rights_retention_candidates`), so the number shown in Settings is the
 * number the daily job will act on. Enforcement goes through the same
 * `anonymiseSubject` executor a person uses from the lead drawer.
 */

/** Per workspace per run. A large backlog drains over several days. */
const BATCH = 200;

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export async function retentionPreview(businessId: string): Promise<RetentionPreview> {
  const client = db();
  const [preview, controls] = await Promise.all([
    client.rpc("data_rights_retention_preview", { p_business_id: businessId }),
    client
      .from("business_data_controls")
      .select("retain_inactive_leads_days, retain_uncontacted_prospects_days, retain_raw_events_days")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);
  if (preview.error) throw new Error(`Retention preview failed: ${preview.error.message}`);

  const counts = (preview.data ?? {}) as {
    inactive_leads?: number;
    uncontacted_prospects?: number;
    raw_events?: number;
  };
  const settings = (controls.data ?? {}) as {
    retain_inactive_leads_days?: number | null;
    retain_uncontacted_prospects_days?: number | null;
    retain_raw_events_days?: number | null;
  };

  return {
    settings: {
      inactiveLeadsDays: settings.retain_inactive_leads_days ?? null,
      uncontactedProspectsDays: settings.retain_uncontacted_prospects_days ?? null,
      rawEventsDays: settings.retain_raw_events_days ?? null,
    },
    inactiveLeads: Number(counts.inactive_leads ?? 0),
    uncontactedProspects: Number(counts.uncontacted_prospects ?? 0),
    rawEvents: Number(counts.raw_events ?? 0),
  };
}

export type RetentionRunResult = {
  businessId: string;
  leadsAnonymised: number;
  prospectsAnonymised: number;
  rawEventsRedacted: number;
  failures: number;
};

async function candidates(
  businessId: string,
  kind: "INACTIVE_LEADS" | "UNCONTACTED_PROSPECTS",
): Promise<string[]> {
  const { data, error } = await db().rpc("data_rights_retention_candidates", {
    p_business_id: businessId,
    p_kind: kind,
    p_limit: BATCH,
  });
  if (error) throw new Error(`Retention candidates failed: ${error.message}`);
  return ((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id);
}

async function anonymiseEach(
  businessId: string,
  subjectType: SubjectType,
  ids: string[],
  reason: string,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await anonymiseSubject(subjectType, id, {
        businessId,
        requestedBy: null,
        caller: "SYSTEM",
        reason,
      });
      done += 1;
    } catch (error) {
      // Gone between listing and acting is not a failure.
      if (error instanceof SubjectNotFoundError) continue;
      failed += 1;
      console.error("[retention] anonymise failed", {
        businessId,
        subjectType,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { done, failed };
}

/** Enforces one workspace's settings. Retry-safe: each subject is idempotent. */
export async function enforceRetention(businessId: string): Promise<RetentionRunResult> {
  const [leadIds, prospectIds] = await Promise.all([
    candidates(businessId, "INACTIVE_LEADS"),
    candidates(businessId, "UNCONTACTED_PROSPECTS"),
  ]);

  const leads = await anonymiseEach(
    businessId,
    "LEAD",
    leadIds,
    "Retention: inactive longer than the workspace's retain_inactive_leads_days",
  );
  const prospects = await anonymiseEach(
    businessId,
    "PROSPECT",
    prospectIds,
    "Retention: uncontacted longer than the workspace's retain_uncontacted_prospects_days",
  );

  const raw = await db().rpc("data_rights_raw_event_retention", {
    p_business_id: businessId,
    p_dry_run: false,
  });
  assertWrite(raw, "data_rights_raw_event_retention", { businessId });

  return {
    businessId,
    leadsAnonymised: leads.done,
    prospectsAnonymised: prospects.done,
    rawEventsRedacted: Number(raw.data ?? 0),
    failures: leads.failed + prospects.failed,
  };
}

/** Workspaces that have set at least one retention period. */
export async function workspacesWithRetention(limit = 500): Promise<string[]> {
  const { data, error } = await db()
    .from("business_data_controls")
    .select("business_id")
    .or(
      "retain_inactive_leads_days.not.is.null,retain_uncontacted_prospects_days.not.is.null,retain_raw_events_days.not.is.null",
    )
    .limit(limit);
  if (error) throw new Error(`Retention workspace list failed: ${error.message}`);
  return ((data ?? []) as { business_id: string }[]).map((row) => row.business_id);
}
