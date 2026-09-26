import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Calendly booking webhook. One subscription per connected workspace is
 * created by `src/lib/integrations/providers/calendly.ts` (`afterConnect`),
 * pointed at this route with the integration's own id as a query param — see
 * that file's header comment for why the id has to travel that way rather
 * than through a business id known only later in the OAuth flow.
 *
 * Signature: `Calendly-Webhook-Signature: t=<unix ts>,v1=<hex hmac>`, where
 * the hmac is SHA-256 over `${t}.${rawBody}`. CORRECTED after live
 * verification against developer.calendly.com/api-docs/overview/webhooks/webhook-signatures:
 * for an OAuth 2.0 app, Calendly generates ONE signing key for the whole app
 * at creation time -- not one per subscription -- so verification here uses
 * the single platform-wide `CALENDLY_WEBHOOK_SIGNING_KEY`, the same shape as
 * `TWILIO_AUTH_TOKEN`, rather than a per-integration secret looked up by
 * `iid`. The `iid` query param still identifies which workspace a delivery
 * belongs to; it plays no role in authenticating the request.
 *
 * Payload shape: `{ event: "invitee.created" | "invitee.canceled", payload:
 * {...} }`. Calendly's invitee payload nests the scheduled event as
 * `payload.scheduled_event` in current API versions; older accounts/docs
 * describe `payload.event` as a bare URI to the event resource instead. This
 * has not been exercised against a live account, so `extractScheduledEvent`
 * below tries every shape it might reasonably take (nested object, plain URI
 * string) rather than assuming one. If none of them yield a start/end time
 * the booking is still recorded — `bookingSyncPayload.startsAt/endsAt` are
 * optional — just without a time on it, and this is the shape most likely to
 * need adjusting once verified against a real webhook delivery.
 */

function parseSignatureHeader(header: string | null): { t: string; v1: string } | null {
  if (!header) return null;
  const parts: Record<string, string> = {};
  for (const segment of header.split(",")) {
    const [key, value] = segment.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }
  if (!parts.t || !parts.v1) return null;
  return { t: parts.t, v1: parts.v1 };
}

function verifySignature(
  signingKey: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", signingKey)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const envelopeSchema = z.object({
  event: z.enum(["invitee.created", "invitee.canceled"]),
  payload: z.record(z.string(), z.unknown()),
});

function lastPathSegment(uri: string): string {
  const trimmed = uri.split("?")[0]?.replace(/\/+$/, "") ?? uri;
  return trimmed.split("/").pop() || uri;
}

type ExtractedEvent = {
  externalEventId: string | null;
  startsAt: string | undefined;
  endsAt: string | undefined;
  location: string | undefined;
};

/** See header comment — tolerant of more than one Calendly payload shape. */
function extractScheduledEvent(payload: Record<string, unknown>): ExtractedEvent {
  const scheduledEvent = payload.scheduled_event as Record<string, unknown> | undefined;
  const eventField = payload.event;
  const nestedEvent =
    typeof eventField === "object" && eventField !== null
      ? (eventField as Record<string, unknown>)
      : undefined;

  const eventUri =
    (scheduledEvent?.uri as string | undefined) ??
    (nestedEvent?.uri as string | undefined) ??
    (typeof eventField === "string" ? eventField : undefined);

  const invitedUri = payload.uri as string | undefined;
  const uriForId = eventUri ?? invitedUri ?? null;

  const startsAt =
    (scheduledEvent?.start_time as string | undefined) ??
    (nestedEvent?.start_time as string | undefined);
  const endsAt =
    (scheduledEvent?.end_time as string | undefined) ?? (nestedEvent?.end_time as string | undefined);

  const locationValue = scheduledEvent?.location ?? nestedEvent?.location;
  const location =
    typeof locationValue === "string"
      ? locationValue
      : locationValue && typeof locationValue === "object"
        ? ((locationValue as Record<string, unknown>).location as string | undefined) ??
          ((locationValue as Record<string, unknown>).join_url as string | undefined)
        : undefined;

  return {
    externalEventId: uriForId ? lastPathSegment(uriForId) : null,
    startsAt,
    endsAt,
    location,
  };
}

/**
 * Calendly marks a reschedule on both halves: the cancellation carries
 * `rescheduled: true`, and the new invitee carries `old_invitee`, the URI of
 * the invitee on the event it replaces
 * (`.../scheduled_events/{event uuid}/invitees/{invitee uuid}`). The event
 * uuid is what booking.sync keys bookings on.
 */
function rescheduleFields(
  event: "invitee.created" | "invitee.canceled",
  payload: Record<string, unknown>,
): { rescheduled?: boolean; previousExternalEventId?: string } {
  if (event === "invitee.canceled") {
    return payload.rescheduled === true ? { rescheduled: true } : {};
  }
  const oldInvitee = typeof payload.old_invitee === "string" ? payload.old_invitee : null;
  const match = oldInvitee?.match(/\/scheduled_events\/([^/?#]+)\/invitees\//);
  return match ? { previousExternalEventId: match[1].slice(0, 200) } : {};
}

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const integrationId = new URL(request.url).searchParams.get("iid");
  if (!integrationId) return new Response(null, { status: 400 });

  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("id, business_id, status")
    .eq("id", integrationId)
    .eq("provider_type", "calendly")
    .maybeSingle();

  // An unknown or disconnected integration id: this subscription should have
  // been deleted on disconnect, but a race or a delivery already in flight
  // must not be treated as trustworthy just because the id parses.
  if (!integration || integration.status === "DISCONNECTED") {
    return new Response(null, { status: 404 });
  }

  const signingKey = serverEnv.calendly.webhookSigningKey;
  if (!signingKey) {
    // Not configured on this deployment — there is nothing safe to verify
    // against, so the delivery is refused rather than trusted unauthenticated.
    return new Response(null, { status: 503 });
  }

  const rawBody = await request.text();
  const sig = parseSignatureHeader(request.headers.get("calendly-webhook-signature"));
  if (!sig || !verifySignature(signingKey, sig.t, rawBody, sig.v1)) {
    return new Response(null, { status: 403 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody || "{}");
  } catch {
    return new Response(null, { status: 400 });
  }

  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  const { event, payload } = parsed.data;
  const invitee = payload as { email?: unknown; name?: unknown; uri?: unknown };
  const extracted = extractScheduledEvent(payload);

  const externalEventId =
    extracted.externalEventId ??
    (typeof invitee.uri === "string" ? lastPathSegment(invitee.uri) : null);

  if (!externalEventId) return new Response(null, { status: 400 });

  const { error: inboxError } = await admin.from("webhook_events").insert({
    provider: "calendly",
    external_event_id: `${externalEventId}:${event}`,
    business_id: integration.business_id,
    event_type: event,
    status: "received",
    payload: json as never,
  });

  // A re-delivered event already recorded is acknowledged, not repeated.
  if (inboxError?.code === "23505") return new Response(null, { status: 200 });
  if (inboxError) return new Response(null, { status: 500 });

  await enqueue(
    "booking.sync",
    {
      businessId: integration.business_id,
      provider: "calendly",
      externalEventId,
      email: typeof invitee.email === "string" ? invitee.email : undefined,
      startsAt: extracted.startsAt,
      endsAt: extracted.endsAt,
      location: extracted.location,
      status: event === "invitee.created" ? "scheduled" : "cancelled",
      // Phase 3.1: a reschedule is one transition, not a cancel + a new booking.
      ...rescheduleFields(event, payload),
    },
    {
      businessId: integration.business_id,
      idempotencyKey: `booking.sync:calendly:${externalEventId}:${event}`,
    },
  );

  return new Response(null, { status: 200 });
}
