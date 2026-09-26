import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { ingestLead } from "@/lib/ingest/service";
import { googleAdsWebhookSchema, googleAdsWebhookToIngest } from "@/lib/ingest/google-ads-webhook";
import { parsePayload } from "./parse";
import { ingestWebhookPayload } from "./payloads";

/**
 * `ingest.webhook`: a lead webhook the route already verified and recorded,
 * turned into a lead by the one intake path.
 *
 * Retry-safe: it re-reads the stored `webhook_events` row, skips one already
 * processed, and `ingestLead` dedupes on the provider's lead id, so a retry
 * after a partial run adds no second lead or touch.
 */
export async function handleIngestWebhook(job: ClaimedJob) {
  const payload = parsePayload(ingestWebhookPayload, job.payload);
  const client = createAdminClient() as unknown as SupabaseClient;

  const { data, error } = await client
    .from("webhook_events")
    .select("id, business_id, status, payload")
    .eq("id", payload.webhookEventId)
    .maybeSingle();
  if (error) throw new Error(`ingest.webhook: read failed: ${error.message}`);
  if (!data) throw new PermanentJobError(`webhook event ${payload.webhookEventId} is gone`);

  const event = data as {
    id: string;
    business_id: string | null;
    status: string;
    payload: { integration_id?: string; lead?: Record<string, unknown> } | null;
  };
  if (event.status === "processed" || event.status === "ignored") return;
  if (!event.business_id) throw new PermanentJobError("webhook event has no workspace");

  // The stored body no longer carries the key (the route drops it after
  // verifying), so it is restored as an empty string for the schema only.
  const lead = googleAdsWebhookSchema.safeParse({ google_key: "", ...(event.payload?.lead ?? {}) });
  if (!lead.success || !event.payload?.integration_id) {
    logWriteError(
      await client
        .from("webhook_events")
        .update({ status: "failed", last_error: "stored payload is not a Google Ads lead" })
        .eq("id", event.id),
      "ingest.webhook: mark failed",
      { webhookEventId: event.id },
    );
    throw new PermanentJobError("stored payload is not a Google Ads lead");
  }

  const result = await ingestLead(
    googleAdsWebhookToIngest(event.business_id, event.payload.integration_id, lead.data),
    {
      externalId: `google_ads_webhook:${lead.data.lead_id}`,
      // Google's "send test data" button: kept, and marked as a test so it is
      // excluded from analytics and identity matching like the onboarding test.
      insertExtras: lead.data.is_test ? { is_test: true } : {},
      process: { sourceName: "Google Ads Lead Form" },
    },
  );

  logWriteError(
    await client
      .from("webhook_events")
      .update({
        status: result.outcome === "INVALID" ? "failed" : "processed",
        processed_at: new Date().toISOString(),
        last_error: result.outcome === "INVALID" ? result.reasons.join(", ").slice(0, 500) : null,
      })
      .eq("id", event.id),
    "ingest.webhook: mark processed",
    { webhookEventId: event.id, businessId: event.business_id },
  );
}
