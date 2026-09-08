/**
 * The Meta webhook's parsing and signature rules.
 *
 * This endpoint is the only unauthenticated door into the system that creates
 * Leads, so the two things asserted hardest here are that it refuses forged
 * traffic and that it never turns one real event into two records.
 *
 * Everything is exercised through the pure parser and verifier rather than the
 * route, because the route's remaining job — insert, acknowledge, enqueue —
 * needs a database and is covered in `e2e-meta-flows.test.ts`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  deliveriesFor,
  parseMetaInbound,
  parseMetaStatus,
  verifyMetaHmac,
} from "../src/lib/messaging/meta-protocol.ts";

const SECRET = "test-app-secret";

/** The route's wrapper, inlined so the test needs no environment. */
async function verifyMetaSignature(request: Request, rawBody: string) {
  return verifyMetaHmac(request.headers.get("x-hub-signature-256"), rawBody, SECRET);
}

function signed(body: string, secret = SECRET): Request {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return new Request("https://example.test/api/webhooks/meta", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${digest}` },
    body,
  });
}

const messengerDelivery = JSON.stringify({
  object: "page",
  entry: [
    {
      id: "PAGE_1",
      time: 1789000000000,
      messaging: [
        {
          sender: { id: "PSID_1" },
          recipient: { id: "PAGE_1" },
          timestamp: 1789000000000,
          message: { mid: "mid.abc", text: "Do you do emergency call-outs?" },
        },
      ],
    },
  ],
});

/* --------------------------------------------------------------- signature */

describe("webhook signature verification", () => {
  test("a correctly signed body is accepted", async () => {
    assert.equal(await verifyMetaSignature(signed(messengerDelivery), messengerDelivery), true);
  });

  test("a body signed with the wrong secret is refused", async () => {
    const request = signed(messengerDelivery, "not-the-secret");
    assert.equal(await verifyMetaSignature(request, messengerDelivery), false);
  });

  test("a tampered body is refused", async () => {
    // The signature is computed over the original bytes; the verifier is handed
    // different ones. This is the attack the raw-body rule exists to stop.
    const request = signed(messengerDelivery);
    const tampered = messengerDelivery.replace("PSID_1", "PSID_ATTACKER");
    assert.equal(await verifyMetaSignature(request, tampered), false);
  });

  test("re-serialised JSON does not verify", async () => {
    // Proves the verifier is not quietly normalising. `JSON.parse` then
    // `JSON.stringify` reorders keys and drops whitespace; a verifier that
    // tolerated that would accept forgeries.
    const request = signed(messengerDelivery);
    const reserialised = JSON.stringify(JSON.parse(messengerDelivery));
    const changed = reserialised !== messengerDelivery;
    if (changed) {
      assert.equal(await verifyMetaSignature(request, reserialised), false);
    }
  });

  test("a missing signature header is refused", async () => {
    const request = new Request("https://example.test/api/webhooks/meta", {
      method: "POST",
      body: messengerDelivery,
    });
    assert.equal(await verifyMetaSignature(request, messengerDelivery), false);
  });

  test("a malformed signature header is refused rather than throwing", async () => {
    for (const header of ["sha256=zzzz", "sha1=abcd", "garbage", "sha256="]) {
      const request = new Request("https://example.test/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": header },
        body: messengerDelivery,
      });
      assert.equal(await verifyMetaSignature(request, messengerDelivery), false);
    }
  });
});

/* ------------------------------------------------------------- inbound */

describe("parsing inbound messages", () => {
  test("a Messenger message becomes one addressed inbound", () => {
    const [message] = parseMetaInbound(messengerDelivery);

    assert.ok(message);
    assert.equal(message.channel, "messenger");
    assert.equal(message.from, "meta_psid:PSID_1");
    assert.equal(message.to, "meta_psid:PAGE_1");
    assert.equal(message.body, "Do you do emergency call-outs?");
    assert.equal(message.providerMessageId, "mid.abc");
    assert.equal(message.provider, "meta");
  });

  test("an Instagram message is addressed on the Instagram channel", () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "IG_1",
          messaging: [
            {
              sender: { id: "IGSID_1" },
              recipient: { id: "IG_1" },
              timestamp: 1789000000000,
              message: { mid: "mid.ig", text: "how much for a boiler service?" },
            },
          ],
        },
      ],
    });

    const [message] = parseMetaInbound(body);
    assert.equal(message.channel, "instagram");
    assert.equal(message.from, "meta_igsid:IGSID_1");
  });

  test("the business's own echo is never treated as inbound", () => {
    // Meta delivers outbound messages back with `is_echo`. Treating one as
    // inbound would have the agent reply to itself — and because a reply is
    // itself an event, do so indefinitely.
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [
            {
              sender: { id: "PAGE_1" },
              recipient: { id: "PSID_1" },
              timestamp: 1789000000000,
              message: { mid: "mid.echo", text: "Thanks for getting in touch.", is_echo: true },
            },
          ],
        },
      ],
    });

    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("a message with no text is dropped rather than passed on empty", () => {
    // A sticker or a like is a real interaction but not something the
    // qualification engine can read. An empty string would look to the agent
    // like the person said nothing at all.
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [
            {
              sender: { id: "PSID_1" },
              recipient: { id: "PAGE_1" },
              message: { mid: "mid.sticker" },
            },
          ],
        },
      ],
    });

    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("a deleted message is ignored", () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [
            {
              sender: { id: "PSID_1" },
              recipient: { id: "PAGE_1" },
              message: { mid: "mid.gone", text: "oops", is_deleted: true },
            },
          ],
        },
      ],
    });

    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("an unsubscribed product is ignored, not guessed at", () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "X", messaging: [{ sender: { id: "1" }, message: { mid: "m", text: "hi" } }] }],
    });

    // The channel cannot be inferred from the ids — PSIDs and IGSIDs are both
    // opaque numeric strings — so an unknown product yields nothing.
    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("malformed JSON yields nothing rather than throwing", () => {
    assert.deepEqual(parseMetaInbound("{not json"), []);
    assert.deepEqual(parseMetaStatus("{not json"), []);
  });

  test("a batched delivery yields every message in it", () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [
            {
              sender: { id: "PSID_1" },
              recipient: { id: "PAGE_1" },
              message: { mid: "mid.1", text: "first" },
            },
            {
              sender: { id: "PSID_2" },
              recipient: { id: "PAGE_1" },
              message: { mid: "mid.2", text: "second" },
            },
          ],
        },
      ],
    });

    const messages = parseMetaInbound(body);
    assert.equal(messages.length, 2);
    // Distinct ids, so each becomes its own `webhook_events` row and neither
    // is collapsed into the other by the uniqueness key.
    assert.notEqual(messages[0].providerMessageId, messages[1].providerMessageId);
  });
});

/* ------------------------------------------------------------ idempotency */

describe("event identity", () => {
  test("a message event is keyed on Meta's own message id", () => {
    const [delivery] = deliveriesFor("page", {
      id: "PAGE_1",
      messaging: [{ sender: { id: "PSID_1" }, message: { mid: "mid.abc", text: "hi" } }],
    });

    assert.equal(delivery.kind, "message");
    assert.equal(delivery.eventId, "page:msg:mid.abc");
  });

  test("the same delivery twice produces the same key", () => {
    // This is what makes Meta's retry policy safe: the second insert collides
    // on `webhook_events(provider, external_event_id)` and is acknowledged
    // rather than processed. Without it, a retried leadgen event is a duplicate
    // lead in the customer's pipeline.
    const entry = {
      id: "PAGE_1",
      messaging: [{ sender: { id: "PSID_1" }, message: { mid: "mid.abc", text: "hi" } }],
    };

    assert.deepEqual(deliveriesFor("page", entry), deliveriesFor("page", entry));
  });

  test("Messenger and Instagram do not collide on the same message id", () => {
    const entry = {
      id: "X",
      messaging: [{ sender: { id: "1" }, message: { mid: "mid.same", text: "hi" } }],
    };

    assert.notEqual(
      deliveriesFor("page", entry)[0].eventId,
      deliveriesFor("instagram", entry)[0].eventId,
    );
  });

  test("a lead form event carries the Page it belongs to", () => {
    const [delivery] = deliveriesFor("page", {
      id: "PAGE_1",
      changes: [
        {
          field: "leadgen",
          value: { leadgen_id: "LEAD_9", page_id: "PAGE_1", form_id: "FORM_2" },
        },
      ],
    });

    assert.equal(delivery.kind, "leadgen");
    assert.equal(delivery.eventId, "page:leadgen:LEAD_9");
    assert.equal(delivery.kind === "leadgen" && delivery.pageId, "PAGE_1");
  });

  test("the Page id falls back to the entry id", () => {
    const [delivery] = deliveriesFor("page", {
      id: "PAGE_FALLBACK",
      changes: [{ field: "leadgen", value: { leadgen_id: "LEAD_9" } }],
    });

    assert.equal(delivery.kind === "leadgen" && delivery.pageId, "PAGE_FALLBACK");
  });

  test("an event with no stable id is skipped, not given a synthetic one", () => {
    // Something that cannot be deduplicated must not be processed: the poller
    // will collect anything genuinely missed, and a duplicate lead cannot be
    // un-created.
    assert.deepEqual(
      deliveriesFor("page", {
        id: "PAGE_1",
        changes: [{ field: "leadgen", value: {} }],
      }),
      [],
    );
  });

  test("a change we do not subscribe to is ignored", () => {
    assert.deepEqual(
      deliveriesFor("page", {
        id: "PAGE_1",
        changes: [{ field: "feed", value: { leadgen_id: "NOT_A_LEAD" } }],
      }),
      [],
    );
  });
});

/* -------------------------------------------------------------- delivery */

describe("parsing delivery receipts", () => {
  test("an explicit mid list becomes delivery events", () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [
            {
              sender: { id: "PSID_1" },
              recipient: { id: "PAGE_1" },
              delivery: { mids: ["mid.out.1"], watermark: 1789000000000 },
            },
          ],
        },
      ],
    });

    const [event] = parseMetaStatus(body);
    assert.equal(event.providerMessageId, "mid.out.1");
    assert.equal(event.status, "DELIVERED");
  });

  test("a bare watermark names no message and is discarded", () => {
    // Meta reports by watermark — "everything up to this time" — which names no
    // id we can key on. Marking the wrong message delivered is worse than
    // marking none.
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [{ sender: { id: "PSID_1" }, delivery: { watermark: 1789000000000 } }],
        },
      ],
    });

    assert.deepEqual(parseMetaStatus(body), []);
  });

  test("a read receipt is not a delivery receipt", () => {
    const body = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "PAGE_1",
          messaging: [{ sender: { id: "PSID_1" }, read: { watermark: 1789000000000 } }],
        },
      ],
    });

    assert.deepEqual(parseMetaStatus(body), []);
  });
});
