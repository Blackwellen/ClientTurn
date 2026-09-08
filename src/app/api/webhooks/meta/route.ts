import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { verifyMetaSignature } from "@/lib/messaging/meta";
import { deliveriesFor, type MetaEntry } from "@/lib/messaging/meta-protocol";
import { ingestWebhookComment } from "@/lib/social/comment-ingest";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Meta's single webhook, for Messenger, Instagram Direct and lead forms.
 *
 * Meta posts every subscribed product to one URL per app, so this endpoint is
 * a router rather than a handler. It does four things and nothing else:
 * verify the signature, record the event, acknowledge, queue. Provider I/O and
 * anything that could be slow happen in the job, because Meta retries an
 * unacknowledged delivery and a retried lead-form event that has not yet been
 * deduplicated is a duplicate lead in the customer's pipeline.
 *
 * ## Why lead forms come here rather than staying on the poller
 *
 * `lead_source.poll` already collects lead-form submissions on an interval, and
 * it stays as the backstop — a webhook Meta failed to deliver is invisible, and
 * the poller is what makes that recoverable. But the interval is the whole
 * commercial argument for this product: a reply inside five minutes converts
 * several times better than one an hour later, and a poll cannot beat its own
 * period. Both paths dedupe on Meta's own `leadgen_id`, so whichever arrives
 * first wins and the second finds the work already done.
 */

/** Meta's subscription handshake. Answered only with the configured token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = serverEnv.meta.webhookVerifyToken;

  // No configured token means the handshake cannot be authenticated, which must
  // refuse rather than echo the challenge back to whoever asked for it.
  if (!expected) return new Response("not configured", { status: 503 });

  if (mode !== "subscribe" || token !== expected || !challenge) {
    return new Response("forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * The Meta integration belonging to a Page.
 *
 * A workspace is identified by the Page the event arrived for, and by nothing
 * else. There is deliberately no fallback: an event whose Page matches no
 * connected integration belongs to a workspace that has disconnected, and
 * guessing which of the others might want it would file a stranger's lead in
 * somebody's pipeline.
 */
async function integrationForPage(pageId: string | null) {
  if (!pageId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id, business_id, status")
    .eq("provider_type", "meta")
    .eq("config->>pageId", pageId)
    .neq("status", "DISCONNECTED")
    .maybeSingle();

  return data ?? null;
}

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  // Read the body exactly once, as text. The signature covers these bytes; a
  // re-serialised object would not verify, and a verifier relaxed until it did
  // would accept forgeries.
  const rawBody = await request.text();

  if (!(await verifyMetaSignature(request, rawBody))) {
    // 403, not 401: there is no credential to offer. Meta stops retrying a
    // 403, which is correct — a signature that does not verify will not verify
    // on the fourth attempt either.
    return new Response("forbidden", { status: 403 });
  }

  let body: { object?: string; entry?: MetaEntry[] };
  try {
    body = JSON.parse(rawBody) as { object?: string; entry?: MetaEntry[] };
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const object = body.object ?? "";
  if (
    object !== "page" &&
    object !== "instagram" &&
    object !== "whatsapp_business_account"
  ) {
    // A product we have not subscribed to. Acknowledged so Meta stops
    // retrying, and ignored.
    return new Response("ok", { status: 200 });
  }

  const admin = createAdminClient();

  for (const entry of body.entry ?? []) {
    for (const delivery of deliveriesFor(object, entry)) {
      const { eventId } = delivery;

      const { error } = await admin.from("webhook_events").insert({
        provider: "meta",
        external_event_id: eventId,
        event_type: delivery.kind === "leadgen" ? "leadgen" : "message.inbound",
        status: "received",
        // The whole entry, not the whole body: an entry is self-contained, and
        // storing the envelope again for each of its events would multiply a
        // batched delivery into several copies of itself.
        payload: { object, entry } as never,
      });

      // A redelivery of an event already recorded is acknowledged, not
      // repeated. This is the only thing standing between Meta's retry policy
      // and a duplicated lead.
      if (error?.code === "23505") continue;

      // A failed write must not be acknowledged: returning 200 here would tell
      // Meta the event was accepted and stop the retry that is the only way it
      // would ever arrive again.
      if (error) return new Response("error", { status: 500 });

      if (delivery.kind === "message") {
        await enqueue(
          "message.process_inbound",
          { provider: "meta", externalEventId: eventId },
          { priority: 10, idempotencyKey: `meta:${eventId}` },
        );
        continue;
      }

      if (delivery.kind === "comment") {
        // Somebody commented on the business's own content. This is the entry
        // point for the discovery flows: a comment is the only thing that makes
        // a person reachable who has never messaged the business, and it opens
        // a seven-day window measured from the comment's own timestamp.
        //
        // Handled inline rather than queued because it is one indexed upsert
        // with no provider I/O — the comment arrived with everything needed.
        // Queueing would add latency to the one clock in the product that
        // expires silently.
        await ingestWebhookComment(delivery.comment, entry.id ?? null);
        continue;
      }

      // A lead form submission. Rather than fetching this one lead on a
      // bespoke path, the notification triggers the existing poller for that
      // integration: it already knows how to read Meta's lead endpoint, record
      // consent and attribution, and deduplicate on Meta's own lead id. The
      // webhook's job is to make it run *now* instead of at the next interval,
      // which is the entire point — the poll remains the safety net for a
      // delivery Meta never made.
      const integration = await integrationForPage(delivery.pageId);
      if (!integration) continue;

      await enqueue(
        "lead_source.poll",
        { integrationId: integration.id, provider: "meta" },
        {
          businessId: integration.business_id,
          priority: 10,
          // Keyed on the leadgen event, not the integration, so two
          // submissions seconds apart both run rather than the second being
          // collapsed into the first and arriving an interval late.
          idempotencyKey: `meta:${eventId}`,
        },
      );
    }
  }

  return new Response("ok", { status: 200 });
}
