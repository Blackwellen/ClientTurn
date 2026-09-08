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
      // leadgen
      leadgen_id?: string;
      page_id?: string;
      form_id?: string;
      created_time?: number;
      // feed (Page) and comments (Instagram)
      id?: string;
      item?: string;
      verb?: string;
      comment_id?: string;
      post_id?: string;
      parent_id?: string;
      message?: string;
      text?: string;
      created_at?: number;
      from?: { id?: string; name?: string; username?: string };
      media?: { id?: string; media_product_type?: string };
      permalink_url?: string;
      // whatsapp
      messaging_product?: string;
      metadata?: { display_phone_number?: string; phone_number_id?: string };
      contacts?: { wa_id?: string; profile?: { name?: string } }[];
      messages?: {
        id?: string;
        from?: string;
        timestamp?: string;
        type?: string;
        text?: { body?: string };
      }[];
      statuses?: { id?: string; status?: string; timestamp?: string }[];
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

  // WhatsApp arrives on the same endpoint under its own object, and is not a
  // Meta *channel* in this codebase's sense — it is addressed by phone number,
  // not by a page-scoped id — so it is parsed separately rather than being bent
  // through `channelForObject`.
  if (body.object === "whatsapp_business_account") {
    return parseWhatsAppInbound(body);
  }

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

/**
 * Inbound WhatsApp messages.
 *
 * Addressed by phone number rather than by a platform-scoped id, so the
 * `from`/`to` here are E.164 rather than a `meta_psid:` address — which is
 * exactly right: a WhatsApp number is the same number the lead gave on a form,
 * and suppression keyed on it works across SMS and WhatsApp alike.
 *
 * Only text is taken. An image, a location or a reaction is a real message but
 * not one the qualification engine can read, and passing it on as an empty
 * string would look to the agent like the person said nothing.
 */
function parseWhatsAppInbound(body: MetaWebhookBody): InboundMessage[] {
  const messages: InboundMessage[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      if (!value?.messages?.length) continue;

      // The business's own number, as Meta reports it on the delivery.
      const to = value.metadata?.display_phone_number
        ? `+${value.metadata.display_phone_number.replace(/[^\d]/g, "")}`
        : "";

      for (const message of value.messages) {
        const text = message.text?.body?.trim();
        if (!message.id || !message.from || !text) continue;
        if (message.type && message.type !== "text") continue;

        messages.push({
          provider: "whatsapp_cloud",
          providerMessageId: message.id,
          from: `+${message.from.replace(/[^\d]/g, "")}`,
          to,
          body: text,
          channel: "whatsapp",
          receivedAt: new Date(
            message.timestamp ? Number(message.timestamp) * 1000 : Date.now(),
          ).toISOString(),
        });
      }
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
  | { kind: "leadgen"; eventId: string; pageId: string | null }
  | { kind: "comment"; eventId: string; comment: MetaComment };

/**
 * Somebody commented on the business's own post, reel or ad.
 *
 * This is the entry point for flows 1 and 3: a comment is the only thing that
 * makes a person reachable who has never messaged the business, and
 * `commentId` is the address Meta's private-reply endpoint takes.
 *
 * Arriving by webhook rather than by polling matters for more than latency.
 * Reading comments back from `/{page}/feed` needs `pages_read_user_content`,
 * which the use-case model does not offer on this app — but a comment delivered
 * to a subscribed webhook needs no read permission at all, because Meta is
 * handing it to us rather than us going to fetch it. The seven-day reply window
 * also runs from the comment's own timestamp, so hearing about it immediately
 * is most of the window.
 */
export type MetaComment = {
  platform: "FACEBOOK" | "INSTAGRAM";
  channel: MetaChannel;
  commentId: string;
  /** The post, reel or ad it was left on. */
  postId: string | null;
  /** Platform-scoped id of the commenter. Bare, never prefixed. */
  fromId: string | null;
  fromName: string | null;
  text: string | null;
  createdAt: string;
  permalinkUrl: string | null;
};

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
/**
 * A comment change, or null if this change is something else.
 *
 * Three exclusions, each one a real event we deliberately ignore:
 *
 *   * **Anything but `add`.** An edit or a delete is not a new person to
 *     answer, and treating a delete as an arrival would create a prospect from
 *     a comment that no longer exists.
 *   * **The business's own comments.** A Page replying in its own thread is
 *     delivered here too; ingesting it would create a prospect for the customer.
 *     Filtered by the caller, which knows the Page id — see the webhook route.
 *   * **Replies to comments.** `parent_id` present means this is a reply
 *     inside a thread. Meta permits one private reply per top-level comment,
 *     and addressing a nested reply is refused.
 */
function commentFrom(
  object: string,
  entry: MetaEntry,
  change: NonNullable<MetaEntry["changes"]>[number],
): MetaComment | null {
  const value = change.value;
  if (!value) return null;

  const isPageComment = change.field === "feed" && value.item === "comment";
  const isInstagramComment = change.field === "comments";
  if (!isPageComment && !isInstagramComment) return null;

  // Only additions. `verb` is absent on the Instagram `comments` field, where
  // every delivery is an arrival.
  if (isPageComment && value.verb !== "add") return null;

  const commentId = value.comment_id ?? (isInstagramComment ? value.id : null);
  if (!commentId) return null;

  // A reply inside a thread cannot be privately replied to.
  if (isPageComment && value.parent_id && value.parent_id !== value.post_id) {
    return null;
  }

  // No author id, no delivery.
  //
  // A private reply is addressed to the *comment*, so Meta would in principle
  // accept one — but suppression is keyed on the person's platform address, and
  // without an id there is no way to establish they have not opted out. An
  // unverifiable contactability decision is a refusal, never an assumption that
  // nobody objected. Dropped here rather than in the ingest so it never becomes
  // a stored event either.
  if (!value.from?.id) return null;

  const platform = isInstagramComment ? "INSTAGRAM" : "FACEBOOK";
  const channel: MetaChannel = isInstagramComment ? "instagram" : "messenger";

  const createdSeconds = value.created_time ?? value.created_at;

  return {
    platform,
    channel,
    commentId,
    postId: value.post_id ?? value.media?.id ?? null,
    fromId: value.from?.id ?? null,
    fromName: value.from?.name ?? value.from?.username ?? null,
    text: (value.message ?? value.text ?? "").trim() || null,
    // The platform's own timestamp. Meta measures the seven-day private-reply
    // window from this, never from when we received it, so a receipt time here
    // would quietly overstate how long is left.
    createdAt: new Date(
      createdSeconds ? createdSeconds * 1000 : (entry.time ?? Date.now()),
    ).toISOString(),
    permalinkUrl: value.permalink_url ?? null,
  };
}

export function deliveriesFor(object: string, entry: MetaEntry): MetaDelivery[] {
  const deliveries: MetaDelivery[] = [];

  for (const event of entry.messaging ?? []) {
    const mid = event.message?.mid;
    if (mid) deliveries.push({ kind: "message", eventId: `${object}:msg:${mid}` });
  }

  // WhatsApp messages arrive as a `messages` change rather than in the
  // `messaging` array, but they are ordinary inbound messages once parsed — so
  // they become the same kind of delivery and take the same path through
  // `message.process_inbound`.
  if (object === "whatsapp_business_account") {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const message of change.value?.messages ?? []) {
        if (!message.id) continue;
        deliveries.push({ kind: "message", eventId: `whatsapp:msg:${message.id}` });
      }
    }
    return deliveries;
  }

  for (const change of entry.changes ?? []) {
    const comment = commentFrom(object, entry, change);
    if (comment) {
      deliveries.push({
        kind: "comment",
        // Keyed on the comment id, which is what a redelivery repeats and what
        // the one-reply-per-comment rule is enforced against.
        eventId: `${object}:comment:${comment.commentId}`,
        comment,
      });
      continue;
    }

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
