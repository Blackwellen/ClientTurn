/**
 * Comments arriving by webhook.
 *
 * This is the entry point for the Facebook and Instagram discovery flows, and
 * it exists in this shape for a permission reason as much as a latency one:
 * reading comments back from `/{page}/feed` needs `pages_read_user_content`,
 * which the use-case model does not offer on this app. A comment **delivered**
 * to a subscribed webhook needs no read permission at all.
 *
 * So these assertions are load-bearing. If the parser drops a real comment,
 * Facebook discovery does not degrade — it stops.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { deliveriesFor, type MetaEntry } from "../src/lib/messaging/meta-protocol.ts";

/** A Page feed change, as Meta sends one when somebody comments. */
function pageComment(overrides: Record<string, unknown> = {}): MetaEntry {
  return {
    id: "PAGE_1",
    time: 1789000000,
    changes: [
      {
        field: "feed",
        value: {
          item: "comment",
          verb: "add",
          comment_id: "COMMENT_1",
          post_id: "PAGE_1_POST_1",
          created_time: 1789000000,
          from: { id: "PSID_1", name: "Dana Okafor" },
          message: "Do you cover Croydon?",
          ...overrides,
        },
      },
    ],
  };
}

function instagramComment(overrides: Record<string, unknown> = {}): MetaEntry {
  return {
    id: "IG_1",
    time: 1789000000,
    changes: [
      {
        field: "comments",
        value: {
          id: "IG_COMMENT_1",
          text: "how much for a boiler service?",
          created_at: 1789000000,
          from: { id: "IGSID_1", username: "dana.okafor" },
          media: { id: "IG_MEDIA_1" },
          ...overrides,
        },
      },
    ],
  };
}

describe("a Facebook comment becomes a delivery", () => {
  test("it is parsed with the id a private reply is addressed to", () => {
    const [delivery] = deliveriesFor("page", pageComment());

    assert.equal(delivery.kind, "comment");
    if (delivery.kind !== "comment") return;

    assert.equal(delivery.comment.platform, "FACEBOOK");
    assert.equal(delivery.comment.channel, "messenger");
    assert.equal(delivery.comment.commentId, "COMMENT_1");
    assert.equal(delivery.comment.fromId, "PSID_1");
    assert.equal(delivery.comment.fromName, "Dana Okafor");
    assert.equal(delivery.comment.text, "Do you cover Croydon?");
    assert.equal(delivery.comment.postId, "PAGE_1_POST_1");
  });

  test("the timestamp is the platform's, not our receipt time", () => {
    // Meta measures the seven-day private-reply window from when they
    // commented. Using a receipt time would overstate how long is left, and the
    // product would offer a reply the platform then refuses.
    const [delivery] = deliveriesFor("page", pageComment());
    if (delivery.kind !== "comment") throw new Error("not a comment");

    assert.equal(delivery.comment.createdAt, new Date(1789000000 * 1000).toISOString());
  });

  test("the event id is keyed on the comment", () => {
    // One reply per comment, ever — so the comment is the thing a redelivery
    // must collide on.
    const [delivery] = deliveriesFor("page", pageComment());
    assert.equal(delivery.eventId, "page:comment:COMMENT_1");
  });

  test("the same delivery twice produces the same key", () => {
    const entry = pageComment();
    assert.deepEqual(deliveriesFor("page", entry), deliveriesFor("page", entry));
  });

  test("an edit is not an arrival", () => {
    // Only `add`. An edit or a delete is not a new person to answer, and
    // treating a delete as an arrival would create a prospect from a comment
    // that no longer exists.
    for (const verb of ["edited", "remove", "hide"]) {
      assert.deepEqual(deliveriesFor("page", pageComment({ verb })), []);
    }
  });

  test("a post is not a comment", () => {
    assert.deepEqual(deliveriesFor("page", pageComment({ item: "post" })), []);
    assert.deepEqual(deliveriesFor("page", pageComment({ item: "reaction" })), []);
  });

  test("a reply inside a thread is ignored", () => {
    // Meta permits one private reply per top-level comment; addressing a nested
    // reply is refused. Ingesting one would spend an attempt on a send that
    // cannot succeed.
    assert.deepEqual(
      deliveriesFor("page", pageComment({ parent_id: "COMMENT_0" })),
      [],
    );
  });

  test("a top-level comment whose parent is the post is kept", () => {
    // Meta sets `parent_id` to the post id on a top-level comment, which must
    // not be mistaken for a threaded reply.
    const deliveries = deliveriesFor(
      "page",
      pageComment({ parent_id: "PAGE_1_POST_1" }),
    );
    assert.equal(deliveries.length, 1);
  });

  test("a comment with no author is dropped", () => {
    assert.deepEqual(deliveriesFor("page", pageComment({ from: {} })), []);
  });
});

describe("an Instagram comment becomes a delivery", () => {
  test("it is parsed from the comments field", () => {
    const [delivery] = deliveriesFor("instagram", instagramComment());

    assert.equal(delivery.kind, "comment");
    if (delivery.kind !== "comment") return;

    assert.equal(delivery.comment.platform, "INSTAGRAM");
    assert.equal(delivery.comment.channel, "instagram");
    assert.equal(delivery.comment.commentId, "IG_COMMENT_1");
    assert.equal(delivery.comment.fromId, "IGSID_1");
    // Instagram gives a username where Facebook gives a name.
    assert.equal(delivery.comment.fromName, "dana.okafor");
    assert.equal(delivery.comment.text, "how much for a boiler service?");
    assert.equal(delivery.comment.postId, "IG_MEDIA_1");
  });

  test("Instagram and Facebook comment ids do not collide", () => {
    const fb = deliveriesFor("page", pageComment({ comment_id: "SAME" }))[0];
    const ig = deliveriesFor("instagram", instagramComment({ id: "SAME" }))[0];
    assert.notEqual(fb.eventId, ig.eventId);
  });

  test("Instagram has no verb, and every delivery is an arrival", () => {
    // The `verb` filter must not be applied to Instagram, where the field
    // carries none — applying it would drop every Instagram comment.
    const deliveries = deliveriesFor("instagram", instagramComment());
    assert.equal(deliveries.length, 1);
  });
});

describe("comments and lead forms share the changes envelope", () => {
  test("a leadgen change is still parsed as leadgen", () => {
    const [delivery] = deliveriesFor("page", {
      id: "PAGE_1",
      changes: [
        {
          field: "leadgen",
          value: { leadgen_id: "LEAD_1", page_id: "PAGE_1", form_id: "FORM_1" },
        },
      ],
    });

    assert.equal(delivery.kind, "leadgen");
  });

  test("a batch of both kinds yields both", () => {
    const deliveries = deliveriesFor("page", {
      id: "PAGE_1",
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "C1",
            from: { id: "P1", name: "A" },
            message: "hi",
          },
        },
        { field: "leadgen", value: { leadgen_id: "L1", page_id: "PAGE_1" } },
      ],
    });

    assert.equal(deliveries.length, 2);
    assert.deepEqual(
      deliveries.map((d) => d.kind).sort(),
      ["comment", "leadgen"],
    );
  });

  test("an unsubscribed change field is ignored", () => {
    assert.deepEqual(
      deliveriesFor("page", {
        id: "PAGE_1",
        changes: [{ field: "ratings", value: { comment_id: "X" } }],
      }),
      [],
    );
  });
});
