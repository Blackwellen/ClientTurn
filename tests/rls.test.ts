/**
 * Cross-tenant RLS tests. These run against the real Supabase project because
 * policies are enforced by Postgres — mocking them would prove nothing.
 *
 * Run with: npm run test:rls
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
  userId: string;
  businessId: string;
  leadId: string;
  email: string;
  client: SupabaseClient;
};

const PASSWORD = "RlsTest!2026pw";
const tenants: Tenant[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;
  const userId = userData.user!.id;

  await admin.from("profiles").insert({ id: userId, email, first_name: label });

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .insert({ name: `RLS ${label}`, created_by: userId })
    .select("id")
    .single();
  if (businessError) throw businessError;

  await admin.from("business_members").insert({
    business_id: business.id,
    user_id: userId,
    role: "owner",
    status: "active",
  });

  await admin.from("business_settings").insert({ business_id: business.id });

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .insert({
      business_id: business.id,
      first_name: label,
      last_name: "Tester",
      phone: "+447700900000",
    })
    .select("id")
    .single();
  if (leadError) throw leadError;

  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { userId, businessId: business.id, leadId: lead.id, email, client };
}

describe("row level security", () => {
  before(async () => {
    tenants.push(await createTenant("alpha"));
    tenants.push(await createTenant("bravo"));
  });

  after(async () => {
    for (const tenant of tenants) {
      await admin.from("businesses").delete().eq("id", tenant.businessId);
      await admin.auth.admin.deleteUser(tenant.userId);
    }
  });

  test("a tenant can read its own lead", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("leads").select("id").eq("id", a.leadId);
    assert.equal(data?.length, 1);
  });

  test("a tenant cannot read another tenant's lead", async () => {
    const [a, b] = tenants;
    const { data } = await a.client.from("leads").select("id").eq("id", b.leadId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("an unfiltered select returns only the caller's rows", async () => {
    const [a, b] = tenants;
    const { data } = await a.client.from("leads").select("id, business_id");
    assert.ok(data!.every((row) => row.business_id === a.businessId));
    assert.ok(!data!.some((row) => row.id === b.leadId));
  });

  test("a tenant cannot read another tenant's business", async () => {
    const [a, b] = tenants;
    const { data } = await a.client
      .from("businesses")
      .select("id")
      .eq("id", b.businessId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("a tenant cannot move its lead into another business", async () => {
    const [a, b] = tenants;
    const { error } = await a.client
      .from("leads")
      .update({ business_id: b.businessId })
      .eq("id", a.leadId);
    assert.ok(error, "expected the business_id change to be rejected");

    const { data } = await admin
      .from("leads")
      .select("business_id")
      .eq("id", a.leadId)
      .single();
    assert.equal(data!.business_id, a.businessId);
  });

  test("a tenant cannot insert a service into another business", async () => {
    const [a, b] = tenants;
    const { error } = await a.client
      .from("services")
      .insert({ business_id: b.businessId, name: "Injected" });
    assert.ok(error, "expected the cross-tenant insert to be rejected");
  });

  test("a tenant cannot insert a message directly", async () => {
    const [a] = tenants;
    const { error } = await a.client.from("messages").insert({
      business_id: a.businessId,
      conversation_id: crypto.randomUUID(),
      lead_id: a.leadId,
      direction: "outbound",
      channel: "sms",
      body: "bypassing the server",
    });
    assert.ok(error, "browser clients must not insert messages");
  });

  test("server-only tables are unreachable from a browser session", async () => {
    const [a] = tenants;
    for (const table of [
      "webhook_events",
      "jobs",
      "usage_events",
      "audit_log",
      "field_mappings",
      "integration_secrets",
      "integration_oauth_states",
      "lead_source_cursors",
      "rate_limits",
      "ai_prompt_versions",
      "ai_runs",
      "provider_price_book",
      "cost_events",
      "business_cost_daily",
      "business_margin_monthly",
      "plan_entitlements",
      "automation_events",
    ] as const) {
      const { data, error } = await a.client.from(table).select("*").limit(1);
      assert.ok(
        error || (data?.length ?? 0) === 0,
        `${table} leaked rows to a browser session`,
      );
    }
  });

  test("a tenant cannot read another tenant's crm_push_records", async () => {
    const [a, b] = tenants;
    await admin.from("crm_push_records").insert({
      business_id: b.businessId,
      lead_id: b.leadId,
      provider_type: "hubspot",
      status: "pushed",
      external_contact_id: "test-contact",
    });

    const { data } = await a.client
      .from("crm_push_records")
      .select("id")
      .eq("business_id", b.businessId);
    assert.equal(data?.length ?? 0, 0);

    const { data: ownRead } = await b.client
      .from("crm_push_records")
      .select("id")
      .eq("business_id", b.businessId);
    assert.equal(ownRead?.length, 1);
  });

  test("a tenant cannot insert a crm_push_records row directly", async () => {
    const [a] = tenants;
    const { error } = await a.client.from("crm_push_records").insert({
      business_id: a.businessId,
      lead_id: a.leadId,
      provider_type: "hubspot",
      status: "pushed",
      external_contact_id: "forged",
    });
    assert.ok(error, "crm_push_records must not be client-writable");
  });

  test("a logged-out client reads nothing", async () => {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.from("leads").select("id").limit(1);
    assert.ok(error || (data?.length ?? 0) === 0);
  });

  // A blocked write returns no error — it simply matches no rows. The property
  // that matters is that the stored role is unchanged.
  test("a tenant cannot escalate its own role", async () => {
    const [a] = tenants;
    await admin
      .from("business_members")
      .update({ role: "member" })
      .eq("user_id", a.userId);

    const { data: changed } = await a.client
      .from("business_members")
      .update({ role: "owner" })
      .eq("user_id", a.userId)
      .select();
    assert.equal(changed?.length ?? 0, 0, "no membership row may be updated");

    const { data: after } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", a.userId)
      .single();
    assert.equal(after!.role, "member", "role must be unchanged");

    await admin
      .from("business_members")
      .update({ role: "owner" })
      .eq("user_id", a.userId);
  });

  test("a tenant cannot read another tenant's subscription", async () => {
    const [a, b] = tenants;
    const { data } = await a.client
      .from("subscriptions")
      .select("id")
      .eq("business_id", b.businessId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("a tenant cannot read another tenant's AI behaviour settings", async () => {
    const [a, b] = tenants;
    await admin
      .from("business_ai_settings")
      .upsert({ business_id: b.businessId, tone: "friendly" }, { onConflict: "business_id" });

    const { data } = await a.client
      .from("business_ai_settings")
      .select("id")
      .eq("business_id", b.businessId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("a non-admin member cannot update AI behaviour settings", async () => {
    const [a] = tenants;
    await admin
      .from("business_ai_settings")
      .upsert({ business_id: a.businessId, tone: "professional" }, { onConflict: "business_id" });
    await admin
      .from("business_members")
      .update({ role: "member" })
      .eq("user_id", a.userId);

    const { data: changed } = await a.client
      .from("business_ai_settings")
      .update({ tone: "direct" })
      .eq("business_id", a.businessId)
      .select();
    assert.equal(changed?.length ?? 0, 0, "a member must not change AI behaviour");

    await admin
      .from("business_members")
      .update({ role: "owner" })
      .eq("user_id", a.userId);
  });
});
