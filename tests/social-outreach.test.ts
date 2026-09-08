import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SEQUENCE_SETTINGS,
  decideSocialSequence,
  finalStep,
  nextActionAtFor,
  nextActionFor,
  type SocialSequenceInput,
  type SocialSequenceSettings,
} from "../src/lib/outreach/social-sequence.ts";
import {
  checkComposedCopy,
  renderSocialTemplate,
  truncateAtWord,
} from "../src/lib/outreach/social-copy.ts";
import {
  assessContacts,
  assessEmail,
  assessPhone,
  lawfulBasisFor,
} from "../src/lib/find-leads/contact-legality.ts";
import {
  avatarPolicyFor,
  mayStoreAvatar,
  resolveAvatar,
} from "../src/lib/prospects/avatar.ts";

/**
 * Connect-then-message, end to end at the decision layer.
 *
 * Everything asserted here decides whether a customer's own LinkedIn account
 * performs an action. The failure modes are not "the page looks wrong" -- they
 * are a follow-up sent to somebody who already replied, a second invite to
 * somebody who declined, a message containing a price nobody authorised, or an
 * account restricted for exceeding a cap. None of those announce themselves in
 * a staging environment, which is why the logic is pure and tested here rather
 * than only exercised through the database.
 */

const NOW = new Date("2026-03-10T10:00:00.000Z");

function input(overrides: Partial<SocialSequenceInput> = {}): SocialSequenceInput {
  return {
    state: "NOT_CONNECTED",
    sequenceStep: 0,
    inviteSentAt: null,
    acceptedAt: null,
    lastOutboundAt: null,
    repliedAt: null,
    hasPendingDraft: false,
    promoted: false,
    settings: DEFAULT_SEQUENCE_SETTINGS,
    now: NOW,
    ...overrides,
  };
}

/* ==================================================== the gate and the clock */

describe("the platform's gate", () => {
  test("a cold prospect is invited, never messaged", () => {
    const decision = decideSocialSequence(input());
    assert.equal(decision.action, "INVITE");
  });

  test("a pending invite is never messaged, however long it has been", () => {
    // The single most important rule on this channel. A message before
    // acceptance is impossible on LinkedIn and invisible on Meta, so attempting
    // it wastes the one approach the customer gets.
    const decision = decideSocialSequence(
      input({
        state: "INVITE_SENT",
        inviteSentAt: "2026-03-01T10:00:00.000Z",
      }),
    );
    assert.equal(decision.action, "WAIT");
  });

  test("acceptance opens the door, and the opener is due immediately", () => {
    const decision = decideSocialSequence(
      input({ state: "ACCEPTED", acceptedAt: NOW.toISOString() }),
    );
    assert.equal(decision.action, "COMPOSE");
    assert.equal(decision.kind, "OPENER");
    assert.equal(decision.step, 1);
  });
});

describe("invites that go unanswered", () => {
  test("withdrawn once past the workspace's window, to free the allowance", () => {
    const decision = decideSocialSequence(
      input({
        state: "INVITE_SENT",
        // 22 days: one past the default 21.
        inviteSentAt: "2026-02-16T10:00:00.000Z",
      }),
    );
    assert.equal(decision.action, "WITHDRAW");
  });

  test("waits, with a due time, while still inside the window", () => {
    const decision = decideSocialSequence(
      input({ state: "INVITE_SENT", inviteSentAt: "2026-03-08T10:00:00.000Z" }),
    );
    assert.equal(decision.action, "WAIT");
    assert.ok(decision.nextActionAt > NOW, "should be scheduled in the future");
  });

  test("a workspace that disables withdrawal never withdraws", () => {
    const settings: SocialSequenceSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      withdrawAfterDays: null,
    };
    const decision = decideSocialSequence(
      input({
        state: "INVITE_SENT",
        inviteSentAt: "2020-01-01T00:00:00.000Z",
        settings,
      }),
    );
    assert.equal(decision.action, "WAIT");
  });

  test("an invite with no recorded time is not aged into a withdrawal", () => {
    // Treating an unknown age as stale would withdraw a request sent an hour
    // ago. The row waits a day instead, by which time the timestamp exists.
    const decision = decideSocialSequence(
      input({ state: "INVITE_SENT", inviteSentAt: null }),
    );
    assert.equal(decision.action, "WAIT");
  });

  test("a withdrawn invite is never re-sent", () => {
    // `canInvite` permits it because the platform does. The product refuses,
    // because re-inviting somebody who ignored you is what restricts accounts.
    const decision = decideSocialSequence(input({ state: "WITHDRAWN" }));
    assert.equal(decision.action, "HALT");
  });

  test("a declined invite is terminal", () => {
    const decision = decideSocialSequence(input({ state: "DECLINED" }));
    assert.equal(decision.action, "HALT");
  });
});

/* ============================================================ the sequence */

describe("follow-ups", () => {
  const messaged = (over: Partial<SocialSequenceInput> = {}) =>
    input({
      state: "MESSAGED",
      sequenceStep: 1,
      acceptedAt: "2026-03-01T10:00:00.000Z",
      lastOutboundAt: "2026-03-01T10:00:00.000Z",
      ...over,
    });

  test("a follow-up fires once the gap has elapsed", () => {
    // Default gap is 96 hours; the last message was nine days ago.
    const decision = decideSocialSequence(messaged());
    assert.equal(decision.action, "COMPOSE");
    assert.equal(decision.kind, "FOLLOW_UP");
    assert.equal(decision.step, 2);
  });

  test("nothing fires before the gap has elapsed", () => {
    const decision = decideSocialSequence(
      messaged({ lastOutboundAt: "2026-03-09T10:00:00.000Z" }),
    );
    assert.equal(decision.action, "WAIT");
  });

  test("the gap is measured from the last message, not from acceptance", () => {
    // An ASSISTED send may happen days after acceptance. Measuring from
    // acceptance would collapse the opener and its follow-up into one
    // afternoon, which reads as a bot to the person receiving them.
    const decision = decideSocialSequence(
      messaged({
        acceptedAt: "2026-02-01T10:00:00.000Z",
        lastOutboundAt: "2026-03-09T12:00:00.000Z",
      }),
    );
    assert.equal(decision.action, "WAIT");
  });

  test("stops after the workspace's ceiling, rather than chasing forever", () => {
    // Default is two follow-ups, so step 3 is the last one sent.
    const decision = decideSocialSequence(messaged({ sequenceStep: 3 }));
    assert.equal(decision.action, "HALT");
  });

  test("a workspace that sends no follow-ups halts after the opener", () => {
    const settings: SocialSequenceSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      maxFollowUps: 0,
    };
    assert.equal(finalStep(settings), 1);
    const decision = decideSocialSequence(messaged({ settings }));
    assert.equal(decision.action, "HALT");
  });

  test("the ceiling can never exceed what the column permits", () => {
    // A settings row edited past the cap must not produce a decision the
    // database's own 0..3 check would reject.
    const settings: SocialSequenceSettings = {
      ...DEFAULT_SEQUENCE_SETTINGS,
      maxFollowUps: 99,
    };
    assert.equal(finalStep(settings), 3);
  });
});

describe("a reply ends everything", () => {
  test("a replied state halts, whatever step it had reached", () => {
    const decision = decideSocialSequence(
      input({
        state: "REPLIED",
        sequenceStep: 1,
        lastOutboundAt: "2026-01-01T10:00:00.000Z",
      }),
    );
    assert.equal(decision.action, "HALT");
  });

  test("a reply timestamp halts even if the state has not caught up", () => {
    // The two writes are not atomic. A follow-up that is technically due to
    // somebody who answered yesterday is the worst message the product sends,
    // so either signal alone is enough to stop.
    const decision = decideSocialSequence(
      input({
        state: "MESSAGED",
        sequenceStep: 1,
        lastOutboundAt: "2026-01-01T10:00:00.000Z",
        repliedAt: "2026-03-09T10:00:00.000Z",
      }),
    );
    assert.equal(decision.action, "HALT");
  });

  test("a promoted prospect is left to the agent", () => {
    const decision = decideSocialSequence(
      input({ state: "MESSAGED", sequenceStep: 1, promoted: true }),
    );
    assert.equal(decision.action, "HALT");
  });
});

describe("one message at a time", () => {
  test("a composed-but-unsent message blocks composing another", () => {
    // In ASSISTED mode a draft waits hours for a person. Composing a second on
    // top of it is how a prospect receives two openers.
    const decision = decideSocialSequence(
      input({
        state: "ACCEPTED",
        acceptedAt: NOW.toISOString(),
        hasPendingDraft: true,
      }),
    );
    assert.equal(decision.action, "WAIT");
  });
});

describe("the clock the sweeper reads", () => {
  test("a halt clears the clock, so a dead row is never swept again", () => {
    const decision = decideSocialSequence(input({ state: "DECLINED" }));
    assert.equal(nextActionAtFor(decision, NOW), null);
    assert.equal(nextActionFor(decision), null);
  });

  test("an action keeps the clock at now, so a failure retries next sweep", () => {
    const decision = decideSocialSequence(
      input({ state: "ACCEPTED", acceptedAt: NOW.toISOString() }),
    );
    assert.equal(nextActionAtFor(decision, NOW)?.getTime(), NOW.getTime());
  });

  test("the column's verbs match the database's check constraint", () => {
    const opener = decideSocialSequence(
      input({ state: "ACCEPTED", acceptedAt: NOW.toISOString() }),
    );
    assert.equal(nextActionFor(opener), "MESSAGE");

    const chase = decideSocialSequence(
      input({
        state: "MESSAGED",
        sequenceStep: 1,
        lastOutboundAt: "2026-03-01T10:00:00.000Z",
      }),
    );
    assert.equal(nextActionFor(chase), "FOLLOW_UP");

    assert.equal(nextActionFor(decideSocialSequence(input())), "INVITE");
  });
});

/* ================================================================ the copy */

describe("what a model is allowed to say under the customer's name", () => {
  const supplied = ["Their company is called Northgate Roofing."];

  const check = (body: string, usedFacts: string[] = []) =>
    checkComposedCopy({ body, usedFacts, suppliedFacts: supplied, kind: "OPENER" });

  test("a plain, factual message passes", () => {
    const result = check(
      "Thanks for connecting. We work with roofing firms on lead follow-up. Is that something you handle?",
    );
    assert.equal(result.ok, true);
  });

  test("a price is refused", () => {
    const result = check("We can do this for £499 a month.");
    assert.equal(result.ok, false);
    assert.ok(result.rejections.some((r) => r.rule.includes("price")));
  });

  test("a free quote is refused", () => {
    assert.equal(check("Happy to offer a free quote.").ok, false);
  });

  test("a guarantee is refused", () => {
    assert.equal(check("We guarantee more bookings.").ok, false);
    assert.equal(check("We can save you 40% on admin.").ok, false);
  });

  test("an invented availability is refused", () => {
    // The agent may only offer a slot the calendar returned. A composer has no
    // calendar at all.
    assert.equal(check("I'm free on Thursday if that suits.").ok, false);
  });

  test("a promised timescale is refused", () => {
    assert.equal(check("We can have you live within 5 days.").ok, false);
  });

  test("an invented prior conversation is refused", () => {
    // The most effective cold-outreach lie, and the one the recipient can
    // disprove instantly.
    assert.equal(check("Following up on our call last week.").ok, false);
    assert.equal(check("As we discussed, here are the details.").ok, false);
    assert.equal(check("You asked about our pricing.").ok, false);
  });

  test("an invented referral is refused", () => {
    assert.equal(check("Our mutual connection suggested I reach out.").ok, false);
  });

  test("a fact that was never supplied is refused", () => {
    const result = check(
      "I saw you just opened a second depot.",
      ["They just opened a second depot."],
    );
    assert.equal(result.ok, false);
    assert.ok(result.rejections.some((r) => r.rule.includes("never supplied")));
  });

  test("a supplied fact is accepted, whatever its casing", () => {
    const result = check("Northgate Roofing looked relevant.", [
      "  their company is called northgate roofing.  ",
    ]);
    assert.equal(result.ok, true);
  });

  test("an over-length message is refused", () => {
    const result = check("x".repeat(2000));
    assert.equal(result.ok, false);
  });

  test("an empty message is refused", () => {
    assert.equal(check("   ").ok, false);
  });
});

describe("the deterministic templates", () => {
  const context = {
    prospect: {
      first_name: "Dan",
      last_name: "Ellis",
      role_title: "Operations Manager",
      company: { name: "Northgate Roofing" },
    },
    businessName: "Client Turn",
    companyType: "roofing firms",
    serviceLine: "lead follow-up",
  };

  test("an invite note fits inside LinkedIn's 300-character limit", () => {
    const body = renderSocialTemplate({
      kind: "INVITE_NOTE",
      platform: "LINKEDIN",
      step: 0,
      context,
    });
    assert.ok(body.length <= 300, `note was ${body.length} characters`);
    assert.ok(body.includes("Dan"));
  });

  test("every template passes the guard it will be checked against", () => {
    // The fallback is what most customers actually receive. A template that
    // would fail the model's own guard would be a rule the product breaks only
    // when its AI is switched off.
    for (const kind of ["OPENER", "FOLLOW_UP"] as const) {
      for (const step of [1, 2, 3]) {
        const body = renderSocialTemplate({
          kind,
          platform: "LINKEDIN",
          step,
          context,
        });
        const result = checkComposedCopy({
          body,
          usedFacts: [],
          suppliedFacts: [],
          kind,
        });
        assert.equal(result.ok, true, `${kind} step ${step}: ${JSON.stringify(result)}`);
      }
    }
  });

  test("the last follow-up says it is the last", () => {
    const body = renderSocialTemplate({
      kind: "FOLLOW_UP",
      platform: "LINKEDIN",
      step: 3,
      context,
    });
    assert.match(body, /last one|won't chase/i);
  });

  test("a missing first name still reads as a sentence", () => {
    const body = renderSocialTemplate({
      kind: "OPENER",
      platform: "LINKEDIN",
      step: 1,
      context: { ...context, prospect: { ...context.prospect, first_name: null } },
    });
    assert.ok(!body.includes(" ,"), "should not render 'Hi ,'");
    assert.ok(body.includes("there"));
  });

  test("truncation never cuts mid-word", () => {
    const out = truncateAtWord("the quick brown fox jumps", 14);
    assert.equal(out, "the quick");
  });
});

/* ==================================================== enrichment guardrails */

describe("what a contact detail is", () => {
  test("a work address at the company's own domain is corporate", () => {
    const result = assessEmail("dan.ellis@northgateroofing.co.uk", true);
    assert.equal(result.verdict, "PERMITTED");
    assert.equal(result.subscriberType, "CORPORATE");
  });

  test("a personal mailbox is an individual subscriber", () => {
    // The consequential case. Under PECR an individual subscriber needs
    // consent that a corporate one does not, and nothing previously derived
    // this from the address itself in the sourcing run.
    const result = assessEmail("dan.ellis@gmail.com", true);
    assert.equal(result.subscriberType, "INDIVIDUAL");
    assert.notEqual(result.verdict, "PERMITTED");
  });

  test("a disposable domain is refused outright", () => {
    assert.equal(assessEmail("someone@mailinator.com", true).verdict, "REFUSED");
  });

  test("nonsense is refused rather than repaired", () => {
    assert.equal(assessEmail("not an address", true).verdict, "REFUSED");
    assert.equal(assessEmail(null, true).verdict, "REFUSED");
  });

  test("an address with no recorded provenance is refused", () => {
    // A record that arrived from nowhere identifiable is exactly the one worth
    // stopping on, however well-formed the address looks.
    const result = assessEmail("dan.ellis@northgateroofing.co.uk", false);
    assert.equal(result.verdict, "REFUSED");
    assert.equal(result.code, "NO_PROVENANCE");
  });
});

describe("UK phone screening", () => {
  test("a mobile goes to review rather than being called", () => {
    // It may be a company line or a sole trader's personal phone, and only the
    // second needs TPS screening. Guessing corporate is the expensive error.
    const result = assessPhone("07700 900123", true);
    assert.equal(result.verdict, "REVIEW");
  });

  test("the same number in E.164 is judged identically", () => {
    assert.equal(assessPhone("+447700900123", true).verdict, "REVIEW");
  });

  test("a geographic landline is a corporate line", () => {
    const result = assessPhone("0161 496 0000", true);
    assert.equal(result.verdict, "PERMITTED");
    assert.equal(result.subscriberType, "CORPORATE");
  });

  test("premium and personal-numbering ranges are refused", () => {
    assert.equal(assessPhone("09001234567", true).verdict, "REFUSED");
    assert.equal(assessPhone("07011234567", true).verdict, "REFUSED");
    // 076 is personal numbering, except 07624 which is a real Manx mobile.
    assert.equal(assessPhone("07601234567", true).verdict, "REFUSED");
    assert.notEqual(assessPhone("07624123456", true).verdict, "REFUSED");
  });

  test("a directory-enquiry number is refused, not offered for review", () => {
    // 118 numbers are six digits and do not start with 0, so a shape-gate-first
    // ordering used to send them to "not a UK number -- check the local rules",
    // which invites somebody to dial a number charging pounds per minute.
    assert.equal(assessPhone("118500", true).verdict, "REFUSED");
  });

  test("a non-UK number is sent to review rather than guessed at", () => {
    assert.equal(assessPhone("+1 415 555 0123", true).verdict, "REVIEW");
  });
});

describe("the whole contact set", () => {
  test("a refused detail is dropped, not carried behind a flag", () => {
    // The point: a personal address must not sit in the database with only a
    // boolean between it and a send.
    const decision = assessContacts(
      { email: "dan@mailinator.com", phone: "0161 496 0000" },
      true,
    );
    assert.equal(decision.email, null);
    assert.equal(decision.phone, "0161 496 0000");
  });

  test("the strictest verdict across the set wins", () => {
    // A good business email plus a mobile is REVIEW, because the mobile is the
    // thing somebody might call.
    const decision = assessContacts(
      { email: "dan.ellis@northgateroofing.co.uk", phone: "07700 900123" },
      true,
    );
    assert.equal(decision.verdict, "REVIEW");
  });

  test("nothing usable is a refusal, not an empty pass", () => {
    const decision = assessContacts({ email: null, phone: null }, true);
    assert.equal(decision.verdict, "REFUSED");
  });
});

describe("lawful basis", () => {
  test("licensed providers are recorded as licensed B2B data", () => {
    assert.equal(lawfulBasisFor("hunter"), "LICENSED_B2B");
    assert.equal(lawfulBasisFor("apollo"), "LICENSED_B2B");
  });

  test("a transparency library is a public register", () => {
    assert.equal(lawfulBasisFor("meta_ad_library"), "PUBLIC_REGISTER");
  });

  test("an unrecognised provider is UNKNOWN, never assumed permitted", () => {
    assert.equal(lawfulBasisFor("some-new-vendor"), "UNKNOWN");
    assert.equal(lawfulBasisFor(null), "UNKNOWN");
  });
});

/* ================================================================= avatars */

describe("profile photos", () => {
  test("a LinkedIn photo is never stored or shown", () => {
    // LinkedIn's User Agreement forbids retaining member profile images
    // outside the platform. This is refused on read as well as on write, so a
    // row written by an older build cannot become renderable.
    assert.equal(mayStoreAvatar("LINKEDIN"), false);
    assert.equal(avatarPolicyFor("LINKEDIN")?.storable, false);

    const resolved = resolveAvatar({
      avatar_url: "https://media.licdn.com/x.jpg",
      avatar_source: "LINKEDIN",
      avatar_expires_at: null,
    });
    assert.equal(resolved.url, null);
    assert.ok(resolved.reason);
  });

  test("an unexpired Meta image is shown", () => {
    const resolved = resolveAvatar(
      {
        avatar_url: "https://scontent.example/x.jpg",
        avatar_source: "INSTAGRAM",
        avatar_expires_at: "2026-03-10T12:00:00.000Z",
      },
      NOW,
    );
    assert.equal(resolved.url, "https://scontent.example/x.jpg");
  });

  test("a lapsed link falls back to initials rather than a broken image", () => {
    const resolved = resolveAvatar(
      {
        avatar_url: "https://scontent.example/x.jpg",
        avatar_source: "INSTAGRAM",
        avatar_expires_at: "2026-03-10T09:00:00.000Z",
      },
      NOW,
    );
    assert.equal(resolved.url, null);
  });

  test("an unparseable expiry is treated as expired", () => {
    const resolved = resolveAvatar(
      {
        avatar_url: "https://scontent.example/x.jpg",
        avatar_source: "INSTAGRAM",
        avatar_expires_at: "not a date",
      },
      NOW,
    );
    assert.equal(resolved.url, null);
  });

  test("an unknown source is refused", () => {
    const resolved = resolveAvatar({
      avatar_url: "https://example.com/x.jpg",
      avatar_source: "SOMEWHERE_ELSE",
      avatar_expires_at: null,
    });
    assert.equal(resolved.url, null);
  });

  test("no photo is an ordinary outcome, with no reason to explain", () => {
    const resolved = resolveAvatar({
      avatar_url: null,
      avatar_source: null,
      avatar_expires_at: null,
    });
    assert.equal(resolved.url, null);
    assert.equal(resolved.reason, null);
  });
});
