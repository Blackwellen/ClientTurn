import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SOCIAL_PLATFORMS,
  SOCIAL_STATES,
  canInvite,
  canMessage,
  isTerminal,
  limitsFor,
  shouldAttachNote,
  socialCapacity,
  MAX_SOCIAL_MESSAGE_CHARS,
  type SocialState,
} from "../src/lib/outreach/social-limits.ts";
import {
  CHANNEL_LIMITS,
  isMetaAgentChannel,
  isPlatformAgentChannel,
} from "../src/lib/agent/types.ts";
import {
  CHANNEL_DEFINITIONS,
  INBOX_CHANNELS,
  type InboxChannel,
} from "../src/lib/inbox/types.ts";

/**
 * The TikTok flow, end to end, at the level that can be tested without a
 * database: find someone, follow them, wait for the follow-back, then message.
 *
 * The tests below are deliberately about **invariants that must not drift**
 * rather than about particular numbers. Every one of them corresponds to a way
 * the flow could be broken by a plausible future change, and in most cases the
 * damage would be silent — a message the platform refuses, a tab that lies
 * about what it contains, or an account restricted for going too fast.
 */

describe("the follow gate", () => {
  /**
   * The single most important rule on this channel.
   *
   * TikTok will not deliver a direct message until the recipient follows you
   * back — it is an API refusal, not a deliverability preference. A change that
   * let `canMessage` return true one state early would produce a queue full of
   * sends that silently fail, and would burn the one approach the customer
   * gets at each person.
   */
  test("a message is impossible before acceptance, in every pre-acceptance state", () => {
    const beforeAcceptance: SocialState[] = [
      "NOT_CONNECTED",
      "INVITE_QUEUED",
      "INVITE_SENT",
      "DECLINED",
      "WITHDRAWN",
      "BLOCKED",
    ];

    for (const state of beforeAcceptance) {
      assert.equal(
        canMessage(state),
        false,
        `${state} must not permit a message: TikTok refuses the send until the follow is reciprocated`,
      );
    }
  });

  test("acceptance, and only acceptance, opens the channel", () => {
    for (const state of ["ACCEPTED", "MESSAGED", "REPLIED"] as SocialState[]) {
      assert.equal(canMessage(state), true, `${state} should permit a message`);
    }
  });

  /**
   * Every state is either messageable or not — there is no third answer. This
   * catches a new state being added to `SOCIAL_STATES` without anyone deciding
   * which side of the gate it falls on, which is exactly the kind of omission
   * that defaults to the dangerous answer.
   */
  test("every declared state has an explicit answer at the gate", () => {
    for (const state of SOCIAL_STATES) {
      assert.equal(
        typeof canMessage(state),
        "boolean",
        `${state} must have a defined messageability`,
      );
      assert.equal(typeof canInvite(state), "boolean");
    }
  });

  /**
   * A declined invite is the recipient's decision and it is final. Withdrawing
   * and re-sending to somebody who already said no is precisely the behaviour
   * that gets an account restricted, so it must not be reachable.
   */
  test("declined and blocked are terminal and never re-invitable", () => {
    for (const state of ["DECLINED", "BLOCKED"] as SocialState[]) {
      assert.equal(isTerminal(state), true);
      assert.equal(canInvite(state), false, `${state} must never be re-invited`);
      assert.equal(canMessage(state), false);
    }
  });
});

describe("TikTok account limits", () => {
  test("TikTok is a first-class platform with published caps", () => {
    assert.ok(SOCIAL_PLATFORMS.includes("TIKTOK"));

    const limits = limitsFor("TIKTOK", "BUSINESS_PAGE");
    assert.ok(limits, "TikTok business accounts must have limits defined");
  });

  /**
   * TikTok is the most restricted of the four channels, and the caps encode
   * that. If a future edit raised them above the Meta figures it would suggest
   * somebody had copied a row rather than researched it — the direction of the
   * inequality is the thing worth pinning, not the numbers themselves.
   */
  test("TikTok messaging is capped no higher than the Meta channels", () => {
    const tiktok = limitsFor("TIKTOK", "BUSINESS_PAGE");
    const instagram = limitsFor("INSTAGRAM", "BUSINESS_PAGE");
    assert.ok(tiktok && instagram);

    assert.ok(
      tiktok.dailyMessages <= instagram.dailyMessages,
      "TikTok's daily message cap must not exceed Instagram's — its gate is stricter, not looser",
    );
  });

  /**
   * There is no invitation note on TikTok. Attaching one would mean composing
   * text that has nowhere to go, and then counting it against a note allowance
   * the platform does not have.
   */
  test("no invitation note is ever attached on TikTok", () => {
    const capacity = socialCapacity(
      { dailyConnects: 30, weeklyConnects: 200, monthlyNotes: 99, dailyMessages: 20, monthlyInMail: 0 },
      { connectsToday: 0, connectsThisWeek: 0, messagesToday: 0, notesThisMonth: 0 },
    );

    const decision = shouldAttachNote(capacity, "TIKTOK");
    assert.equal(decision.attach, false);
    assert.ok(decision.reason, "the UI needs a sentence explaining why");
  });

  /**
   * Running out of capacity is the system working, and the customer is owed a
   * number rather than the word "blocked" — "3 invites left today" is
   * actionable, "blocked" is not.
   */
  test("exhausted capacity reports which axis ran out", () => {
    const limits = {
      dailyConnects: 30,
      weeklyConnects: 200,
      monthlyNotes: 0,
      dailyMessages: 20,
      monthlyInMail: 0,
    };

    const dayExhausted = socialCapacity(limits, {
      connectsToday: 30,
      connectsThisWeek: 40,
      messagesToday: 0,
      notesThisMonth: 0,
    });
    assert.equal(dayExhausted.connectsLeftToday, 0);
    assert.match(dayExhausted.blockedReason ?? "", /today/i);

    const weekExhausted = socialCapacity(limits, {
      connectsToday: 0,
      connectsThisWeek: 200,
      messagesToday: 0,
      notesThisMonth: 0,
    });
    assert.equal(weekExhausted.connectsLeftThisWeek, 0);
    assert.match(weekExhausted.blockedReason ?? "", /week/i);

    // The weekly cap must also bound today's number. Reporting "15 left today"
    // while the week is exhausted would send a customer to a queue that then
    // refuses every action in it.
    assert.equal(weekExhausted.connectsLeftToday, 0);
  });

  test("usage can never drive remaining capacity negative", () => {
    const capacity = socialCapacity(
      { dailyConnects: 30, weeklyConnects: 200, monthlyNotes: 0, dailyMessages: 20, monthlyInMail: 0 },
      // Over cap, which happens when a person acts outside the product.
      { connectsToday: 45, connectsThisWeek: 260, messagesToday: 31, notesThisMonth: 4 },
    );

    assert.equal(capacity.connectsLeftToday, 0);
    assert.equal(capacity.connectsLeftThisWeek, 0);
    assert.equal(capacity.messagesLeftToday, 0);
    assert.equal(capacity.notesLeftThisMonth, 0);
  });
});

describe("the agent on a TikTok DM", () => {
  test("tiktok is a channel the agent can hold a conversation on", () => {
    assert.ok(CHANNEL_LIMITS.tiktok, "the agent must know how long a TikTok message may be");
  });

  /**
   * The agent's preferred length is a judgement about what gets replies, and it
   * sits far below the platform's own ceiling. Pinning the relationship stops a
   * future edit from "simplifying" the two into one number, which would produce
   * essays in a chat thread.
   */
  test("the agent aims far below the platform ceiling", () => {
    assert.ok(
      CHANNEL_LIMITS.tiktok.preferred < CHANNEL_LIMITS.tiktok.hard,
      "preferred must leave room before the hard limit",
    );
    assert.ok(
      CHANNEL_LIMITS.tiktok.hard < MAX_SOCIAL_MESSAGE_CHARS,
      "the agent's hard limit must stay inside what the platform itself accepts",
    );
    assert.ok(
      CHANNEL_LIMITS.tiktok.preferred < CHANNEL_LIMITS.email.preferred,
      "a DM must be shorter than an email",
    );
  });

  /**
   * TikTok is addressed by a platform id, like Messenger — but its gate is a
   * follow-back, which does not expire, whereas Meta's 24-hour window does.
   * Treating TikTok as a Meta channel would apply a countdown to conversations
   * the platform was perfectly willing to deliver, silently stopping them.
   */
  test("TikTok is a platform channel but not a Meta reply-window channel", () => {
    assert.equal(isPlatformAgentChannel("tiktok"), true);
    assert.equal(isMetaAgentChannel("tiktok"), false);

    assert.equal(isMetaAgentChannel("messenger"), true);
    assert.equal(isMetaAgentChannel("instagram"), true);

    // And the phone/mailbox channels are neither.
    assert.equal(isPlatformAgentChannel("sms"), false);
    assert.equal(isPlatformAgentChannel("email"), false);
  });
});

describe("the inbox catalogue tells the truth", () => {
  test("TikTok is present, and honest about not being readable", () => {
    assert.ok(INBOX_CHANNELS.includes("tiktok"));

    const tiktok = CHANNEL_DEFINITIONS.tiktok;
    assert.equal(tiktok.canRead, false, "TikTok publishes no API that reads direct messages");
    assert.equal(
      tiktok.ingestion,
      "recorded",
      "threads exist because the outreach queue records them, not because anything syncs",
    );
    assert.ok(
      tiktok.emptyExplanation.length > 0,
      "an empty TikTok tab must explain itself rather than reading as 'you have no messages'",
    );
  });

  /**
   * The invariant the `ChannelIngestion` type was introduced for: a channel we
   * cannot read must never claim live ingestion. Getting this wrong is how
   * Messenger and Instagram once shipped as tabs that could never contain a
   * conversation, and the empty state read as "you have no messages" when it
   * meant "we cannot fetch them".
   */
  test("no channel claims live ingestion of something it cannot read", () => {
    for (const key of INBOX_CHANNELS) {
      const definition = CHANNEL_DEFINITIONS[key as InboxChannel];
      if (!definition.canRead) {
        assert.notEqual(
          definition.ingestion,
          "live",
          `${key} cannot be read, so it must not claim live ingestion`,
        );
      }
    }
  });

  test("every channel in the union has a definition and an empty explanation", () => {
    for (const key of INBOX_CHANNELS) {
      const definition = CHANNEL_DEFINITIONS[key as InboxChannel];
      assert.ok(definition, `${key} must have a definition`);
      assert.equal(definition.key, key, `${key}'s definition must be self-consistent`);
      assert.ok(definition.label.length > 0);
      assert.ok(
        definition.emptyExplanation.length > 0,
        `${key} must explain its empty state`,
      );
    }
  });

  /**
   * A channel that cannot be read cannot be sent to either, on the platforms
   * where the same absent API governs both. This is what stops the UI offering
   * a reply box on a thread nothing could deliver.
   */
  test("the recorded channels do not offer sending", () => {
    for (const key of INBOX_CHANNELS) {
      const definition = CHANNEL_DEFINITIONS[key as InboxChannel];
      if (definition.ingestion === "recorded") {
        assert.equal(
          definition.canSend,
          false,
          `${key} records replies rather than delivering them, so it must not claim it can send`,
        );
        assert.ok(
          definition.requires,
          `${key} must say what has to be connected before it does anything`,
        );
      }
    }
  });
});

/* ------------------------------------------------- the post-acceptance gate */

import { canSend } from "../src/lib/policy/channel-policy.ts";
import { isWarmRelationship } from "../src/lib/policy/types.ts";
import type {
  CompliancePolicyPack,
  PolicyInput,
} from "../src/lib/policy/types.ts";

/**
 * The pack shipped by migration 0077. Cold stays email-only; SOCIAL is warm and
 * still requires a recorded relationship.
 */
const UK_PACK_0077: CompliancePolicyPack = {
  version: "uk-2026.09.2",
  name: "United Kingdom",
  countryCodes: ["GB"],
  cold: {
    allowedChannels: ["EMAIL"],
    allowedSubscriberTypes: ["CORPORATE", "PARTNERSHIP"],
    reviewSubscriberTypes: ["SOLE_TRADER", "UNKNOWN"],
    blockedSubscriberTypes: ["INDIVIDUAL"],
    requirePostalFooter: true,
    requireUnsubscribe: true,
  },
  warm: {
    allowedChannels: ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"],
    requireRelationship: true,
    requireUnsubscribe: true,
  },
  quietHours: { start: "20:00", end: "08:00", channels: ["SMS", "WHATSAPP"] },
};

function socialInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    channel: "SOCIAL",
    campaignType: "WARM",
    country: "GB",
    subscriberType: "CORPORATE",
    relationshipType: "ACCEPTED_SOCIAL_CONNECTION",
    consentStatus: "UNKNOWN",
    hasConsentEvidence: false,
    sourcePermitted: "PERMITTED",
    destination: "https://www.tiktok.com/@acmeroofing",
    suppression: null,
    optedOut: false,
    businessActive: true,
    senderAvailable: true,
    senderHealth: "HEALTHY",
    withinDailyCap: true,
    withinMonthlyCap: true,
    withinBudget: true,
    localTime: { hour: 10, minute: 0 },
    pack: UK_PACK_0077,
    ...overrides,
  };
}

describe("messaging someone who accepted your follow", () => {
  /**
   * The behaviour this whole change exists for. Before it, the scheduler
   * evaluated every social action as COLD, the UK pack listed EMAIL as the only
   * cold channel, and every TikTok prospect halted at BLOCKED_COLD_CHANNEL —
   * the flow could never send anything.
   */
  test("an accepted connection makes a social message permitted", () => {
    const result = canSend(socialInput());
    assert.equal(result.outcome, "ALLOWED", result.message);
  });

  test("acceptance counts as a warm relationship", () => {
    assert.equal(isWarmRelationship("ACCEPTED_SOCIAL_CONNECTION"), true);
    // And the one that must never be warm stays cold.
    assert.equal(isWarmRelationship("FOUND_BY_US"), false);
  });

  /**
   * The other half of the rule, and the more important half to pin. Permitting
   * the post-acceptance message must not quietly permit a cold DM to a stranger
   * — that is the behaviour that gets accounts banned and customers fined.
   */
  test("a cold social message is still refused", () => {
    const result = canSend(
      socialInput({ campaignType: "COLD", relationshipType: "FOUND_BY_US" }),
    );
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.reasonCode, "BLOCKED_COLD_CHANNEL");
  });

  /**
   * Warm is not a free pass either: the warm rules require a relationship, and
   * a prospect we merely found does not have one. Without this, "warm" would
   * become a way to send to anybody simply by labelling the send differently.
   */
  test("warm social without a relationship still needs permission", () => {
    const result = canSend(socialInput({ relationshipType: "FOUND_BY_US" }));
    assert.notEqual(result.outcome, "ALLOWED");
    assert.equal(result.reasonCode, "BLOCKED_NO_PERMISSION");
  });

  test("an opt-out beats an acceptance", () => {
    const optedOut = canSend(socialInput({ optedOut: true }));
    assert.equal(optedOut.outcome, "BLOCKED");
    assert.equal(optedOut.reasonCode, "BLOCKED_OPT_OUT");

    const withdrawn = canSend(socialInput({ consentStatus: "WITHDRAWN" }));
    assert.equal(withdrawn.outcome, "BLOCKED");
    assert.equal(withdrawn.reasonCode, "BLOCKED_OPT_OUT");
  });

  test("suppression beats an acceptance", () => {
    const result = canSend(
      socialInput({ suppression: { reason: "COMPLAINT", scope: "PLATFORM" } }),
    );
    assert.equal(result.outcome, "BLOCKED");
  });

  /**
   * The subscriber-type rules live on the **cold** ruleset only, and that is
   * deliberate rather than an oversight — so it is pinned here, because the
   * asymmetry is surprising enough that someone would otherwise "fix" it.
   *
   * Cold refuses an individual subscriber outright: PECR requires consent to
   * market to one, and a stranger has given none. Warm carries no such list
   * because this product's warm leads *are* individuals — a homeowner who
   * enquired about a new boiler is an individual subscriber, and a rule that
   * blocked them would stop the core product working.
   *
   * What separates the two is the relationship, and warm already demands one.
   * So an individual who accepted a follow can be messaged, and an individual
   * who did not, cannot.
   */
  test("cold refuses an individual subscriber", () => {
    const result = canSend(
      socialInput({
        campaignType: "COLD",
        channel: "EMAIL",
        subscriberType: "INDIVIDUAL",
        relationshipType: "FOUND_BY_US",
      }),
    );
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.reasonCode, "BLOCKED_SUBSCRIBER_TYPE");
  });

  test("warm permits an individual, but only with a relationship", () => {
    // Accepted the follow: permitted, and the acceptance is what carries it.
    const accepted = canSend(socialInput({ subscriberType: "INDIVIDUAL" }));
    assert.equal(accepted.outcome, "ALLOWED", accepted.message);

    // No relationship: refused, whatever the campaign is labelled.
    const stranger = canSend(
      socialInput({ subscriberType: "INDIVIDUAL", relationshipType: "FOUND_BY_US" }),
    );
    assert.notEqual(stranger.outcome, "ALLOWED");
  });
});

/* ------------------------------------------- the agent's own send-time gate */

import { evaluateSendGate } from "../src/lib/agent/policy.ts";
import type { SendGateSnapshot } from "../src/lib/agent/policy.ts";
import type { AgentChannel } from "../src/lib/agent/types.ts";

function agentSend(overrides: Partial<SendGateSnapshot> = {}): SendGateSnapshot {
  return {
    agentMode: "AUTO_REPLY",
    channel: "tiktok",
    contactSuppressed: false,
    hasDestination: true,
    providerHealthy: true,
    lastInboundAt: new Date("2026-09-06T13:30:00Z").toISOString(),
    socialConnectionState: "ACCEPTED",
    quietHours: {
      enabled: true,
      start: "20:00",
      end: "08:00",
      timezone: "Europe/London",
    },
    now: new Date("2026-09-06T14:00:00Z"),
    ...overrides,
  };
}

describe("the agent re-checks the follow gate before every send", () => {
  /**
   * The gap this closes. On TikTok and LinkedIn the permission to send is the
   * relationship, not the thread — and somebody can unfollow, withdraw a
   * connection or block the account at any moment. None of those arrive as an
   * inbound message, so an agent that trusted the conversation's existence
   * would keep replying into a channel that had been closed to it. That is
   * precisely what gets an account reported.
   */
  test("an agent reply is allowed while the connection stands", () => {
    for (const state of ["ACCEPTED", "MESSAGED", "REPLIED"]) {
      const result = evaluateSendGate(agentSend({ socialConnectionState: state }));
      assert.notEqual(
        result.decision,
        "DENY",
        `${state} should still permit an agent reply`,
      );
    }
  });

  test("a withdrawn or blocked connection stops the agent", () => {
    for (const state of ["NOT_CONNECTED", "INVITE_SENT", "DECLINED", "WITHDRAWN", "BLOCKED"]) {
      const result = evaluateSendGate(agentSend({ socialConnectionState: state }));
      assert.equal(
        result.decision,
        "DENY",
        `${state} must stop the agent replying`,
      );
      assert.equal(
        result.decision === "DENY" && result.code,
        "SOCIAL_NOT_CONNECTED",
      );
    }
  });

  /**
   * A missing row is a refusal, not a default. If the connection cannot be
   * found the gate cannot be shown to have been passed, and on these platforms
   * the send would be refused anyway — so denying is both safe and accurate.
   */
  test("no recorded connection is a refusal", () => {
    const result = evaluateSendGate(agentSend({ socialConnectionState: null }));
    assert.equal(result.decision, "DENY");
    assert.equal(result.decision === "DENY" && result.code, "SOCIAL_NOT_CONNECTED");
  });

  /**
   * The gate must not leak onto channels it does not describe. Meta has no
   * connection to accept — a Page cannot follow a person — so applying it there
   * would deny every reply Meta was willing to deliver.
   */
  test("the connection gate does not apply to Meta or to phone channels", () => {
    for (const channel of ["messenger", "instagram", "sms", "whatsapp", "email"] as AgentChannel[]) {
      const result = evaluateSendGate(
        agentSend({ channel, socialConnectionState: null }),
      );
      assert.notEqual(
        result.decision === "DENY" && result.code,
        "SOCIAL_NOT_CONNECTED",
        `${channel} has no connection to accept, so this gate must not fire on it`,
      );
    }
  });

  /**
   * The agent's private copy of the rule must not drift from the outreach
   * layer's. `agent/policy.ts` is deliberately pure and cannot import the
   * outreach module, so the two are asserted equivalent here instead — a drift
   * would let a turn decide to send something the outreach layer refuses.
   */
  test("the agent's gate agrees with the outreach layer's, state for state", () => {
    for (const state of SOCIAL_STATES) {
      const agentAllows =
        evaluateSendGate(agentSend({ socialConnectionState: state })).decision !== "DENY";

      assert.equal(
        agentAllows,
        canMessage(state),
        `the agent and the outreach layer disagree about "${state}"`,
      );
    }
  });

  test("suppression still outranks a standing connection", () => {
    const result = evaluateSendGate(agentSend({ contactSuppressed: true }));
    assert.equal(result.decision, "DENY");
    assert.equal(result.decision === "DENY" && result.code, "CONTACT_SUPPRESSED");
  });
});
