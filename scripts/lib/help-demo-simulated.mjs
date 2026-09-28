/**
 * SIMULATED provider connections for the help-centre demo workspace.
 *
 * Owner decision (2026-09-28): the connected-state screenshots may be taken
 * from simulated connections, which must be removed as soon as those shots are
 * captured, so the kept demo workspace carries no fake connections.
 *
 *   - Created only by `seed-help-demo.mjs --with-simulated-connections`.
 *   - Every row: fictional display names and ids, `config.help_demo_simulated
 *     = true`, and NO token. `integration_secrets.access_token` and
 *     `refresh_token` are null; the Google Ads webhook key is an obviously fake
 *     `DEMO-NOT-A-TOKEN-...` string (it only authenticates inbound posts to the
 *     demo workspace, and is deleted with the row).
 *   - A connection with no token cannot call its provider: every provider
 *     client reads the token from integration_secrets first. And the workspace
 *     has job_claims_paused, so no sync, pull or push job runs for it.
 *   - `removeSimulatedConnections` deletes them and everything derived from
 *     them (secrets, integration objects and CRM pull settings cascade; CRM
 *     push records, WhatsApp templates and step mappings, and the Calendly
 *     booking mode are removed or reset explicitly).
 */

const MARK = { help_demo_simulated: true };
const FAKE = (name) => `DEMO-NOT-A-TOKEN-${name}`;

export const SIMULATED = [
  {
    provider_type: "meta",
    display_name: "Blackwellen (demo Page)",
    external_account_id: "demo-page-1001",
    config: {
      pageId: "demo-page-1001",
      pages: [
        { id: "demo-page-1001", name: "Blackwellen" },
        { id: "demo-page-1002", name: "Blackwellen Shopify Studio" },
      ],
    },
    secret: { token_expires_at: 8 },
  },
  {
    provider_type: "google_ads",
    display_name: "Blackwellen Ads (demo)",
    external_account_id: "000-000-1001",
    config: { accessibleCustomerIds: ["000-000-1001", "000-000-1002"] },
    secret: { webhook_secret: FAKE("google-ads-webhook-key") },
  },
  {
    provider_type: "linkedin_ads",
    display_name: "Blackwellen (demo organisation)",
    external_account_id: "urn:li:organization:demo-1001",
    config: {
      organizations: [
        { id: "urn:li:organization:demo-1001", name: "Blackwellen" },
        { id: "urn:li:organization:demo-1002", name: "Blackwellen Labs" },
      ],
    },
  },
  { provider_type: "hubspot", display_name: "Blackwellen (demo HubSpot portal)", external_account_id: "demo-portal-1001", config: {} },
  { provider_type: "salesforce", display_name: "Blackwellen (demo Salesforce org)", external_account_id: "demo-org-00D000000000001", config: { instance: "demo" } },
  { provider_type: "zoho_crm", display_name: "Blackwellen (demo Zoho CRM)", external_account_id: "demo-zoho-1001", config: { dataCentre: "eu" } },
  { provider_type: "slack", display_name: "Blackwellen demo Slack", external_account_id: "demo-team-T0001", config: { channel_id: "C0DEMO1001", channel_name: "new-leads" } },
  { provider_type: "calendly", display_name: "Alex Morgan (demo Calendly)", external_account_id: "demo-calendly-user", config: { event_type_uri: "https://calendly.com/event_types/help-demo-discovery-call" } },
  { provider_type: "google_calendar", display_name: `alex@blackwellen-demo.example (demo calendar)`, external_account_id: "demo-calendar", config: {} },
  { provider_type: "whatsapp_cloud", display_name: "Blackwellen WhatsApp (demo)", external_account_id: "demo-waba-1001", config: {} },
];

export async function seedSimulatedConnections(ctx) {
  const { admin, businessId } = ctx;
  const ids = {};
  for (const row of SIMULATED) {
    const { secret, config, ...rest } = row;
    const { data: existing } = await admin
      .from("integrations")
      .select("id, config")
      .eq("business_id", businessId)
      .eq("provider_type", row.provider_type)
      .maybeSingle();
    if (existing && existing.config?.help_demo_simulated !== true) {
      throw new Error(`a real ${row.provider_type} connection exists in the demo workspace; refusing to overwrite it`);
    }
    const values = {
      business_id: businessId,
      ...rest,
      status: "HEALTHY",
      config: { ...config, ...MARK },
      scopes: [],
      last_success_at: ctx.ago(0, 1),
      last_error_at: null,
      last_error_code: null,
      last_error_message: null,
      connected_by: ctx.users.owner,
    };
    const { data, error } = existing
      ? await admin.from("integrations").update(values).eq("id", existing.id).select("id").single()
      : await admin.from("integrations").insert(values).select("id").single();
    if (error) throw new Error(`simulated ${row.provider_type}: ${error.message}`);
    ids[row.provider_type] = data.id;
    await admin.from("integration_secrets").upsert(
      {
        integration_id: data.id,
        business_id: businessId,
        access_token: null,
        refresh_token: null,
        token_expires_at: secret?.token_expires_at ? new Date(Date.now() + secret.token_expires_at * 86_400_000).toISOString() : null,
        webhook_secret: secret?.webhook_secret ?? null,
        extra: MARK,
      },
      { onConflict: "integration_id" },
    );
    ctx.bump("simulated_integrations");
  }

  // Meta: the Page and one lead form, as a connection lists them.
  for (const [type, external, name] of [
    ["meta_page", "demo-page-1001", "Blackwellen"],
    ["meta_form", "demo-form-2001", "Website project enquiry"],
  ]) {
    await admin.from("integration_objects").upsert(
      { business_id: businessId, integration_id: ids.meta, object_type: type, external_id: external, name, enabled: true, config: MARK },
      { onConflict: "integration_id,object_type,external_id" },
    );
  }

  // HubSpot: import switched on, one completed pull.
  await admin.from("crm_pull_settings").upsert(
    {
      integration_id: ids.hubspot,
      business_id: businessId,
      provider_type: "hubspot",
      enabled: true,
      updated_by: ctx.users.owner,
      last_run_at: ctx.ago(0, 1),
      last_run_status: "OK",
      last_run_ingested: 3,
      last_run_skipped: 12,
    },
    { onConflict: "integration_id" },
  );

  // CRM push status: recent pushes and one failure.
  const pushes = [
    ["harriet", "hubspot", "pushed", null],
    ["daniel", "hubspot", "pushed", null],
    ["fiona", "hubspot", "pushed", null],
    ["james", "hubspot", "pushed", null],
    ["grace", "hubspot", "failed", "HubSpot rejected the contact: property \"lifecyclestage\" cannot move backwards (demo)."],
    ["harriet", "salesforce", "pushed", null],
    ["daniel", "salesforce", "pushed", null],
  ];
  for (const [key, provider, status, error] of pushes) {
    await admin.from("crm_push_records").upsert(
      {
        business_id: businessId,
        lead_id: ctx.leadIds[key],
        provider_type: provider,
        status,
        last_error: error,
        pushed_at: status === "pushed" ? ctx.ago(1, 3) : null,
        external_contact_id: status === "pushed" ? `demo-contact-${key}` : null,
      },
      { onConflict: "business_id,lead_id,provider_type" },
    );
  }

  // WhatsApp (direct): two approved templates, and the follow-up sequence's
  // WhatsApp step mapped to one of them.
  const templates = [
    { external_id: "help-demo-follow-up", name: "follow_up_after_enquiry", category: "UTILITY", body: "Hi {{1}}, it's the team at {{2}}. Just following up on your enquiry about {{3}}. Would a quick call this week help?", variables: ["1", "2", "3"] },
    { external_id: "help-demo-check-in", name: "project_check_in", category: "MARKETING", body: "Hi {{1}}, is your {{2}} project still on the cards? We have availability next month.", variables: ["1", "2"] },
  ];
  const templateIds = [];
  for (const t of templates) {
    const { data, error } = await admin
      .from("whatsapp_templates")
      .upsert({ business_id: businessId, provider: "meta", language: "en_GB", status: "APPROVED", synced_at: ctx.ago(0, 2), ...t }, { onConflict: "business_id,provider,external_id" })
      .select("id")
      .single();
    if (error) throw new Error(`whatsapp template: ${error.message}`);
    templateIds.push(data.id);
  }
  const { data: automation } = await admin.from("automation_definitions").select("id").eq("business_id", businessId).eq("type", "new_lead").maybeSingle();
  if (automation) {
    const { data: steps } = await admin
      .from("automation_steps")
      .select("position, automation_versions!inner(automation_id, status)")
      .eq("business_id", businessId)
      .eq("channel", "whatsapp")
      .eq("automation_versions.automation_id", automation.id)
      .limit(1);
    const position = steps?.[0]?.position;
    if (position) {
      await admin.from("whatsapp_step_templates").upsert(
        { business_id: businessId, automation_id: automation.id, step_position: position, template_id: templateIds[0], variable_map: { 1: "first_name", 2: "business_name", 3: "service_name" }, updated_by: ctx.users.owner },
        { onConflict: "automation_id,step_position" },
      );
    }
  }
  return ids;
}

/** Deletes every simulated connection and what was derived from it. */
export async function removeSimulatedConnections(admin, businessId) {
  const removed = {};
  const { data: rows, error } = await admin
    .from("integrations")
    .select("id, provider_type, config")
    .eq("business_id", businessId);
  if (error) throw new Error(`integrations read: ${error.message}`);
  const simulated = (rows ?? []).filter((row) => row.config?.help_demo_simulated === true);
  const ids = simulated.map((row) => row.id);

  const del = async (table, build) => {
    const { data, error: e } = await build(admin.from(table).delete()).select("*");
    if (e) throw new Error(`${table} delete: ${e.message}`);
    removed[table] = (removed[table] ?? 0) + (data?.length ?? 0);
  };
  // Derived rows first (the templates cascade to their step mappings).
  await del("whatsapp_templates", (q) => q.eq("business_id", businessId).like("external_id", "help-demo-%"));
  await del("crm_push_records", (q) => q.eq("business_id", businessId));
  if (ids.length) {
    await del("integration_objects", (q) => q.eq("business_id", businessId).in("integration_id", ids));
    await del("crm_pull_settings", (q) => q.eq("business_id", businessId).in("integration_id", ids));
    await del("integration_secrets", (q) => q.eq("business_id", businessId).in("integration_id", ids));
    await del("integrations", (q) => q.eq("business_id", businessId).in("id", ids));
  }
  // Settings that only made sense with a connection.
  await admin.from("business_settings").update({ booking_mode: "handover" }).eq("business_id", businessId).neq("booking_mode", "handover");

  const { data: left } = await admin.from("integrations").select("id, config").eq("business_id", businessId);
  removed.remaining_simulated = (left ?? []).filter((row) => row.config?.help_demo_simulated === true).length;
  removed.remaining_integrations = (left ?? []).length;
  return removed;
}
