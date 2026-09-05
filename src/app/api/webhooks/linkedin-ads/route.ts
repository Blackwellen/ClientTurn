import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * LinkedIn Lead Sync real-time notifications. Two distinct request shapes,
 * both documented at learn.microsoft.com/en-us/linkedin/shared/api-guide/
 * webhook-validation:
 *
 * 1. GET — endpoint ownership challenge, sent at registration and re-sent
 *    roughly every 2 hours. Must answer within 3 seconds with
 *    { challengeCode, challengeResponse } where challengeResponse is the
 *    hex-encoded HMAC-SHA256 of challengeCode using the app's client secret.
 * 2. POST — the actual lead notification, signed via an `X-LI-Signature`
 *    header: hex(HMAC-SHA256("hmacsha256=" + <raw body>, client secret)).
 *    The body itself carries only the lead's URN and timestamp, never its
 *    answers (learn.microsoft.com/.../marketing/lead-sync/leadsync,
 *    "Lead Notification Subscriptions" — payload fields: type,
 *    leadGenFormResponse, leadGenForm, owner, associatedEntity, leadType,
 *    leadAction, occurredAt) — the full record is fetched separately via
 *    `leadFormResponses`, done here by nudging the existing poller
 *    (src/lib/integrations/providers/linkedin-ads.ts) rather than calling
 *    LinkedIn from inside this request.
 */

function clientSecret(): string | null {
  return serverEnv.linkedinAds.clientSecret ?? null;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function GET(request: Request) {
  const secret = clientSecret();
  if (!secret) return new Response(null, { status: 503 });

  const challengeCode = new URL(request.url).searchParams.get("challengeCode");
  if (!challengeCode) return new Response(null, { status: 400 });

  const challengeResponse = hmacHex(secret, challengeCode);
  return Response.json({ challengeCode, challengeResponse });
}

const notificationSchema = z.object({
  type: z.string().optional(),
  leadGenFormResponse: z.string(),
  leadGenForm: z.string().optional(),
  owner: z
    .object({ organization: z.string().optional(), sponsoredAccount: z.string().optional() })
    .optional(),
  associatedEntity: z.record(z.string(), z.string()).optional(),
  leadType: z.string().optional(),
  leadAction: z.enum(["CREATED", "DELETED"]),
  occurredAt: z.number(),
});

/** `urn:li:organization:5509810` -> `5509810`. */
function urnId(urn: string | undefined): string | null {
  if (!urn) return null;
  return urn.split(":").pop() ?? null;
}

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const secret = clientSecret();
  if (!secret) return new Response(null, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-li-signature");
  if (!signature) return new Response(null, { status: 401 });

  const expected = hmacHex(secret, `hmacsha256=${rawBody}`);
  if (!safeEqual(expected, signature)) {
    return new Response(null, { status: 403 });
  }

  const parsed = notificationSchema.safeParse(JSON.parse(rawBody || "{}"));
  if (!parsed.success) return new Response(null, { status: 400 });

  const notification = parsed.data;
  // Per LinkedIn's own deduplication guidance: the lead URN is reused across
  // create/delete/re-create, so the timestamp is what disambiguates.
  const eventId = `${notification.leadGenFormResponse}_${notification.occurredAt}`;

  const admin = createAdminClient();

  const organizationId = urnId(notification.owner?.organization);
  let businessId: string | null = null;
  let integrationId: string | null = null;

  if (organizationId) {
    const { data: integration } = await admin
      .from("integrations")
      .select("id, business_id")
      .eq("provider_type", "linkedin_ads")
      .eq("external_account_id", organizationId)
      .maybeSingle();
    businessId = integration?.business_id ?? null;
    integrationId = integration?.id ?? null;
  }

  const { error: inboxError } = await admin.from("webhook_events").insert({
    provider: "linkedin_ads",
    external_event_id: eventId,
    business_id: businessId,
    event_type: `lead.${notification.leadAction.toLowerCase()}`,
    status: businessId ? "received" : "ignored",
    payload: notification as never,
  });

  // A re-delivered notification already recorded is acknowledged, not repeated.
  if (inboxError?.code === "23505") return new Response(null, { status: 200 });
  if (inboxError) return new Response(null, { status: 500 });

  if (notification.leadAction === "CREATED" && integrationId && businessId) {
    // No provider I/O here — this nudges the registered poller (which does
    // the actual `leadFormResponses` fetch) to run immediately instead of
    // waiting for its 5-minute cadence.
    await enqueue(
      "lead_source.poll",
      { integrationId, provider: "linkedin_ads" },
      { businessId, priority: 5, idempotencyKey: `poll-nudge:${integrationId}:${eventId}` },
    );
  }

  return new Response(null, { status: 200 });
}
