import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LEAD_ROUTES,
  ROUTES,
  routesTo,
  socialRoutes,
} from "../src/lib/find-leads/lead-routes.ts";
import {
  DEFAULT_SOCIAL_LIMITS,
  MAX_INVITE_NOTE_CHARS,
  SOCIAL_PLATFORMS,
  canInvite,
  canMessage,
  isTerminal,
  limitsFor,
  shouldAttachNote,
  socialCapacity,
  socialStateLabel,
  type SocialPlatform,
  type SocialState,
} from "../src/lib/outreach/social-limits.ts";

/**
 * The six lead routes, and the connect-then-message gate the social ones share.
 *
 * The properties worth protecting here are the ones that cause real damage when
 * they slip: a sourced prospect landing in Leads, a message being attempted
 * before the recipient accepted, and an account being pushed past a platform
 * limit — which costs the customer the account, not just the campaign.
 */

/* ------------------------------------------------------------------ routes */

test("only lead forms produce Leads; every other route produces Prospects", () => {
  // The whole Prospect/Lead boundary rests on this. Someone who filled in your
  // form asked to hear from you; someone we found did not.
  assert.deepEqual(
    routesTo("LEADS").map((route) => route.key),
    ["lead_forms"],
  );

  const prospectRoutes = routesTo("PROSPECTS").map((route) => route.key);
  assert.equal(prospectRoutes.length, LEAD_ROUTES.length - 1);
  assert.ok(!prospectRoutes.includes("lead_forms"));
});

test("every route states a real limitation", () => {
  // A route with no stated limitation is one a customer will plan around
  // capability it does not have.
  for (const key of LEAD_ROUTES) {
    const route = ROUTES[key];
    assert.ok(route.limitation.length > 40, `${key} needs an honest limitation`);
    assert.ok(route.summary.length > 20, `${key} needs a summary`);
    assert.ok(route.stages.length >= 4, `${key} needs its stages spelled out`);
  }
});

/**
 * The two shapes a social route can take, and the gate each one uses.
 *
 * They are genuinely different, and flattening them would misdescribe a
 * platform rather than tighten a rule:
 *
 *   * **connect-then-message** (LinkedIn, TikTok). You may approach a stranger
 *     with a connection or follow request, and the gate is them accepting it.
 *   * **private-reply-then-converse** (Facebook, Instagram). You may not
 *     approach anybody at all — a Page cannot follow a person and cannot open a
 *     conversation. The gate is their own engagement, which is a stronger
 *     permission than an acceptance, not a weaker one.
 *
 * What both must satisfy is the same, and it is the invariant these tests
 * exist for: **nothing outbound happens until the recipient has opened the
 * door, and a person has approved it.**
 */
function permissionGateFor(route: { stages: { key: string }[] }): {
  gate: string;
  firstOutbound: string;
  isConnectRoute: boolean;
} {
  const keys = route.stages.map((stage) => stage.key);
  return keys.includes("connect")
    ? { gate: "accepted", firstOutbound: "message", isConnectRoute: true }
    : { gate: "engage", firstOutbound: "private_reply", isConnectRoute: false };
}

test("every social route waits for the recipient before it says anything", () => {
  for (const route of socialRoutes()) {
    const keys = route.stages.map((stage) => stage.key);
    const { gate, firstOutbound } = permissionGateFor(route);

    const gateAt = keys.indexOf(gate);
    const outboundAt = keys.indexOf(firstOutbound);

    assert.ok(gateAt >= 0, `${route.key} must have a "${gate}" stage`);
    assert.ok(outboundAt >= 0, `${route.key} must have a "${firstOutbound}" stage`);
    assert.ok(
      outboundAt > gateAt,
      `${route.key} must not contact anyone before "${gate}"`,
    );

    // The wait belongs to the recipient, and the flow has to say so — otherwise
    // it gets scheduled like an email delay.
    assert.equal(
      route.stages[gateAt].waitsOnRecipient,
      true,
      `${route.key}'s "${gate}" stage is the recipient's to end, not ours`,
    );
  }
});

test("every social route approves before it contacts anyone", () => {
  for (const route of socialRoutes()) {
    const keys = route.stages.map((stage) => stage.key);
    const { firstOutbound, isConnectRoute } = permissionGateFor(route);

    // On a connect route the request itself is outbound, so approval has to
    // precede that rather than the later message.
    const firstOutboundKey = isConnectRoute ? "connect" : firstOutbound;

    const approveAt = keys.indexOf("approve");
    assert.ok(approveAt >= 0, `${route.key} must be approved by a person`);
    assert.ok(
      approveAt < keys.indexOf(firstOutboundKey),
      `${route.key} must be approved before the first outbound action`,
    );
    assert.ok(
      keys.includes("eligibility"),
      `${route.key} must check contactability — social is not a route around an opt-out`,
    );
  }
});

test("connect routes withdraw stale invites rather than re-inviting", () => {
  // A pending invite keeps consuming the weekly limit, and re-inviting someone
  // who ignored you is what gets an account restricted.
  //
  // Only the connect routes: there is no invite to withdraw where you were
  // never able to send one, and no sending account to health-check where the
  // Page is answering its own inbox.
  const connectRoutes = socialRoutes().filter(
    (route) => permissionGateFor(route).isConnectRoute,
  );

  assert.ok(connectRoutes.length > 0, "there should be at least one connect route");

  for (const route of connectRoutes) {
    const keys = route.stages.map((stage) => stage.key);
    assert.ok(keys.includes("withdraw"), `${route.key} must handle stale invites`);
    assert.ok(keys.includes("account_health"), `${route.key} must check the account first`);
  }
});

test("a reply route never claims it can approach a stranger", () => {
  // The distinction that makes the Meta routes honest. If one of these ever
  // grew a "connect" stage it would be describing a capability the platform
  // does not offer, and a customer would plan a campaign around it.
  const replyRoutes = socialRoutes().filter(
    (route) => !permissionGateFor(route).isConnectRoute,
  );

  for (const route of replyRoutes) {
    const keys = route.stages.map((stage) => stage.key);
    assert.ok(
      !keys.includes("connect"),
      `${route.key} cannot send a connection request — the platform has no such thing`,
    );
    assert.ok(
      keys.indexOf("engage") === 0,
      `${route.key} must begin with the recipient, because nothing else can start it`,
    );
  }
});

test("the public-sources route verifies before it sends, and handles bounces", () => {
  const keys = ROUTES.public_sources.stages.map((stage) => stage.key);

  assert.ok(keys.indexOf("verify") < keys.indexOf("email"), "verify before sending");
  assert.ok(keys.indexOf("dedupe") < keys.indexOf("enrich"), "dedupe before paying to enrich");
  assert.ok(keys.includes("sender_health"), "sending domain health is a real gate");
  assert.ok(keys.includes("bounce"), "a hard bounce must suppress");
  assert.ok(
    ROUTES.public_sources.limitation.toLowerCase().includes("scraper"),
    "must be explicit that there is no general web scraper",
  );
});

test("the lead-form route records consent and attributes the spend", () => {
  const keys = ROUTES.lead_forms.stages.map((stage) => stage.key);

  // Consent cannot be reconstructed after the fact, so it is captured on
  // arrival or not at all.
  assert.ok(keys.includes("consent"));
  assert.ok(keys.includes("dedupe"), "a webhook retry must not create a second lead");
  assert.ok(keys.includes("attribute"), "spend has to be measurable against bookings");
  assert.ok(keys.indexOf("respond") > keys.indexOf("lead"));

  // No approval step, and that is correct: they already asked.
  assert.ok(!keys.includes("approve"));
});

/* ------------------------------------------------------------ social gates */

test("a message is impossible before acceptance", () => {
  const beforeAcceptance: SocialState[] = [
    "NOT_CONNECTED",
    "INVITE_QUEUED",
    "INVITE_SENT",
    "WITHDRAWN",
    "DECLINED",
    "BLOCKED",
  ];
  for (const state of beforeAcceptance) {
    assert.equal(canMessage(state), false, `${state} must not permit a message`);
  }

  for (const state of ["ACCEPTED", "MESSAGED", "REPLIED"] as SocialState[]) {
    assert.equal(canMessage(state), true);
  }
});

test("a declined or blocked invite is never retried", () => {
  assert.equal(isTerminal("DECLINED"), true);
  assert.equal(isTerminal("BLOCKED"), true);
  assert.equal(canInvite("DECLINED"), false);
  assert.equal(canInvite("BLOCKED"), false);

  // A withdrawal is not a refusal, so it may be re-attempted.
  assert.equal(canInvite("WITHDRAWN"), true);
  assert.equal(canInvite("NOT_CONNECTED"), true);
  assert.equal(canInvite("INVITE_SENT"), false);
});

test("every platform and state has a label", () => {
  for (const platform of SOCIAL_PLATFORMS) {
    assert.ok(DEFAULT_SOCIAL_LIMITS[platform], `${platform} needs limits`);
  }
  for (const state of ["NOT_CONNECTED", "ACCEPTED", "REPLIED"] as SocialState[]) {
    assert.ok(socialStateLabel(state).length > 0);
  }
});

/* ----------------------------------------------------------------- limits */

test("free LinkedIn has very few invitation notes, and that is the point", () => {
  const free = limitsFor("LINKEDIN", "FREE")!;
  const navigator = limitsFor("LINKEDIN", "SALES_NAVIGATOR")!;

  assert.ok(free.monthlyNotes > 0 && free.monthlyNotes <= 10);
  assert.ok(navigator.monthlyNotes > free.monthlyNotes);

  // Free cannot message a stranger at all — which is exactly why the connect
  // step is a hard prerequisite rather than an optimisation.
  assert.equal(free.monthlyInMail, 0);
  assert.ok(navigator.monthlyInMail > 0);
});

test("capacity reports what is left on every axis, not just blocked or not", () => {
  const limits = limitsFor("LINKEDIN", "FREE")!;
  const capacity = socialCapacity(limits, {
    connectsToday: 12,
    connectsThisWeek: 40,
    messagesToday: 5,
    notesThisMonth: 5,
  });

  assert.equal(capacity.connectsLeftToday, 3);
  assert.equal(capacity.notesLeftThisMonth, 0);
  assert.equal(capacity.blockedReason, null, "still has headroom today");
});

test("the weekly ceiling caps the daily allowance, not the other way round", () => {
  const limits = limitsFor("LINKEDIN", "FREE")!;
  // Two left this week, fifteen a day allowed: two is the real answer.
  const capacity = socialCapacity(limits, {
    connectsToday: 0,
    connectsThisWeek: limits.weeklyConnects - 2,
    messagesToday: 0,
    notesThisMonth: 0,
  });
  assert.equal(capacity.connectsLeftToday, 2);
});

test("a used-up week blocks with a reason a person can act on", () => {
  const limits = limitsFor("LINKEDIN", "FREE")!;
  const capacity = socialCapacity(limits, {
    connectsToday: 0,
    connectsThisWeek: limits.weeklyConnects,
    messagesToday: 0,
    notesThisMonth: 0,
  });

  assert.equal(capacity.connectsLeftToday, 0);
  assert.ok(capacity.blockedReason?.includes("week"));
});

test("running out of notes degrades to a bare invite rather than stopping", () => {
  const limits = limitsFor("LINKEDIN", "FREE")!;
  const spent = socialCapacity(limits, {
    connectsToday: 0,
    connectsThisWeek: 0,
    messagesToday: 0,
    notesThisMonth: limits.monthlyNotes,
  });

  const decision = shouldAttachNote(spent, "LINKEDIN");
  assert.equal(decision.attach, false);
  // An invite without a note still works, and the copy has to say so.
  assert.ok(decision.reason?.includes("still allowed"));

  const fresh = socialCapacity(limits, {
    connectsToday: 0,
    connectsThisWeek: 0,
    messagesToday: 0,
    notesThisMonth: 0,
  });
  assert.equal(shouldAttachNote(fresh, "LINKEDIN").attach, true);
});

test("only LinkedIn has an invitation note", () => {
  const limits = limitsFor("INSTAGRAM", "BUSINESS_PAGE")!;
  const capacity = socialCapacity(limits, {
    connectsToday: 0,
    connectsThisWeek: 0,
    messagesToday: 0,
    notesThisMonth: 0,
  });

  for (const platform of ["INSTAGRAM", "FACEBOOK", "TIKTOK"] as SocialPlatform[]) {
    assert.equal(shouldAttachNote(capacity, platform).attach, false);
  }
});

test("the note length cap is the platform's, and is enforced as a number", () => {
  assert.equal(MAX_INVITE_NOTE_CHARS, 300);
});

test("TikTok is the most restricted channel, as its route claims", () => {
  const tiktok = limitsFor("TIKTOK", "BUSINESS_PAGE")!;
  const instagram = limitsFor("INSTAGRAM", "BUSINESS_PAGE")!;

  assert.ok(
    tiktok.dailyMessages < instagram.dailyMessages,
    "the route text says TikTok is tightest; the limits must agree",
  );
  assert.ok(ROUTES.tiktok_social.limitation.toLowerCase().includes("follow"));
});
