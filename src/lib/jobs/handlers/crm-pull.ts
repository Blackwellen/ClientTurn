import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { ingestLead } from "@/lib/ingest/service";
import { findCrmAdapter } from "@/lib/integrations/providers/crm-registry";
import {
  advanceCrmCursor,
  CRM_PULL_INTERVAL_MS,
  CRM_PULL_MAX_PAGES,
  CRM_PULL_PAGE_DELAY_MS,
  CRM_PULL_PAGE_SIZE,
  crmIngestInput,
  crmRunStatus,
  decideCrmRecord,
  initialCrmCursor,
  isAfterCursor,
  isCrmPullProvider,
  ownerUserIdFor,
  parseCrmCursor,
  serialiseCrmCursor,
  sortForCursor,
  type CrmCursor,
  type CrmPulledRecord,
} from "@/lib/integrations/crm-pull/plan";

/**
 * `crm.pull` (brief §29): the opt-in inbound sync from a connected CRM.
 *
 * Without an integration id it is the sweep: it queues one pull per enabled
 * integration, bucketed so a pull already pending is never queued twice. With
 * one, it pulls that integration:
 *
 *   1. re-read the setting and the connection -- a pull switched off or a CRM
 *      disconnected since the job was queued does nothing;
 *   2. fetch pages of records modified since the stored cursor (bounded pages,
 *      a pause between them, stop on a rate limit);
 *   3. per record, in cursor order: skip our own pushed records (loop
 *      prevention), otherwise `ingestLead` as source CRM, relationship
 *      IMPORTED, RECORD_ONLY -- nothing is messaged because a CRM held a row;
 *   4. move the cursor only past records that were handled, and record the run.
 *
 * Retry-safe: ingest is idempotent on the provider record id, and the cursor
 * never passes a record whose ingest threw.
 */

export const crmPullPayload = z.object({
  integrationId: z.uuid().optional(),
});

// crm_pull_settings (0127) post-dates the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The sweep: one `crm.pull` per enabled integration, at most once per interval. */
async function fanOut(): Promise<void> {
  const { data, error } = await db()
    .from("crm_pull_settings")
    .select("integration_id, business_id")
    .eq("enabled", true)
    .limit(1000);
  // Before migration 0127 there is nothing to sweep; not a failure to retry.
  if (error && isSchemaLag(error)) return;
  if (error) throw new Error(`crm.pull sweep: ${error.message}`);

  const bucket = Math.floor(Date.now() / CRM_PULL_INTERVAL_MS);
  for (const row of (data ?? []) as { integration_id: string; business_id: string }[]) {
    await enqueue(
      "crm.pull",
      { integrationId: row.integration_id },
      {
        businessId: row.business_id,
        idempotencyKey: `crm.pull:${row.integration_id}:${bucket}`,
        maxAttempts: 3,
      },
    );
  }
}

/** Queued by the worker tick; the idempotency key makes it once per interval. */
export async function scheduleCrmPullSweep(): Promise<void> {
  const bucket = Math.floor(Date.now() / CRM_PULL_INTERVAL_MS);
  await enqueue("crm.pull", {}, { idempotencyKey: `crm.pull.sweep:${bucket}` });
}

async function workspaceMembers(businessId: string): Promise<{ userId: string; email: string | null }[]> {
  const admin = createAdminClient();
  const { data: members, error } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("status", "active");
  if (error) throw new Error(`crm.pull members: ${error.message}`);
  const ids = (members ?? []).map((row) => row.user_id).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, email")
    .in("id", ids);
  if (profileError) throw new Error(`crm.pull profiles: ${profileError.message}`);
  return (profiles ?? []).map((row) => ({ userId: row.id, email: row.email }));
}

/** CRM ids ClientTurn itself wrote: those records are never re-ingested. */
async function pushedIds(
  businessId: string,
  provider: string,
  externalIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (externalIds.length === 0) return out;
  const admin = createAdminClient();

  const [pushes, links] = await Promise.all([
    admin
      .from("crm_push_records")
      .select("external_contact_id")
      .eq("business_id", businessId)
      .eq("provider_type", provider)
      .in("external_contact_id", externalIds),
    admin
      .from("external_entity_links")
      .select("external_id")
      .eq("business_id", businessId)
      .eq("local_type", "LEAD")
      .in("external_id", externalIds),
  ]);
  // A lookup that failed cannot prove a record is not ours; refusing the page
  // is the direction that never duplicates a lead.
  if (pushes.error) throw new Error(`crm.pull push records: ${pushes.error.message}`);
  if (links.error) throw new Error(`crm.pull entity links: ${links.error.message}`);

  for (const row of pushes.data ?? []) if (row.external_contact_id) out.add(row.external_contact_id);
  for (const row of links.data ?? []) out.add(row.external_id);
  return out;
}

async function writeCursor(integrationId: string, businessId: string, cursor: CrmCursor, objectType: string) {
  const admin = createAdminClient();
  assertWrite(
    await admin.from("lead_source_cursors").upsert(
      {
        integration_id: integrationId,
        business_id: businessId,
        external_object_id: `crm:${objectType}`,
        cursor_value: serialiseCrmCursor(cursor),
        last_polled_at: new Date().toISOString(),
      },
      { onConflict: "integration_id" },
    ),
    "crm.pull: write cursor",
    { businessId, integrationId },
  );
}

export async function handleCrmPull(job: ClaimedJob): Promise<void> {
  const payload = crmPullPayload.parse(job.payload ?? {});
  if (!payload.integrationId) {
    await fanOut();
    return;
  }

  const admin = createAdminClient();
  const [{ data: setting, error: settingError }, { data: integration, error: integrationError }] =
    await Promise.all([
      db()
        .from("crm_pull_settings")
        .select("integration_id, business_id, provider_type, enabled")
        .eq("integration_id", payload.integrationId)
        .maybeSingle(),
      admin
        .from("integrations")
        .select("id, business_id, provider_type, status")
        .eq("id", payload.integrationId)
        .maybeSingle(),
    ]);
  if (settingError) throw new Error(`crm.pull setting: ${settingError.message}`);
  if (integrationError) throw new Error(`crm.pull integration: ${integrationError.message}`);

  const row = setting as { business_id: string; provider_type: string; enabled: boolean } | null;
  if (!row?.enabled || !integration) return;
  if (integration.status === "DISCONNECTED") return;
  if (integration.business_id !== row.business_id) return;

  const provider = integration.provider_type;
  if (!isCrmPullProvider(provider)) return;
  const adapter = findCrmAdapter(provider);
  if (!adapter?.pull) return;

  const businessId = integration.business_id;

  const { data: cursorRow, error: cursorError } = await admin
    .from("lead_source_cursors")
    .select("cursor_value")
    .eq("integration_id", integration.id)
    .maybeSingle();
  if (cursorError) throw new Error(`crm.pull cursor: ${cursorError.message}`);

  let cursor: CrmCursor | null = parseCrmCursor(cursorRow?.cursor_value);
  if (!cursor) {
    // Enabled with no cursor: start now. History is a CSV import, not a pull.
    cursor = initialCrmCursor();
    await writeCursor(integration.id, businessId, cursor, provider);
  }

  const members = await workspaceMembers(businessId);
  let ingested = 0;
  let skipped = 0;
  let handledCount = 0;
  let failed = false;
  let rateLimited = false;
  let lastError: string | null = null;
  const since = cursor.modifiedAt;
  let pageToken: string | null = null;
  let objectType = provider === "hubspot" ? "contact" : "lead";

  try {
    for (let page = 0; page < CRM_PULL_MAX_PAGES; page += 1) {
      if (page > 0) await sleep(CRM_PULL_PAGE_DELAY_MS);

      const result = await adapter.pull({
        integrationId: integration.id,
        since,
        pageToken,
        pageSize: CRM_PULL_PAGE_SIZE,
      });
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }

      const fresh: CrmPulledRecord[] = sortForCursor(result.records).filter((record) =>
        isAfterCursor(record, cursor),
      );
      if (fresh[0]) objectType = fresh[0].objectType;
      const ours = await pushedIds(
        businessId,
        provider,
        fresh.map((record) => record.externalId),
      );

      const handled: { record: CrmPulledRecord; ok: boolean }[] = [];
      for (const record of fresh) {
        const decision = decideCrmRecord(record, ours);
        if (decision.action === "SKIP") {
          skipped += 1;
          handled.push({ record, ok: true });
          continue;
        }
        try {
          const owner = ownerUserIdFor(record.ownerEmail, members);
          const outcome = await ingestLead(
            crmIngestInput({ businessId, provider, integrationId: integration.id, record }),
            {
              // Nothing is messaged because a CRM held a row: recorded and scored.
              process: { mode: "RECORD_ONLY" },
              insertExtras: owner ? { assigned_user_id: owner } : undefined,
              permission: { source: `crm:${provider}` },
            },
          );
          if (outcome.outcome === "CREATED" || outcome.outcome === "MERGED" || outcome.outcome === "REVIEW" || outcome.outcome === "SUPPRESSED") {
            ingested += 1;
          } else {
            skipped += 1;
          }
          handled.push({ record, ok: true });
        } catch (error) {
          failed = true;
          lastError = error instanceof Error ? error.message : "Ingest failed.";
          handled.push({ record, ok: false });
          break;
        }
      }

      handledCount += handled.filter((entry) => entry.ok).length;
      const next = advanceCrmCursor(cursor, handled);
      if (next && (next.modifiedAt !== cursor.modifiedAt || next.externalId !== cursor.externalId)) {
        cursor = next;
        await writeCursor(integration.id, businessId, cursor, objectType);
      }

      if (failed || !result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }
  } catch (error) {
    failed = true;
    lastError = error instanceof Error ? error.message : "The CRM could not be read.";
  }

  const status = crmRunStatus({ handled: handledCount, failed, rateLimited });
  logWriteError(
    await db()
      .from("crm_pull_settings")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_error: lastError ? lastError.slice(0, 500) : rateLimited ? "Rate limited by the CRM; continuing next run." : null,
        last_run_ingested: ingested,
        last_run_skipped: skipped,
      })
      .eq("integration_id", integration.id),
    "crm.pull: record run",
    { businessId, integrationId: integration.id },
  );

  if (failed && handledCount === 0) {
    // Nothing moved: let the queue retry with backoff. The cursor is unchanged.
    throw new Error(`crm.pull ${provider}: ${lastError ?? "failed"}`);
  }
}
