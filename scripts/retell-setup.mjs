#!/usr/bin/env node
/**
 * Creates or updates ClientTurn's Retell LLM and voice agent (voice phase P3,
 * docs/VOICE.md §16 and §13). Idempotent. Run by the OWNER, never by the app
 * or a test: it creates objects on the Retell account.
 *
 *   node --env-file=.env --env-file=.env.local scripts/retell-setup.mjs            # dry run: prints what it would send
 *   node --env-file=.env --env-file=.env.local scripts/retell-setup.mjs --apply    # creates / updates on Retell
 *
 * Needs:
 *   RETELL_SECRET_KEY        the server secret key (RETELL_API_KEY accepted)
 *   VOICE_WEBHOOK_BASE_URL   the public https origin (falls back to NEXT_PUBLIC_SITE_URL)
 * Optional:
 *   RETELL_AGENT_ID          an existing agent to update (else found by name, else created)
 *   RETELL_LLM_ID            an existing Retell LLM to update (else the agent's, else created)
 *   RETELL_VOICE_ID          the platform default voice (a workspace may choose its own in Settings, Voice).
 *                            PROVISIONAL default cartesia-Willa (voice-profile.ts PROVISIONAL_DEFAULT_VOICE_ID,
 *                            chosen by the voice QA pass 2026-09-28, VOICE.md §16.15; male alternative
 *                            cartesia-Anthony). Listen to both on a test call before going live.
 *                            An ElevenLabs (11labs-*) default is refused: it is premium voice (+£0.20/min).
 *   RETELL_VOICE_SPEED, RETELL_RESPONSIVENESS, RETELL_INTERRUPTION_SENSITIVITY,
 *   RETELL_BACKCHANNEL (1/0), RETELL_AMBIENT_SOUND    the default feel (voice-profile.ts DEFAULT_VOICE_FEEL)
 *   RETELL_LLM_MODEL         the model (default gpt-4.1-mini: the stack A cost in docs/economics.md §13;
 *                            UNVERIFIED as a current enum value, check it on a live GET first)
 *
 * What it configures (every value from the codebase, never typed here twice):
 *   LLM   general_prompt  voice/tools/definitions.ts RETELL_GENERAL_PROMPT (reads the per-call
 *                         brief from dynamic variables: call_brief, time_plan, ...)
 *         begin_message   "{{locked_preamble}}": the locked OD-1 opener, spoken by Retell, never the model
 *         general_tools   the ClientTurn custom functions at <base>/api/voice/tools/<tool>,
 *                         plus Retell's end_call and a transfer_call to {{transfer_number}}
 *   Agent response_engine retell-llm; language en-GB; timezone Europe/London;
 *         webhook_url     <base>/api/webhooks/retell
 *         max_call_duration_ms  the time governor's ceiling (voice/time-governor.ts)
 *         voicemail_option      hang up by default; each call overrides it with the fixed
 *                               voicemail script only when the consent basis allows (§26)
 *
 * It prints RETELL_AGENT_ID and RETELL_LLM_ID for .env. Nothing else changes.
 */

const APPLY = process.argv.includes("--apply");
const API = "https://api.retellai.com";
const AGENT_NAME = "ClientTurn voice agent";

const { retellCustomTools, RETELL_GENERAL_PROMPT, RETELL_BEGIN_MESSAGE, RETELL_DEFAULT_DYNAMIC_VARIABLES } = await import(
  "../src/lib/voice/tools/definitions.ts"
);
const { PROVIDER_MAX_DURATION_SEC } = await import("../src/lib/voice/time-governor.ts");
const { DEFAULT_VOICE_FEEL, candidateFor, isPremiumProvider, PROVISIONAL_DEFAULT_VOICE_ID, BRITISH_BACKCHANNEL_WORDS, END_CALL_AFTER_SILENCE_MS, REMINDER_AFTER_SILENCE_MS } = await import("../src/lib/voice/voice-profile.ts");

const VOICE_ID = process.env.RETELL_VOICE_ID ?? PROVISIONAL_DEFAULT_VOICE_ID; // provisional, see the header and VOICE.md §16.15
const voice = candidateFor(VOICE_ID);
if (!voice) console.warn(`RETELL_VOICE_ID ${VOICE_ID} is not one of the listed British voices (voice-profile.ts); check it exists.`);
if (voice && isPremiumProvider(voice.provider)) {
  console.error("The platform default voice must be a standard voice: ElevenLabs is premium voice (+£0.20/min), chosen per workspace.");
  process.exit(1);
}
const num = (v, d) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const FEEL = {
  speed: num(process.env.RETELL_VOICE_SPEED, DEFAULT_VOICE_FEEL.speed),
  responsiveness: num(process.env.RETELL_RESPONSIVENESS, DEFAULT_VOICE_FEEL.responsiveness),
  interruption: num(process.env.RETELL_INTERRUPTION_SENSITIVITY, DEFAULT_VOICE_FEEL.interruptionSensitivity),
  backchannel: process.env.RETELL_BACKCHANNEL === undefined ? DEFAULT_VOICE_FEEL.backchannel : process.env.RETELL_BACKCHANNEL === "1",
  ambient: process.env.RETELL_AMBIENT_SOUND ?? DEFAULT_VOICE_FEEL.ambient,
};

const key = process.env.RETELL_SECRET_KEY ?? process.env.RETELL_API_KEY;
const base = (process.env.VOICE_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
if (!base.startsWith("https://") || /localhost|127\.0\.0\.1/.test(base)) {
  console.error("VOICE_WEBHOOK_BASE_URL must be the public https origin (not localhost).");
  process.exit(1);
}
if (APPLY && !key) {
  console.error("RETELL_SECRET_KEY is not set.");
  process.exit(1);
}

const llmBody = {
  general_prompt: RETELL_GENERAL_PROMPT,
  begin_message: RETELL_BEGIN_MESSAGE,
  start_speaker: "agent",
  model: process.env.RETELL_LLM_MODEL ?? "gpt-4.1-mini",
  model_temperature: 0.2,
  default_dynamic_variables: RETELL_DEFAULT_DYNAMIC_VARIABLES,
  general_tools: [
    ...retellCustomTools(base),
    {
      type: "end_call",
      name: "end_call",
      description: "End the call, only after the closing line and end_call_summary (or at once after opt_out).",
    },
    {
      type: "transfer_call",
      name: "transfer_call",
      description: "Put the call through to the business. Only straight after transfer_to_human returned ok.",
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      transfer_option: { type: "cold_transfer", show_transferee_as_caller: false },
    },
  ],
};

function agentBody(llmId) {
  return {
    agent_name: AGENT_NAME,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: VOICE_ID,
    ...(FEEL.speed !== 1 ? { voice_speed: FEEL.speed } : {}), // UNVERIFIED field name
    ...(FEEL.ambient !== "none" ? { ambient_sound: FEEL.ambient } : {}),
    language: "en-GB",
    timezone: "Europe/London",
    webhook_url: `${base}/api/webhooks/retell`,
    max_call_duration_ms: PROVIDER_MAX_DURATION_SEC * 1000,
    end_call_after_silence_ms: END_CALL_AFTER_SILENCE_MS,
    // Detection on; the action is overridden per call (agent_override) with the
    // fixed voicemail only when the consent basis allows. Default: hang up.
    voicemail_option: { action: { type: "hangup" } },
    interruption_sensitivity: FEEL.interruption,
    responsiveness: FEEL.responsiveness,
    enable_backchannel: FEEL.backchannel,
    ...(FEEL.backchannel ? { backchannel_frequency: DEFAULT_VOICE_FEEL.backchannelFrequency } : {}),
    backchannel_words: [...BRITISH_BACKCHANNEL_WORDS],
    reminder_trigger_ms: REMINDER_AFTER_SILENCE_MS,
    reminder_max_count: 1,
    boosted_keywords: ["ClientTurn"],
    post_call_analysis_data: [
      { type: "system-presets", name: "call_summary" },
      { type: "system-presets", name: "call_successful" },
    ],
    // ClientTurn copies the transcript and recording to its own storage
    // (post-call, recording_fetch); Retell keeps them for 30 days.
    data_storage_setting: "everything",
    data_storage_retention_days: 30,
  };
}

async function retell(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function findAgentByName() {
  const res = await retell("POST", "/v2/list-agents?limit=1000", {});
  const items = Array.isArray(res) ? res : (res?.items ?? []);
  return items.find((a) => a.agent_name === AGENT_NAME) ?? null;
}

if (!APPLY) {
  console.log("Dry run (add --apply to create or update on Retell).\n");
  console.log("Retell LLM body:\n", JSON.stringify(llmBody, null, 2));
  console.log("\nAgent body (llm_id filled in on --apply):\n", JSON.stringify(agentBody("<llm_id>"), null, 2));
  process.exit(0);
}

let agentId = process.env.RETELL_AGENT_ID ?? null;
let llmId = process.env.RETELL_LLM_ID ?? null;
let existing = null;
if (agentId) existing = await retell("GET", `/get-agent/${encodeURIComponent(agentId)}`);
else existing = await findAgentByName();
if (existing) {
  agentId = existing.agent_id;
  if (!llmId && existing.response_engine?.type === "retell-llm") llmId = existing.response_engine.llm_id ?? null;
}

if (llmId) {
  await retell("PATCH", `/update-retell-llm/${encodeURIComponent(llmId)}`, llmBody);
  console.log(`Updated Retell LLM ${llmId}`);
} else {
  const created = await retell("POST", "/create-retell-llm", llmBody);
  llmId = created.llm_id;
  console.log(`Created Retell LLM ${llmId}`);
}

if (agentId) {
  await retell("PATCH", `/update-agent/${encodeURIComponent(agentId)}`, agentBody(llmId));
  console.log(`Updated agent ${agentId}`);
} else {
  const created = await retell("POST", "/create-agent", agentBody(llmId));
  agentId = created.agent_id;
  console.log(`Created agent ${agentId}`);
}

console.log("\nAdd to .env (server only):");
console.log(`RETELL_AGENT_ID=${agentId}`);
console.log(`RETELL_LLM_ID=${llmId}`);
console.log("\nThen: import each workspace number into Retell over the Elastic SIP trunk and publish the agent version you want calls to use.");
