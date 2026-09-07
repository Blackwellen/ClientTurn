/**
 * The four-route acceptance test (Programme §21).
 *
 * The programme's definition of done: the UI, Copilot, an autonomous agent and
 * an MCP client all producing **identical database state, billing events,
 * permission decisions and audit history** for the same operation. If those four
 * diverge, the service layer has not actually unified anything and the
 * divergence will be discovered by a customer rather than by a test.
 *
 * This runs against a real Postgres with the real RLS, because permission is
 * enforced by the database and mocking it would prove nothing.
 *
 * Run with:
 *   npx supabase start
 *   npm run test:e2e:routes
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

/* --------------------------------------------------------------- fixtures */

type World = {
  businessId: string;
  ownerId: string;
  memberId: string;
  viewerId: string;
  leadIds: Record<Caller, string>;
};

type Caller = "UI" | "COPILOT" | "AGENT" | "MCP";
const CALLERS: Caller[] = ["UI", "COPILOT", "AGENT", "MCP"];

let world: World;

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "FourRoutes!2026pw",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  return data.user.id;
}

before(async () => {
  const ownerId = await createUser("owner");
  const memberId = await createUser("member");
  const viewerId = await createUser("viewer");

  const { data: business, error } = await admin
    .from("businesses")
    .insert({
      name: "Four Routes Ltd",
      slug: `four-routes-${Date.now()}`,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !business) throw new Error(`could not create business: ${error?.message}`);

  await admin.from("business_members").insert([
    { business_id: business.id, user_id: ownerId, role: "owner", status: "active" },
    { business_id: business.id, user_id: memberId, role: "member", status: "active" },
    { business_id: business.id, user_id: viewerId, role: "viewer", status: "active" },
  ]);

  // One lead per route, identical to start with, so a divergence is visible as
  // a difference between them rather than as a difference over time.
  const leadIds = {} as Record<Caller, string>;
  for (const caller of CALLERS) {
    const { data: lead } = await admin
      .from("leads")
      .insert({
        business_id: business.id,
        first_name: "Priya",
        last_name: "Shah",
        email: `priya-${caller.toLowerCase()}@example.co.uk`,
        status: "NEW",
      })
      .select("id")
      .single();
    leadIds[caller] = lead!.id;
  }

  world = {
    businessId: business.id,
    ownerId,
    memberId,
    viewerId,
    leadIds,
  };
});

after(async () => {
  if (!world) return;
  await admin.from("businesses").delete().eq("id", world.businessId);
  for (const id of [world.ownerId, world.memberId, world.viewerId]) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

/* ------------------------------------------------------------- the runner */

/** Imported lazily so the service registry loads after env is in place. */
async function run(
  operation: string,
  args: Record<string, unknown>,
  context: {
    caller: Caller | "SYSTEM";
    userId: string;
    role: "owner" | "admin" | "member" | "viewer";
    confirmed?: boolean;
  },
) {
  const { runOperation } = await import("../src/lib/services/index.ts");
  return runOperation(operation, args, {
    businessId: world.businessId,
    userId: context.userId,
    role: context.role,
    caller: context.caller,
    confirmed: context.confirmed,
    correlationId: randomUUID(),
  });
}

/** The audit rows this operation produced, newest first. */
async function auditFor(entityId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("action, actor_type, actor_user_id, entity_type, metadata")
    .eq("business_id", world.businessId)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/* ----------------------------------------------------- the acceptance test */

describe("the same operation through all four routes", () => {
  const results: Record<string, Awaited<ReturnType<typeof run>>> = {};

  test("every route can perform the same write", async () => {
    for (const caller of CALLERS) {
      const result = await run(
        "lead.set_status",
        { leadId: world.leadIds[caller], status: "QUALIFIED" },
        { caller, userId: world.memberId, role: "member" },
      );
      results[caller] = result;
      assert.equal(result.success, true, `${caller} was refused: ${JSON.stringify(result)}`);
    }
  });

  test("they leave identical database state", async () => {
    const rows = [];
    for (const caller of CALLERS) {
      const { data } = await admin
        .from("leads")
        .select("status, qualification_state, needs_attention, archived_at")
        .eq("id", world.leadIds[caller])
        .single();
      rows.push({ caller, ...data });
    }

    const [first, ...rest] = rows;
    for (const row of rest) {
      assert.deepEqual(
        { ...row, caller: undefined },
        { ...first, caller: undefined },
        `${row.caller} left different state from ${first.caller}`,
      );
    }
    assert.equal(first.status, "QUALIFIED");
  });

  test("they report identical before and after", async () => {
    // Each route acts on its own lead, so the identifying fields differ by
    // design. What must match is everything the *operation* touches — comparing
    // the email as well would only assert that the fixtures were set up
    // differently, which is not a property of the service layer.
    const identifying = new Set(["email", "first_name", "last_name", "phone"]);
    const comparable = (snapshot: Record<string, unknown> | null) =>
      Object.fromEntries(
        Object.entries(snapshot ?? {}).filter(([key]) => !identifying.has(key)),
      );

    const shapes = CALLERS.map((caller) => {
      const result = results[caller];
      if (!result.success) throw new Error(`${caller} failed`);
      return {
        before: comparable(result.before),
        after: comparable(result.after),
      };
    });

    for (const shape of shapes.slice(1)) {
      assert.deepEqual(shape, shapes[0]);
    }
    assert.equal(shapes[0].before.status, "NEW");
    assert.equal(shapes[0].after.status, "QUALIFIED");
  });

  test("every route produces an audit row that names it", async () => {
    for (const caller of CALLERS) {
      const rows = await auditFor(world.leadIds[caller]);
      const entry = rows.find((row) => row.action === "lead.set_status");
      assert.ok(entry, `${caller} produced no audit row`);
      assert.equal(
        (entry!.metadata as Record<string, unknown>).caller,
        caller,
        `${caller}'s audit row does not name the caller`,
      );
      // "a lead was qualified" and "a lead was qualified by an MCP client acting
      // for Priya" are different facts, and only the second is useful later.
      assert.ok(entry!.metadata, "audit row carries no before/after");
    }
  });

  test("every route returns an audit id that resolves to a real row", async () => {
    for (const caller of CALLERS) {
      const result = results[caller];
      if (!result.success) throw new Error(`${caller} failed`);
      assert.ok(result.auditEventId, `${caller} returned no audit id`);

      const { data } = await admin
        .from("audit_log")
        .select("id, action")
        .eq("id", result.auditEventId!)
        .single();

      // The claim has to be checkable. An assistant that says "I archived that"
      // and hands back an id nobody can look up has asserted, not reported.
      assert.equal(data?.action, "lead.set_status");
    }
  });

  test("every route reports the same warnings", async () => {
    // Parity is the property under test. `QUALIFIED` does not stop follow-up,
    // so the correct answer here is "no warnings" — from all four.
    const sets = CALLERS.map((caller) => {
      const result = results[caller];
      if (!result.success) throw new Error(`${caller} failed`);
      return result.warnings.map((w) => w.code);
    });

    for (const codes of sets.slice(1)) {
      assert.deepEqual(codes, sets[0]);
    }
  });

  test("a terminal status warns that follow-up stops, from every route", async () => {
    // Separate from the parity check above, because this asserts the *content*
    // of the warning: a change that also stops follow-up is not fully described
    // by saying the change was made.
    for (const caller of CALLERS) {
      const { data: lead } = await admin
        .from("leads")
        .insert({
          business_id: world.businessId,
          first_name: "Terminal",
          email: `terminal-${caller.toLowerCase()}-${Date.now()}@example.co.uk`,
          status: "NEW",
        })
        .select("id")
        .single();

      const result = await run(
        "lead.set_status",
        { leadId: lead!.id, status: "WON" },
        { caller, userId: world.memberId, role: "member" },
      );

      assert.equal(result.success, true, `${caller} was refused`);
      if (!result.success) continue;
      assert.deepEqual(
        result.warnings.map((w) => w.code),
        ["follow_up_stopped"],
        `${caller} did not report that follow-up stops`,
      );
    }
  });
});

/* ----------------------------------------------------- permission parity */

describe("permission decisions are identical across routes", () => {
  test("a viewer is refused everywhere, with the same code", async () => {
    for (const caller of CALLERS) {
      const result = await run(
        "lead.set_status",
        { leadId: world.leadIds[caller], status: "WON" },
        { caller, userId: world.viewerId, role: "viewer" },
      );
      assert.equal(result.success, false, `${caller} let a viewer write`);
      if (result.success) continue;
      assert.equal(result.code, "FORBIDDEN_ROLE", `${caller} refused for the wrong reason`);
    }
  });

  test("a refused write is audited as an attempt", async () => {
    const { data } = await admin
      .from("audit_log")
      .select("action, metadata")
      .eq("business_id", world.businessId)
      .eq("action", "lead.set_status.denied");

    // "Nothing happened" and "someone tried and was stopped" are different
    // facts, and only the second one shows a permission model being probed.
    assert.ok((data ?? []).length >= CALLERS.length);
  });

  test("a destructive operation is unreachable by an autonomous agent", async () => {
    const result = await run(
      "lead.archive",
      { leadId: world.leadIds.AGENT },
      { caller: "AGENT", userId: world.ownerId, role: "owner", confirmed: true },
    );
    // Even with owner role and a forged confirmation, the caller itself is the
    // boundary: an agent runs with nobody watching.
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.code, "FORBIDDEN_SCOPE");
  });

  test("the same operation succeeds from the UI with a confirmation", async () => {
    const result = await run(
      "lead.archive",
      { leadId: world.leadIds.UI },
      { caller: "UI", userId: world.ownerId, role: "owner", confirmed: true },
    );
    assert.equal(result.success, true, JSON.stringify(result));
  });

  test("and is refused from the UI without one", async () => {
    const result = await run(
      "lead.archive",
      { leadId: world.leadIds.COPILOT },
      { caller: "UI", userId: world.ownerId, role: "owner" },
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.code, "NEEDS_CONFIRMATION");
    assert.ok(result.effect, "a confirmation with nothing to read is not a confirmation");
  });
});

/* -------------------------------------------------------- tenant isolation */

describe("the workspace boundary", () => {
  test("a lead in another workspace does not resolve", async () => {
    const { data: other } = await admin
      .from("businesses")
      .insert({ name: "Other Ltd", slug: `other-${Date.now()}`, status: "active" })
      .select("id")
      .single();

    const { data: otherLead } = await admin
      .from("leads")
      .insert({
        business_id: other!.id,
        first_name: "Someone",
        email: "someone@other.test",
        status: "NEW",
      })
      .select("id")
      .single();

    for (const caller of CALLERS) {
      const result = await run(
        "lead.get",
        { leadId: otherLead!.id },
        { caller, userId: world.memberId, role: "member" },
      );
      assert.equal(result.success, false, `${caller} reached another tenant's lead`);
      if (result.success) continue;
      // NOT_FOUND rather than FORBIDDEN: telling a caller an id exists but is
      // not theirs is itself a disclosure.
      assert.equal(result.code, "NOT_FOUND");
    }

    await admin.from("businesses").delete().eq("id", other!.id);
  });
});

/* ----------------------------------------------------------- side effects */

describe("writes have the side effects they promise", () => {
  test("archiving stops follow-up", async () => {
    const { data } = await admin
      .from("leads")
      .select("archived_at, automation_active, needs_attention")
      .eq("id", world.leadIds.UI)
      .single();

    assert.ok(data?.archived_at, "the lead was not archived");
    assert.equal(data?.automation_active, false, "follow-up was left running");
  });

  test("a note records the route that wrote it", async () => {
    for (const caller of CALLERS) {
      const result = await run(
        "lead.add_note",
        { leadId: world.leadIds[caller], body: `Noted by ${caller}.` },
        { caller, userId: world.memberId, role: "member" },
      );
      assert.equal(result.success, true, `${caller} could not add a note`);
    }

    const { data } = await admin
      .from("lead_notes")
      .select("author_kind, body")
      .eq("business_id", world.businessId);

    const kinds = new Set((data ?? []).map((row) => row.author_kind));
    for (const caller of CALLERS) {
      assert.ok(kinds.has(caller), `no note attributed to ${caller}`);
    }
  });

  test("assigning refuses a non-member", async () => {
    const stranger = await createUser("stranger");
    const result = await run(
      "lead.assign",
      { leadId: world.leadIds.MCP, userId: stranger },
      { caller: "UI", userId: world.memberId, role: "member" },
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.code, "INVALID_INPUT");
    await admin.auth.admin.deleteUser(stranger).catch(() => undefined);
  });

  test("a no-op status change is reported as unchanged, not as a write", async () => {
    const result = await run(
      "lead.set_status",
      { leadId: world.leadIds.MCP, status: "QUALIFIED" },
      { caller: "UI", userId: world.memberId, role: "member" },
    );
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(
      result.warnings.map((w) => w.code),
      ["no_change"],
    );
  });
});
