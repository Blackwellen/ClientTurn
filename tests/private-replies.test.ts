/**
 * The private-reply path, at the level where its rules live.
 *
 * This is the entry point the whole Meta flow depends on: without it there is
 * no way to start a conversation with somebody who has not already started one,
 * because Meta publishes no follow API and no cold-DM API.
 *
 * It is also the only deadline in the product that expires **silently**.
 * Nothing errors when the seven days lapse — the person simply becomes
 * permanently unreachable — so the countdown is asserted here as carefully as
 * the sending rules.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  META_PRIVATE_REPLY_WINDOW_DAYS,
  socialAddress,
  withinPrivateReplyWindow,
} from "../src/lib/messaging/types.ts";

import {
  MAX_PRIVATE_REPLY_CHARS,
  maxCharsFor,
  renderSocialTemplate,
} from "../src/lib/outreach/social-copy.ts";

import {
  PRIVATE_REPLY_WINDOW_DAYS,
  privateReplyState,
} from "../src/lib/prospects/private-reply-window.ts";

const NOW = new Date("2026-09-08T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/* ------------------------------------------------------------ the countdown */

describe("the private-reply countdown", () => {
  test("a fresh comment has nearly the whole window", () => {
    const status = privateReplyState({
      commentId: "c1",
      commentedAt: hoursAgo(2),
      sentAt: null,
      now: NOW,
    });

    assert.equal(status.state, "OPEN");
    // Seven days minus two hours, rounded up.
    assert.equal(status.state === "OPEN" && status.hoursLeft, 7 * 24 - 2);
  });

  test("the clock runs from the comment, not from discovery", () => {
    // A comment found on day six has one day left, not seven. Showing it
    // otherwise would have somebody schedule a reply Meta refuses.
    const status = privateReplyState({
      commentId: "c2",
      commentedAt: daysAgo(6),
      sentAt: null,
      now: NOW,
    });

    assert.equal(status.state, "OPEN");
    assert.equal(status.state === "OPEN" && status.hoursLeft, 24);
  });

  test("past seven days it is expired, not merely urgent", () => {
    const status = privateReplyState({
      commentId: "c3",
      commentedAt: daysAgo(8),
      sentAt: null,
      now: NOW,
    });
    assert.equal(status.state, "EXPIRED");
  });

  test("a spent reply outranks a window that is still open", () => {
    // One per comment, ever. A prospect with six days left and a reply already
    // sent is not actionable, and showing the countdown would suggest it was.
    const status = privateReplyState({
      commentId: "c4",
      commentedAt: hoursAgo(1),
      sentAt: hoursAgo(1),
      now: NOW,
    });
    assert.equal(status.state, "SPENT");
  });

  test("somebody who never commented has no window at all", () => {
    // A DM-sourced prospect. Rendering "no reply window" on every one of them
    // would be noise; the component returns null.
    assert.equal(
      privateReplyState({ commentId: null, commentedAt: null, sentAt: null, now: NOW }).state,
      "NONE",
    );
  });

  test("an unparseable timestamp is expired, not open", () => {
    const status = privateReplyState({
      commentId: "c5",
      commentedAt: "whenever",
      sentAt: null,
      now: NOW,
    });
    assert.equal(status.state, "EXPIRED");
  });

  test("the UI and the transport agree on the window", () => {
    // Restated in the component so a client render needs no `server-only`
    // import. A drift would show a customer a countdown the sender refuses.
    assert.equal(PRIVATE_REPLY_WINDOW_DAYS, META_PRIVATE_REPLY_WINDOW_DAYS);
  });

  test("the countdown and the send gate never disagree", () => {
    // Same input, both layers, across the whole window and past it.
    for (const days of [0, 1, 3, 6, 6.9, 7, 7.1, 30]) {
      const commentedAt = new Date(NOW.getTime() - days * 86_400_000).toISOString();
      const uiOpen =
        privateReplyState({ commentId: "c", commentedAt, sentAt: null, now: NOW }).state ===
        "OPEN";

      assert.equal(
        uiOpen,
        withinPrivateReplyWindow(commentedAt, NOW),
        `disagreed at ${days} days`,
      );
    }
  });
});

/* ---------------------------------------------------------------- the copy */

describe("what a private reply says", () => {
  const context = {
    businessName: "Thames Plumbing",
    companyType: "letting agents",
    serviceLine: "boiler servicing",
    prospect: {
      first_name: "Marcus",
      last_name: null,
      role_title: null,
      company: null,
    },
  };

  test("it names the comment it is answering", () => {
    // The message is delivered as a reply to something they said in public.
    // Opening as though it were a cold approach is both dishonest and
    // confusing to the person receiving it.
    for (const platform of ["FACEBOOK", "INSTAGRAM"] as const) {
      const body = renderSocialTemplate({
        kind: "PRIVATE_REPLY",
        platform,
        step: 1,
        context,
      });
      assert.match(body, /comment/i, `${platform} reply does not mention the comment`);
    }
  });

  test("it uses their name and the business's own words", () => {
    const body = renderSocialTemplate({
      kind: "PRIVATE_REPLY",
      platform: "FACEBOOK",
      step: 1,
      context,
    });

    assert.match(body, /Marcus/);
    assert.match(body, /Thames Plumbing/);
    assert.match(body, /boiler servicing/);
    // No unresolved placeholders left behind.
    assert.doesNotMatch(body, /\{\{/);
  });

  test("it asks exactly one question", () => {
    // There will be no second message unless they answer, so the reply has to
    // carry the whole ask — and two questions in a first message from a
    // stranger halves the chance of either being answered.
    const body = renderSocialTemplate({
      kind: "PRIVATE_REPLY",
      platform: "INSTAGRAM",
      step: 1,
      context,
    });

    assert.equal((body.match(/\?/g) ?? []).length, 1);
  });

  test("a missing name degrades to something sayable, never to a placeholder", () => {
    const body = renderSocialTemplate({
      kind: "PRIVATE_REPLY",
      platform: "FACEBOOK",
      step: 1,
      context: {
        ...context,
        companyType: null,
        serviceLine: null,
        prospect: { first_name: null, last_name: null, role_title: null, company: null },
      },
    });

    assert.doesNotMatch(body, /\{\{|null|undefined/);
    assert.ok(body.length > 40, "the fallback should still be a real message");
  });

  test("it is held well under the platform's ceiling", () => {
    // Meta would accept far more. This is the length past which a first message
    // from a stranger reads as a sales blast, on a surface where the recipient's
    // only options are to answer or to report it.
    assert.equal(maxCharsFor("PRIVATE_REPLY"), MAX_PRIVATE_REPLY_CHARS);
    assert.ok(MAX_PRIVATE_REPLY_CHARS < 1000);

    for (const platform of ["FACEBOOK", "INSTAGRAM"] as const) {
      const body = renderSocialTemplate({
        kind: "PRIVATE_REPLY",
        platform,
        step: 1,
        context,
      });
      assert.ok(
        body.length <= MAX_PRIVATE_REPLY_CHARS,
        `${platform} reply is ${body.length} chars`,
      );
    }
  });

  test("a very long business name is truncated at a word, not mid-word", () => {
    const body = renderSocialTemplate({
      kind: "PRIVATE_REPLY",
      platform: "FACEBOOK",
      step: 1,
      context: { ...context, serviceLine: "servicing ".repeat(200) },
    });

    assert.ok(body.length <= MAX_PRIVATE_REPLY_CHARS);
    assert.doesNotMatch(body, /\s$/);
  });
});

/* ------------------------------------------------------------ the address */

describe("the address a private reply is suppressed against", () => {
  test("suppression is keyed on the platform address, not our row id", () => {
    // The bug this prevents: checking a prospect's UUID against a suppression
    // list keyed on platform addresses never matches, so an opt-out would never
    // stop a send. `socialAddress` is shared with the send path and the opt-out
    // handler so all three agree by construction.
    const address = socialAddress("instagram", "17841400000000000");
    assert.equal(address, "meta_igsid:17841400000000000");
    assert.doesNotMatch(address, /^[0-9a-f-]{36}$/);
  });

  test("the same person on two platforms is two addresses", () => {
    // A page-scoped id means nothing outside the product that issued it, so
    // being blocked on Instagram must not silently stop Messenger too — and
    // vice versa.
    assert.notEqual(
      socialAddress("instagram", "1234"),
      socialAddress("messenger", "1234"),
    );
  });
});
