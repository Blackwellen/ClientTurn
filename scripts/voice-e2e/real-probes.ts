/**
 * REAL-mode provider probes for the voice harness (owner, 2026-09-30: "make
 * all providers real, no faked"). Read-only against the live providers:
 *
 *   Retell      GET the agent, its LLM and the imported numbers; checks the
 *               webhook and every custom tool point at VOICE_WEBHOOK_BASE_URL,
 *               the begin message is the locked preamble, en-GB, and the
 *               workspace's ACTIVE number is imported.
 *   Calendars   for one workspace (default: the owner's), each Calendly or
 *               Google Calendar connection through the app's own
 *               refresh-aware accessor (getLiveAccessToken: the only write is
 *               the token refresh the app itself does), then the health
 *               ping (pingSpec), which for Calendly proves event_types:read.
 *
 * Nothing here creates, updates or calls anything at a provider.
 */
import type { VoiceHarness } from "./harness.ts";

export const OWNER_WORKSPACE = "7c7f61e4-ee71-42ef-b81a-2bd31f84a50b";

type J = Record<string, unknown>;

async function retellGet(path: string): Promise<{ status: number; json: J | J[] }> {
  const key = process.env.RETELL_SECRET_KEY ?? process.env.RETELL_API_KEY ?? "";
  const r = await fetch(`https://api.retellai.com${path}`, { headers: { Authorization: `Bearer ${key}` } });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as J | J[] };
}

export async function probeRetell(h: VoiceHarness, businessId: string): Promise<void> {
  h.step = "real:retell";
  const origin = (process.env.VOICE_WEBHOOK_BASE_URL ?? "").replace(/\/$/, "");
  const { data: vs } = await h.admin.from("voice_settings").select("provider_agent_id").eq("business_id", businessId).maybeSingle();
  const agentId = (vs as { provider_agent_id: string | null } | null)?.provider_agent_id ?? process.env.RETELL_AGENT_ID ?? "";
  const agent = await retellGet(`/get-agent/${agentId}`);
  const a = agent.json as J;
  h.check("Retell agent readable with the configured key", agent.status === 200, { status: agent.status });
  h.check("agent webhook points at VOICE_WEBHOOK_BASE_URL", a.webhook_url === `${origin}/api/webhooks/retell`, { webhook_url: a.webhook_url, origin });
  h.check("agent speaks en-GB", a.language === "en-GB", a.language);
  h.check("agent call ceiling within the 420 s minute reservation", Number(a.max_call_duration_ms) <= 420_000, a.max_call_duration_ms);

  const engine = (a.response_engine ?? {}) as J;
  const llmId = String(engine.llm_id ?? process.env.RETELL_LLM_ID ?? "");
  const llm = await retellGet(`/get-retell-llm/${llmId}`);
  const l = llm.json as J;
  h.check("Retell LLM readable", llm.status === 200, { status: llm.status, llmId });
  h.check("begin message is the locked preamble", l.begin_message === "{{locked_preamble}}" && l.start_speaker === "agent", { begin: l.begin_message, start: l.start_speaker });
  const tools = ((l.general_tools ?? []) as J[]).filter((t) => t.type === "custom");
  const wrongHost = tools.filter((t) => !String(t.url ?? "").startsWith(`${origin}/api/voice/tools/`));
  h.check("every custom tool points at VOICE_WEBHOOK_BASE_URL", tools.length > 0 && wrongHost.length === 0, { tools: tools.length, wrongHost: wrongHost.map((t) => t.url) });
  h.notes.push(`Retell LLM model ${String(l.model)}, ${tools.length} custom tools, prompt ${String(l.general_prompt ?? "").length} chars`);

  // The live general prompt vs this working tree's (a drift means retell-setup --apply is due).
  try {
    const { RETELL_GENERAL_PROMPT } = await import("../../src/lib/voice/tools/definitions.ts");
    const same = String(l.general_prompt ?? "") === RETELL_GENERAL_PROMPT;
    h.check("live Retell general prompt matches this working tree (else run retell-setup --apply)", same, { live: String(l.general_prompt ?? "").length, local: RETELL_GENERAL_PROMPT.length });
  } catch (e) {
    h.notes.push(`prompt comparison skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  const nums = await retellGet("/list-phone-numbers");
  const list = (Array.isArray(nums.json) ? nums.json : []) as J[];
  const { data: num } = await h.admin.from("business_numbers").select("e164, provisioning_state").eq("business_id", businessId).maybeSingle();
  const e164 = (num as { e164: string | null } | null)?.e164 ?? null;
  h.check("the workspace's ACTIVE number is imported into Retell", Boolean(e164) && list.some((n) => n.phone_number === e164), { e164, retell: list.map((n) => n.phone_number) });
}

export async function probeCalendars(h: VoiceHarness, businessId: string): Promise<void> {
  h.step = "real:calendars";
  const { getLiveAccessToken } = await import("../../src/lib/integrations/oauth.ts");
  const { calendlyOAuthConfig } = await import("../../src/lib/integrations/providers/calendly.ts");
  const { googleCalendarConfig } = await import("../../src/lib/integrations/providers/google-calendar.ts");
  const { pingSpec, isInsufficientScope } = await import("../../src/lib/integrations/oauth-health.ts");
  const { data } = await h.admin.from("integrations").select("id, provider_type, status, config").eq("business_id", businessId).in("provider_type", ["calendly", "google_calendar"]);
  const rows = (data ?? []) as { id: string; provider_type: string; status: string; config: J | null }[];
  if (!rows.length) h.notes.push(`no calendar connection on ${businessId}`);
  for (const row of rows) {
    const config = row.provider_type === "calendly" ? calendlyOAuthConfig() : googleCalendarConfig();
    if (!config) {
      h.check(`${row.provider_type}: OAuth client configured`, false, "missing client id/secret");
      continue;
    }
    let token: string;
    try {
      token = await getLiveAccessToken(row.id, config);
    } catch (e) {
      h.check(`${row.provider_type}: live token (refreshed if due)`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    h.check(`${row.provider_type}: live token (refreshed if due)`, true, row.status);
    const spec = pingSpec(row.provider_type, token, { calendlyOrganizationUri: typeof row.config?.organizationUri === "string" ? row.config.organizationUri : null });
    if (!spec) continue;
    const r = await fetch(spec.url, { headers: spec.headers });
    const body = await r.json().catch(() => null);
    const scope = isInsufficientScope(r.status, body);
    h.check(
      `${row.provider_type}: provider accepts the token${row.provider_type === "calendly" ? " and event_types:read" : ""}`,
      r.ok,
      scope ? { status: r.status, insufficientScope: (body as J | null)?.required_scopes } : { status: r.status },
    );
    if (row.provider_type === "calendly" && !row.config?.event_type_uri && !row.config?.eventTypeUri) {
      h.notes.push("calendly: no event type chosen on the workspace, so availability answers NOT_CONFIGURED until one is set");
    }
  }
}
