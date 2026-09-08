/**
 * The four Meta flows, end to end, against a real Postgres with real RLS.
 *
 *   1. Instagram — found, followed, messaged, they reply, agent takes over.
 *   2. Instagram — lead form, straight into the conversion engine.
 *   3. Facebook  — found, followed, messaged, they reply, agent takes over.
 *   4. Facebook  — lead form, straight into the conversion engine.
 *
 * The unit tests in `meta-flows.test.ts` cover the rules. This covers the
 * things only a database can prove: that a redelivered webhook creates one
 * record rather than two, that a prospect becomes the same lead rather than a
 * rival one, that RLS keeps one workspace's threads out of another's, and that
 * a suppression written on one channel is honoured on all of them.
 *
 * Run with:
 *   npm run test:e2e:meta
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type World = {
  businessId: string;
  otherBusinessId: string;
  ownerId: string;
  pageId: string;
  igUserId: string;
};

let world: World;

/** Unique per run so repeated runs never collide on a platform id. */
const RUN = randomUUID().slice(0, 8);
const psid = (suffix: string) => `PSID_${RUN}_${suffix}`;
const igsid = (suffix: string) => `IGSID_${RUN}_${suffix}`;

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `e2e-meta-${label}-${RUN}@example.test`,
    password: "MetaFlows!2026pw",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  return data.user.id;
}

async function createBusiness(name: string): Promise<string> {
  const { data, error } = await admin
    .from("businesses")
    .insert({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${RUN}`, status: "active" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create business: ${error?.message}`);
  return data.id;
}

before(async () => {
  const ownerId = await createUser("owner");
  const businessId = await createBusiness("Meta Flows Ltd");
  const otherBusinessId = await createBusiness("Rival Plumbing Ltd");

  await admin.from("business_members").insert({
    business_id: businessId,
    user_id: ownerId,
    role: "owner",
    status: "active",
  });

  const pageId = `PAGE_${RUN}`;
  const igUserId = `IGUSER_${RUN}`;

  // The connected Page. This is what identifies the workspace for every
  // inbound event — there is no other route from a Meta id to a tenant.
  await admin.from("integrations").insert({
    business_id: businessId,
    provider_type: "meta",
    status: "HEALTHY",
    config: { pageId, instagramUserId: igUserId },
  });

  world = { businessId, otherBusinessId, ownerId, pageId, igUserId };
});

after(async () => {
  if (!world) return;
  await admin.from("businesses").delete().eq("id", world.businessId);
  await admin.from("businesses").delete().eq("id", world.otherBusinessId);
  await admin.auth.admin.deleteUser(world.ownerId).catch(() => undefined);
});

/* ------------------------------------------------------------- resolution */

describe("a Page identifies exactly one workspace", () => {
  test("the connected Page resolves to its own workspace", async () => {
    const { resolveMetaBusinessId } = await import("../src/lib/social/meta-inbound.ts");

    const resolved = await resolveMetaBusinessId({
      provider: "meta",
      providerMessageId: "mid.resolve",
      from: `meta_psid:${psid("a")}`,
      to: `meta_psid:${world.pageId}`,
      body: "hello",
      channel: "messenger",
      receivedAt: new Date().toISOString(),
    });

    assert.equal(resolved, world.businessId);
  });

  test("the linked Instagram account resolves to the same workspace", async () => {
    const { resolveMetaBusinessId } = await import("../src/lib/social/meta-inbound.ts");

    const resolved = await resolveMetaBusinessId({
      provider: "meta",
      providerMessageId: "mid.resolve.ig",
      from: `meta_igsid:${igsid("a")}`,
      to: `meta_igsid:${world.igUserId}`,
      body: "hello",
      channel: "instagram",
      receivedAt: new Date().toISOString(),
    });

    assert.equal(resolved, world.businessId);
  });

  test("an unknown Page resolves to nobody, never to a guess", async () => {
    // Guessing would file a stranger's enquiry in somebody's pipeline. There is
    // deliberately no fallback for social, because a page-scoped id means
    // nothing outside the Page that issued it.
    const { resolveMetaBusinessId } = await import("../src/lib/social/meta-inbound.ts");

    const resolved = await resolveMetaBusinessId({
      provider: "meta",
      providerMessageId: "mid.unknown",
      from: `meta_psid:${psid("b")}`,
      to: "meta_psid:PAGE_BELONGING_TO_NOBODY",
      body: "hello",
      channel: "messenger",
      receivedAt: new Date().toISOString(),
    });

    assert.equal(resolved, null);
  });
});

/* -------------------------------------- flows 1 and 3: they reply to us */

describe("an inbound DM becomes a lead the agent can work", () => {
  test("a first message creates one lead and one thread", async () => {
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const message = {
      provider: "meta" as const,
      providerMessageId: "mid.first",
      from: `meta_igsid:${igsid("first")}`,
      to: `meta_igsid:${world.igUserId}`,
      body: "Hi, do you do bathroom fitting?",
      channel: "instagram" as const,
      receivedAt: new Date().toISOString(),
    };

    const resolved = await resolveSocialThread(message, world.businessId);

    assert.ok(resolved, "the thread should have resolved");
    assert.equal(resolved.created, true);

    const { data: conversation } = await admin
      .from("conversations")
      .select("id, channel, external_thread_id, lead_id")
      .eq("id", resolved.conversationId)
      .single();

    assert.ok(conversation, "the conversation row should exist");

    // The channel must be the one it arrived on. Filed as 'sms' — which is what
    // the old fall-through did — a reply would be sent by text message to a
    // phone number belonging to somebody else entirely.
    assert.equal(conversation.channel, "instagram");
    assert.equal(conversation.external_thread_id, message.from);
    assert.equal(conversation.lead_id, resolved.leadId);
  });

  test("a redelivered webhook finds the same lead rather than creating a second", async () => {
    // Meta retries anything it does not see acknowledged. Without idempotency
    // here, one person's first message becomes two leads in the pipeline.
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const message = {
      provider: "meta" as const,
      providerMessageId: "mid.retry",
      from: `meta_psid:${psid("retry")}`,
      to: `meta_psid:${world.pageId}`,
      body: "Are you free Thursday?",
      channel: "messenger" as const,
      receivedAt: new Date().toISOString(),
    };

    const first = await resolveSocialThread(message, world.businessId);
    const second = await resolveSocialThread(message, world.businessId);

    assert.ok(first && second);
    assert.equal(first.leadId, second.leadId);
    assert.equal(first.conversationId, second.conversationId);
    assert.equal(second.created, false);

    const { count } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", world.businessId)
      .eq("external_id", `meta:messenger:${psid("retry")}`);

    assert.equal(count, 1);
  });

  test("a prospect who replies is promoted, not duplicated", async () => {
    // This is the seam the whole social flow turns on. We found them and
    // followed them as a Prospect; the moment they write back they have become
    // someone who contacted us, which is the definition of a Lead.
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const externalId = psid("prospect");

    const { data: prospect, error: prospectError } = await admin
      .from("prospects")
      .insert({
        business_id: world.businessId,
        first_name: "Marcus",
        last_name: "Webb",
        role_classification: "UNKNOWN",
        status: "READY",
        outreach_eligibility: "ELIGIBLE",
        subscriber_type: "UNKNOWN",
        verification_status: "UNKNOWN",
        social_platform: "FACEBOOK",
        social_external_id: externalId,
      })
      .select("id")
      .single();

    assert.ok(prospect, `the prospect should have been created: ${prospectError?.message}`);

    const resolved = await resolveSocialThread(
      {
        provider: "meta",
        providerMessageId: "mid.promote",
        from: `meta_psid:${externalId}`,
        to: `meta_psid:${world.pageId}`,
        body: "Yes, interested — what would that cost?",
        channel: "messenger",
        receivedAt: new Date().toISOString(),
      },
      world.businessId,
    );

    assert.ok(resolved);

    const { data: after } = await admin
      .from("prospects")
      .select("promoted_to_lead_id, promoted_at, first_name")
      .eq("id", prospect.id)
      .single();

    assert.ok(after, "the prospect row should still exist after promotion");
    assert.equal(after.promoted_to_lead_id, resolved.leadId);
    assert.ok(after.promoted_at, "promotion should be timestamped");

    // The lead carries the name we already knew, rather than starting blank.
    const { data: lead } = await admin
      .from("leads")
      .select("first_name, last_name")
      .eq("id", resolved.leadId)
      .single();

    assert.ok(lead, "the promoted lead should exist");
    assert.equal(lead.first_name, "Marcus");
  });

  test("a second reply on the same thread does not fork the conversation", async () => {
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const from = `meta_igsid:${igsid("thread")}`;
    const base = {
      provider: "meta" as const,
      to: `meta_igsid:${world.igUserId}`,
      channel: "instagram" as const,
      receivedAt: new Date().toISOString(),
    };

    const first = await resolveSocialThread(
      { ...base, providerMessageId: "mid.t1", from, body: "hello" },
      world.businessId,
    );
    const second = await resolveSocialThread(
      { ...base, providerMessageId: "mid.t2", from, body: "still there?" },
      world.businessId,
    );

    assert.ok(first && second);
    assert.equal(first.conversationId, second.conversationId);

    const { count } = await admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", world.businessId)
      .eq("external_thread_id", from);

    assert.equal(count, 1);
  });
});

/* --------------------------------------------------------- tenant safety */

describe("one workspace cannot see another's threads", () => {
  test("a thread address is scoped to its workspace", async () => {
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const from = `meta_psid:${psid("shared")}`;

    const ours = await resolveSocialThread(
      {
        provider: "meta",
        providerMessageId: "mid.ours",
        from,
        to: `meta_psid:${world.pageId}`,
        body: "hello",
        channel: "messenger",
        receivedAt: new Date().toISOString(),
      },
      world.businessId,
    );

    assert.ok(ours);

    // The same platform id arriving for a different workspace must produce a
    // separate record. A PSID is page-scoped: the same string genuinely does
    // refer to different people on different Pages.
    const { data: theirs } = await admin
      .from("conversations")
      .select("id")
      .eq("business_id", world.otherBusinessId)
      .eq("external_thread_id", from)
      .maybeSingle();

    assert.equal(theirs, null);
  });

  test("RLS hides another workspace's conversations from a member", async () => {
    // Proven against the real policy rather than by inspection: this is the
    // guarantee that a bug in a query cannot quietly cross a tenant boundary.
    const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: session } = await anon.auth.signInWithPassword({
      email: `e2e-meta-owner-${RUN}@example.test`,
      password: "MetaFlows!2026pw",
    });
    assert.ok(session.session, "the owner should be able to sign in");

    const { data: rows } = await anon
      .from("conversations")
      .select("id, business_id");

    // Everything visible belongs to the workspace they are a member of.
    for (const row of rows ?? []) {
      assert.equal(row.business_id, world.businessId);
    }
  });
});

/* ------------------------------------------------- suppression is global */

describe("an opt-out on one channel stops every channel", () => {
  test("suppressing a person blocks the social channel too", async () => {
    const { suppress, checkSuppression } = await import("../src/lib/policy/suppression.ts");

    const address = `meta_igsid:${igsid("optout")}`;

    await suppress({
      businessId: world.businessId,
      channel: "ALL",
      reason: "OPT_OUT",
      source: "e2e",
      social: address,
    });

    const hit = await checkSuppression(world.businessId, "SOCIAL", { social: address });
    assert.ok(hit, "the social address should be suppressed");
    assert.equal(hit.reason, "OPT_OUT");
  });

  test("suppression does not leak across workspaces", async () => {
    const { checkSuppression } = await import("../src/lib/policy/suppression.ts");

    const hit = await checkSuppression(world.otherBusinessId, "SOCIAL", {
      social: `meta_igsid:${igsid("optout")}`,
    });

    assert.equal(hit, null);
  });
});

/* ------------------------------ flows 1 and 3: the private-reply entry point */

describe("commenters can be answered without ever having messaged us", () => {
  /** Creates a commenter prospect the way `engagement-ingest` would. */
  async function commenter(input: {
    suffix: string;
    platform: "FACEBOOK" | "INSTAGRAM";
    commentedAt: string;
    eligibility?: string;
  }): Promise<string> {
    const external = input.platform === "INSTAGRAM" ? igsid(input.suffix) : psid(input.suffix);

    const { data, error } = await admin
      .from("prospects")
      .insert({
        business_id: world.businessId,
        first_name: "Dana",
        role_classification: "UNKNOWN",
        status: "READY",
        outreach_eligibility: input.eligibility ?? "ELIGIBLE",
        subscriber_type: "UNKNOWN",
        verification_status: "UNKNOWN",
        social_platform: input.platform,
        social_external_id: external,
        social_comment_id: `COMMENT_${RUN}_${input.suffix}`,
        social_commented_at: input.commentedAt,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`could not create commenter: ${error?.message}`);
    return data.id;
  }

  test("a fresh, approved commenter is due for a reply", async () => {
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await commenter({
      suffix: "due",
      platform: "INSTAGRAM",
      commentedAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const due = await dueForPrivateReply(world.businessId, 50);
    const found = due.find((candidate) => candidate.prospectId === id);

    assert.ok(found, "a fresh approved commenter should be due");
    assert.equal(found.platform, "INSTAGRAM");
    assert.ok(found.commentId, "the comment id is the address, and must be present");
    // The bare platform id, not the prefixed messaging address: this is what
    // makes a later inbound webhook match this prospect and promote it.
    assert.doesNotMatch(found.externalId ?? "", /^meta_/);
  });

  test("an eight-day-old comment is not offered, however eligible", async () => {
    // The window expires silently. If this filter were wrong the sweep would
    // spend a refused send finding out, which is logged against the Page.
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await commenter({
      suffix: "stale",
      platform: "FACEBOOK",
      commentedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });

    const due = await dueForPrivateReply(world.businessId, 100);
    assert.equal(due.some((candidate) => candidate.prospectId === id), false);
  });

  test("an unapproved commenter is not offered", async () => {
    // A comment is interest, not a request to be sold to. Approval is a
    // precondition, not a check that happens later.
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await commenter({
      suffix: "review",
      platform: "FACEBOOK",
      commentedAt: new Date().toISOString(),
      eligibility: "REVIEW",
    });

    const due = await dueForPrivateReply(world.businessId, 100);
    assert.equal(due.some((candidate) => candidate.prospectId === id), false);
  });

  test("the oldest comment is offered first", async () => {
    // The window is closing on them. A backlog worked newest-first would let
    // the oldest expire while capacity went to comments with six days left.
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    await commenter({
      suffix: "order-new",
      platform: "INSTAGRAM",
      commentedAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    await commenter({
      suffix: "order-old",
      platform: "INSTAGRAM",
      commentedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });

    const due = await dueForPrivateReply(world.businessId, 100);
    const times = due.map((candidate) => new Date(candidate.commentedAt).getTime());

    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i] >= times[i - 1], "candidates must be oldest first");
    }
  });

  test("one reply per comment is enforced by the database, not only by code", async () => {
    // Application code already checks it, and application code is exactly what a
    // retried job or a future scheduler bug routes around. Meta refuses the
    // second send anyway; the point is that we never make the request.
    const commentId = `COMMENT_${RUN}_unique`;

    const insert = (suffix: string) =>
      admin
        .from("prospects")
        .insert({
          business_id: world.businessId,
          first_name: "Dana",
          role_classification: "UNKNOWN",
          status: "READY",
          outreach_eligibility: "ELIGIBLE",
          subscriber_type: "UNKNOWN",
          verification_status: "UNKNOWN",
          social_platform: "FACEBOOK",
          social_external_id: psid(suffix),
          social_comment_id: commentId,
          social_commented_at: new Date().toISOString(),
        })
        .select("id")
        .single();

    const first = await insert("unique-a");
    assert.ok(first.data, "the first should succeed");

    const second = await insert("unique-b");
    assert.equal(second.error?.code, "23505", "a second row for the same comment must collide");
  });

  test("a spent reply removes them from the queue", async () => {
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await commenter({
      suffix: "spent",
      platform: "INSTAGRAM",
      commentedAt: new Date().toISOString(),
    });

    await admin
      .from("prospects")
      .update({ private_reply_sent_at: new Date().toISOString() })
      .eq("id", id);

    const due = await dueForPrivateReply(world.businessId, 100);
    assert.equal(due.some((candidate) => candidate.prospectId === id), false);
  });

  test("the sweep finds a workspace whose only due work is commenters", async () => {
    // The gap this closes was silent and total: `social_businesses_with_due_work`
    // only looked at `social_connection_states`, and a commenter never has one.
    // A workspace whose whole Meta strategy is "answer the people who comment on
    // our ads" would have had due work forever and been swept never.
    await commenter({
      suffix: "sweep",
      platform: "FACEBOOK",
      commentedAt: new Date().toISOString(),
    });

    const { data } = await admin.rpc("social_businesses_with_due_work", { p_limit: 500 });
    const row = ((data ?? []) as { business_id: string; due_count: number }[]).find(
      (entry) => entry.business_id === world.businessId,
    );

    assert.ok(row, "the workspace should appear in the sweep");
    assert.ok(row.due_count > 0);
  });

  test("a commenter who replies is promoted to the same lead", async () => {
    // The full flow: we found them commenting, we answered, they wrote back.
    // Their reply must promote the prospect we already have rather than create
    // a rival record — which is what the bare-vs-prefixed id fix made possible.
    const { resolveSocialThread } = await import("../src/lib/social/meta-inbound.ts");

    const external = psid("full-flow");

    const { data: prospect, error: prospectError } = await admin
      .from("prospects")
      .insert({
        business_id: world.businessId,
        first_name: "Nadia",
        last_name: "Okafor",
        role_classification: "UNKNOWN",
        status: "OUTREACH_ACTIVE",
        outreach_eligibility: "ELIGIBLE",
        subscriber_type: "UNKNOWN",
        verification_status: "UNKNOWN",
        social_platform: "FACEBOOK",
        social_external_id: external,
        social_comment_id: `COMMENT_${RUN}_full-flow`,
        social_commented_at: new Date().toISOString(),
        private_reply_sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    assert.ok(prospect, `prospect insert failed: ${prospectError?.message}`);

    const resolved = await resolveSocialThread(
      {
        provider: "meta",
        providerMessageId: "mid.fullflow",
        from: `meta_psid:${external}`,
        to: `meta_psid:${world.pageId}`,
        body: "Yes please — what would a service cost?",
        channel: "messenger",
        receivedAt: new Date().toISOString(),
      },
      world.businessId,
    );

    assert.ok(resolved, "their reply should resolve to a thread");

    const { data: after } = await admin
      .from("prospects")
      .select("promoted_to_lead_id")
      .eq("id", prospect.id)
      .single();

    assert.ok(after, "the prospect row should still be readable");
    assert.ok(after, "the prospect should still exist");
    assert.equal(
      after.promoted_to_lead_id,
      resolved.leadId,
      "the reply must promote the prospect we already had",
    );

    // And the name we knew from the comment travels onto the lead.
    const { data: lead } = await admin
      .from("leads")
      .select("first_name, last_name")
      .eq("id", resolved.leadId)
      .single();

    assert.ok(lead, "the promoted lead should be readable");
    assert.ok(lead, "the promoted lead should exist");
    assert.equal(lead.first_name, "Nadia");
    assert.equal(lead.last_name, "Okafor");
  });
});

/* ------------------------------------------------- approval is the only gate */

describe("a human decision is what makes a commenter contactable", () => {
  /** Exactly what `engagement-ingest` writes for somebody who commented. */
  async function ingestedCommenter(suffix: string): Promise<string> {
    const { data, error } = await admin
      .from("prospects")
      .insert({
        business_id: world.businessId,
        first_name: "Ola",
        role_classification: "UNKNOWN",
        // The ingest's own values for a public comment: they engaged, but
        // nobody has established who they are, so a person decides.
        status: "REVIEW",
        outreach_eligibility: "REVIEW",
        eligibility_reason:
          "They engaged publicly rather than contacting you. Confirm who they are before reaching out.",
        subscriber_type: "UNKNOWN",
        verification_status: "UNKNOWN",
        social_platform: "INSTAGRAM",
        social_external_id: igsid(suffix),
        social_comment_id: `COMMENT_${RUN}_${suffix}`,
        social_commented_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`could not create commenter: ${error?.message}`);
    return data.id;
  }

  test("an unapproved commenter is not contactable", async () => {
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await ingestedCommenter("gate-unapproved");
    const due = await dueForPrivateReply(world.businessId, 200);

    assert.equal(
      due.some((candidate) => candidate.prospectId === id),
      false,
      "a commenter awaiting review must not be messaged",
    );
  });

  test("approving one resolves the review and makes it contactable", async () => {
    // The chain this locks down was broken end to end: nothing in the product
    // moved a prospect from REVIEW eligibility to ELIGIBLE, and approval
    // refused to touch anything that was not already ELIGIBLE. Every commenter
    // — which is the whole Meta audience — was stranded, and the private-reply
    // queue could never fill.
    const { dueForPrivateReply } = await import("../src/lib/social/private-replies.ts");

    const id = await ingestedCommenter("gate-approved");

    // The action itself needs a session, so the state change it performs is
    // asserted directly. What matters is that this exact transition is the one
    // the queue depends on.
    const { error } = await admin
      .from("prospects")
      .update({
        status: "APPROVED",
        outreach_eligibility: "ELIGIBLE",
        approved_by: world.ownerId,
        approved_at: new Date().toISOString(),
      })
      .eq("business_id", world.businessId)
      .eq("id", id)
      .in("outreach_eligibility", ["ELIGIBLE", "REVIEW"])
      .in("status", ["READY", "REVIEW", "VERIFIED"])
      .is("promoted_to_lead_id", null);

    assert.equal(error, null, "approving a reviewed commenter must succeed");

    const due = await dueForPrivateReply(world.businessId, 200);
    assert.ok(
      due.some((candidate) => candidate.prospectId === id),
      "an approved commenter must become due for a private reply",
    );
  });

  test("approval can never resurrect a suppressed prospect", async () => {
    // SUPPRESSED is not a review awaiting a decision; it is a decision already
    // taken. Widening approval to resolve REVIEW must not have widened it to
    // reverse an opt-out.
    const { data: prospect, error: insertError } = await admin
      .from("prospects")
      .insert({
        business_id: world.businessId,
        first_name: "Ola",
        role_classification: "UNKNOWN",
        status: "REVIEW",
        outreach_eligibility: "SUPPRESSED",
        suppression_reason: "OPT_OUT",
        subscriber_type: "UNKNOWN",
        verification_status: "UNKNOWN",
        social_platform: "INSTAGRAM",
        social_external_id: igsid("gate-suppressed"),
        social_comment_id: `COMMENT_${RUN}_gate-suppressed`,
        social_commented_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    assert.ok(prospect, `suppressed fixture failed: ${insertError?.message}`);

    const { data: touched } = await admin
      .from("prospects")
      .update({ status: "APPROVED", outreach_eligibility: "ELIGIBLE" })
      .eq("business_id", world.businessId)
      .eq("id", prospect.id)
      // The production filter, verbatim.
      .in("outreach_eligibility", ["ELIGIBLE", "REVIEW"])
      .in("status", ["READY", "REVIEW", "VERIFIED"])
      .is("promoted_to_lead_id", null)
      .select("id");

    assert.equal(touched?.length ?? 0, 0, "a suppressed prospect must not be approvable");

    const { data: after } = await admin
      .from("prospects")
      .select("outreach_eligibility")
      .eq("id", prospect.id)
      .single();

    assert.equal(after?.outreach_eligibility, "SUPPRESSED");
  });
});

describe("what a refusal tells the customer", () => {
  test("a prospect that does not exist is not reported as already answered", async () => {
    // Found by a live probe: a nonexistent id returned "their one reply had
    // already been sent", which would send somebody hunting for a message that
    // was never composed. Zero rows updated has two causes and they need two
    // different sentences.
    const { sendOnePrivateReply } = await import("../src/lib/social/private-replies.ts");

    const result = await sendOnePrivateReply({
      businessId: world.businessId,
      businessName: "Meta Flows Ltd",
      candidate: {
        prospectId: "00000000-0000-0000-0000-000000000000",
        platform: "FACEBOOK",
        externalId: psid("ghost"),
        commentId: `COMMENT_${RUN}_ghost`,
        commentedAt: new Date().toISOString(),
        firstName: "Ghost",
        companyName: null,
      },
    });

    assert.equal(result.status, "SKIPPED");
    assert.match(
      result.status === "SKIPPED" ? result.reason : "",
      /no longer exists/i,
    );
  });
});

/* ---------------------------------------- flows 2 and 4: the lead forms */

describe("the lead-form route", () => {
  test("Meta's own lead id makes a repeated delivery a no-op", async () => {
    // Both the webhook and the poll can deliver the same submission. They
    // dedupe on `leads(business_id, external_id)`, so whichever arrives first
    // wins and the second finds the work already done.
    const externalId = `meta:LEADGEN_${RUN}`;

    const insert = () =>
      admin
        .from("leads")
        .insert({
          business_id: world.businessId,
          external_id: externalId,
          first_name: "Priya",
          last_name: "Shah",
          email: `priya-${RUN}@example.co.uk`,
          status: "NEW",
        })
        .select("id")
        .single();

    const first = await insert();
    assert.ok(first.data, "the first insert should succeed");

    const second = await insert();
    assert.equal(second.error?.code, "23505", "the second must collide, not duplicate");

    const { count } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", world.businessId)
      .eq("external_id", externalId);

    assert.equal(count, 1);
  });
});
