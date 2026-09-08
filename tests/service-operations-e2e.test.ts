/**
 * Every service operation, actually executed against a real database.
 *
 * This file exists because of a specific failure. Six operations shipped that
 * could never have worked: they wrote `"sending"` to a column whose vocabulary
 * is `RUNNING`, `"REJECTED"` where it is `DISQUALIFIED`, `"dismissed"` where it
 * is `ignored`, `"disconnected"` where it is `DISCONNECTED`, and offered a
 * booking status the constraint does not contain. Every one type-checked. Every
 * one passed the unit tests. Each would have failed on its first real call.
 *
 * Nothing catches that but running it. A `CHECK` constraint enumerating strings
 * is invisible to TypeScript, and a mocked Supabase client agrees with whatever
 * it is told — so the only test worth having here is one that does the write
 * and reads the row back.
 *
 * The rule this file enforces, and the reason it is a loop rather than a list:
 * **an operation that writes must be exercised here.** A new one that is not
 * fails `every write operation is exercised by this file` below, rather than
 * shipping unexercised.
 *
 * Run with:
 *   npx supabase start
 *   npm run test:e2e:operations
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
  userId: string;
  leadId: string;
  bookingId: string;
  campaignId: string;
  prospectId: string;
  connectorId: string;
  webhookEventId: string;
  agentId: string;
};

let world: World;

/** Operations this run actually executed. Compared against the catalogue. */
const exercised = new Set<string>();

async function run(
  operation: string,
  args: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const { runOperation } = await import("../src/lib/services/index.ts");
  exercised.add(operation);
  return runOperation(operation, args, {
    businessId: world.businessId,
    userId: world.userId,
    role: "owner",
    caller: "MCP",
    correlationId: randomUUID(),
    ...overrides,
  });
}

/** Asserts an operation succeeded, and says why if it did not. */
function ok(result: Awaited<ReturnType<typeof run>>, label: string) {
  assert.equal(
    result.success,
    true,
    `${label} failed: ${result.success ? "" : `${result.code} — ${result.message}`}`,
  );
  return result;
}

before(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "Operations!2026pw",
    email_confirm: true,
  });

  const { data: business } = await admin
    .from("businesses")
    .insert({ name: "Operations Ltd", slug: `ops-${Date.now()}`, status: "active" })
    .select("id")
    .single();

  const businessId = business!.id;
  const userId = user!.user!.id;

  await admin.from("business_members").insert({
    business_id: businessId,
    user_id: userId,
    role: "owner",
    status: "active",
  });

  const { data: lead } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      first_name: "Priya",
      last_name: "Shah",
      email: `ops-${Date.now()}@example.co.uk`,
      phone: "+447700900321",
      phone_normalized: "+447700900321",
      status: "NEW",
    })
    .select("id")
    .single();

  const { data: booking } = await admin
    .from("bookings")
    .insert({
      business_id: businessId,
      lead_id: lead!.id,
      provider: "manual",
      status: "scheduled",
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select("id")
    .single();

  const { data: campaign } = await admin
    .from("campaigns")
    .insert({
      business_id: businessId,
      name: "Winter reactivation",
      status: "DRAFT",
      channel: "sms",
      message_template: "Hello {{first_name}}",
    })
    .select("id")
    .single();

  const { data: company } = await admin
    .from("prospect_companies")
    .insert({ business_id: businessId, name: "Apex Roofing" })
    .select("id")
    .single();

  const { data: prospect } = await admin
    .from("prospects")
    .insert({
      business_id: businessId,
      company_id: company?.id ?? null,
      first_name: "Dara",
      last_name: "Okafor",
      email: `dara-${Date.now()}@example.co.uk`,
      status: "READY",
    })
    .select("id")
    .single();

  const { data: connector } = await admin
    .from("integrations")
    .insert({
      business_id: businessId,
      provider_type: "slack",
      status: "HEALTHY",
      display_name: "Slack",
    })
    .select("id")
    .single();

  const { data: event } = await admin
    .from("webhook_events")
    .insert({
      business_id: businessId,
      provider: "slack",
      external_event_id: `evt-${Date.now()}`,
      event_type: "message",
      status: "failed",
      payload: {},
    })
    .select("id")
    .single();

  world = {
    businessId,
    userId,
    leadId: lead!.id,
    bookingId: booking!.id,
    campaignId: campaign!.id,
    prospectId: prospect!.id,
    connectorId: connector!.id,
    webhookEventId: event!.id,
    agentId: "",
  };
});

after(async () => {
  if (!world) return;
  await admin.from("businesses").delete().eq("id", world.businessId);
  await admin.auth.admin.deleteUser(world.userId).catch(() => undefined);
});

/* ----------------------------------------------------------------- leads */

describe("lead operations write what the schema accepts", () => {
  test("update, status, note, attention, assign", async () => {
    ok(await run("lead.get", { leadId: world.leadId }), "lead.get");
    ok(await run("lead.search", { query: "Priya" }), "lead.search");

    ok(
      await run("lead.update", { leadId: world.leadId, postcode: "M1 2AB" }),
      "lead.update",
    );

    const status = ok(
      await run("lead.set_status", { leadId: world.leadId, status: "CONTACTED" }),
      "lead.set_status",
    );
    assert.equal(
      (status.success && (status.after as { status?: string })?.status) ?? "CONTACTED",
      "CONTACTED",
    );

    ok(
      await run("lead.add_note", { leadId: world.leadId, body: "Called back." }),
      "lead.add_note",
    );
    ok(
      await run("lead.flag_attention", { leadId: world.leadId, needsAttention: true }),
      "lead.flag_attention",
    );
    ok(
      await run("lead.assign", { leadId: world.leadId, userId: world.userId }),
      "lead.assign",
    );
  });

  test("archive and restore round-trip", async () => {
    // DESTRUCTIVE, so it needs the confirmation a person gives.
    ok(
      await run("lead.archive", { leadId: world.leadId }, { confirmed: true }),
      "lead.archive",
    );
    ok(await run("lead.restore", { leadId: world.leadId }), "lead.restore");

    const { data } = await admin
      .from("leads")
      .select("archived_at")
      .eq("id", world.leadId)
      .single();
    assert.equal(data?.archived_at, null, "the lead should be restored");
  });
});

/* -------------------------------------------------------------- messaging */

describe("message.send", () => {
  test("queues a real message and meters it", async () => {
    const result = ok(
      await run(
        "message.send",
        { leadId: world.leadId, channel: "sms", body: "Hello from the tests." },
        { confirmed: true },
      ),
      "message.send",
    );

    const messageId =
      result.success && (result.data as { messageId?: string }).messageId;
    assert.ok(messageId, "no message row was created");

    const { data: message } = await admin
      .from("messages")
      .select("status, direction, channel, origin")
      .eq("id", messageId as string)
      .single();

    assert.equal(message?.status, "QUEUED");
    assert.equal(message?.direction, "outbound");

    // Queued for the sender rather than sent inline: holding a request open
    // while contacting a carrier is how a timeout becomes a double send.
    const { count } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", world.businessId)
      .eq("type", "message.send");
    assert.ok((count ?? 0) >= 1, "no send job was queued");
  });

  test("an opted-out lead is refused, not queued", async () => {
    await admin
      .from("leads")
      .update({ opted_out: true })
      .eq("id", world.leadId);

    const result = await run(
      "message.send",
      { leadId: world.leadId, channel: "sms", body: "Should not send." },
      { confirmed: true },
    );

    assert.equal(result.success, false);
    assert.equal(result.success === false && result.code, "POLICY_BLOCKED");

    await admin.from("leads").update({ opted_out: false }).eq("id", world.leadId);
  });
});

/* -------------------------------------------------------------- bookings */

describe("booking operations", () => {
  test("every declared status is one the database accepts", async () => {
    ok(await run("booking.list", {}), "booking.list");
    ok(await run("booking.get", { bookingId: world.bookingId }), "booking.get");

    // The bug this catches directly: a status offered in the schema that the
    // column's CHECK constraint rejects. Each is written and read back.
    for (const status of ["completed", "cancelled", "no_show", "scheduled"]) {
      ok(
        await run("booking.set_status", { bookingId: world.bookingId, status }),
        `booking.set_status(${status})`,
      );

      const { data } = await admin
        .from("bookings")
        .select("status")
        .eq("id", world.bookingId)
        .single();
      assert.equal(data?.status, status, `${status} did not persist`);
    }
  });
});

/* -------------------------------------------------------------- campaigns */

describe("campaign lifecycle", () => {
  test("launch, pause and resume move through real statuses", async () => {
    ok(await run("campaign.list", {}), "campaign.list");
    ok(await run("campaign.get", { campaignId: world.campaignId }), "campaign.get");

    const launched = ok(
      await run("campaign.launch", { campaignId: world.campaignId }, { confirmed: true }),
      "campaign.launch",
    );
    assert.equal(
      launched.success && (launched.after as { status?: string })?.status,
      "RUNNING",
      "a launched campaign must be RUNNING, the value the column holds",
    );

    ok(await run("campaign.pause", { campaignId: world.campaignId }), "campaign.pause");

    const { data: paused } = await admin
      .from("campaigns")
      .select("status, paused_at")
      .eq("id", world.campaignId)
      .single();
    assert.equal(paused?.status, "PAUSED");
    assert.ok(paused?.paused_at, "paused_at was not recorded");

    ok(
      await run("campaign.resume", { campaignId: world.campaignId }, { confirmed: true }),
      "campaign.resume",
    );

    const { data: resumed } = await admin
      .from("campaigns")
      .select("status")
      .eq("id", world.campaignId)
      .single();
    assert.equal(resumed?.status, "RUNNING");
  });

  test("a transition the status does not allow is refused", async () => {
    // Launching an already-running campaign would send to the audience twice.
    const again = await run(
      "campaign.launch",
      { campaignId: world.campaignId },
      { confirmed: true },
    );
    assert.equal(again.success, false);
    assert.equal(again.success === false && again.code, "CONFLICT");
  });
});

/* -------------------------------------------------------------- prospects */

describe("prospect decisions", () => {
  test("approve and reject persist a status the column permits", async () => {
    ok(await run("prospect.search", {}), "prospect.search");
    ok(await run("prospect.get", { prospectId: world.prospectId }), "prospect.get");

    ok(
      await run("prospect.approve", { prospectId: world.prospectId }),
      "prospect.approve",
    );
    const { data: approved } = await admin
      .from("prospects")
      .select("status, approved_at")
      .eq("id", world.prospectId)
      .single();
    assert.equal(approved?.status, "APPROVED");
    assert.ok(approved?.approved_at, "approved_at was not recorded");

    ok(await run("prospect.reject", { prospectId: world.prospectId }), "prospect.reject");
    const { data: rejected } = await admin
      .from("prospects")
      .select("status")
      .eq("id", world.prospectId)
      .single();
    // "REJECTED" is not a value this column holds; DISQUALIFIED is.
    assert.equal(rejected?.status, "DISQUALIFIED");
  });
});

/* ------------------------------------------------------------- connectors */

describe("connector operations", () => {
  test("a healthy connector is not counted as needing attention", async () => {
    const listed = ok(await run("connector.list", {}), "connector.list");
    const data = listed.success
      ? (listed.data as { count: number; needingAttention: number })
      : null;

    assert.equal(data?.count, 1);
    // The bug this catches: comparing against a status value the column never
    // holds, which made every connector — healthy ones included — read as broken.
    assert.equal(data?.needingAttention, 0, "a HEALTHY connector reads as broken");
  });

  test("status is reported from the same vocabulary everywhere", async () => {
    const status = ok(await run("business.get_status", {}), "business.get_status");
    const summary = status.success
      ? (status.data as { connectors: { healthy: number }; healthy: boolean })
      : null;
    assert.equal(summary?.connectors.healthy, 1);
  });

  test("replay and dismiss write statuses the column accepts", async () => {
    ok(await run("connector.get", { connectorId: world.connectorId }), "connector.get");

    ok(
      await run("connector.replay_event", { eventId: world.webhookEventId }),
      "connector.replay_event",
    );

    ok(
      await run("connector.dismiss_event", { eventId: world.webhookEventId }),
      "connector.dismiss_event",
    );
    const { data } = await admin
      .from("webhook_events")
      .select("status")
      .eq("id", world.webhookEventId)
      .single();
    // `dismissed` is not one of the five values this column holds; `ignored` is.
    assert.equal(data?.status, "ignored");
  });

  test("disconnect persists, and takes the stored credential with it", async () => {
    ok(
      await run(
        "connector.disconnect",
        { connectorId: world.connectorId },
        { confirmed: true },
      ),
      "connector.disconnect",
    );

    const { data } = await admin
      .from("integrations")
      .select("status")
      .eq("id", world.connectorId)
      .single();
    assert.equal(data?.status, "DISCONNECTED");

    const { count } = await admin
      .from("integration_secrets")
      .select("integration_id", { count: "exact", head: true })
      .eq("integration_id", world.connectorId);
    assert.equal(count ?? 0, 0, "a live credential was left behind");
  });
});

/* ----------------------------------------------------------------- agents */

describe("agent setup and lifecycle", () => {
  test("create, configure, start, pause, stop", async () => {
    ok(await run("agent.list", {}), "agent.list");

    const created = ok(
      await run("agent.create", {
        name: "Booking chaser",
        type: "BOOKING",
        cadence: "DAILY",
        dailyCap: 10,
        monthlyCap: 100,
      }),
      "agent.create",
    );

    const agentId = created.entityId!;
    world.agentId = agentId;

    // A new agent is always a draft. That is what makes creating it safe.
    const { data: draft } = await admin
      .from("agents")
      .select("status, autonomy")
      .eq("id", agentId)
      .single();
    assert.equal(draft?.status, "DRAFT");
    assert.equal(draft?.autonomy, "REVIEW_ALL", "a new agent must default to review");

    ok(await run("agent.get", { agentId }), "agent.get");

    ok(
      await run("agent.configure", { agentId, dailyCap: 20, cadence: "WEEKLY" }),
      "agent.configure",
    );
    const { data: configured } = await admin
      .from("agents")
      .select("daily_prospect_cap, cadence")
      .eq("id", agentId)
      .single();
    assert.equal(configured?.daily_prospect_cap, 20);
    assert.equal(configured?.cadence, "WEEKLY");

    ok(await run("agent.start", { agentId }, { confirmed: true }), "agent.start");
    ok(await run("agent.run_now", { agentId }, { confirmed: true }), "agent.run_now");
    ok(await run("agent.pause", { agentId }), "agent.pause");
    ok(await run("agent.stop", { agentId }), "agent.stop");

    const { data: stopped } = await admin
      .from("agents")
      .select("status")
      .eq("id", agentId)
      .single();
    assert.equal(stopped?.status, "STOPPED");
  });

  test("starting is refused without a person's confirmation", async () => {
    const result = await run("agent.start", { agentId: world.agentId });
    assert.equal(result.success, false);
    assert.equal(result.success === false && result.code, "NEEDS_CONFIRMATION");
  });

  test("the monthly limit cannot be set below the daily one", async () => {
    const result = await run("agent.configure", {
      agentId: world.agentId,
      dailyCap: 100,
      monthlyCap: 10,
    });
    assert.equal(result.success, false);
    assert.equal(result.success === false && result.code, "INVALID_INPUT");
  });

  test("the agent's own activity feed records what happened", async () => {
    // The audit row proves it happened; this is what the customer reads.
    const { data } = await admin
      .from("agent_activity_events")
      .select("event_type, severity")
      .eq("agent_id", world.agentId);

    const types = new Set((data ?? []).map((row) => row.event_type));
    assert.ok(types.has("CREATED"));
    assert.ok(types.has("ACTIVE"));
    assert.ok(types.has("STOPPED"));
  });
});

/* --------------------------------------------------- conversation assistant */

describe("ai_settings", () => {
  test("reads back what it wrote", async () => {
    ok(await run("ai_settings.get", {}), "ai_settings.get");

    const updated = ok(
      await run("ai_settings.update", { tone: "friendly", replyLength: "normal" }),
      "ai_settings.update",
    );
    const settings = updated.success
      ? (updated.data as { settings: { tone: string; replyLength: string } }).settings
      : null;

    assert.equal(settings?.tone, "friendly");
    assert.equal(settings?.replyLength, "normal");
  });

  test("the assistant cannot be switched on while AI is off", async () => {
    const result = ok(
      await run("ai_settings.update", { enabled: false, agentMode: "AUTO_REPLY" }),
      "ai_settings.update",
    );
    const settings = result.success
      ? (result.data as { settings: { agentMode: string } }).settings
      : null;

    assert.equal(settings?.agentMode, "OFF", "the agent must not run with AI off");
    assert.ok(
      result.success && result.warnings.some((w) => w.code === "agent_disabled"),
      "the contradiction must be reported, not silently corrected",
    );
  });
});

/* ---------------------------------------------------------------- reading */

describe("reads", () => {
  test("the remaining read operations run", async () => {
    ok(await run("business.get_profile", {}), "business.get_profile");
    ok(await run("analytics.summary", { days: 30 }), "analytics.summary");
    ok(
      await run("qualification.list_questions", {}),
      "qualification.list_questions",
    );
  });
});

/* ------------------------------------------------------------- completeness */

describe("coverage", () => {
  test("every write operation is exercised by this file", async () => {
    // The guard that makes the rest of this file a rule rather than a snapshot.
    // A new write operation that nobody exercises here would be one nobody has
    // ever actually run — which is exactly how six of them shipped broken.
    const { SERVICE_OPERATIONS } = await import("../src/lib/services/registry.ts");

    const missing = SERVICE_OPERATIONS.filter(
      (operation) => operation.risk !== "READ" && !exercised.has(operation.name),
    ).map((operation) => operation.name);

    assert.deepEqual(
      missing,
      [],
      `these write operations have never been run against a database: ${missing.join(", ")}`,
    );
  });

  test("every read operation is exercised too", async () => {
    const { SERVICE_OPERATIONS } = await import("../src/lib/services/registry.ts");

    const missing = SERVICE_OPERATIONS.filter(
      (operation) => operation.risk === "READ" && !exercised.has(operation.name),
    ).map((operation) => operation.name);

    assert.deepEqual(missing, [], `unexercised reads: ${missing.join(", ")}`);
  });
});
