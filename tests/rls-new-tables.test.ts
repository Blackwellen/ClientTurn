/**
 * Cross-tenant RLS for the tables added by migrations 0062–0066.
 *
 * Every one of these holds something a competitor would like: the notes a team
 * wrote on a lead, the inbound payloads a connector rejected, and the legal
 * position a workspace has stated about itself. They were added with policies
 * that had never been exercised against a second tenant, and a policy nobody
 * has tested from the outside is a policy nobody knows the shape of.
 *
 * Two things are asserted for each table:
 *
 *   1. A member of workspace A cannot read workspace B's rows.
 *   2. A member of workspace A cannot *write* their own rows directly either.
 *      These tables are written through the service layer under the service
 *      role, which is where the permission, audit and correlation are applied;
 *      a browser-role insert that succeeded would be a way around all three.
 *
 * Run with: npm run test:rls:new
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Tenant = {
  label: string;
  userId: string;
  businessId: string;
  leadId: string;
  installId: string;
  client: SupabaseClient;
};

const PASSWORD = "RlsNewTables!2026pw";
const tenants: Tenant[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const email = `rlsnew-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`user: ${userError?.message}`);

  const { data: business } = await admin
    .from("businesses")
    .insert({
      name: `RLS ${label}`,
      slug: `rls-new-${label}-${Date.now()}`,
      status: "active",
    })
    .select("id")
    .single();

  await admin.from("business_members").insert({
    business_id: business!.id,
    user_id: userData.user.id,
    role: "owner",
    status: "active",
  });

  const { data: lead } = await admin
    .from("leads")
    .insert({
      business_id: business!.id,
      first_name: label,
      email: `${label}@example.co.uk`,
      status: "NEW",
    })
    .select("id")
    .single();

  const { data: install } = await admin
    .from("workspace_app_installs")
    .insert({
      business_id: business!.id,
      app_key: "clay",
      secret_ciphertext: "sealed-placeholder",
    })
    .select("id")
    .single();

  // The rows a second tenant must never see.
  await admin.from("lead_notes").insert({
    business_id: business!.id,
    lead_id: lead!.id,
    body: `Private note for ${label}.`,
    author_kind: "UI",
  });

  await admin.from("connector_event_failures").insert({
    business_id: business!.id,
    install_id: install!.id,
    reason: "invalid_payload",
    payload: { eventId: `${label}-secret`, email: `${label}@leaked.test` },
    external_event_id: `${label}-secret`,
  });

  await admin.from("business_data_controls").insert({
    business_id: business!.id,
    legal_name: `${label} Holdings Ltd`,
    marketing_lawful_basis: "LEGITIMATE_INTERESTS",
    lawful_basis_note: `Confidential assessment for ${label}.`,
  });

  await admin.from("usage_events").insert({
    business_id: business!.id,
    metric: "enrichment_email",
    unit: "lookup",
    quantity: 1,
    feature: "enrichment",
    provider: "hunter",
    operation_id: `${label}-op`,
  });

  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`sign in: ${signInError.message}`);

  return {
    label,
    userId: userData.user.id,
    businessId: business!.id,
    leadId: lead!.id,
    installId: install!.id,
    client,
  };
}

before(async () => {
  tenants.push(await createTenant("alpha"));
  tenants.push(await createTenant("bravo"));
});

after(async () => {
  for (const tenant of tenants) {
    await admin.from("businesses").delete().eq("id", tenant.businessId);
    await admin.auth.admin.deleteUser(tenant.userId).catch(() => undefined);
  }
});

/* ------------------------------------------------------------ lead_notes */

describe("lead_notes", () => {
  test("a member reads only their own workspace's notes", async () => {
    const [alpha] = tenants;
    const { data } = await alpha.client.from("lead_notes").select("business_id, body");
    assert.ok(data);
    assert.ok(data!.length > 0, "alpha should see its own note");
    for (const row of data!) {
      assert.equal(row.business_id, alpha.businessId, "a note leaked across tenants");
    }
  });

  test("naming another tenant's lead returns nothing", async () => {
    const [alpha, bravo] = tenants;
    const { data } = await alpha.client
      .from("lead_notes")
      .select("body")
      .eq("lead_id", bravo.leadId);
    assert.deepEqual(data, []);
  });

  test("a browser role cannot write a note directly", async () => {
    // Notes are written through `lead.add_note`, which records the author and
    // the calling surface. A direct insert would bypass both.
    const [alpha] = tenants;
    const { error } = await alpha.client.from("lead_notes").insert({
      business_id: alpha.businessId,
      lead_id: alpha.leadId,
      body: "Written directly.",
    });
    assert.ok(error, "a direct insert should be refused");
  });
});

/* ------------------------------------------------- connector_event_failures */

describe("connector_event_failures", () => {
  test("a member reads only their own workspace's failures", async () => {
    const [alpha] = tenants;
    const { data } = await alpha.client
      .from("connector_event_failures")
      .select("business_id, payload");
    assert.ok(data);
    assert.ok(data!.length > 0);
    for (const row of data!) {
      assert.equal(row.business_id, alpha.businessId);
    }
  });

  test("another tenant's rejected payload is unreachable", async () => {
    // The payload is a contact record that arrived from outside. Leaking one
    // would leak a third party's data, not just the customer's.
    const [alpha, bravo] = tenants;
    const { data } = await alpha.client
      .from("connector_event_failures")
      .select("payload")
      .eq("install_id", bravo.installId);
    assert.deepEqual(data, []);
  });

  test("a browser role cannot forge a failure", async () => {
    const [alpha] = tenants;
    const { error } = await alpha.client.from("connector_event_failures").insert({
      business_id: alpha.businessId,
      install_id: alpha.installId,
      reason: "forged",
    });
    assert.ok(error, "a direct insert should be refused");
  });

  test("a browser role cannot mark a failure replayed", async () => {
    // Replay is an action with an audit trail; flipping the status directly
    // would close the loop without anything having been re-queued.
    const [alpha] = tenants;
    const { data } = await alpha.client
      .from("connector_event_failures")
      .update({ status: "DISMISSED" })
      .eq("business_id", alpha.businessId)
      .select("id");
    assert.deepEqual(data ?? [], []);
  });
});

/* ------------------------------------------------- business_data_controls */

describe("business_data_controls", () => {
  test("a member reads their own workspace's position", async () => {
    const [alpha] = tenants;
    const { data } = await alpha.client
      .from("business_data_controls")
      .select("business_id, legal_name");
    assert.ok(data);
    assert.equal(data!.length, 1);
    assert.equal(data![0].business_id, alpha.businessId);
  });

  test("another workspace's legal position is unreachable", async () => {
    const [alpha, bravo] = tenants;
    const { data } = await alpha.client
      .from("business_data_controls")
      .select("legal_name, lawful_basis_note")
      .eq("business_id", bravo.businessId);
    assert.deepEqual(data, []);
  });

  test("a browser role cannot change the stated lawful basis", async () => {
    // Changing this changes what the product will send on the customer's
    // behalf. It goes through an admin-gated server action that audits it.
    const [alpha] = tenants;
    const { data } = await alpha.client
      .from("business_data_controls")
      .update({ marketing_lawful_basis: "CONSENT" })
      .eq("business_id", alpha.businessId)
      .select("business_id");
    assert.deepEqual(data ?? [], []);
  });
});

/* ---------------------------------------------------------- usage_events */

describe("usage_events provenance columns", () => {
  test("the ledger is not readable by a browser role at all", async () => {
    // It carries provider names and unit costs. It was already server-only;
    // the new columns must not have changed that.
    const [alpha] = tenants;
    const { data, error } = await alpha.client
      .from("usage_events")
      .select("metric, provider, unit_cost");
    assert.ok(error || (data ?? []).length === 0, "the usage ledger leaked to a browser role");
  });

  test("a browser role cannot post a charge", async () => {
    const [alpha] = tenants;
    const { error } = await alpha.client.from("usage_events").insert({
      business_id: alpha.businessId,
      metric: "agent_run",
      quantity: 1,
    });
    assert.ok(error, "a direct insert into the ledger should be refused");
  });
});
