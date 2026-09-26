import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { connectorCompany } from "@/lib/integrations/connector-company";

/**
 * One inbound connector event (Settings -> Connections -> apps) into a
 * prospect. `process_workspace_app_event` does the matching and the insert
 * atomically; the company the sender named is attached here afterwards,
 * because the SQL function never read it (tracker 8.24 #20).
 *
 * Retry-safe: the RPC returns the prospect already linked to the event, and
 * the company is attached only while the prospect has none, so a re-run
 * never replaces a company someone has since corrected.
 */
export async function handleAppIngest(job: ClaimedJob) {
  const id = z.uuid().parse(job.payload.eventId);
  const businessId = z.uuid().parse(job.business_id);
  const db = createAdminClient();

  const { data: prospectId, error } = await db.rpc("process_workspace_app_event", {
    p_event_id: id,
    p_business_id: businessId,
  });
  if (error) throw error;
  if (!prospectId) return;

  const { data: event, error: eventError } = await db
    .from("workspace_app_events")
    .select("payload")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (eventError) throw eventError;

  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  const company = connectorCompany({ company: payload.company, email: payload.email });
  if (!company) return;

  const { data: prospect, error: prospectError } = await db
    .from("prospects")
    .select("id, company_id")
    .eq("id", prospectId as string)
    .eq("business_id", businessId)
    .maybeSingle();
  if (prospectError) throw prospectError;
  if (!prospect || prospect.company_id) return;

  // An existing company is reused as it is, never renamed by an inbound event.
  const { error: upsertError } = await db
    .from("prospect_companies")
    .upsert(
      {
        business_id: businessId,
        name: company.name,
        domain: company.domain,
        dedupe_key: company.dedupeKey,
      },
      { onConflict: "business_id,dedupe_key", ignoreDuplicates: true },
    );
  if (upsertError && upsertError.code !== "23505") throw upsertError;

  // Looked up by dedupe key, then by domain: a company already stored under a
  // different key but the same domain is the same company.
  let companyId: string | null = null;
  const byKey = await db
    .from("prospect_companies")
    .select("id")
    .eq("business_id", businessId)
    .eq("dedupe_key", company.dedupeKey)
    .maybeSingle();
  if (byKey.error) throw byKey.error;
  companyId = byKey.data?.id ?? null;
  if (!companyId && company.domain) {
    const byDomain = await db
      .from("prospect_companies")
      .select("id")
      .eq("business_id", businessId)
      .eq("domain", company.domain)
      .maybeSingle();
    if (byDomain.error) throw byDomain.error;
    companyId = byDomain.data?.id ?? null;
  }
  if (!companyId) return;

  const { error: linkError } = await db
    .from("prospects")
    .update({ company_id: companyId })
    .eq("id", prospect.id)
    .eq("business_id", businessId)
    .is("company_id", null);
  if (linkError) throw linkError;
}
