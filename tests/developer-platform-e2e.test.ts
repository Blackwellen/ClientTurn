/**
 * The developer platform, end to end, against a real database.
 *
 * The pure tests in `developer-platform.test.ts` prove the rules are stated
 * correctly. This proves they are *enforced* — by the real service code, the
 * real RLS, and the real MCP gateway, with nothing mocked. A mocked Supabase
 * client would only demonstrate that the mock agrees with itself, which is
 * precisely the wrong thing to be confident about for a credential boundary.
 *
 * What it establishes, in order:
 *
 *   1. A key issued by the real `createApiKey` resolves through the real
 *      `authenticateApiKey`, and never comes back out of the database.
 *   2. Every way a key should stop working actually stops it: revoked, expired,
 *      wrong address, and — the one that matters most — its owner losing their
 *      membership without anyone touching the key.
 *   3. The same key drives the MCP gateway: tools are listed scope-filtered, a
 *      read tool runs, a write tool is refused for a viewer, and every call is
 *      audited.
 *   4. A webhook endpoint signs a real payload verifiably, and an emitted event
 *      lands as a queued delivery.
 *
 * Run with:
 *   npm run test:e2e:developer
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
  adminUserId: string;
  viewerUserId: string;
  leadId: string;
};

let world: World;

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `devplat-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "DevPlatform!2026pw",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  return data.user.id;
}

before(async () => {
  const adminUserId = await createUser("admin");
  const viewerUserId = await createUser("viewer");

  const { data: business, error } = await admin
    .from("businesses")
    .insert({
      name: "Developer Platform Ltd",
      slug: `devplat-${Date.now()}`,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !business) throw new Error(`could not create business: ${error?.message}`);

  await admin.from("business_members").insert([
    { business_id: business.id, user_id: adminUserId, role: "admin", status: "active" },
    { business_id: business.id, user_id: viewerUserId, role: "viewer", status: "active" },
  ]);

  const { data: lead } = await admin
    .from("leads")
    .insert({
      business_id: business.id,
      first_name: "Priya",
      last_name: "Shah",
      email: `devplat-${Date.now()}@example.co.uk`,
      status: "NEW",
    })
    .select("id")
    .single();

  world = {
    businessId: business.id,
    adminUserId,
    viewerUserId,
    leadId: lead!.id,
  };
});

after(async () => {
  if (!world) return;
  await admin.from("businesses").delete().eq("id", world.businessId);
  for (const id of [world.adminUserId, world.viewerUserId]) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

/* ------------------------------------------------------------- helpers */

async function issueKey(options: {
  userId?: string;
  scopes?: string[];
  allowedIps?: string[];
  expiresAt?: Date | null;
  name?: string;
}) {
  const { createApiKey } = await import("../src/lib/api-keys/service.ts");
  const created = await createApiKey({
    businessId: world.businessId,
    userId: options.userId ?? world.adminUserId,
    createdBy: world.adminUserId,
    name: options.name ?? `key-${randomUUID().slice(0, 8)}`,
    environment: "live",
    scopes: options.scopes ?? ["leads:read", "leads:write", "business:read"],
    allowedIps: options.allowedIps ?? [],
    expiresAt: options.expiresAt ?? null,
  });
  assert.ok(created, "the key was not created");
  return created;
}

async function resolve(key: string, ip = "203.0.113.9") {
  const { authenticateApiKey } = await import("../src/lib/api-keys/service.ts");
  return authenticateApiKey(key, ip);
}

/* --------------------------------------------------------------- issuing */

describe("issuing an API key", () => {
  test("the key resolves to its workspace, owner and live role", async () => {
    const created = await issueKey({});
    const result = await resolve(created.key);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.context.businessId, world.businessId);
    assert.equal(result.context.userId, world.adminUserId);
    // The role is read from the membership now, not stored on the key.
    assert.equal(result.context.userRole, "admin");
    assert.deepEqual(result.context.scopes.sort(), [
      "business:read",
      "leads:read",
      "leads:write",
    ]);
  });

  test("the key is prefixed so a leak is recognisable, and never stored", async () => {
    const created = await issueKey({});
    assert.match(created.key, /^ct_live_[A-Za-z0-9_-]{40,}$/);

    // The whole point: the database holds a digest and the visible prefix, and
    // nothing that could reconstruct the key.
    const { data } = await admin
      .from("api_keys")
      .select("key_hash, key_prefix, key_last_four")
      .eq("id", created.id)
      .single();

    assert.ok(data);
    assert.ok(!data.key_hash.includes(created.key));
    assert.equal(data.key_hash.length, 64);
    assert.equal(created.key.startsWith(data.key_prefix), true);
    assert.equal(created.key.endsWith(data.key_last_four), true);
  });

  test("a key with no valid scopes is refused rather than created inert", async () => {
    const { createApiKey } = await import("../src/lib/api-keys/service.ts");
    const created = await createApiKey({
      businessId: world.businessId,
      userId: world.adminUserId,
      createdBy: world.adminUserId,
      name: "empty",
      environment: "live",
      scopes: ["leads:delete", "*"],
    });
    // A credential that looks live and can do nothing is worse than a refusal.
    assert.equal(created, null);
  });

  test("issuing a key is written to the audit trail", async () => {
    const created = await issueKey({ name: "audited-key" });
    const { data } = await admin
      .from("audit_log")
      .select("action, entity_type, entity_id")
      .eq("business_id", world.businessId)
      .eq("entity_id", created.id)
      .eq("action", "api_key.created");

    assert.equal(data?.length, 1);
    assert.equal(data![0].entity_type, "api_key");
  });
});

/* ------------------------------------------------------------- refusals */

describe("every way a key stops working", () => {
  test("an unknown key is refused", async () => {
    const result = await resolve("ct_live_thisisnotarealkeyatallnotevenclose");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "UNKNOWN");
  });

  test("something that is not our key shape is refused before any lookup", async () => {
    for (const value of ["", "Bearer ", "sk_live_abc", "hello"]) {
      const result = await resolve(value);
      assert.equal(result.ok, false, value);
    }
  });

  test("a revoked key stops working immediately", async () => {
    const created = await issueKey({});
    assert.equal((await resolve(created.key)).ok, true);

    const { revokeApiKey } = await import("../src/lib/api-keys/service.ts");
    const revoked = await revokeApiKey({
      businessId: world.businessId,
      keyId: created.id,
      userId: world.adminUserId,
    });
    assert.equal(revoked, true);

    const after = await resolve(created.key);
    assert.equal(after.ok === false && after.reason, "REVOKED");
  });

  test("revoking twice does not rewrite who revoked it", async () => {
    const created = await issueKey({});
    const { revokeApiKey } = await import("../src/lib/api-keys/service.ts");
    assert.equal(
      await revokeApiKey({
        businessId: world.businessId,
        keyId: created.id,
        userId: world.adminUserId,
      }),
      true,
    );
    assert.equal(
      await revokeApiKey({
        businessId: world.businessId,
        keyId: created.id,
        userId: world.viewerUserId,
      }),
      false,
    );
  });

  test("a key cannot be revoked from another workspace", async () => {
    const created = await issueKey({});
    const { revokeApiKey } = await import("../src/lib/api-keys/service.ts");
    const revoked = await revokeApiKey({
      businessId: randomUUID(),
      keyId: created.id,
      userId: world.adminUserId,
    });
    assert.equal(revoked, false);
    assert.equal((await resolve(created.key)).ok, true);
  });

  test("an expired key is refused", async () => {
    const created = await issueKey({
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await resolve(created.key);
    assert.equal(result.ok === false && result.reason, "EXPIRED");
  });

  test("a key restricted by address is refused from anywhere else", async () => {
    const created = await issueKey({ allowedIps: ["198.51.100.0/24"] });

    assert.equal((await resolve(created.key, "198.51.100.22")).ok, true);

    const blocked = await resolve(created.key, "203.0.113.9");
    assert.equal(blocked.ok === false && blocked.reason, "IP_BLOCKED");

    // And when we cannot tell where the caller is, a restriction that cannot be
    // checked must refuse rather than wave the request through.
    const unknown = await resolve(created.key, "unknown");
    assert.equal(unknown.ok === false && unknown.reason, "IP_BLOCKED");
  });

  test("suspending the owner's membership disables their key with no revocation", async () => {
    // The property that makes offboarding work: nobody has to remember to go
    // and find this person's keys.
    const created = await issueKey({ userId: world.viewerUserId });
    assert.equal((await resolve(created.key)).ok, true);

    await admin
      .from("business_members")
      .update({ status: "suspended" })
      .eq("business_id", world.businessId)
      .eq("user_id", world.viewerUserId);

    const result = await resolve(created.key);
    assert.equal(result.ok === false && result.reason, "NO_MEMBERSHIP");

    await admin
      .from("business_members")
      .update({ status: "active" })
      .eq("business_id", world.businessId)
      .eq("user_id", world.viewerUserId);
  });

  test("demoting the owner narrows the key's reach on the very next call", async () => {
    const created = await issueKey({ userId: world.adminUserId });
    assert.equal(
      (await resolve(created.key)).ok === true &&
        (await resolve(created.key)).ok,
      true,
    );

    await admin
      .from("business_members")
      .update({ role: "viewer" })
      .eq("business_id", world.businessId)
      .eq("user_id", world.adminUserId);

    const demoted = await resolve(created.key);
    assert.equal(demoted.ok, true);
    // Same key, same scopes, lower authority — which is what the gateway then
    // enforces against each tool's minimum role.
    assert.equal(demoted.ok === true && demoted.context.userRole, "viewer");

    await admin
      .from("business_members")
      .update({ role: "admin" })
      .eq("business_id", world.businessId)
      .eq("user_id", world.adminUserId);
  });
});

/* ------------------------------------------------------------------ MCP */

describe("MCP over a workspace API key", () => {
  test("the gateway authenticates the key and reports the key it used", async () => {
    const created = await issueKey({});
    const { authenticate } = await import("../src/lib/mcp/gateway.ts");

    const auth = await authenticate(`Bearer ${created.key}`, "203.0.113.9");
    assert.ok(auth, "the MCP gateway refused a valid workspace key");
    assert.equal(auth.businessId, world.businessId);
    assert.equal(auth.apiKeyId, created.id);
    // Not an MCP OAuth client, and the audit trail must say so rather than
    // attributing the call to nothing.
    assert.equal(auth.clientId, null);
  });

  test("tools are listed filtered by the key's scopes, not by what exists", async () => {
    const readOnly = await issueKey({ scopes: ["leads:read"] });
    const { authenticate, listTools } = await import("../src/lib/mcp/gateway.ts");

    const auth = await authenticate(`Bearer ${readOnly.key}`, "203.0.113.9");
    assert.ok(auth);

    const tools = listTools(auth);
    assert.ok(tools.length > 0, "a read key was offered no tools at all");
    for (const tool of tools) {
      assert.equal(
        tool.scope,
        "leads:read",
        `${tool.name} was offered to a key that was not granted its scope`,
      );
    }
    // An assistant must not even learn that a capability it cannot use exists.
    assert.equal(
      tools.some((tool) => tool.scope === "leads:write"),
      false,
    );
  });

  test("a read tool runs and returns this workspace's data", async () => {
    const created = await issueKey({});
    const { authenticate, callTool } = await import("../src/lib/mcp/gateway.ts");

    const auth = await authenticate(`Bearer ${created.key}`, "203.0.113.9");
    assert.ok(auth);

    const result = await callTool(auth, "lead.get", { leadId: world.leadId });
    assert.equal(result.ok, true, result.ok === false ? result.message : "");

    const content = result.ok ? (result.content as { lead: { id: string } }) : null;
    assert.equal(content?.lead.id, world.leadId);
  });

  test("a call the key was not scoped for is refused and audited as a denial", async () => {
    const readOnly = await issueKey({ scopes: ["leads:read"] });
    const { authenticate, callTool } = await import("../src/lib/mcp/gateway.ts");

    const auth = await authenticate(`Bearer ${readOnly.key}`, "203.0.113.9");
    assert.ok(auth);

    const result = await callTool(auth, "lead.set_status", {
      leadId: world.leadId,
      status: "CONTACTED",
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "DENIED_SCOPE");

    // The refusal is a fact an admin can see, not a silent no-op.
    const { data } = await admin
      .from("mcp_audit_logs")
      .select("result, tool_name, api_key_id")
      .eq("business_id", world.businessId)
      .eq("tool_name", "lead.set_status")
      .eq("result", "DENIED_SCOPE")
      .order("created_at", { ascending: false })
      .limit(1);

    assert.equal(data?.length, 1);
    assert.equal(data![0].api_key_id, readOnly.id);
  });

  test("a viewer's key cannot write, whatever scopes it was granted", async () => {
    // Scopes narrow; they never widen. A key granted `leads:write` on a
    // viewer's authority is still a viewer.
    const viewerKey = await issueKey({
      userId: world.viewerUserId,
      scopes: ["leads:read", "leads:write"],
    });
    const { authenticate, callTool } = await import("../src/lib/mcp/gateway.ts");

    const auth = await authenticate(`Bearer ${viewerKey.key}`, "203.0.113.9");
    assert.ok(auth);
    assert.equal(auth.userRole, "viewer");

    const result = await callTool(auth, "lead.set_status", {
      leadId: world.leadId,
      status: "CONTACTED",
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "DENIED_ROLE");
  });

  test("a revoked key is refused by the MCP gateway too, not just by the API", async () => {
    const created = await issueKey({});
    const { revokeApiKey } = await import("../src/lib/api-keys/service.ts");
    await revokeApiKey({
      businessId: world.businessId,
      keyId: created.id,
      userId: world.adminUserId,
    });

    const { authenticate } = await import("../src/lib/mcp/gateway.ts");
    assert.equal(await authenticate(`Bearer ${created.key}`, "203.0.113.9"), null);
  });

  test("using a key records that it was used", async () => {
    const created = await issueKey({});
    await resolve(created.key);

    const { touchApiKey } = await import("../src/lib/api-keys/service.ts");
    await touchApiKey(created.id, "203.0.113.9");

    const { data } = await admin
      .from("api_keys")
      .select("last_used_at, request_count")
      .eq("id", created.id)
      .single();

    assert.ok(data?.last_used_at, "a used key still reads as never used");
    assert.ok(Number(data!.request_count) >= 1);
  });
});

/* -------------------------------------------------------------- webhooks */

describe("webhooks end to end", () => {
  test("an endpoint is created with a verifiable signing secret", async (t) => {
    const { createEndpoint } = await import("../src/lib/webhooks/endpoints.ts");
    const result = await createEndpoint({
      businessId: world.businessId,
      userId: world.adminUserId,
      url: "https://example.com/hooks/clientturn",
      description: "e2e",
      events: ["lead.created", "lead.status_changed"],
    });

    if (!result.ok && result.error.includes("cannot store signing secrets")) {
      t.skip("CREDENTIAL_ENCRYPTION_KEY is not set in this environment");
      return;
    }

    assert.equal(result.ok, true, result.ok === false ? result.error : "");
    if (!result.ok) return;

    // The secret round-trips through the sealed column, which is what the
    // delivery job depends on.
    const { endpointSigningSecret } = await import("../src/lib/webhooks/endpoints.ts");
    const readBack = await endpointSigningSecret(result.endpoint.id);
    assert.equal(readBack, result.endpoint.secret);

    // And a payload signed with it verifies with the copy the customer holds.
    const { signPayload, verifySignature } = await import(
      "../src/lib/webhooks/signature.ts"
    );
    const body = JSON.stringify({ id: randomUUID(), type: "lead.created" });
    const header = signPayload(body, result.endpoint.secret);
    assert.equal(verifySignature(body, header, result.endpoint.secret).ok, true);

    await admin.from("webhook_endpoints").delete().eq("id", result.endpoint.id);
  });

  test("a plain http address is refused", async () => {
    const { createEndpoint } = await import("../src/lib/webhooks/endpoints.ts");
    const result = await createEndpoint({
      businessId: world.businessId,
      userId: world.adminUserId,
      url: "http://example.com/hooks",
      events: ["lead.created"],
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /https/);
  });

  test("an address on a private network is refused", async () => {
    // The request-forgery case: our servers would be the ones connecting.
    const { createEndpoint } = await import("../src/lib/webhooks/endpoints.ts");
    for (const url of [
      "https://127.0.0.1/hooks",
      "https://10.0.0.5/hooks",
      "https://localhost/hooks",
    ]) {
      const result = await createEndpoint({
        businessId: world.businessId,
        userId: world.adminUserId,
        url,
        events: ["lead.created"],
      });
      assert.equal(result.ok, false, `${url} was accepted`);
    }
  });

  test("an emitted event becomes a queued delivery for each subscriber", async (t) => {
    const { createEndpoint } = await import("../src/lib/webhooks/endpoints.ts");
    const endpoint = await createEndpoint({
      businessId: world.businessId,
      userId: world.adminUserId,
      url: "https://example.org/hooks/clientturn",
      events: ["lead.status_changed"],
    });

    if (!endpoint.ok) {
      t.skip(`endpoint could not be created: ${endpoint.error}`);
      return;
    }

    const { emitWebhookEvent } = await import("../src/lib/webhooks/emit.ts");
    const eventId = randomUUID();

    const first = await emitWebhookEvent({
      businessId: world.businessId,
      type: "lead.status_changed",
      eventId,
      data: { lead_id: world.leadId, from: "NEW", to: "CONTACTED" },
    });
    assert.equal(first.queued, 1);

    // Emitting the same event id again must not queue a second delivery. This
    // is what makes a retry-safe job handler safe to re-run.
    const second = await emitWebhookEvent({
      businessId: world.businessId,
      type: "lead.status_changed",
      eventId,
      data: { lead_id: world.leadId, from: "NEW", to: "CONTACTED" },
    });
    assert.equal(second.queued, 0);

    const { data: deliveries } = await admin
      .from("webhook_deliveries")
      .select("id, status, event_type, payload, next_attempt_at")
      .eq("business_id", world.businessId)
      .eq("event_id", eventId);

    assert.equal(deliveries?.length, 1);
    assert.equal(deliveries![0].status, "PENDING");
    assert.ok(deliveries![0].next_attempt_at, "nothing would ever pick this up");

    const payload = deliveries![0].payload as { id: string; type: string };
    assert.equal(payload.id, eventId);
    assert.equal(payload.type, "lead.status_changed");

    // A dispatch job exists to carry it out.
    const { data: jobs } = await admin
      .from("jobs")
      .select("id, type")
      .eq("business_id", world.businessId)
      .eq("type", "webhook.dispatch")
      .limit(1);
    assert.equal(jobs?.length, 1);

    await admin.from("webhook_endpoints").delete().eq("id", endpoint.endpoint.id);
  });

  test("delivery re-checks the address and refuses a private one", async () => {
    // The endpoint row is written directly, deliberately bypassing
    // `createEndpoint`'s validation. That is exactly the situation the
    // delivery-time check exists for: a hostname that passed when it was saved
    // and resolves somewhere private now. If the guard only ran at save time,
    // this delivery would connect to an internal address.
    const { sealSecret } = await import("../src/lib/security/secret-box.ts");
    const { generateSigningSecret, secretHint } = await import(
      "../src/lib/webhooks/signature.ts"
    );
    const secret = generateSigningSecret();

    const { data: endpoint } = await admin
      .from("webhook_endpoints")
      .insert({
        business_id: world.businessId,
        url: "https://10.0.0.7/hooks",
        secret_sealed: sealSecret(secret),
        secret_hint: secretHint(secret),
        events: ["lead.created"],
        status: "ACTIVE",
      })
      .select("id")
      .single();

    const eventId = randomUUID();
    const now = new Date().toISOString();
    await admin.from("webhook_deliveries").insert({
      business_id: world.businessId,
      endpoint_id: endpoint!.id,
      event_id: eventId,
      event_type: "lead.created",
      payload: { id: eventId, type: "lead.created", data: {} },
      status: "PENDING",
      next_attempt_at: now,
    });

    const { handleWebhookDispatch } = await import(
      "../src/lib/jobs/handlers/webhook-dispatch.ts"
    );
    await handleWebhookDispatch();

    const { data: after } = await admin
      .from("webhook_deliveries")
      .select("status, attempts, error, response_status")
      .eq("event_id", eventId)
      .single();

    assert.ok(after);
    assert.ok(after.attempts >= 1, "the delivery was never claimed");
    // Never connected, so there is no response — and it must not be retried,
    // because a private address will not become public on the next attempt.
    assert.equal(after.response_status, null);
    assert.equal(after.status, "EXHAUSTED");
    assert.match(after.error ?? "", /not reachable/);

    // The endpoint's failure streak is recorded, so it is eventually switched
    // off rather than retried against forever.
    const { data: health } = await admin
      .from("webhook_endpoints")
      .select("consecutive_failures, last_error")
      .eq("id", endpoint!.id)
      .single();
    assert.ok((health?.consecutive_failures ?? 0) >= 1);

    await admin.from("webhook_endpoints").delete().eq("id", endpoint!.id);
  });

  test("an event nobody subscribed to queues nothing", async () => {
    const { emitWebhookEvent } = await import("../src/lib/webhooks/emit.ts");
    const result = await emitWebhookEvent({
      businessId: world.businessId,
      type: "booking.created",
      data: { booking_id: randomUUID() },
    });
    assert.equal(result.queued, 0);
  });
});

/* ------------------------------------------------------------------- RLS */

describe("row level security", () => {
  test("an anonymous browser client sees no keys, endpoints or deliveries", async () => {
    // The service role above bypasses RLS by design. This is the check that the
    // policies actually hold for a browser session.
    const anon = createClient(
      SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    for (const table of [
      "api_keys",
      "api_request_logs",
      "webhook_endpoints",
      "webhook_deliveries",
    ]) {
      const { data, error } = await anon.from(table).select("id").limit(1);
      assert.ok(
        error || (data?.length ?? 0) === 0,
        `${table} returned rows to an anonymous client`,
      );
    }
  });
});
