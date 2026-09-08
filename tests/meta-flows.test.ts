/**
 * The four Meta flows, at the level where their rules actually live.
 *
 * The flows the product promises are:
 *
 *   1. Instagram — find someone, follow, message, agent converses, books.
 *   2. Instagram — lead form, agent converses, books.
 *   3. Facebook  — find someone, follow, message, agent converses, books.
 *   4. Facebook  — lead form, agent converses, books.
 *
 * Flows 1 and 3 have a constraint no amount of engineering removes: **Meta
 * provides no API to follow a person and no API to message a stranger.** The
 * follow and the opening message are performed by a human in the real app, with
 * this product composing, pacing and recording them. What *is* autonomous is
 * everything after the person replies, because a reply opens a window Meta
 * permits us to answer in.
 *
 * So the assertions below are about the seams where a mistake would be
 * expensive and invisible: the reply window, the address vocabulary, the
 * webhook's idempotency, and the refusal to invent a contact detail. Anything
 * requiring a live Postgres lives in `e2e-four-routes.test.ts`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BROADCAST_CHANNELS,
  META_MESSAGING_WINDOW_HOURS,
  PLATFORM_CHANNELS,
  channelForAddress,
  META_PRIVATE_REPLY_WINDOW_DAYS,
  META_HUMAN_AGENT_WINDOW_HOURS,
  isBroadcastChannel,
  isMetaChannel,
  withinHumanAgentWindow,
  withinPrivateReplyWindow,
  isPlatformChannel,
  platformIdFrom,
  socialAddress,
  withinMetaMessagingWindow,
  type Channel,
} from "../src/lib/messaging/types.ts";

import {
  CHANNEL_LIMITS,
  SOCIAL_REPLY_WINDOW_HOURS,
  isMetaAgentChannel,
  isPlatformAgentChannel,
  type AgentChannel,
} from "../src/lib/agent/types.ts";

import { evaluateSendGate, withinSocialReplyWindow } from "../src/lib/agent/policy.ts";
import {
  replyWindow,
  canReplyOn,
  CHANNEL_DEFINITIONS,
  SOCIAL_HUMAN_WINDOW_HOURS,
} from "../src/lib/inbox/types.ts";
import { assessContacts, assessEmail, assessPhone } from "../src/lib/find-leads/contact-legality.ts";
import { ROUTES } from "../src/lib/find-leads/lead-routes.ts";

/* ------------------------------------------------------- the address space */

describe("platform addresses", () => {
  test("a Messenger address round-trips through its platform id", () => {
    const address = socialAddress("messenger", "8452110394");
    assert.equal(address, "meta_psid:8452110394");
    assert.equal(platformIdFrom(address), "8452110394");
    assert.equal(channelForAddress(address), "messenger");
  });

  test("Instagram uses a distinct prefix from Messenger", () => {
    // The same person has a different id on each product, and the ids are
    // opaque numeric strings with no distinguishing shape. If both used one
    // prefix, a reply would be sent to whichever product was tried first.
    const messenger = socialAddress("messenger", "1111");
    const instagram = socialAddress("instagram", "1111");

    assert.notEqual(messenger, instagram);
    assert.equal(channelForAddress(instagram), "instagram");
  });

  test("a platform address is never mistaken for a phone number", () => {
    // The failure this prevents: `normalisePhone("meta_igsid:17841…")` strips
    // the non-digits and returns a plausible-looking E.164 string. A
    // suppression row written against that value matches nothing, for ever.
    const address = socialAddress("instagram", "17841400000000000");
    assert.equal(channelForAddress(address), "instagram");
    assert.notEqual(channelForAddress(address), "sms");
  });

  test("a bare string is not a platform address", () => {
    assert.equal(platformIdFrom("+447700900123"), null);
    assert.equal(platformIdFrom("someone@example.co.uk"), null);
  });
});

describe("the channel vocabularies agree", () => {
  test("every platform channel is excluded from the broadcast set, and vice versa", () => {
    // These two sets partition `Channel`. An overlap would mean a channel that
    // is both scheduled into the future and gated on a window that closes —
    // which is the exact combination that produces a message reported as sent
    // and never delivered.
    for (const channel of PLATFORM_CHANNELS) {
      assert.equal(isBroadcastChannel(channel), false, `${channel} must not be broadcast`);
      assert.equal(isPlatformChannel(channel), true);
    }
    for (const channel of BROADCAST_CHANNELS) {
      assert.equal(isPlatformChannel(channel as Channel), false, `${channel} must not be platform`);
    }
  });

  test("the Meta channels are a strict subset of the platform channels", () => {
    // LinkedIn and TikTok are addressed by platform id but their gate is an
    // acceptance that never expires. Treating them as Meta channels would
    // apply a 24-hour countdown that does not exist on those platforms and
    // stop conversations they would happily have delivered.
    const meta = PLATFORM_CHANNELS.filter((channel) => isMetaChannel(channel));
    assert.deepEqual([...meta].sort(), ["instagram", "messenger"]);

    assert.equal(isMetaChannel("linkedin"), false);
    assert.equal(isMetaChannel("tiktok"), false);
  });

  test("the agent's channel predicates match the transport's", () => {
    const channels: AgentChannel[] = [
      "sms",
      "whatsapp",
      "email",
      "messenger",
      "instagram",
      "tiktok",
      "linkedin",
    ];

    for (const channel of channels) {
      assert.equal(
        isMetaAgentChannel(channel),
        isMetaChannel(channel as Channel),
        `${channel} disagrees on being a Meta channel`,
      );
      assert.equal(
        isPlatformAgentChannel(channel),
        isPlatformChannel(channel as Channel),
        `${channel} disagrees on being a platform channel`,
      );
    }
  });

  test("the reply window is the same number in both layers", () => {
    // Restated rather than imported, so the agent's pure policy module does not
    // have to pull in a `server-only` transport. A drift between them would let
    // a turn decide to send something the transport is then refused for.
    assert.equal(SOCIAL_REPLY_WINDOW_HOURS, META_MESSAGING_WINDOW_HOURS);
  });

  test("every agent channel has a length limit", () => {
    const channels: AgentChannel[] = [
      "sms",
      "whatsapp",
      "email",
      "messenger",
      "instagram",
      "tiktok",
      "linkedin",
    ];
    for (const channel of channels) {
      const limit = CHANNEL_LIMITS[channel];
      assert.ok(limit, `${channel} has no limit`);
      assert.ok(limit.preferred < limit.hard, `${channel} preferred must be under hard`);
    }
  });

  test("Meta's hard limits are the platform's, not a preference", () => {
    assert.equal(CHANNEL_LIMITS.messenger.hard, 2000);
    assert.equal(CHANNEL_LIMITS.instagram.hard, 1000);
  });
});

/* ---------------------------------------------------------- the 24h window */

describe("Meta's reply window", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  test("a message an hour ago leaves the window open", () => {
    const anHourAgo = new Date("2026-09-08T11:00:00Z").toISOString();
    assert.equal(withinMetaMessagingWindow(anHourAgo, now), true);
    assert.equal(withinSocialReplyWindow(anHourAgo, now), true);
  });

  test("a message 25 hours ago has closed it", () => {
    const yesterday = new Date("2026-09-07T11:00:00Z").toISOString();
    assert.equal(withinMetaMessagingWindow(yesterday, now), false);
    assert.equal(withinSocialReplyWindow(yesterday, now), false);
  });

  test("exactly 24 hours is closed, not open", () => {
    // The boundary is exclusive on purpose. A send attempted at the instant the
    // window lapses races Meta's own clock, and losing that race is a refusal
    // recorded against the Page.
    const exactly = new Date("2026-09-07T12:00:00Z").toISOString();
    assert.equal(withinMetaMessagingWindow(exactly, now), false);
  });

  test("never having written means the window was never open", () => {
    // This is the rule that makes flows 1 and 3 honest. A prospect we found and
    // followed has not messaged us, so there is no window, so no automated
    // opener can be sent — which is exactly Meta's position.
    assert.equal(withinMetaMessagingWindow(null, now), false);
    assert.equal(withinSocialReplyWindow(null, now), false);
  });

  test("an unparseable timestamp is closed, not open", () => {
    assert.equal(withinMetaMessagingWindow("not a date", now), false);
  });
});

/* ------------------------------------------------- the private reply entry */

describe("private replies: the way a Meta conversation can be started", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  test("a comment from today can be privately replied to", () => {
    // The correction that matters most about this product. Meta gives no way to
    // DM a stranger, but it *does* let a business send one direct message to
    // somebody who commented on its own content. That is the entry point the
    // whole social flow depends on; without it, flows 1 and 3 would need a
    // person for every opener.
    const today = new Date("2026-09-08T09:00:00Z").toISOString();
    assert.equal(withinPrivateReplyWindow(today, now), true);
  });

  test("the window is seven days, not twenty-four hours", () => {
    assert.equal(META_PRIVATE_REPLY_WINDOW_DAYS, 7);

    const sixDaysAgo = new Date("2026-09-02T12:00:00Z").toISOString();
    assert.equal(withinPrivateReplyWindow(sixDaysAgo, now), true);
  });

  test("an eight-day-old comment is out of reach", () => {
    const eightDaysAgo = new Date("2026-08-31T12:00:00Z").toISOString();
    assert.equal(withinPrivateReplyWindow(eightDaysAgo, now), false);
  });

  test("the clock runs from the comment, not from when we noticed it", () => {
    // Meta measures against the comment's own creation timestamp. A backlogged
    // worker can therefore miss the window on a comment that reached our queue
    // seconds ago, which is why the ingest stores the platform's occurredAt
    // rather than now().
    const oldComment = new Date("2026-08-30T12:00:00Z").toISOString();
    const noticedNow = new Date("2026-09-08T11:59:00Z").toISOString();

    assert.equal(withinPrivateReplyWindow(oldComment, now), false);
    assert.equal(withinPrivateReplyWindow(noticedNow, now), true);
  });

  test("a comment with no timestamp is out of reach, not assumed fresh", () => {
    assert.equal(withinPrivateReplyWindow(null, now), false);
    assert.equal(withinPrivateReplyWindow("not a date", now), false);
  });
});

describe("the human-agent window", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  test("a person may answer for seven days", () => {
    assert.equal(META_HUMAN_AGENT_WINDOW_HOURS, SOCIAL_HUMAN_WINDOW_HOURS);

    const threeDaysAgo = new Date("2026-09-05T12:00:00Z").toISOString();
    assert.equal(withinHumanAgentWindow(threeDaysAgo, now), true);
    // But automation has long stopped.
    assert.equal(withinMetaMessagingWindow(threeDaysAgo, now), false);
  });

  test("the human window is strictly wider than the automated one", () => {
    // Two bounds, two legal bases, two separate functions. A shared helper
    // taking a boolean is precisely how the automated path ends up borrowing
    // the human one.
    assert.ok(META_HUMAN_AGENT_WINDOW_HOURS > META_MESSAGING_WINDOW_HOURS);
  });

  test("neither window opens without an inbound message", () => {
    assert.equal(withinHumanAgentWindow(null, now), false);
    assert.equal(withinMetaMessagingWindow(null, now), false);
  });
});

/* --------------------------------------------------------- the send gate */

describe("the agent's send gate on social", () => {
  const base = {
    agentMode: "AUTO_REPLY" as const,
    contactSuppressed: false,
    hasDestination: true,
    providerHealthy: true,
    // Meta channels have no connect gate — a thread exists because the person
    // wrote to us, not because a request was accepted. The connect-gated
    // channels are LinkedIn and TikTok, and those are covered in agent.test.ts.
    socialConnectionState: null,
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
    now: new Date("2026-09-08T12:00:00Z"),
  };

  test("an open window sends", () => {
    const result = evaluateSendGate({
      ...base,
      channel: "instagram",
      lastInboundAt: new Date("2026-09-08T11:00:00Z").toISOString(),
    });
    assert.equal(result.decision, "SEND");
  });

  test("a closed window denies rather than queueing", () => {
    // Queueing would be the intuitive choice and it is wrong: waiting cannot
    // help, because the window only ever shuts further and nothing this product
    // does reopens it. Only the person can, by writing again.
    const result = evaluateSendGate({
      ...base,
      channel: "messenger",
      lastInboundAt: new Date("2026-09-06T11:00:00Z").toISOString(),
    });

    assert.equal(result.decision, "DENY");
    assert.equal(result.decision === "DENY" && result.code, "SOCIAL_WINDOW_CLOSED");
  });

  test("a closed window denies even in suggest-only mode", () => {
    // Drafting a reply for a person to send would offer them a button Meta
    // refuses too. The denial sits above the SUGGEST_ONLY branch for that
    // reason.
    const result = evaluateSendGate({
      ...base,
      agentMode: "SUGGEST_ONLY",
      channel: "instagram",
      lastInboundAt: null,
    });

    assert.equal(result.decision, "DENY");
    assert.equal(result.decision === "DENY" && result.code, "SOCIAL_WINDOW_CLOSED");
  });

  test("the window does not constrain SMS", () => {
    const result = evaluateSendGate({ ...base, channel: "sms", lastInboundAt: null });
    assert.equal(result.decision, "SEND");
  });

  test("suppression still outranks an open window", () => {
    const result = evaluateSendGate({
      ...base,
      channel: "instagram",
      contactSuppressed: true,
      lastInboundAt: new Date("2026-09-08T11:00:00Z").toISOString(),
    });

    assert.equal(result.decision, "DENY");
    assert.equal(result.decision === "DENY" && result.code, "CONTACT_SUPPRESSED");
  });
});

/* ------------------------------------------------------------- the inbox */

describe("the inbox composer", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  test("Messenger and Instagram are live channels, not placeholders", () => {
    // They shipped as tabs that could never contain a conversation. The
    // ingestion now exists, and this is the assertion that stops the honest
    // "not built" copy being left behind after it does.
    assert.equal(CHANNEL_DEFINITIONS.messenger.ingestion, "live");
    assert.equal(CHANNEL_DEFINITIONS.instagram.ingestion, "live");
  });

  test("LinkedIn and TikTok are recorded, never synced", () => {
    // Not an oversight and not a to-do. Neither platform offers an API that
    // lets an application read a member's inbox, so a thread exists here only
    // because somebody worked it from the outreach queue. `canRead` describes
    // the platform; `ingestion` describes us, and conflating them is how a
    // channel ships as a tab that can never fill.
    for (const key of ["linkedin", "tiktok"] as const) {
      assert.equal(CHANNEL_DEFINITIONS[key].ingestion, "recorded");
      assert.equal(CHANNEL_DEFINITIONS[key].canRead, false);
    }
  });

  test("no channel claims to read what its platform will not give us", () => {
    // The invariant behind the whole catalogue: "live" means an API delivers
    // the messages. A channel that cannot be read must never claim it.
    for (const definition of Object.values(CHANNEL_DEFINITIONS)) {
      if (definition.ingestion === "live" && definition.key !== "all") {
        assert.equal(
          definition.canRead,
          true,
          `${definition.key} claims live ingestion but cannot be read`,
        );
      }
    }
  });

  test("a human can reply on a social thread", () => {
    assert.equal(canReplyOn("messenger", true), true);
    assert.equal(canReplyOn("instagram", true), true);
  });

  test("a thread with no lead cannot be replied to", () => {
    assert.equal(canReplyOn("messenger", false), false);
  });

  test("the window is reported with hours remaining", () => {
    const window = replyWindow(
      "instagram",
      new Date("2026-09-08T08:00:00Z").toISOString(),
      now,
    );
    assert.equal(window.state, "OPEN");
    assert.equal(window.state === "OPEN" && window.hoursLeft, 20);
  });

  test("past 24 hours the assistant stops but a person may still answer", () => {
    // Meta permits a human to respond for seven days using the human-agent tag.
    // Reporting this as CLOSED would have customers abandon threads they could
    // still rescue.
    const window = replyWindow(
      "messenger",
      new Date("2026-09-05T08:00:00Z").toISOString(),
      now,
    );
    assert.equal(window.state, "HUMAN_ONLY");
    assert.equal(window.state === "HUMAN_ONLY" && window.daysLeft, 4);
  });

  test("past seven days the thread is genuinely closed", () => {
    const window = replyWindow(
      "instagram",
      new Date("2026-08-25T08:00:00Z").toISOString(),
      now,
    );
    assert.equal(window.state, "CLOSED");
  });

  test("email has no window at all", () => {
    assert.equal(replyWindow("email", null, now).state, "NOT_APPLICABLE");
  });
});

/* -------------------------------------------------- enrichment lawfulness */

describe("what may lawfully be used as a contact detail", () => {
  test("a business address on a company domain is permitted", () => {
    const result = assessEmail("priya@thamesplumbing.co.uk", true);
    assert.equal(result.verdict, "PERMITTED");
    assert.equal(result.subscriberType, "CORPORATE");
  });

  test("a personal mailbox is refused, not merely flagged", () => {
    // `compliance/types.ts` lists harvested personal email addresses among the
    // sources that are never permitted. Before this gate existed that was a
    // paragraph in a settings page with nothing enforcing it.
    for (const address of [
      "priya.shah@gmail.com",
      "dave@hotmail.co.uk",
      "sam@btinternet.com",
      "jo@icloud.com",
    ]) {
      const result = assessEmail(address, true);
      assert.equal(result.verdict, "REFUSED", `${address} should be refused`);
      assert.equal(result.code, "CONSUMER_MAILBOX");
      assert.equal(result.subscriberType, "INDIVIDUAL");
    }
  });

  test("a disposable address is refused for a different reason", () => {
    const result = assessEmail("x@mailinator.com", true);
    assert.equal(result.verdict, "REFUSED");
    assert.equal(result.code, "DISPOSABLE_MAILBOX");
  });

  test("a role address is kept, because it is the safest of all", () => {
    // The instinct is to strip these. An info@ address is published by the
    // business for exactly this purpose and belongs to the organisation rather
    // than to a named person — under PECR it is a corporate subscriber's
    // address. It is a weaker sales lead, which is a commercial judgement and
    // not a legal one.
    const result = assessEmail("info@thamesplumbing.co.uk", true);
    assert.equal(result.verdict, "PERMITTED");
    assert.equal(result.subscriberType, "CORPORATE");
  });

  test("an address with no recorded provenance is refused", () => {
    // Accountability requires being able to *demonstrate* the lawful basis. A
    // detail whose origin nobody recorded cannot be demonstrated, so it is
    // refused rather than quietly allowed by a parameter somebody forgot.
    const result = assessEmail("priya@thamesplumbing.co.uk", false);
    assert.equal(result.verdict, "REFUSED");
    assert.equal(result.code, "NO_PROVENANCE");
  });

  test("a UK landline is a corporate subscriber", () => {
    const result = assessPhone("020 7946 0018", true);
    assert.equal(result.verdict, "PERMITTED");
    assert.equal(result.subscriberType, "CORPORATE");
  });

  test("a UK mobile is a review, never an automatic yes", () => {
    // The most expensive wrong answer in the module. A mobile may be a company
    // line or a sole trader's personal phone; only the second needs TPS
    // screening, and nothing in the number says which.
    const result = assessPhone("07700 900123", true);
    assert.equal(result.verdict, "REVIEW");
    assert.equal(result.code, "PERSONAL_MOBILE");
    assert.equal(result.subscriberType, "UNKNOWN");
  });

  test("+44 and 0 forms of the same number agree", () => {
    assert.equal(
      assessPhone("+447700900123", true).code,
      assessPhone("07700900123", true).code,
    );
  });

  test("premium and personal-numbering ranges are refused", () => {
    for (const number of ["09011234567", "07011234567", "01184960000"]) {
      const result = assessPhone(number, true);
      if (number.startsWith("0118")) {
        // 0118 is Reading's geographic code, not the 118 directory range. The
        // rule must not confuse the two.
        assert.equal(result.verdict, "PERMITTED");
      } else {
        assert.equal(result.verdict, "REFUSED", `${number} should be refused`);
      }
    }
  });

  test("the strictest verdict across a contact set wins", () => {
    // A good business email plus a mobile is REVIEW, not PERMITTED: the mobile
    // is the thing somebody might call.
    const decision = assessContacts(
      { email: "priya@thamesplumbing.co.uk", phone: "07700900123" },
      true,
    );
    assert.equal(decision.verdict, "REVIEW");
    assert.equal(decision.email, "priya@thamesplumbing.co.uk");
    assert.equal(decision.phone, "07700900123");
  });

  test("a refused detail is dropped from the record, not carried with a flag", () => {
    // Carrying it would leave a personal address in the database with nothing
    // but a boolean between it and a send. There is no lawful basis to hold it,
    // so it is not held.
    const decision = assessContacts(
      { email: "priya.shah@gmail.com", phone: "02079460018" },
      true,
    );
    assert.equal(decision.email, null);
    assert.equal(decision.phone, "02079460018");
    assert.equal(decision.verdict, "PERMITTED");
  });

  test("a contact set with nothing usable is refused outright", () => {
    const decision = assessContacts(
      { email: "someone@gmail.com", phone: "09011234567" },
      true,
    );
    assert.equal(decision.verdict, "REFUSED");
    assert.equal(decision.email, null);
    assert.equal(decision.phone, null);
  });
});

/* ------------------------------------------------ what the routes promise */

describe("the routes describe what Meta actually permits", () => {
  test("social routes produce Prospects; lead forms produce Leads", () => {
    // The distinction the whole approval model rests on. Someone we found has
    // not asked for anything; someone who filled in a form has.
    assert.equal(ROUTES.instagram_social.destination, "PROSPECTS");
    assert.equal(ROUTES.facebook_social.destination, "PROSPECTS");
    assert.equal(ROUTES.lead_forms.destination, "LEADS");
  });

  test("both Meta routes state that they cannot reach a cold audience", () => {
    for (const route of [ROUTES.facebook_social, ROUTES.instagram_social]) {
      assert.match(route.limitation, /has not interacted|no way for a Page to follow|no follow, no cold DM/i);
    }
  });

  test("both Meta routes begin with something the person did", () => {
    // The rule that makes them lawful. Meta offers no way to reach somebody who
    // has not interacted, so a route that opened with an outbound step would be
    // describing something the platform does not do.
    for (const route of [ROUTES.facebook_social, ROUTES.instagram_social]) {
      const first = route.stages[0];
      assert.equal(first.key, "engage", `${route.key} does not start with engagement`);
      assert.equal(first.waitsOnRecipient, true);

      const engageAt = route.stages.findIndex((stage) => stage.key === "engage");
      const replyAt = route.stages.findIndex((stage) => stage.key === "private_reply");
      assert.ok(replyAt > engageAt, `${route.key} replies before they engage`);
    }
  });

  test("both Meta routes state the one-reply-per-comment limit", () => {
    for (const route of [ROUTES.facebook_social, ROUTES.instagram_social]) {
      assert.match(route.limitation, /one private reply per comment/i);
      assert.match(route.limitation, /seven days/i);
    }
  });

  test("LinkedIn and TikTok still gate on an acceptance the recipient controls", () => {
    // These two genuinely are connect-then-message: no private-reply equivalent
    // exists on either platform.
    for (const route of [ROUTES.linkedin_social, ROUTES.tiktok_social]) {
      const accepted = route.stages.find((stage) => stage.key === "accepted");
      assert.ok(accepted, `${route.key} has no acceptance stage`);
      assert.equal(accepted.waitsOnRecipient, true);

      const acceptedAt = route.stages.findIndex((stage) => stage.key === "accepted");
      const messageAt = route.stages.findIndex((stage) => stage.key === "message");
      assert.ok(messageAt > acceptedAt, `${route.key} messages before acceptance`);
    }
  });

  test("the lead-form route responds immediately and needs no approval", () => {
    const keys = ROUTES.lead_forms.stages.map((stage) => stage.key);
    assert.ok(keys.includes("respond"));
    assert.ok(keys.includes("consent"));
    // No approval stage: they already gave permission, and inserting one would
    // throw away the speed advantage that is the route's entire point.
    assert.equal(keys.includes("approve"), false);
  });
});
