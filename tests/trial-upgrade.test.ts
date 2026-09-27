import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import {
  DISMISS_HOURS,
  HELD_REPLY_ATTENTION_REASON,
  HELD_REPLY_ERROR_CODE,
  decideTrialUpgradePrompt,
  dismissalCookie,
  dismissalCookieName,
  dismissalKey,
  isDismissed,
  isHeldSmsReply,
  pickCandidate,
  planHeldReplyRelease,
  planOffer,
  releaseJobKey,
  type HeldReplyRow,
  type PromptInput,
} from "../src/lib/billing/trial-upgrade-prompt.ts";
import {
  classifyStripeError,
  endTrialIdempotencyKey,
  endTrialNow,
  endTrialUpdateParams,
  previewEndTrialCharge,
  type EndTrialStripe,
} from "../src/lib/billing/end-trial.ts";
import { operationsForCaller, registryProblems, serviceOperation } from "../src/lib/services/registry.ts";
import { requiresConfirmation, roleMeets, callerAllowed } from "../src/lib/services/types.ts";
import { PLANS, TRIAL } from "../src/lib/billing/plans.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/* ---------------------------------------------------------- modal conditions */

const base: PromptInput = {
  plan: "trial",
  state: "TRIALING",
  role: "owner",
  allowance: TRIAL.smsSegmentAllowance,
  usedThisPeriod: TRIAL.smsSegmentAllowance,
  creditBalance: 0,
  candidate: { leadId: "lead-1", leadName: "Priya Shah", hasRecentInboundSms: true, hasHeldReply: true, heldReplyUnits: 1 },
};

describe("trial upgrade prompt: when it shows", () => {
  test("shows for an owner in a trial with SMS used up and a held reply", () => {
    const decision = decideTrialUpgradePrompt(base);
    assert.equal(decision.show, true);
    if (decision.show) {
      assert.equal(decision.leadName, "Priya Shah");
      assert.equal(decision.canUpgrade, true);
      assert.equal(decision.reason, "held_reply");
    }
  });

  test("an admin sees it but cannot pay; a member or viewer does not see it", () => {
    const admin = decideTrialUpgradePrompt({ ...base, role: "admin" });
    assert.equal(admin.show, true);
    if (admin.show) assert.equal(admin.canUpgrade, false);
    assert.deepEqual(decideTrialUpgradePrompt({ ...base, role: "member" }), { show: false, reason: "role" });
    assert.deepEqual(decideTrialUpgradePrompt({ ...base, role: "viewer" }), { show: false, reason: "role" });
  });

  test("never shows outside a trial", () => {
    assert.equal(decideTrialUpgradePrompt({ ...base, plan: "growth", state: "ACTIVE" }).show, false);
    assert.equal(decideTrialUpgradePrompt({ ...base, state: "TRIAL_EXPIRED" }).show, false);
  });

  test("shows when the next send would use it up, not before", () => {
    // 7 of 8 used, next reply needs 2 segments: would run out.
    const tight = { ...base, usedThisPeriod: 7, candidate: { ...base.candidate!, heldReplyUnits: 2 } };
    assert.equal(decideTrialUpgradePrompt(tight).show, true);
    // 7 of 8 used, next reply needs 1: still fits.
    const fits = { ...base, usedThisPeriod: 7, candidate: { ...base.candidate!, heldReplyUnits: 1 } };
    assert.deepEqual(decideTrialUpgradePrompt(fits), { show: false, reason: "allowance_left" });
  });

  test("top-up credit counts as SMS left", () => {
    assert.deepEqual(decideTrialUpgradePrompt({ ...base, creditBalance: 5 }), { show: false, reason: "allowance_left" });
  });

  test("needs a lead in a live SMS conversation", () => {
    assert.deepEqual(decideTrialUpgradePrompt({ ...base, candidate: null }), {
      show: false,
      reason: "no_live_conversation",
    });
    const quiet = { ...base.candidate!, hasHeldReply: false, hasRecentInboundSms: false };
    assert.equal(decideTrialUpgradePrompt({ ...base, candidate: quiet }).show, false);
    const inboundOnly = { ...base.candidate!, hasHeldReply: false };
    const decision = decideTrialUpgradePrompt({ ...base, candidate: inboundOnly });
    assert.equal(decision.show && decision.reason, "inbound_sms");
  });

  test("a held reply outranks a newer inbound text, and the page's own lead wins", () => {
    const candidates = [
      { leadId: "a", leadName: "A", hasHeldReply: false, hasRecentInboundSms: true, lastActivityAt: hoursAgo(1) },
      { leadId: "b", leadName: "B", hasHeldReply: true, hasRecentInboundSms: true, lastActivityAt: hoursAgo(5) },
    ];
    assert.equal(pickCandidate(candidates)?.leadId, "b");
    assert.equal(pickCandidate(candidates, "a")?.leadId, "a");
    assert.equal(pickCandidate(candidates, "missing")?.leadId, "b");
    assert.equal(pickCandidate([]), null);
  });

  test("dismissal hides it for that lead for 24 hours only", () => {
    const now = NOW.getTime();
    assert.notEqual(dismissalKey("u1", "lead-1"), dismissalKey("u1", "lead-2"));
    assert.notEqual(dismissalKey("u1", "lead-1"), dismissalKey("u2", "lead-1"));
    assert.equal(isDismissed(String(now - 60_000), now), true);
    assert.equal(isDismissed(String(now - DISMISS_HOURS * 3_600_000), now), false);
    assert.equal(isDismissed(null, now), false);
    assert.equal(isDismissed("garbage", now), false);
    assert.equal(isDismissed(String(now + 3_600_000), now), false);
  });

  test("the offer shows the chosen plan's catalogue price and allowance", () => {
    const growth = planOffer("growth", "month");
    assert.equal(growth.price, PLANS.growth.monthlyPrice);
    assert.equal(growth.smsSegmentAllowance, PLANS.growth.smsSegmentAllowance);
    assert.equal(planOffer("pro", "year").price, PLANS.pro.yearlyPrice);
    // An unknown or trial tier falls back to Starter rather than failing.
    assert.equal(planOffer("trial", null).plan, "starter");
  });
});

/* ------------------------------------------------------- the service op */

describe("billing.end_trial_now declaration", () => {
  const op = serviceOperation("billing.end_trial_now");

  test("is declared, well formed and FINANCIAL (needs a person's confirmation)", () => {
    assert.ok(op);
    assert.equal(op!.risk, "FINANCIAL");
    assert.equal(requiresConfirmation(op!.risk), true);
    assert.ok(op!.effect && op!.effect.length > 20);
    assert.deepEqual(registryProblems(), []);
  });

  test("is owner-only", () => {
    assert.equal(op!.minimumRole, "owner");
    assert.equal(roleMeets("admin", op!.minimumRole), false);
    assert.equal(roleMeets("owner", op!.minimumRole), true);
  });

  test("is offered to the UI only: never an API key, MCP, Copilot or an agent", () => {
    assert.equal(callerAllowed(op!, "UI"), true);
    for (const caller of ["API", "MCP", "COPILOT", "AGENT", "SYSTEM"] as const) {
      assert.equal(callerAllowed(op!, caller), false, caller);
      assert.ok(!operationsForCaller(caller).some((o) => o.name === "billing.end_trial_now"), caller);
    }
  });

  test("the handler passes the nonce as the Stripe idempotency input and the action confirms", () => {
    const handler = source("src/lib/services/operations/billing.ts");
    assert.match(handler, /nonce: args\.nonce/);
    assert.match(handler, /releaseHeldSmsReplies\(context\.businessId, args\.nonce\)/);
    assert.match(handler, /applyStripeSubscription\(/);
    const action = source("src/lib/billing/trial-upgrade-actions.ts");
    assert.match(action, /caller: "UI"/);
    assert.match(action, /idempotencyKey: parsed\.data\.nonce/);
  });

  test("the idempotency key is per workspace and per confirmation", () => {
    const key = endTrialIdempotencyKey("biz-1", "11111111-2222-3333-4444-555555555555");
    assert.equal(key, "end-trial:biz-1:11111111-2222-3333-4444-555555555555");
    assert.notEqual(key, endTrialIdempotencyKey("biz-2", "11111111-2222-3333-4444-555555555555"));
    assert.throws(() => endTrialIdempotencyKey("biz-1", "x"));
    assert.throws(() => endTrialIdempotencyKey("biz-1", "has spaces in it"));
  });
});

/* ------------------------------------------------- the Stripe call shape */

type Call = { method: string; id?: string; params?: unknown; options?: unknown };

function subscription(over: Partial<Stripe.Subscription> & { priceId?: string; interval?: "month" | "year" } = {}) {
  const { priceId = "price_growth_m", interval = "month", ...rest } = over;
  return {
    id: "sub_1",
    status: "trialing",
    metadata: { business_id: "biz-1" },
    items: { data: [{ id: "si_1", price: { id: priceId, recurring: { interval } } }] },
    latest_invoice: null,
    ...rest,
  } as unknown as Stripe.Subscription;
}

function mockStripe(opts: {
  retrieve?: Stripe.Subscription;
  update?: (params: Stripe.SubscriptionUpdateParams) => Stripe.Subscription;
  preview?: Stripe.Invoice;
}) {
  const calls: Call[] = [];
  const client: EndTrialStripe = {
    subscriptions: {
      async retrieve(id) {
        calls.push({ method: "retrieve", id });
        return opts.retrieve ?? subscription();
      },
      async update(id, params, options) {
        calls.push({ method: "update", id, params, options });
        if (!opts.update) throw new Error("unexpected update");
        return opts.update(params);
      },
    },
    invoices: {
      async createPreview(params) {
        calls.push({ method: "createPreview", params });
        return opts.preview ?? ({ amount_due: 19900, currency: "gbp" } as Stripe.Invoice);
      },
    },
  };
  return { client, calls };
}

const PRICES: Record<string, Record<string, string>> = {
  starter: { month: "price_starter_m", year: "price_starter_y" },
  growth: { month: "price_growth_m", year: "price_growth_y" },
  pro: { month: "price_pro_m", year: "price_pro_y" },
};
const priceIdFor = (plan: string, interval: string) => PRICES[plan]?.[interval] ?? null;
const NONCE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("end-trial Stripe call", () => {
  test("same plan: ends the trial now, no price swap, no proration, errors on an incomplete payment", async () => {
    const paid = subscription({
      status: "active",
      latest_invoice: { amount_paid: 19900, currency: "gbp" } as Stripe.Invoice,
    });
    const { client, calls } = mockStripe({ update: () => paid });
    const outcome = await endTrialNow({
      stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: "growth", nonce: NONCE, priceIdFor,
    });
    assert.equal(outcome.kind, "converted");
    assert.equal(outcome.ok && outcome.kind === "converted" && outcome.amountPaidMinor, 19900);
    assert.deepEqual(calls.map((c) => c.method), ["retrieve", "update"]);
    const update = calls[1];
    assert.deepEqual(update.params, {
      trial_end: "now",
      proration_behavior: "none",
      payment_behavior: "error_if_incomplete",
      expand: ["latest_invoice"],
      metadata: { business_id: "biz-1" },
    });
    assert.deepEqual(update.options, { idempotencyKey: `end-trial:biz-1:${NONCE}` });
  });

  test("a plan switch swaps the item's price on the subscription's own interval", async () => {
    const { client, calls } = mockStripe({
      retrieve: subscription({ priceId: "price_growth_y", interval: "year" }),
      update: () => subscription({ status: "active", priceId: "price_pro_y", interval: "year" }),
    });
    const outcome = await endTrialNow({
      stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: "pro", nonce: NONCE, priceIdFor,
    });
    assert.equal(outcome.ok && outcome.kind === "converted" && outcome.planChanged, true);
    assert.deepEqual((calls[1].params as Stripe.SubscriptionUpdateParams).items, [{ id: "si_1", price: "price_pro_y" }]);
  });

  test("an already active subscription is not charged again", async () => {
    const { client, calls } = mockStripe({ retrieve: subscription({ status: "active" }) });
    const outcome = await endTrialNow({
      stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: "growth", nonce: NONCE, priceIdFor,
    });
    assert.equal(outcome.kind, "already_active");
    assert.ok(!calls.some((c) => c.method === "update"));
  });

  test("another workspace's subscription, a non-trial state or a missing price never reaches update", async () => {
    for (const [retrieve, kind, plan] of [
      [subscription({ metadata: { business_id: "other" } }), "wrong_workspace", "growth"],
      [subscription({ status: "past_due" }), "not_trialing", "growth"],
      [subscription(), "no_price", "starter"],
    ] as const) {
      const { client, calls } = mockStripe({ retrieve });
      const outcome = await endTrialNow({
        stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: plan, nonce: NONCE,
        priceIdFor: kind === "no_price" ? () => null : priceIdFor,
      });
      assert.equal(outcome.kind, kind);
      assert.ok(!calls.some((c) => c.method === "update"), kind);
    }
  });

  test("a decline keeps the trial and says so", async () => {
    const { client, calls } = mockStripe({
      update: () => {
        throw Object.assign(new Error("Your card was declined."), {
          type: "StripeCardError", code: "card_declined", decline_code: "generic_decline",
        });
      },
    });
    const outcome = await endTrialNow({
      stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: "growth", nonce: NONCE, priceIdFor,
    });
    assert.equal(outcome.kind, "declined");
    assert.match(!outcome.ok ? outcome.message : "", /trial continues/);
    assert.equal(calls.filter((c) => c.method === "update").length, 1);
  });

  test("SCA asks Stripe for a hosted invoice as a pending update, under its own idempotency key", async () => {
    let n = 0;
    const { client, calls } = mockStripe({
      update: () => {
        n += 1;
        if (n === 1) {
          throw Object.assign(new Error("requires action"), {
            type: "StripeCardError", code: "subscription_payment_intent_requires_action",
          });
        }
        return subscription({ latest_invoice: { hosted_invoice_url: "https://invoice.stripe.com/i/x" } as Stripe.Invoice });
      },
    });
    const outcome = await endTrialNow({
      stripe: client, businessId: "biz-1", subscriptionId: "sub_1", targetPlan: "growth", nonce: NONCE, priceIdFor,
    });
    assert.equal(outcome.kind, "requires_action");
    assert.equal(!outcome.ok && outcome.kind === "requires_action" && outcome.hostedInvoiceUrl, "https://invoice.stripe.com/i/x");
    const second = calls.filter((c) => c.method === "update")[1];
    assert.equal((second.params as Stripe.SubscriptionUpdateParams).payment_behavior, "pending_if_incomplete");
    assert.equal((second.params as Stripe.SubscriptionUpdateParams).metadata, undefined);
    assert.deepEqual(second.options, { idempotencyKey: `end-trial:biz-1:${NONCE}:authenticate` });
  });

  test("error classification", () => {
    assert.equal(classifyStripeError({ code: "authentication_required" }).kind, "requires_action");
    assert.equal(classifyStripeError({ type: "StripeCardError", code: "card_declined" }).kind, "declined");
    assert.equal(classifyStripeError(new Error("network")).kind, "failed");
  });

  test("update params only send items when the price changes", () => {
    const same = endTrialUpdateParams({
      businessId: "b", itemId: "si", currentPriceId: "p1", targetPriceId: "p1", paymentBehavior: "error_if_incomplete",
    });
    assert.equal(same.items, undefined);
    const swap = endTrialUpdateParams({
      businessId: "b", itemId: "si", currentPriceId: "p1", targetPriceId: "p2", paymentBehavior: "error_if_incomplete",
    });
    assert.deepEqual(swap.items, [{ id: "si", price: "p2" }]);
  });

  test("the preview asks for the same trial end and price", async () => {
    const { client, calls } = mockStripe({});
    const preview = await previewEndTrialCharge({ stripe: client, subscriptionId: "sub_1", targetPlan: "pro", priceIdFor });
    assert.deepEqual(preview, { amountDueMinor: 19900, currency: "gbp" });
    assert.deepEqual(calls[1].params, {
      subscription: "sub_1",
      subscription_details: { trial_end: "now", proration_behavior: "none", items: [{ id: "si_1", price: "price_pro_m" }] },
    });
  });
});

/* --------------------------------------------- releasing held replies */

function held(id: string, leadId: string, createdAt: string, over: Partial<HeldReplyRow> = {}): HeldReplyRow {
  return {
    id,
    lead_id: leadId,
    channel: "sms",
    direction: "outbound",
    status: "BLOCKED",
    origin: "agent",
    error_code: HELD_REPLY_ERROR_CODE,
    created_at: createdAt,
    send_key: `key-${id}`,
    ...over,
  };
}

const flaggedLead = (id: string) => ({ id, human_takeover: true, attention_reason: HELD_REPLY_ATTENTION_REASON });

describe("releasing held AI SMS replies after conversion", () => {
  test("only the send-store contract counts as a held reply", () => {
    assert.equal(isHeldSmsReply(held("m", "l", hoursAgo(1))), true);
    assert.equal(isHeldSmsReply(held("m", "l", hoursAgo(1), { origin: "automation" })), false);
    assert.equal(isHeldSmsReply(held("m", "l", hoursAgo(1), { channel: "email" })), false);
    assert.equal(isHeldSmsReply(held("m", "l", hoursAgo(1), { error_code: "policy:BLOCKED_OPT_OUT" })), false);
    assert.equal(isHeldSmsReply(held("m", "l", hoursAgo(1), { origin: "agent_handover" })), true);
  });

  test("releases the newest held reply per flagged lead and clears that lead's takeover", () => {
    const plan = planHeldReplyRelease({
      messages: [held("m1", "l1", hoursAgo(5)), held("m2", "l1", hoursAgo(1)), held("m3", "l2", hoursAgo(2))],
      leads: [flaggedLead("l1"), flaggedLead("l2")],
      now: NOW,
    });
    assert.deepEqual(plan.messageIds, ["m2", "m3"]);
    assert.deepEqual(plan.skippedMessageIds, ["m1"]);
    assert.deepEqual(plan.leadIds, ["l1", "l2"]);
  });

  test("a lead taken over for another reason is not released", () => {
    const plan = planHeldReplyRelease({
      messages: [held("m1", "l1", hoursAgo(1))],
      leads: [{ id: "l1", human_takeover: true, attention_reason: "policy:BLOCKED_NO_PERMISSION" }],
      now: NOW,
    });
    assert.deepEqual(plan, { leadIds: [], messageIds: [], skippedMessageIds: ["m1"] });
  });

  test("a stale or already-answered reply stays held and its lead stays with a person", () => {
    const plan = planHeldReplyRelease({
      messages: [held("old", "l1", hoursAgo(100)), held("ans", "l2", hoursAgo(3)), held("ok", "l3", hoursAgo(3))],
      leads: [flaggedLead("l1"), flaggedLead("l2"), flaggedLead("l3")],
      lastSentAt: { l2: hoursAgo(1) },
      now: NOW,
    });
    assert.deepEqual(plan.messageIds, ["ok"]);
    assert.deepEqual(plan.leadIds, ["l3"]);
    assert.deepEqual(plan.skippedMessageIds, ["ans", "old"]);
  });

  test("the re-queue job key is new per conversion and stable within one", () => {
    const a = releaseJobKey("sk", "m1", "attempt-1");
    assert.equal(a, releaseJobKey("sk", "m1", "attempt-1"));
    assert.notEqual(a, releaseJobKey("sk", "m1", "attempt-2"));
    assert.notEqual(a, "message.send:sk");
    assert.equal(releaseJobKey(null, "m1", "x"), "message.send:m1:trial-upgrade:x");
  });
});

/* ------------------------------------------------ server-safe dismissal */

describe("dismissal cookie fallback", () => {
  test("is per user and lead, cookie-safe, and expires after 24 hours", () => {
    const name = dismissalCookieName("user-1", "lead-1");
    assert.equal(name, "ct_tus_user-1_lead-1");
    assert.notEqual(name, dismissalCookieName("user-2", "lead-1"));
    assert.match(dismissalCookieName("u;1 =x", "l,1"), /^ct_tus_u1x_l1$/);
    const cookie = dismissalCookie("user-1", "lead-1", NOW.getTime());
    assert.equal(cookie, `ct_tus_user-1_lead-1=${NOW.getTime()}; Max-Age=${DISMISS_HOURS * 3600}; Path=/; SameSite=Lax`);
    // The server reads the cookie value with the same rule as localStorage.
    assert.equal(isDismissed(String(NOW.getTime()), NOW.getTime() + 60_000), true);
  });
});

/* ------------------------------------------------------- mount points */

describe("trial upgrade mount points", () => {
  test("dashboard, Inbox and lead page mount the prompt with the right lead scope", () => {
    const dashboard = source("src/app/(app)/app/page.tsx");
    assert.match(dashboard, /<TrialUpgradePromptMount \/>/);
    const inbox = source("src/app/(app)/app/inbox/page.tsx");
    assert.match(inbox, /<TrialUpgradePromptMount preferLeadId=\{selected\?\.leadId \?\? null\} anyLead \/>/);
    const lead = source("src/app/(app)/app/leads/[id]/page.tsx");
    assert.match(lead, /<TrialUpgradePromptMount preferLeadId=\{id\} \/>/);
  });

  test("the mount streams behind Suspense, honours the cookie and scopes the lead page", () => {
    const mount = source("src/components/billing/trial-upgrade-prompt-mount.tsx");
    assert.match(mount, /^import "server-only";/);
    assert.match(mount, /<Suspense fallback=\{null\}>/);
    assert.match(mount, /dismissalCookieName\(workspace\.userId, prompt\.decision\.leadId\)/);
    assert.match(mount, /preferLeadId && !anyLead && prompt\.decision\.leadId !== preferLeadId/);
    const prompt = source("src/components/billing/trial-upgrade-prompt.tsx");
    assert.match(prompt, /window\.localStorage\.setItem\(key/);
    assert.match(prompt, /document\.cookie = dismissalCookie\(/);
    assert.match(prompt, /!dismissedOnServer/);
    // Each storage access is guarded: a blocked store never breaks the page.
    assert.ok((prompt.match(/try \{/g) ?? []).length >= 3);
  });

  test("the banner and Billing settings offer the same instant upgrade, never a new checkout", () => {
    const banner = source("src/components/billing/billing-banner.tsx");
    assert.match(banner, /canManageBilling && notice\.upgradeNow \? \(/);
    assert.match(banner, /<UpgradeNowButton /);
    const settings = source("src/components/settings/billing/billing-settings.tsx");
    assert.match(settings, /\{trialing \? \([\s\S]*?<UpgradeNowButton/);
    const button = source("src/components/billing/upgrade-now-button.tsx");
    assert.match(button, /<TrialUpgradeModal/);
    assert.doesNotMatch(button, /createCheckout|startCheckout|checkout\.sessions/);
    const modal = source("src/components/billing/trial-upgrade-modal.tsx");
    assert.match(modal, /endTrialNowAction\(/);
    assert.match(modal, /To continue this conversation fully by SMS, upgrade your subscription now\./);
    assert.match(modal, /Not now/);
    assert.match(modal, /Upgrade now/);
    assert.match(modal, /hostedInvoiceUrl|actionUrl/);
  });
});
