/**
 * Cross-tenant RLS tests for the V4 acquisition tables.
 *
 * These run against the real Supabase project, because policies are enforced by
 * Postgres and mocking them would prove nothing. They cover the §109 security
 * matrix for the new surfaces: prospect, search, campaign and support isolation,
 * plus the two rules that are specific to V4 —
 *
 *   * raw provider cost is never readable by a browser role, even for the
 *     caller's own workspace (§90, §112); and
 *   * the agent/token tables are entirely invisible to `authenticated`.
 *
 * Run with: npm run test:rls:v4
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
  companyId: string;
  prospectId: string;
  sessionId: string;
  campaignId: string;
  client: SupabaseClient;
};

const PASSWORD = "RlsV4Test!2026pw";
const tenants: Tenant[] = [];

async function createTenant(label: string): Promise<Tenant> {
  const email = `rlsv4-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

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
    .insert({ name: `RLS V4 ${label}`, created_by: userId })
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

  const { data: company, error: companyError } = await admin
    .from("prospect_companies")
    .insert({
      business_id: business.id,
      name: `${label} Holdings`,
      domain: `${label}-${Date.now()}.example`,
      dedupe_key: `domain:${label}-${Date.now()}.example`,
    })
    .select("id")
    .single();
  if (companyError) throw companyError;

  const { data: prospect, error: prospectError } = await admin
    .from("prospects")
    .insert({
      business_id: business.id,
      company_id: company.id,
      first_name: label,
      last_name: "Prospect",
      email: `${label}-${Date.now()}@prospect.example`,
      status: "READY",
      grade: "A",
      score: 88,
    })
    .select("id")
    .single();
  if (prospectError) throw prospectError;

  const { data: session, error: sessionError } = await admin
    .from("search_sessions")
    .insert({ business_id: business.id, user_id: userId, title: `${label} search` })
    .select("id")
    .single();
  if (sessionError) throw sessionError;

  const { data: campaign, error: campaignError } = await admin
    .from("outreach_campaigns")
    .insert({ business_id: business.id, name: `${label} campaign` })
    .select("id")
    .single();
  if (campaignError) throw campaignError;

  // Cost rows exist so the "cost is never visible" assertions have something
  // real to fail against rather than passing on an empty table.
  await admin.from("cost_events").insert({
    business_id: business.id,
    provider: "company_search",
    metric: "discovery_lookup",
    category: "DISCOVERY",
    quantity: 1,
    unit_cost: 0.01,
    total_cost: 0.01,
  });

  await admin.from("agent_runs").insert({
    business_id: business.id,
    agent_type: "SEARCH",
    deployment: "gpt-5.4-nano",
    prompt_key: "search.plan",
    prompt_version: "v1",
    status: "OK",
  });

  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return {
    userId,
    businessId: business.id,
    companyId: company.id,
    prospectId: prospect.id,
    sessionId: session.id,
    campaignId: campaign.id,
    client,
  };
}

describe("V4 row level security", () => {
  test("app installs hide signing credentials and isolate workspaces", async () => {
    const [a,b]=tenants;
    const {data:install,error}=await admin.from("workspace_app_installs").insert({business_id:a.businessId,app_key:"webhooks",secret_ciphertext:"test-sealed-secret",installed_by:a.userId}).select("id").single();
    assert.equal(error,null);
    const own=await a.client.from("workspace_app_installs").select("id").eq("id",install!.id);
    assert.equal(own.data?.length,1);
    const other=await b.client.from("workspace_app_installs").select("id").eq("id",install!.id);
    assert.equal(other.data?.length,0);
    const secrets=await a.client.from("workspace_app_installs").select("secret_ciphertext");
    assert.ok(secrets.error);
    const write=await a.client.from("workspace_app_installs").update({active:false}).eq("id",install!.id);
    assert.ok(write.error);
  });

  test("signed app receipt queues once and imports once, without contact permission", async () => {
    const [a,b]=tenants;
    const {data:install,error}=await admin.from("workspace_app_installs").insert({business_id:b.businessId,app_key:"clay",secret_ciphertext:"test-only",installed_by:b.userId}).select("id").single();
    assert.equal(error,null);
    const args={p_install_id:install!.id,p_event_id:"test-idempotency",p_payload:{email:`bridge-${Date.now()}@example.test`,firstName:"Bridge"}};
    const forbidden=await a.client.rpc("receive_workspace_app_event",args);assert.ok(forbidden.error);
    const first=await admin.rpc("receive_workspace_app_event",args);assert.equal(first.error,null);assert.ok(first.data);
    const second=await admin.rpc("receive_workspace_app_event",args);assert.equal(second.error,null);assert.equal(second.data,null);
    const eventId=first.data;
    const imported=await admin.rpc("process_workspace_app_event",{p_event_id:eventId,p_business_id:b.businessId});assert.equal(imported.error,null);assert.ok(imported.data);
    const repeat=await admin.rpc("process_workspace_app_event",{p_event_id:eventId,p_business_id:b.businessId});assert.equal(repeat.data,imported.data);
    const cross=await admin.rpc("process_workspace_app_event",{p_event_id:eventId,p_business_id:a.businessId});assert.ok(cross.error);
    const {data:p}=await admin.from("prospects").select("outreach_eligibility,promoted_to_lead_id").eq("id",imported.data).single();assert.equal(p?.outreach_eligibility,"REVIEW");assert.equal(p?.promoted_to_lead_id,null);
    await admin.from("jobs").update({state:"completed"}).eq("idempotency_key",`app.ingest:${eventId}`);
  });

  test("customer agents cannot be read across workspaces or started directly", async () => {
    const [a,b]=tenants;
    const {data:agent,error}=await admin.from("agents").insert({business_id:a.businessId,name:"Isolation test",agent_type:"SOURCING"}).select("id").single();assert.equal(error,null);
    const own=await a.client.from("agents").select("id,name").eq("id",agent!.id);assert.equal(own.data?.length,1);
    const other=await b.client.from("agents").select("id,name").eq("id",agent!.id);assert.equal(other.data?.length,0);
    const write=await a.client.from("agents").update({status:"ACTIVE"}).eq("id",agent!.id);assert.ok(write.error);
    const cost=await a.client.from("agents").select("max_cost_per_run_minor");assert.ok(cost.error);
  });
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

  /* ------------------------------------------------------------ prospects */

  test("a tenant reads its own prospect", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("prospects").select("id").eq("id", a.prospectId);
    assert.equal(data?.length, 1);
  });

  test("a tenant cannot read another tenant's prospect", async () => {
    const [a, b] = tenants;
    const { data } = await a.client.from("prospects").select("id").eq("id", b.prospectId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("an unfiltered prospect select returns only the caller's rows", async () => {
    const [a, b] = tenants;
    const { data } = await a.client.from("prospects").select("id, business_id");
    assert.ok(data && data.length > 0, "expected the caller's own prospect");
    assert.equal(
      data!.some((row) => row.business_id === b.businessId),
      false,
      "another tenant's prospects leaked into an unfiltered select",
    );
  });

  test("a tenant cannot read another tenant's prospect companies", async () => {
    const [a, b] = tenants;
    const { data } = await a.client
      .from("prospect_companies")
      .select("id")
      .eq("id", b.companyId);
    assert.equal(data?.length ?? 0, 0);
  });

  /* --------------------------------------------------- search and campaigns */

  test("a tenant cannot read another tenant's search session", async () => {
    const [a, b] = tenants;
    const { data } = await a.client
      .from("search_sessions")
      .select("id")
      .eq("id", b.sessionId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("a tenant cannot read another tenant's acquisition campaign", async () => {
    const [a, b] = tenants;
    const { data } = await a.client
      .from("outreach_campaigns")
      .select("id")
      .eq("id", b.campaignId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("a tenant reads its own campaign", async () => {
    const [a] = tenants;
    const { data } = await a.client
      .from("outreach_campaigns")
      .select("id")
      .eq("id", a.campaignId);
    assert.equal(data?.length, 1);
  });

  /* ------------------------------------------------------- writes are denied */

  test("a browser client cannot insert a prospect directly", async () => {
    const [a] = tenants;
    const { error } = await a.client.from("prospects").insert({
      business_id: a.businessId,
      first_name: "Injected",
      email: `injected-${Date.now()}@example.test`,
    });
    assert.ok(error, "prospect insert must be denied to the browser role");
  });

  test("a browser client cannot spoof another tenant's business_id", async () => {
    const [a, b] = tenants;
    const { error } = await a.client.from("prospects").insert({
      business_id: b.businessId,
      first_name: "Spoofed",
      email: `spoof-${Date.now()}@example.test`,
    });
    assert.ok(error, "cross-tenant insert must be denied");
  });

  /* ------------------------------------------ cost and tokens stay invisible */

  test("provider cost is invisible to a browser role, even for its own workspace", async () => {
    const [a] = tenants;
    const { data, error } = await a.client
      .from("cost_events")
      .select("id")
      .eq("business_id", a.businessId);
    // Either the table is not exposed at all, or it returns nothing. Both are
    // acceptable; a row coming back is not.
    assert.equal(data?.length ?? 0, 0, error ? "denied outright" : "no rows leaked");
  });

  test("agent runs and token counts are invisible to a browser role", async () => {
    const [a] = tenants;
    const { data } = await a.client
      .from("agent_runs")
      .select("id")
      .eq("business_id", a.businessId);
    assert.equal(data?.length ?? 0, 0);
  });

  test("the provider price book is invisible to a browser role", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("provider_price_book").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });

  test("margin data is invisible to a browser role", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("business_margin_monthly").select("business_id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });

  /* ------------------------------------------------- cost columns on shared tables */

  test("a sourcing run's spend columns are not readable, though the run is", async () => {
    const [a] = tenants;
    const { data: run } = await admin
      .from("sourcing_runs")
      .insert({ business_id: a.businessId, status: "COMPLETED", target_verified: 10 })
      .select("id")
      .single();

    // The run itself is the customer's own record and must be readable.
    const { data: visible } = await a.client
      .from("sourcing_runs")
      .select("id, status, target_verified")
      .eq("id", run!.id);
    assert.equal(visible?.length, 1, "a workspace must see its own sourcing run");

    // Its provider spend must not be.
    const { error } = await a.client
      .from("sourcing_runs")
      .select("spent_cost_minor")
      .eq("id", run!.id);
    assert.ok(error, "spent_cost_minor must be revoked from the browser role");
  });

  test("prospect provenance is readable but its cost column is not", async () => {
    const [a] = tenants;
    await admin.from("prospect_data_sources").insert({
      business_id: a.businessId,
      prospect_id: a.prospectId,
      field_name: "email",
      provider: "contact_search",
      source_type: "LICENSED_PROVIDER",
      cost_minor: 4,
    });

    // §14.3 requires the evidence behind a score to be inspectable.
    const { data: visible } = await a.client
      .from("prospect_data_sources")
      .select("id, field_name, provider, source_url, confidence")
      .eq("prospect_id", a.prospectId);
    assert.ok(visible && visible.length > 0, "provenance must be visible to the workspace");

    const { error } = await a.client
      .from("prospect_data_sources")
      .select("cost_minor")
      .eq("prospect_id", a.prospectId);
    assert.ok(error, "cost_minor must be revoked from the browser role");
  });

  /* ----------------------------------------------------------- suppression */

  test("a tenant cannot read another tenant's suppression list", async () => {
    const [a, b] = tenants;
    const suppressed = `suppressed-${Date.now()}@example.test`;
    await admin.from("suppression_entries").insert({
      business_id: b.businessId,
      email: suppressed,
      channel: "EMAIL",
      reason: "OPT_OUT",
      source: "TEST",
    });

    const { data } = await a.client
      .from("suppression_entries")
      .select("id")
      .eq("email", suppressed);
    assert.equal(data?.length ?? 0, 0);
  });

  /* ------------------------------------------------------------- affiliates */

  test("a customer who is not an affiliate sees no affiliate rows", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("affiliates").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });

  test("affiliate payout details are not readable by a normal customer", async () => {
    const [a] = tenants;
    const { data } = await a.client.from("affiliate_payouts").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0);
  });
});
