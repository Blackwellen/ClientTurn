/**
 * Every write operation, executed against a real database.
 *
 * This exists because of a specific and embarrassing class of bug. Five
 * operations shipped that could never succeed: they wrote `"sending"` into a
 * column whose CHECK constraint says `RUNNING`, `"disconnected"` where it says
 * `DISCONNECTED`, `"REJECTED"` where the vocabulary is `DISQUALIFIED`,
 * `"dismissed"` where it is `ignored`, and a `rescheduled` booking status that
 * does not exist. Every one typechecked. Every one passed the unit tests. Every
 * one would have failed the first time a customer used it.
 *
 * The reason none of that was caught is simple: a Postgres CHECK constraint
 * enumerating strings is invisible to TypeScript, and the only thing that can
 * see it is actually running the statement. So that is what this does — it runs
 * all of them.
 *
 * The assertion is deliberately blunt. A write either succeeds, or fails with a
 * *domain* refusal the operation meant to make (NOT_FOUND, PLAN_LIMIT,
 * POLICY_BLOCKED, NEEDS_CONFIRMATION). What it must never do is fail with the
 * generic CONFLICT a handler raises when the database rejected the row —
 * because that means the operation cannot work at all, for anyone, ever.
 *
 * Run with:
 *   npx supabase start
 *   npm run test:e2e:writes
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
  ownerId: string;
  memberId: string;
  leadId: string;
  agentId: string;
  campaignId: string;
  bookingId: string;
  prospectId: string;
  integrationId: string;
  webhookEventId: string;
};

let world: World;

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `writes-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "ServiceWrites!2026pw",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  return data.user.id;
}

/** Inserts a row and fails loudly rather than leaving the suite to guess. */
async function insert(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from(table)
    .insert(row as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`fixture ${table} failed: ${error?.message ?? "no row"}`);
  }
  return (data as { id: string }).id;
}

before(async () => {
  const ownerId = await createUser("owner");
  const memberId = await createUser("member");

  const businessId = await insert("businesses", {
    name: "Service Writes Ltd",
    slug: `service-writes-${Date.now()}`,
    status: "active",
  });

  await admin.from("business_members").insert([
    { business_id: businessId, user_id: ownerId, role: "owner", status: "active" },
    { business_id: businessId, user_id: memberId, role: "member", status: "active" },
  ]);

  const leadId = await insert("leads", {
    business_id: businessId,
    first_name: "Priya",
    last_name: "Shah",
    email: `writes-${Date.now()}@example.co.uk`,
    phone: "+447700900123",
    phone_normalized: "+447700900123",
    status: "NEW",
  });

  const agentId = await insert("agents", {
    business_id: businessId,
    created_by: ownerId,
    name: "Fixture agent",
    agent_type: "BOOKING",
    cadence: "DAILY",
    daily_prospect_cap: 10,
    monthly_prospect_cap: 100,
    timezone: "Europe/London",
    status: "DRAFT",
    autonomy: "REVIEW_ALL",
  });

  const campaignId = await insert("campaigns", {
    business_id: businessId,
    name: "Fixture campaign",
    status: "DRAFT",
    channel: "sms",
    message_template: "Hello {{first_name}}",
    created_by: ownerId,
  });

  const bookingId = await insert("bookings", {
    business_id: businessId,
    lead_id: leadId,
    provider: "manual",
    status: "scheduled",
    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
  });

  const companyId = await insert("prospect_companies", {
    business_id: businessId,
    name: "Fixture Co",
    // Not nullable: the table dedupes companies on it, so a fixture without one
    // is refused. Unique per run so repeated runs do not collide.
    dedupe_key: `fixture-co-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  const prospectId = await insert("prospects", {
    business_id: businessId,
    company_id: companyId,
    first_name: "Sam",
    last_name: "Okafor",
    email: `prospect-${Date.now()}@example.co.uk`,
    status: "READY",
    verification_status: "VALID",
    outreach_eligibility: "ELIGIBLE",
    subscriber_type: "CORPORATE",
    role_classification: "DECISION_MAKER",
  });

  const integrationId = await insert("integrations", {
    business_id: businessId,
    provider_type: "slack",
    status: "HEALTHY",
    display_name: "Fixture Slack",
    connected_by: ownerId,
  });

  const webhookEventId = await insert("webhook_events", {
    business_id: businessId,
    provider: "stub",
    external_event_id: `fixture-${randomUUID()}`,
    event_type: "fixture.event",
    status: "failed",
    payload: {},
  });

  world = {
    businessId,
    ownerId,
    memberId,
    leadId,
    agentId,
    campaignId,
    bookingId,
    prospectId,
    integrationId,
    webhookEventId,
  };
});

after(async () => {
  if (!world) return;
  await admin.from("businesses").delete().eq("id", world.businessId);
  for (const id of [world.ownerId, world.memberId]) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

/* ---------------------------------------------------------------- running */

/**
 * Refusals an operation is entitled to make about *this* fixture.
 *
 * A CONFLICT is deliberately absent. Handlers raise it when the database
 * refused the row, which is precisely the failure this suite exists to catch —
 * so a CONFLICT here is always a bug, never a valid outcome.
 */
const ALLOWED_REFUSALS = new Set([
  "NOT_FOUND",
  "PLAN_LIMIT",
  "POLICY_BLOCKED",
  "NEEDS_CONFIRMATION",
  "INVALID_INPUT",
]);

async function run(
  operation: string,
  args: Record<string, unknown>,
  options: { confirmed?: boolean } = {},
) {
  const { runOperation } = await import("../src/lib/services/index.ts");
  return runOperation(operation, args, {
    businessId: world.businessId,
    userId: world.ownerId,
    role: "owner",
    caller: "UI",
    // Every write here is run as a person who confirmed it. The point is to
    // reach the database statement, not to re-test the confirmation gate —
    // `tests/mcp.test.ts` and the developer-platform suite cover that.
    confirmed: options.confirmed ?? true,
    correlationId: randomUUID(),
  });
}

/**
 * Runs a write and fails if the database refused the row.
 *
 * The message deliberately names the likely cause, because when this fires the
 * answer is almost always a string literal that does not match a CHECK
 * constraint, and that is a two-minute fix once you know to look.
 */
async function expectReaches(
  operation: string,
  args: Record<string, unknown>,
  options: { confirmed?: boolean } = {},
) {
  const result = await run(operation, args, options);

  if (result.success) return result;

  assert.ok(
    ALLOWED_REFUSALS.has(result.code),
    `${operation} failed with ${result.code}: "${result.message}".\n` +
      `That is not a refusal this operation is entitled to make about a valid ` +
      `fixture. The usual cause is a value written to a column whose CHECK ` +
      `constraint does not permit it — compare the literals in the handler ` +
      `against the constraint.`,
  );

  return result;
}

/* ------------------------------------------------------------------ leads */

describe("lead writes reach the database", () => {
  test("update, assign, set_status, add_note, flag_attention", async () => {
    await expectReaches("lead.update", {
      leadId: world.leadId,
      firstName: "Priyanka",
      postcode: "M1 2AB",
    });
    await expectReaches("lead.assign", {
      leadId: world.leadId,
      userId: world.memberId,
    });
    await expectReaches("lead.set_status", {
      leadId: world.leadId,
      status: "CONTACTED",
    });
    await expectReaches("lead.add_note", {
      leadId: world.leadId,
      body: "Written by the write-coverage suite.",
    });
    await expectReaches("lead.flag_attention", {
      leadId: world.leadId,
      reason: "Needs a person",
    });
  });

  test("every lead status the operation accepts is a status the column accepts", async () => {
    // The enum in the schema and the CHECK constraint on the column are two
    // separate lists that nothing keeps in step. Walking every value is the
    // only way to know they agree.
    for (const status of [
      "NEW",
      "CONTACTED",
      "RESPONDED",
      "QUALIFIED",
      "BOOKED",
      "WON",
      "LOST",
    ]) {
      await expectReaches("lead.set_status", { leadId: world.leadId, status });
    }
  });

  test("archive and restore", async () => {
    await expectReaches("lead.archive", { leadId: world.leadId });
    await expectReaches("lead.restore", { leadId: world.leadId });
  });
});

/* ----------------------------------------------------------------- agents */

describe("agent writes reach the database", () => {
  test("create, configure, and every lifecycle move", async () => {
    const created = await expectReaches("agent.create", {
      name: "Write-coverage agent",
      type: "BOOKING",
      cadence: "DAILY",
      dailyCap: 12,
      monthlyCap: 120,
      autonomy: "REVIEW_ALL",
    });

    assert.ok(created.success, "agent.create should succeed on a clean fixture");
    const agentId = created.success ? created.entityId! : world.agentId;

    await expectReaches("agent.configure", {
      agentId,
      dailyCap: 20,
      monthlyCap: 200,
      autonomy: "AUTO",
      cadence: "WEEKLY",
    });

    await expectReaches("agent.start", { agentId });
    await expectReaches("agent.run_now", { agentId });
    await expectReaches("agent.pause", { agentId });
    await expectReaches("agent.stop", { agentId });

    await admin.from("agents").delete().eq("id", agentId);
  });

  test("every agent type, cadence and autonomy the schema accepts", async () => {
    for (const type of ["SOURCING", "BOOKING", "REENGAGEMENT", "COMBINED"]) {
      for (const cadence of ["MANUAL", "HOURLY", "DAILY", "WEEKLY"]) {
        const result = await run("agent.create", {
          name: `${type}-${cadence}`,
          type,
          cadence,
          dailyCap: 5,
          monthlyCap: 50,
        });

        // A sourcing agent can be refused on plan grounds, which is a real
        // refusal rather than a broken write.
        if (!result.success) {
          assert.ok(
            ALLOWED_REFUSALS.has(result.code),
            `agent.create(${type}, ${cadence}) failed with ${result.code}: ${result.message}`,
          );
          continue;
        }

        await admin.from("agents").delete().eq("id", result.entityId!);
      }
    }
  });

  test("every autonomy value is one the column accepts", async () => {
    for (const autonomy of ["REVIEW_ALL", "REVIEW_NEW", "AUTO"]) {
      await expectReaches("agent.configure", { agentId: world.agentId, autonomy });
    }
  });
});

/* ------------------------------------------------------------ ai settings */

describe("conversation assistant settings reach the database", () => {
  test("every tone, length and mode the schema accepts", async () => {
    for (const tone of ["professional", "friendly", "direct"]) {
      await expectReaches("ai_settings.update", { tone });
    }
    for (const replyLength of ["short", "normal"]) {
      await expectReaches("ai_settings.update", { replyLength });
    }
    for (const agentMode of ["OFF", "SUGGEST_ONLY", "AUTO_REPLY"]) {
      await expectReaches("ai_settings.update", { agentMode });
    }
    await expectReaches("ai_settings.update", {
      agentChannels: ["sms", "whatsapp", "email"],
    });
  });
});

/* ------------------------------------------------------------- connectors */

describe("connector writes reach the database", () => {
  test("replay and dismiss a failed event", async () => {
    await expectReaches("connector.replay_event", {
      eventId: world.webhookEventId,
    });
    await expectReaches("connector.dismiss_event", {
      eventId: world.webhookEventId,
    });

    // The dismissed event must land on a status the column actually permits,
    // which is the whole point.
    const { data } = await admin
      .from("webhook_events")
      .select("status")
      .eq("id", world.webhookEventId)
      .single();
    assert.equal(data?.status, "ignored");
  });

  test("disconnect", async () => {
    await expectReaches("connector.disconnect", {
      connectorId: world.integrationId,
    });

    const { data } = await admin
      .from("integrations")
      .select("status")
      .eq("id", world.integrationId)
      .single();
    assert.equal(data?.status, "DISCONNECTED");
  });
});

/* -------------------------------------------------------------- bookings */

describe("booking writes reach the database", () => {
  test("every status the operation offers is one the column accepts", async () => {
    for (const status of ["completed", "cancelled", "no_show", "scheduled"]) {
      await expectReaches("booking.set_status", {
        bookingId: world.bookingId,
        status,
      });
    }
  });
});

/* -------------------------------------------------------------- campaigns */

describe("campaign writes reach the database", () => {
  test("launch, pause and resume land on statuses the column accepts", async () => {
    await expectReaches("campaign.launch", { campaignId: world.campaignId });

    const afterLaunch = await admin
      .from("campaigns")
      .select("status")
      .eq("id", world.campaignId)
      .single();
    assert.equal(
      afterLaunch.data?.status,
      "RUNNING",
      "a launched campaign must land on RUNNING, the value the column permits",
    );

    await expectReaches("campaign.pause", { campaignId: world.campaignId });

    const afterPause = await admin
      .from("campaigns")
      .select("status")
      .eq("id", world.campaignId)
      .single();
    assert.equal(afterPause.data?.status, "PAUSED");

    await expectReaches("campaign.resume", { campaignId: world.campaignId });

    const afterResume = await admin
      .from("campaigns")
      .select("status")
      .eq("id", world.campaignId)
      .single();
    assert.equal(afterResume.data?.status, "RUNNING");
  });
});

/* -------------------------------------------------------------- prospects */

describe("prospect writes reach the database", () => {
  test("approve and reject land on statuses the column accepts", async () => {
    await expectReaches("prospect.approve", { prospectId: world.prospectId });

    const approved = await admin
      .from("prospects")
      .select("status")
      .eq("id", world.prospectId)
      .single();
    assert.equal(approved.data?.status, "APPROVED");

    await expectReaches("prospect.reject", {
      prospectId: world.prospectId,
      reason: "Out of area",
    });

    const rejected = await admin
      .from("prospects")
      .select("status")
      .eq("id", world.prospectId)
      .single();
    assert.equal(
      rejected.data?.status,
      "DISQUALIFIED",
      "rejection must use the column's own vocabulary, not a word we invented",
    );
  });
});

/* --------------------------------------------------------------- messages */

describe("message writes reach the database", () => {
  test("a queued message lands with a status the column accepts", async () => {
    const result = await run("message.send", {
      leadId: world.leadId,
      channel: "sms",
      body: "Written by the write-coverage suite.",
    });

    // A plan without messaging refuses this, which is a real refusal.
    if (!result.success) {
      assert.ok(
        ALLOWED_REFUSALS.has(result.code),
        `message.send failed with ${result.code}: ${result.message}`,
      );
      return;
    }

    const { data } = await admin
      .from("messages")
      .select("status, direction, origin")
      .eq("business_id", world.businessId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1);

    assert.equal(data?.[0]?.status, "QUEUED");
  });
});

/* ------------------------------------------------------------- completeness */

describe("coverage", () => {
  test("every write operation in the registry is exercised above", async () => {
    // The guard that keeps this suite honest. Adding a write operation without
    // adding it here fails, so the class of bug this file exists to catch
    // cannot quietly return through the next operation somebody writes.
    const { SERVICE_OPERATIONS } = await import("../src/lib/services/registry.ts");

    const exercised = new Set([
      "lead.update",
      "lead.assign",
      "lead.set_status",
      "lead.add_note",
      "lead.flag_attention",
      "lead.archive",
      "lead.restore",
      "agent.create",
      "agent.configure",
      "agent.start",
      "agent.run_now",
      "agent.pause",
      "agent.stop",
      "ai_settings.update",
      "connector.replay_event",
      "connector.dismiss_event",
      "connector.disconnect",
      "message.send",
      "booking.set_status",
      "campaign.pause",
      "campaign.resume",
      "campaign.launch",
      "prospect.approve",
      "prospect.reject",
    ]);

    const missing = SERVICE_OPERATIONS.filter(
      (operation) => operation.risk !== "READ" && !exercised.has(operation.name),
    ).map((operation) => operation.name);

    assert.deepEqual(
      missing,
      [],
      `these write operations are never run against a real database, so a value ` +
        `they write could be rejected by a CHECK constraint and nobody would know`,
    );
  });
});
