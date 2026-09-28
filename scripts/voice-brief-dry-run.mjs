#!/usr/bin/env node
/**
 * Voice brief dry run (READ-ONLY; live-call fixes, 2026-09-28).
 *
 *   node scripts/voice-brief-dry-run.mjs <leadId> [route]
 *
 * Builds the exact call brief, time plan and Retell dynamic variables the
 * runtime would send for a lead, from the LIVE database, through the real
 * loader (voice/server-p3.ts loadVoiceCallBrief -> call-brief.ts
 * buildVoiceCallBrief). No call is placed, no AI or Retell is called, and
 * nothing is written:
 *
 *   - every Supabase request other than GET/HEAD (and the STABLE
 *     check_suppression RPC) is refused before it leaves
 *     this process (a read-only guard on global fetch), and every request to
 *     any other host is refused, so a loader change that starts writing or
 *     calling out fails loudly here instead of touching live data;
 *   - the call row is synthetic (never inserted): route QUALIFICATION unless
 *     given, OUTBOUND, recording on, the lead's time zone Europe/London.
 *
 * Env: .env then .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 * Server-only imports resolve through scripts/e2e-resolver.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env", ".env.local"]) {
  const p = path.join(repo, f);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}

const leadId = process.argv[2];
const route = process.argv[3] ?? "QUALIFICATION";
if (!/^[0-9a-f-]{36}$/i.test(leadId ?? "")) {
  console.error("Usage: node scripts/voice-brief-dry-run.mjs <leadId> [route]");
  process.exit(1);
}

// ---- read-only guard
const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://invalid").host;
const realFetch = globalThis.fetch;
/** check_suppression: 0037_v4_functions.sql, `language sql stable` (a SELECT). */
const READ_ONLY_RPCS = new Set(["check_suppression"]);
const blocked = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET").toUpperCase();
  if (url.host !== supabaseHost) {
    blocked.push(`${method} ${url.host}${url.pathname}`);
    throw new Error(`dry run: network call to ${url.host} refused`);
  }
  // Read-only RPCs (declared STABLE in their migrations) are the one POST allowed.
  const readRpc = method === "POST" && READ_ONLY_RPCS.has(url.pathname.replace(/^\/rest\/v1\/rpc\//, ""));
  if (method !== "GET" && method !== "HEAD" && !readRpc) {
    blocked.push(`${method} ${url.pathname}`);
    throw new Error(`dry run: ${method} ${url.pathname} refused (read-only)`);
  }
  return realFetch(input, init);
};

await import(pathToFileURL(path.join(repo, "scripts", "e2e-resolver.mjs")).href);
const { createAdminClient } = await import(pathToFileURL(path.join(repo, "src/lib/supabase/admin.ts")).href);
const { loadVoiceCallBrief } = await import(pathToFileURL(path.join(repo, "src/lib/voice/server-p3.ts")).href);

const db = createAdminClient();
const lead = (await db.from("leads").select("id, business_id, first_name, service_id, postcode, notes, qualification_state").eq("id", leadId).maybeSingle()).data;
if (!lead) {
  console.error(`No lead ${leadId}.`);
  process.exit(1);
}
const settings = (await db.from("voice_settings").select("*").eq("business_id", lead.business_id).maybeSingle()).data ?? {};
const now = new Date().toISOString();
const call = {
  id: "00000000-0000-4000-8000-00000000d7e5",
  business_id: lead.business_id,
  lead_id: lead.id,
  direction: "OUTBOUND",
  route,
  state: "QUEUED",
  recording_enabled: true,
  recipient_timezone: "Europe/London",
  calling_as_name: settings.calling_as_name ?? null,
  created_at: now,
};
const identity = {
  callingAsName: settings.calling_as_name ?? "(calling as name not set)",
  legalEntityName: settings.legal_entity_name ?? "(legal entity not set)",
  identificationContact: settings.identification_contact ?? "(contact not set)",
  personaName: settings.assistant_persona_name ?? null,
};

const brief = await loadVoiceCallBrief({ call, ctx: { settings }, identity, preamble: { text: "", version: "dry-run" } });
if (!brief) {
  console.error("The loader returned no brief (no context for this lead).");
  process.exit(1);
}
const v = brief.dynamicVariables;
console.log(`# Voice brief dry run: lead ${lead.id} (${lead.first_name ?? "?"}), business ${lead.business_id}, route ${route}`);
console.log(`# brief ${brief.version}; qualification_state ${lead.qualification_state}; ~${Math.ceil(v.call_brief.length / 4)} brief tokens; dropped for space: ${(brief.dropped ?? []).join(", ") || "none"}`);
console.log("\n## call_brief\n");
console.log(v.call_brief);
console.log("\n## time_plan\n");
console.log(v.time_plan);
console.log("\n## other dynamic variables\n");
for (const [k, val] of Object.entries(v)) if (k !== "call_brief" && k !== "time_plan") console.log(`${k}: ${val}`);
// The offer card the brief's approved lines come from (the same assembly a text turn uses).
const { assembleContext } = await import(pathToFileURL(path.join(repo, "src/lib/agent/context.ts")).href);
const context = await assembleContext({ businessId: lead.business_id, leadId: lead.id, conversationId: null, channel: "sms" });
if (context) {
  console.log("\n## offer card (source of APPROVED OFFER LINES)\n");
  console.log(`hasApprovedClaims: ${context.offer.hasApprovedClaims}; tokens ${context.offer.tokens}/${context.offer.budget}; dropped: ${context.offer.dropped.join(", ") || "none"}`);
}
if (blocked.length) {
  console.log(`\n## refused by the read-only guard (${blocked.length})\n`);
  for (const b of blocked) console.log(b);
}
