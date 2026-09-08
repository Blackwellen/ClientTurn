/**
 * WhatsApp through Meta's Cloud API.
 *
 * WhatsApp already worked through Twilio, an official Business Solution
 * Provider. This is the direct route — same messages, Meta's own pricing, no
 * reseller margin — and both are kept, chosen per workspace.
 *
 * The rules on messaging an individual are Meta's either way, and they are the
 * part worth testing: free text only inside the 24-hour service window, an
 * approved template outside it, and no way at all to reach a number that never
 * wrote to the business.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  WHATSAPP_SERVICE_WINDOW_HOURS,
  META_MESSAGING_WINDOW_HOURS,
  withinWhatsAppServiceWindow,
  normalisePhone,
} from "../src/lib/messaging/types.ts";

import { deliveriesFor, parseMetaInbound } from "../src/lib/messaging/meta-protocol.ts";

const NOW = new Date("2026-09-08T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();

/* ------------------------------------------------------- the service window */

describe("WhatsApp's customer service window", () => {
  test("a message an hour ago leaves it open", () => {
    assert.equal(withinWhatsAppServiceWindow(hoursAgo(1), NOW), true);
  });

  test("25 hours has closed it", () => {
    assert.equal(withinWhatsAppServiceWindow(hoursAgo(25), NOW), false);
  });

  test("exactly 24 hours is closed, not open", () => {
    // The boundary is exclusive: a send attempted as the window lapses races
    // Meta's clock, and losing that race is a refusal counted against the
    // number's quality rating.
    assert.equal(withinWhatsAppServiceWindow(hoursAgo(24), NOW), false);
  });

  test("a number that never wrote has no window", () => {
    // The rule that makes WhatsApp not a cold channel. Without an inbound
    // message there is no window, so free text is impossible — only an approved
    // template with an evidenced opt-in.
    assert.equal(withinWhatsAppServiceWindow(null, NOW), false);
  });

  test("an unparseable timestamp is closed", () => {
    assert.equal(withinWhatsAppServiceWindow("sometime", NOW), false);
  });

  test("it is a separate constant from Meta's messaging window", () => {
    // The same length today, deliberately not the same constant: they are
    // different rules on different platforms, and collapsing them would mean a
    // change to one silently moving the other.
    assert.equal(WHATSAPP_SERVICE_WINDOW_HOURS, 24);
    assert.equal(META_MESSAGING_WINDOW_HOURS, 24);
  });
});

/* ------------------------------------------------------------- the inbound */

const waDelivery = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15556753230",
                phone_number_id: "PHONE_1",
              },
              contacts: [{ wa_id: "447700900123", profile: { name: "Dana" } }],
              messages: [
                {
                  id: "wamid.ABC",
                  from: "447700900123",
                  timestamp: "1789000000",
                  type: "text",
                  text: { body: "Can you fit me in Thursday?" },
                },
              ],
              ...overrides,
            },
          },
        ],
      },
    ],
  });

describe("inbound WhatsApp on the shared Meta webhook", () => {
  test("a text message is parsed onto the whatsapp channel", () => {
    const [message] = parseMetaInbound(waDelivery());

    assert.ok(message);
    assert.equal(message.channel, "whatsapp");
    assert.equal(message.provider, "whatsapp_cloud");
    assert.equal(message.providerMessageId, "wamid.ABC");
    assert.equal(message.body, "Can you fit me in Thursday?");
  });

  test("the address is a phone number, not a platform id", () => {
    // This is what makes suppression work across SMS and WhatsApp: the number a
    // lead gave on a form is the same string either way. A platform-scoped id
    // here would silently split one person into two.
    const [message] = parseMetaInbound(waDelivery());

    assert.equal(message.from, "+447700900123");
    assert.equal(message.from, normalisePhone("07700900123"));
    assert.equal(message.to, "+15556753230");
  });

  test("the timestamp is the platform's, in seconds", () => {
    const [message] = parseMetaInbound(waDelivery());
    assert.equal(message.receivedAt, new Date(1789000000 * 1000).toISOString());
  });

  test("a non-text message is dropped rather than passed on empty", () => {
    // An image or a location is a real message but not one the qualification
    // engine can read, and an empty body would look to the agent like the
    // person said nothing at all.
    const body = waDelivery({
      messages: [
        { id: "wamid.IMG", from: "447700900123", timestamp: "1789000000", type: "image" },
      ],
    });
    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("a status change is not an inbound message", () => {
    // Delivery and read receipts arrive on the same field. Treating one as
    // inbound would have the agent answer its own delivery confirmation.
    const body = waDelivery({
      messages: undefined,
      statuses: [{ id: "wamid.ABC", status: "delivered", timestamp: "1789000000" }],
    });
    assert.deepEqual(parseMetaInbound(body), []);
  });

  test("a batch of two messages yields both", () => {
    const body = waDelivery({
      messages: [
        { id: "wamid.1", from: "447700900123", timestamp: "1789000000", type: "text", text: { body: "one" } },
        { id: "wamid.2", from: "447700900999", timestamp: "1789000001", type: "text", text: { body: "two" } },
      ],
    });

    const messages = parseMetaInbound(body);
    assert.equal(messages.length, 2);
    assert.notEqual(messages[0].from, messages[1].from);
  });
});

describe("WhatsApp events are routed like any other inbound", () => {
  test("each message becomes a delivery keyed on its wamid", () => {
    const entry = {
      id: "WABA_1",
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              { id: "wamid.ABC", from: "447700900123", timestamp: "1789000000", type: "text", text: { body: "hi" } },
            ],
          },
        },
      ],
    };

    const [delivery] = deliveriesFor("whatsapp_business_account", entry);
    assert.equal(delivery.kind, "message");
    assert.equal(delivery.eventId, "whatsapp:msg:wamid.ABC");
  });

  test("the same delivery twice produces the same key", () => {
    // Meta retries anything it does not see acknowledged, and a WhatsApp
    // message processed twice is a duplicate reply to a real person.
    const entry = {
      id: "WABA_1",
      changes: [
        {
          field: "messages",
          value: { messages: [{ id: "wamid.SAME", from: "44770", timestamp: "1", type: "text", text: { body: "x" } }] },
        },
      ],
    };

    assert.deepEqual(
      deliveriesFor("whatsapp_business_account", entry),
      deliveriesFor("whatsapp_business_account", entry),
    );
  });

  test("a WhatsApp id cannot collide with a Messenger one", () => {
    const waEntry = {
      id: "W",
      changes: [
        {
          field: "messages",
          value: { messages: [{ id: "SAME", from: "44770", timestamp: "1", type: "text", text: { body: "x" } }] },
        },
      ],
    };
    const fbEntry = {
      id: "P",
      messaging: [{ sender: { id: "PSID" }, message: { mid: "SAME", text: "x" } }],
    };

    assert.notEqual(
      deliveriesFor("whatsapp_business_account", waEntry)[0].eventId,
      deliveriesFor("page", fbEntry)[0].eventId,
    );
  });
});
