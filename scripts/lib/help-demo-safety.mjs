/**
 * The "nothing can send" proof for the help-centre demo workspace, shared by
 * scripts/seed-help-demo.mjs and scripts/capture-help-screenshots.mjs.
 *
 * `purgeQueuedJobs` deletes every pending job the workspace has (the seed's own
 * writes queue lead and message events; the worker's schedulers may queue more
 * later, which job_claims_paused keeps unclaimed). `finalSafetyCheck` then
 * throws unless every condition below holds.
 */

export async function purgeQueuedJobs(admin, businessId) {
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin
      .from("jobs")
      .select("id")
      .eq("business_id", businessId)
      .in("state", ["pending", "running"])
      .limit(200);
    if (error) throw new Error(`jobs read: ${error.message}`);
    if (!data?.length) return deleted;
    // Small batches: jobs has a self-referencing FK that makes big deletes slow.
    for (let i = 0; i < data.length; i += 25) {
      const batch = data.slice(i, i + 25).map((row) => row.id);
      const { error: deleteError, data: gone } = await admin.from("jobs").delete().in("id", batch).select("id");
      if (deleteError) throw new Error(`jobs delete: ${deleteError.message}`);
      deleted += gone?.length ?? 0;
    }
  }
}

async function count(admin, table, build) {
  const { count: n, error } = await build(admin.from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${table} count: ${error.message}`);
  return n ?? 0;
}

export async function finalSafetyCheck(admin, businessId, { allowSimulated = false } = {}) {
  const purged = await purgeQueuedJobs(admin, businessId);
  const { data: business, error } = await admin
    .from("businesses")
    .select("job_claims_paused, slug")
    .eq("id", businessId)
    .single();
  if (error) throw new Error(`business read: ${error.message}`);

  const { data: integrations, error: integrationError } = await admin
    .from("integrations")
    .select("id, provider_type, config")
    .eq("business_id", businessId);
  if (integrationError) throw new Error(`integrations read: ${integrationError.message}`);
  const simulated = (integrations ?? []).filter((row) => row.config?.help_demo_simulated === true);
  const unmarked = (integrations ?? []).filter((row) => row.config?.help_demo_simulated !== true);

  const { data: secrets, error: secretError } = await admin
    .from("integration_secrets")
    .select("access_token, refresh_token, webhook_secret")
    .eq("business_id", businessId);
  if (secretError) throw new Error(`integration_secrets read: ${secretError.message}`);
  const realLookingTokens = (secrets ?? []).filter(
    (row) =>
      (row.access_token && !String(row.access_token).startsWith("DEMO-NOT-A-TOKEN")) ||
      (row.refresh_token && !String(row.refresh_token).startsWith("DEMO-NOT-A-TOKEN")),
  ).length;

  const result = {
    job_claims_paused: business.job_claims_paused === true,
    purged_jobs: purged,
    claimable_jobs: await count(admin, "jobs", (q) => q.eq("business_id", businessId).in("state", ["pending", "running"])),
    active_agents: await count(admin, "agents", (q) => q.eq("business_id", businessId).eq("status", "ACTIVE")),
    live_campaigns: await count(admin, "campaigns", (q) => q.eq("business_id", businessId).in("status", ["RUNNING", "SCHEDULED"])),
    live_outreach_recipients: await count(admin, "outreach_recipient_runs", (q) =>
      q.eq("business_id", businessId).in("status", ["PENDING", "SCHEDULED", "ACTIVE"]),
    ),
    queued_messages: await count(admin, "messages", (q) => q.eq("business_id", businessId).in("status", ["QUEUED", "SENDING"])),
    voice_numbers: await count(admin, "business_numbers", (q) => q.eq("business_id", businessId)),
    integrations: (integrations ?? []).length,
    simulated_integrations: simulated.length,
    unmarked_integrations: unmarked.length,
    tokens_that_look_real: realLookingTokens,
    // Keys minted for the reveal screenshots must be deleted straight after.
    example_keys_left:
      (await count(admin, "api_keys", (q) => q.eq("business_id", businessId).like("name", "Help centre example%"))) +
      (await count(admin, "mcp_clients", (q) => q.eq("business_id", businessId).like("name", "Help centre example%"))),
  };

  const problems = [];
  if (!result.job_claims_paused) problems.push("job_claims_paused is not true");
  if (result.claimable_jobs) problems.push(`${result.claimable_jobs} claimable jobs`);
  if (result.active_agents) problems.push(`${result.active_agents} ACTIVE agents`);
  if (result.live_campaigns) problems.push(`${result.live_campaigns} running/scheduled campaigns`);
  if (result.live_outreach_recipients) problems.push(`${result.live_outreach_recipients} live outreach recipients`);
  if (result.queued_messages) problems.push(`${result.queued_messages} queued messages`);
  if (result.voice_numbers) problems.push(`${result.voice_numbers} voice numbers`);
  if (result.unmarked_integrations) problems.push(`${result.unmarked_integrations} integration rows not marked simulated`);
  if (!allowSimulated && result.simulated_integrations) problems.push(`${result.simulated_integrations} simulated integrations still present`);
  if (result.example_keys_left) problems.push(`${result.example_keys_left} example keys or connections left`);
  if (result.tokens_that_look_real) problems.push(`${result.tokens_that_look_real} secrets that are not DEMO placeholders`);
  if (problems.length) throw new Error(`SAFETY CHECK FAILED: ${problems.join("; ")}`);
  return result;
}
