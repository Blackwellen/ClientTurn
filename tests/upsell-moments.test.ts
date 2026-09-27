import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MODAL_OFFER_WINDOW_DAYS,
  attributePurchase,
  candidateMoments,
  decideUpsellMoment,
  mentionsWhatsapp,
  passiveAddOns,
  shouldRecordImpression,
  type UpsellFacts,
  type UpsellHistoryEvent,
} from "../src/lib/billing/upsell-moments.ts";
import { MESSAGE_CREDIT_BUNDLES, PLANS } from "../src/lib/billing/plans.ts";
import { TOKEN_PACKS, TOKEN_PACK_LIST } from "../src/lib/billing/tokens.ts";

/**
 * Upsell moments (docs/upsell-plan.md): the triggers, and the rules that
 * keep them from being annoying.
 */

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function facts(overrides: Partial<UpsellFacts> = {}): UpsellFacts {
  return {
    now: NOW,
    context: "dashboard",
    role: "owner",
    userId: "u1",
    suggestionsEnabled: true,
    plan: "starter",
    state: "ACTIVE",
    billingInterval: "month",
    billingNoticeActive: false,
    periodStart: "2026-09-15T00:00:00.000Z",
    periodEnd: "2026-10-15T00:00:00.000Z",
    leads: { used: 10, limit: 100, previousPeriodUsed: 20 },
    aiTokens: { state: "HEALTHY", percentUsed: 10 },
    seats: { used: 1, limit: 1 },
    prospects: null,
    whatsapp: { planAllows: false, tokens: 0, usedThisPeriod: 0, waitingLead: null },
    bookingsThisPeriod: 0,
    history: [],
    ...overrides,
  };
}

function event(e: Partial<UpsellHistoryEvent>): UpsellHistoryEvent {
  return { moment: "ai_paused", offer: "ai_token_pack", surface: "modal", event: "impression", userId: "u1", createdAt: ago(1), ...e };
}

describe("triggers", () => {
  test("AI paused offers a token pack as a modal on the dashboard", () => {
    const d = decideUpsellMoment(facts({ aiTokens: { state: "EXHAUSTED", percentUsed: 100 } }));
    assert.equal(d.show, true);
    if (!d.show) return;
    assert.equal(d.moment.key, "ai_paused");
    assert.equal(d.moment.offer, "ai_token_pack");
    assert.equal(d.moment.surface, "modal");
    assert.equal(d.moment.cta.kind, "token_pack");
  });

  test("AI tokens at 80% is a banner, below 80% nothing", () => {
    const low = decideUpsellMoment(facts({ seats: { used: 0, limit: 1 }, aiTokens: { state: "APPROACHING", percentUsed: 82 } }));
    assert.ok(low.show && low.moment.key === "ai_tokens_low" && low.moment.surface === "banner");
    const fine = candidateMoments(facts({ seats: { used: 0, limit: 1 }, aiTokens: { state: "HEALTHY", percentUsed: 79 } }));
    assert.equal(fine.length, 0);
  });

  test("a lead asking for WhatsApp on Starter offers the tier that unlocks it", () => {
    const d = decideUpsellMoment(
      facts({ whatsapp: { planAllows: false, tokens: 0, usedThisPeriod: 0, waitingLead: { id: "l1", name: "Sam", at: ago(1) } } }),
    );
    assert.ok(d.show);
    if (!d.show) return;
    assert.equal(d.moment.key, "whatsapp_lead_waiting");
    assert.equal(d.moment.offer, "tier_upgrade");
    assert.equal(d.moment.cta.kind === "upgrade" && d.moment.cta.plan.id, "growth");
    assert.match(d.moment.body, /Growth and above/);
  });

  test("on Growth with no WhatsApp tokens it offers a WhatsApp token pack from the catalogue", () => {
    const d = decideUpsellMoment(
      facts({
        plan: "growth",
        seats: { used: 1, limit: 3 },
        whatsapp: { planAllows: true, tokens: 0, usedThisPeriod: 0, waitingLead: { id: "l1", name: "Sam", at: ago(1) } },
      }),
    );
    assert.ok(d.show && d.moment.offer === "whatsapp_tokens");
    if (!d.show || d.moment.cta.kind !== "whatsapp_pack") return assert.fail("expected a pack");
    assert.ok(MESSAGE_CREDIT_BUNDLES.includes(d.moment.cta.bundle));
    assert.equal(d.moment.cta.bundle.channel, "whatsapp");
    assert.doesNotMatch(d.moment.body, /credit|balance/i);
  });

  test("a waiting WhatsApp lead with tokens left, or an old request, triggers nothing", () => {
    const withTokens = candidateMoments(
      facts({ plan: "growth", seats: { used: 0, limit: 3 }, whatsapp: { planAllows: true, tokens: 50, usedThisPeriod: 0, waitingLead: { id: "l", name: "S", at: ago(1) } } }),
    );
    assert.equal(withTokens.length, 0);
    const stale = candidateMoments(
      facts({ seats: { used: 0, limit: 1 }, whatsapp: { planAllows: false, tokens: 0, usedThisPeriod: 0, waitingLead: { id: "l", name: "S", at: ago(9) } } }),
    );
    assert.equal(stale.length, 0);
  });

  test("lead cap at 80% offers a higher tier; two periods running ranks higher", () => {
    const approaching = decideUpsellMoment(facts({ seats: { used: 0, limit: 1 }, leads: { used: 85, limit: 100, previousPeriodUsed: 40 } }));
    assert.ok(approaching.show && approaching.moment.key === "lead_cap_approaching" && approaching.moment.surface === "banner");
    const repeated = decideUpsellMoment(facts({ seats: { used: 0, limit: 1 }, leads: { used: 85, limit: 100, previousPeriodUsed: 100 } }));
    assert.ok(repeated.show && repeated.moment.key === "lead_cap_repeated");
    if (repeated.show) assert.match(repeated.moment.body, new RegExp(PLANS.growth.leadLimit.toLocaleString("en-GB")));
  });

  test("seats full and prospects used up offer a tier only when the next tier raises the limit", () => {
    const seats = decideUpsellMoment(facts({ seats: { used: 1, limit: 1 } }));
    assert.ok(seats.show && seats.moment.key === "seats_full");
    const prospects = candidateMoments(facts({ seats: { used: 0, limit: 1 }, prospects: { used: 100, limit: 100 } }));
    assert.equal(prospects[0]?.key, "prospects_cap");
    // Pro to Enterprise is contact sales, never a self-serve charge.
    const pro = candidateMoments(facts({ plan: "pro", seats: { used: 10, limit: 10 } }));
    assert.equal(pro[0]?.cta.kind, "contact_sales");
  });

  test("a projection over the cap after 7 days is a banner; before 7 days it is not trusted", () => {
    const early = candidateMoments(facts({ seats: { used: 0, limit: 1 }, periodStart: ago(3), leads: { used: 30, limit: 100, previousPeriodUsed: 0 } }));
    assert.equal(early.length, 0);
    const later = candidateMoments(facts({ seats: { used: 0, limit: 1 }, periodStart: ago(10), periodEnd: new Date(NOW.getTime() + 20 * DAY).toISOString(), leads: { used: 60, limit: 100, previousPeriodUsed: 0 } }));
    assert.equal(later[0]?.key, "usage_projection");
  });

  test("a booked-meeting milestone is a soft inline card on the dashboard only", () => {
    const d = decideUpsellMoment(facts({ seats: { used: 0, limit: 1 }, bookingsThisPeriod: 12 }));
    assert.ok(d.show && d.moment.key === "bookings_milestone" && d.moment.surface === "card" && d.moment.variant === "10");
    const lead = decideUpsellMoment(facts({ context: "lead", seats: { used: 0, limit: 1 }, bookingsThisPeriod: 12 }));
    assert.equal(lead.show, false);
  });

  test("mentionsWhatsapp is narrow", () => {
    for (const yes of ["Can I WhatsApp you?", "are you on whatsapp", "Whats App is easier", "message me via WA"]) {
      assert.equal(mentionsWhatsapp(yes), true, yes);
    }
    for (const no of ["What's up", "I was at the office", "Wait a moment", null]) {
      assert.equal(mentionsWhatsapp(no), false, String(no));
    }
  });
});

describe("rules", () => {
  const paused = { aiTokens: { state: "EXHAUSTED" as const, percentUsed: 100 } };

  test("never during a trial", () => {
    assert.deepEqual(decideUpsellMoment(facts({ ...paused, plan: "trial", state: "TRIALING" })).show, false);
    const d = decideUpsellMoment(facts({ ...paused, plan: "growth", state: "TRIALING" }));
    assert.ok(!d.show && d.reason === "trial");
    assert.equal(passiveAddOns({ plan: "trial", state: "TRIALING", whatsappEnabled: false, billingInterval: "month", tokenPacks: TOKEN_PACK_LIST }), null);
  });

  test("owner and admin only", () => {
    for (const role of ["member", "viewer", "agent"]) {
      const d = decideUpsellMoment(facts({ ...paused, role }));
      assert.ok(!d.show && d.reason === "role", role);
    }
    assert.equal(decideUpsellMoment(facts({ ...paused, role: "admin" })).show, true);
  });

  test("the owner setting turns everything off", () => {
    const d = decideUpsellMoment(facts({ ...paused, suggestionsEnabled: false }));
    assert.ok(!d.show && d.reason === "setting_off");
  });

  test("never mid-task, and only on a working paid subscription", () => {
    for (const context of ["composer", "onboarding", "checkout"] as const) {
      const d = decideUpsellMoment(facts({ ...paused, context }));
      assert.ok(!d.show && d.reason === "mid_task", context);
    }
    for (const state of ["PAST_DUE_GRACE", "PAST_DUE_RESTRICTED", "CANCELLED"]) {
      const d = decideUpsellMoment(facts({ ...paused, state }));
      assert.ok(!d.show && d.reason === "not_active", state);
    }
  });

  test("dismiss snoozes that moment for 30 days, for that user", () => {
    const snoozed = decideUpsellMoment(facts({ ...paused, seats: { used: 0, limit: 1 }, history: [event({ event: "dismiss", createdAt: ago(29) })] }));
    assert.ok(!snoozed.show && snoozed.suppressed.includes("ai_paused"));
    const expired = decideUpsellMoment(facts({ ...paused, history: [event({ event: "dismiss", createdAt: ago(31) })] }));
    assert.ok(expired.show && expired.moment.key === "ai_paused");
    const otherUser = decideUpsellMoment(facts({ ...paused, history: [event({ event: "dismiss", userId: "u2" })] }));
    assert.ok(otherUser.show && otherUser.moment.key === "ai_paused");
  });

  test("a milestone is snoozed per milestone", () => {
    const d = decideUpsellMoment(
      facts({ seats: { used: 0, limit: 1 }, bookingsThisPeriod: 26, history: [event({ moment: "bookings_milestone:10", offer: "tier_upgrade", event: "dismiss" })] }),
    );
    assert.ok(d.show && d.moment.variant === "25");
  });

  test("at most one modal per user per 7 days: the next blocker becomes a banner", () => {
    const d = decideUpsellMoment(
      facts({
        ...paused,
        history: [event({ moment: "whatsapp_lead_waiting", offer: "tier_upgrade", surface: "modal", createdAt: ago(6) })],
      }),
    );
    assert.ok(d.show && d.moment.key === "ai_paused" && d.moment.surface === "banner");
    const after = decideUpsellMoment(
      facts({ ...paused, history: [event({ moment: "whatsapp_lead_waiting", offer: "tier_upgrade", surface: "modal", createdAt: ago(8) })] }),
    );
    assert.ok(after.show && after.moment.surface === "modal");
  });

  test("at most one modal per offer per 30 days", () => {
    const d = decideUpsellMoment(facts({ ...paused, history: [event({ surface: "modal", createdAt: ago(MODAL_OFFER_WINDOW_DAYS - 1) })] }));
    assert.ok(d.show && d.moment.surface === "banner");
    const later = decideUpsellMoment(facts({ ...paused, history: [event({ surface: "modal", createdAt: ago(MODAL_OFFER_WINDOW_DAYS + 1) })] }));
    assert.ok(later.show && later.moment.surface === "modal");
  });

  test("modals only on the dashboard: the lead page gets a banner", () => {
    const d = decideUpsellMoment(facts({ ...paused, context: "lead" }));
    assert.ok(d.show && d.moment.surface === "banner");
  });

  test("a recent purchase of the same offer hides it", () => {
    const d = decideUpsellMoment(facts({ ...paused, seats: { used: 0, limit: 1 }, history: [event({ event: "purchase", userId: null, createdAt: ago(3) })] }));
    assert.equal(d.show, false);
  });

  test("never contradicts a running-low notice: only blockers, and as banners", () => {
    const lowLeads = decideUpsellMoment(facts({ billingNoticeActive: true, leads: { used: 90, limit: 100, previousPeriodUsed: 0 } }));
    assert.equal(lowLeads.show, false);
    const blocker = decideUpsellMoment(facts({ ...paused, billingNoticeActive: true }));
    assert.ok(blocker.show && blocker.moment.surface === "banner");
  });

  test("one suggestion at a time, the most important first", () => {
    const d = decideUpsellMoment(facts({ ...paused, leads: { used: 99, limit: 100, previousPeriodUsed: 100 }, bookingsThisPeriod: 50 }));
    assert.ok(d.show && d.moment.key === "ai_paused");
  });
});

describe("analytics", () => {
  test("one impression a day per user, moment and surface", () => {
    const history = [event({ createdAt: ago(0.5) })];
    assert.equal(shouldRecordImpression({ moment: "ai_paused", surface: "modal", userId: "u1", history, now: NOW }), false);
    assert.equal(shouldRecordImpression({ moment: "ai_paused", surface: "banner", userId: "u1", history, now: NOW }), true);
    assert.equal(shouldRecordImpression({ moment: "ai_paused", surface: "modal", userId: "u1", history: [event({ createdAt: ago(2) })], now: NOW }), true);
  });

  test("a purchase is credited to the latest click on the same offer within 7 days", () => {
    const history = [
      event({ event: "click", createdAt: ago(5), moment: "ai_tokens_low" }),
      event({ event: "click", createdAt: ago(2), moment: "ai_paused" }),
      event({ event: "click", offer: "tier_upgrade", createdAt: ago(1) }),
    ];
    assert.equal(attributePurchase("ai_token_pack", history, NOW)?.moment, "ai_paused");
    assert.equal(attributePurchase("ai_token_pack", [event({ event: "click", createdAt: ago(8) })], NOW), null);
  });
});

describe("prices come from the catalogue", () => {
  test("the passive billing card lists the catalogue packs, WhatsApp only where the plan allows it", () => {
    const starter = passiveAddOns({ plan: "starter", state: "ACTIVE", whatsappEnabled: false, billingInterval: "month", tokenPacks: TOKEN_PACK_LIST });
    assert.deepEqual(starter?.tokenPacks, TOKEN_PACK_LIST);
    assert.equal(starter?.whatsappPacks.length, 0);
    assert.equal(starter?.whatsappUnlockPlan, "Growth");
    const growth = passiveAddOns({ plan: "growth", state: "ACTIVE", whatsappEnabled: true, billingInterval: "year", tokenPacks: TOKEN_PACK_LIST });
    assert.deepEqual(growth?.whatsappPacks, MESSAGE_CREDIT_BUNDLES.filter((b) => b.channel === "whatsapp"));
    assert.equal(growth?.next?.kind === "upgrade" && growth.next.interval, "year");
  });

  test("the token pack in a moment is a catalogue pack", () => {
    const [moment] = candidateMoments(facts({ seats: { used: 0, limit: 1 }, aiTokens: { state: "EXHAUSTED", percentUsed: 100 } }));
    assert.ok(moment.cta.kind === "token_pack" && Object.values(TOKEN_PACKS).includes(moment.cta.pack));
  });

  test("no voice teaser anywhere in upsell code", () => {
    for (const file of ["src/lib/billing/upsell-moments.ts", "src/components/billing/upsell-moment.tsx", "src/components/settings/billing/upsell-billing-card.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      assert.doesNotMatch(source, /voice|coming soon/i, file);
    }
  });
});
