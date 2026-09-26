import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { googleAdsWebhookSchema, googleKeyMatches } from "@/lib/ingest/google-ads-webhook";

export const dynamic = "force-dynamic";

/**
 * Google Ads lead-form webhook (01-evidence-register §4).
 *
 * Google POSTs the whole lead -- `lead_id`, `user_column_data[]`, form and
 * campaign ids, `google_key`, `is_test`, `gcl_id`, `lead_submit_time` -- to
 * the URL configured on the lead-form asset. It retries on a 5xx and never on
 * a 4xx, so the status codes here are chosen by that rule:
 *
 *   200 `{}`  accepted, or already accepted (a redelivery)
 *   400       the body is not a lead-form payload -- retrying cannot fix it
 *   403       the key does not match this integration -- nor can this
 *   500       our database was unavailable -- Google should retry
 *
 * The URL carries the integration id (`?integration=<uuid>`) because the
 * `google_key` is set per form in the Google Ads UI and says nothing about
 * whose it is. The key is compared, in constant time, against the one stored
 * server-side for that integration (`integration_secrets.webhook_secret`,
 * provisioned when Google Ads is connected).
 *
 * CLAUDE.md webhook rule: verify, record `webhook_events` (unique on
 * provider + event id, which dedupes Google's retries on `lead_id`),
 * acknowledge, queue. The lead itself is ingested by the `ingest.webhook` job,
 * never inside this request.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const ok = () => Response.json({}, { status: 200 });

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const integrationId = z.uuid().safeParse(new URL(request.url).searchParams.get("integration"));
  if (!integrationId.success) return new Response(null, { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = googleAdsWebhookSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  const lead = parsed.data;

  const client = db();
  const { data: integration, error: integrationError } = await client
    .from("integrations")
    .select("id, business_id, integration_secrets(webhook_secret)")
    .eq("id", integrationId.data)
    .eq("provider_type", "google_ads")
    .maybeSingle();
  if (integrationError) return new Response(null, { status: 500 });

  const row = integration as {
    id: string;
    business_id: string;
    integration_secrets: { webhook_secret: string | null } | { webhook_secret: string | null }[] | null;
  } | null;
  const secrets = Array.isArray(row?.integration_secrets)
    ? row?.integration_secrets[0]
    : row?.integration_secrets;

  // Unknown integration and wrong key answer the same way, so the endpoint
  // does not confirm which integration ids exist.
  if (!row || !googleKeyMatches(lead.google_key, secrets?.webhook_secret)) {
    return new Response(null, { status: 403 });
  }

  // The key is a credential: it is verified and then dropped, never stored.
  const { google_key: _key, ...stored } = lead;
  void _key;
  const externalEventId = `${row.id}:${lead.lead_id}`;

  const { data: inserted, error: insertError } = await client
    .from("webhook_events")
    .insert({
      provider: "google_ads",
      external_event_id: externalEventId,
      business_id: row.business_id,
      event_type: lead.is_test ? "lead.test" : "lead.submitted",
      status: "received",
      payload: { integration_id: row.id, lead: stored },
    })
    .select("id")
    .single();

  let webhookEventId = (inserted as { id: string } | null)?.id ?? null;

  if (insertError?.code === "23505") {
    // A redelivery. Acknowledged; and if the first delivery's job was never
    // queued (the request died between the two writes), it is queued now --
    // the job's idempotency key makes a second enqueue a no-op otherwise.
    const { data: existing, error: existingError } = await client
      .from("webhook_events")
      .select("id, status")
      .eq("provider", "google_ads")
      .eq("external_event_id", externalEventId)
      .maybeSingle();
    if (existingError) return new Response(null, { status: 500 });
    const prior = existing as { id: string; status: string } | null;
    if (!prior || prior.status === "processed" || prior.status === "ignored") return ok();
    webhookEventId = prior.id;
  } else if (insertError || !webhookEventId) {
    return new Response(null, { status: 500 });
  }

  try {
    await enqueue(
      "ingest.webhook",
      { webhookEventId, provider: "google_ads" },
      {
        businessId: row.business_id,
        priority: 5,
        idempotencyKey: `ingest.webhook:${webhookEventId}`,
      },
    );
  } catch {
    // Recorded but not queued: a 500 makes Google redeliver, and the
    // redelivery path above queues it.
    return new Response(null, { status: 500 });
  }

  return ok();
}
