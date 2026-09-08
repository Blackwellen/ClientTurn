import { createHmac, timingSafeEqual } from "node:crypto";
import {
  socialAddress,
  type InboundMessage,
  type MessageStatusEvent,
  type MetaChannel,
} from "./types.ts";

/**
 * Meta's wire format: what a webhook delivery means, and whether it is genuine.
 *
 * Deliberately separate from `meta.ts`, and free of `server-only`, Supabase and
 * `serverEnv`. This is the code that stands between the public internet and the
 * creation of Leads, so it is the code that most needs to be exercised
 * directly — and a module that cannot be imported without a service-role client
 * cannot be tested without one.
 *
 * The secret is a parameter rather than a lookup for the same reason: a
 * verifier that reads its own key from the environment can only be tested by
 * mutating the environment, which is how a test suite ends up proving that
 * `verify` returns false when nothing is configured and nothing else.
 */

/* ------------------------------------------------------------- signature */

/**
 * Verifies Meta's `X-Hub-Signature-256` over the exact raw body.
 *
 * Over the raw bytes, never a re-serialised object: `JSON.parse` followed by
 * `JSON.stringify` reorders keys and drops whitespace, so a signature computed
 * over the result would fail for legitimate traffic — and a verifier relaxed
 * until it stopped failing would accept forged traffic.
 *
 * Returns false rather than throwing on every malformed input. A signature
 * header is attacker-controlled, and an exception thrown from a verifier is a
 * 500 where a 403 belongs.
 */
export function verifyMetaHmac(
  signatureHeader: string | null,
  rawBody: string,
  appSecret: string | null | undefined,
): boolean {
  if (!appSecret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const provided = signatureHeader.slice("sha256=".length);

  // A non-hex digest would otherwise be silently coerced by `Buffer.from`,
  // which stops at the first invalid character — so "zz" becomes an empty
  // buffer, and an empty buffer must not be allowed to match anything.
  if (!/^[0-9a-f]+$/i.test(provided) || provided.length % 2 !== 0) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(provided, "hex");

  // Length is compared first because `timingSafeEqual` throws on a mismatch.
  // The length of a digest is not a secret, so this leaks nothing.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/* ---------------------------------------------------------------- shapes */

export type MetaWebhookBody = {
  object?: string;
  entry?: MetaEntry[];
};

export type MetaEntry = {
  id?: string;
  time?: number;
  messaging?: {
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_deleted?: boolean;
    };
    // Delivery and read receipts share the envelope with messages.
    delivery?: { mids?: string[]; watermark?: number };
    read?: { watermark?: number };
  }[];
  changes?: {
    field?: string;
    value?: {
      leadgen_id?: string;
      page_id?: string;
      form_id?: string;
      created_time?: number;
    };
  }[];
};

function parse(rawBody: string): MetaWebhookBody | null {
  try {
    return JSON.parse(rawBody) as MetaWebhookBody;
  } catch {
    return null;
  }
}

/**
 * Which channel an event belongs to.
 *
 * Taken from `object`, never inferred from the ids: a PSID and an IGSID are
 * both opaque numeric strings with no distinguishing shape, so a guess would be
 * a coin flip that delivers a reply to the wrong product.
 */
export function channelForObject(object: string | undefined): MetaChannel | null {
  if (object === "instagram") return "instagram";
  if (object === "page") return "messenger";
  return null;
}

/* -------------------------------------------------------------- inbound */

/**
 * The messages in one webhook delivery.
 *
 * Two exclusions carry real weight:
 *
 *   * **Echoes.** Meta delivers the business's own outbound messages back with
 *     `is_echo` set. Treating one as inbound would have the agent reply to
 *     itself and — because a reply is itself an event — do so indefinitely.
 *   * **Empty bodies.** A sticker, a like or an attachment with no text is a
 *     real interaction but not something the qualification engine can read. It
 *     is dropped here rather than passed on as an empty string, which would
 *     look to the agent like the person said nothing at all.
 */
export function parseMetaInbound(rawBody: string): InboundMessage[] {
  const body = parse(rawBody);
  if (!body) return [];

  const channel = channelForObject(body.object);
  if (!channel) return [];

  const messages: InboundMessage[] = [];

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const senderId = event.sender?.id;
      const text = message?.text?.trim();

      if (!message || !senderId || !text) continue;
      if (message.is_echo || message.is_deleted) continue;

      messages.push({
        provider: "meta",
        providerMessageId: message.mid ?? `${senderId}:${event.timestamp ?? 0}`,
        from: socialAddress(channel, senderId),
        to: socialAddress(channel, event.recipient?.id ?? entry.id ?? ""),
        body: text,
        channel,
        receivedAt: new Date(event.timestamp ?? Date.now()).toISOString(),
      });
    }
  }

  return messages;
}

/* ------------------------------------------------------------- delivery */

/**
 * Delivery receipts.
 *
 * Meta reports these by watermark — "everything up to this timestamp" — rather
 * than per message, so a receipt often names no message id we can key on. Only
 * the explicit `delivery.mids` list is usable; a bare watermark is discarded
 * rather than guessed at, because marking the wrong message delivered is worse
 * than marking none.
 */
export function parseMetaStatus(rawBody: string): MessageStatusEvent[] {
  const body = parse(rawBody);
  if (!body) return [];

  const events: MessageStatusEvent[] = [];

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      for (const mid of event.delivery?.mids ?? []) {
        events.push({
          provider: "meta",
          providerMessageId: mid,
          status: "DELIVERED",
          occurredAt: new Date(
            event.delivery?.watermark ?? event.timestamp ?? Date.now(),
          ).toISOString(),
        });
      }
    }
  }

  return events;
}

/* -------------------------------------------------------- routing a batch */

export type MetaDelivery =
  | { kind: "message"; eventId: string }
  | { kind: "leadgen"; eventId: string; pageId: string | null };

/**
 * The individually-addressable events inside one entry, each with a stable id
 * used as the `webhook_events` uniqueness key.
 *
 * Meta gives a natural id for both kinds — the message id and the leadgen id —
 * and both are what a retry repeats. An event carrying neither is skipped
 * rather than given a synthetic id: something with no stable identity cannot be
 * deduplicated, and processing it twice is worse than dropping it, because the
 * poller collects anything genuinely missed.
 */
export function deliveriesFor(object: string, entry: MetaEntry): MetaDelivery[] {
  const deliveries: MetaDelivery[] = [];

  for (const event of entry.messaging ?? []) {
    const mid = event.message?.mid;
    if (mid) deliveries.push({ kind: "message", eventId: `${object}:msg:${mid}` });
  }

  for (const change of entry.changes ?? []) {
    if (change.field !== "leadgen") continue;
    const leadgenId = change.value?.leadgen_id;
    if (!leadgenId) continue;

    deliveries.push({
      kind: "leadgen",
      eventId: `${object}:leadgen:${leadgenId}`,
      // On a leadgen change the entry id *is* the Page id, but Meta also puts
      // it in the value. Preferring the value and falling back keeps this
      // working if a future product nests the entry differently.
      pageId: change.value?.page_id ?? entry.id ?? null,
    });
  }

  return deliveries;
}
