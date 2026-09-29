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
 *     given, OUTBOUND (INBOUND for RETURN_CALL), recording as the workspace's
 *     voice settings say (the dial's rule), the lead's time zone Europe/London.
 *
 *   node scripts/voice-brief-dry-run.mjs <leadId> --matrix
 *
 * reads the live sources once, then builds and lints (voice/brief-lint.ts)
 * the brief for every route x booking on/off x calendar (none, slots, link)
 * x AI assistant on/off x recording on/off x transfer on/off, varying the
 * permissions IN MEMORY on a copy of the sources. Nothing is written.
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
const route = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "QUALIFICATION";
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
const { gatherVoiceBriefSources, voiceBriefFromSources } = await import(pathToFileURL(path.join(repo, "src/lib/voice/server-p3.ts")).href);
const { lintCallBrief } = await import(pathToFileURL(path.join(repo, "src/lib/voice/brief-lint.ts")).href);
const { aiAuthorityOf, DISABLED_AUTHORITY } = await import(pathToFileURL(path.join(repo, "src/lib/commercial/authority.ts")).href);
const { callPermissionsFromContext } = await import(pathToFileURL(path.join(repo, "src/lib/voice/tools/core.ts")).href);

const db = createAdminClient();
const lead = (await db.from("leads").select("id, business_id, first_name, service_id, postcode, notes, qualification_state").eq("id", leadId).maybeSingle()).data;
if (!lead) {
  console.error(`No lead ${leadId}.`);
  process.exit(1);
}
const settings = (await db.from("voice_settings").select("*").eq("business_id", lead.business_id).maybeSingle()).data ?? {};
const now = new Date().toISOString();
/** The call row the dial would insert (never inserted): recording from the settings, as runtime-core does; a return call is INBOUND. */
const callFor = (r, recording = Boolean(settings.recording_enabled)) => ({
  id: "00000000-0000-4000-8000-00000000d7e5",
  business_id: lead.business_id,
  lead_id: lead.id,
  direction: r === "RETURN_CALL" ? "INBOUND" : "OUTBOUND",
  route: r,
  state: "QUEUED",
  recording_enabled: recording,
  recipient_timezone: "Europe/London",
  calling_as_name: settings.calling_as_name ?? null,
  created_at: now,
});
const identity = {
  callingAsName: settings.calling_as_name ?? "(calling as name not set)",
  legalEntityName: settings.legal_entity_name ?? "(legal entity not set)",
  identificationContact: settings.identification_contact ?? "(contact not set)",
  personaName: settings.assistant_persona_name ?? null,
};
const request = (call) => ({ call, ctx: { settings }, identity, preamble: { text: "", version: "dry-run" } });

// The live sources, read once (the only database reads).
const sources = await gatherVoiceBriefSources(request(callFor(route)));
if (!sources) {
  console.error("The loader returned no brief (no context for this lead).");
  process.exit(1);
}

/** The lint facts for a brief built from these sources (what the brief was allowed to say). */
function factsFor(src, call, brief) {
  const c = src.context;
  const perms = callPermissionsFromContext({
    aiAssistEnabled: c.business.aiAssistEnabled,
    agentMode: c.business.agent.mode,
    quoteAiCapability: src.quoteAiCapability,
    authority: c.commerce?.authority,
    motion: c.sales.motion,
    transfer: { mode: src.transfer.mode, numberSet: Boolean(src.transfer.numberE164) },
    lead: { phone: c.lead.phone, email: c.lead.email, optedOut: Boolean(c.lead.opted_out) },
    contactable: c.leadContext.contactable,
    bookingUrl: c.business.bookingUrl,
  });
  const booking = c.booking.availabilityQueryable ? "SLOTS" : c.booking.bookingUrl ? "LINK" : "TEAM_FOLLOW_UP";
  return {
    route: call.route,
    direction: call.direction,
    permissions: { book: perms.book, quote: perms.quote, sendQuote: perms.sendQuote, checkout: perms.checkout, bookingLink: perms.bookingLink },
    booking,
    recordingEnabled: call.recording_enabled,
    transferAvailable: Boolean(brief.dynamicVariables.transfer_number),
    hasOffer: /APPROVED OFFER LINES/.test(brief.dynamicVariables.call_brief),
    hasEnquiry: /THEIR ENQUIRY/.test(brief.dynamicVariables.call_brief),
  };
}

/**
 * One permission combination, applied in memory to a copy of the live
 * sources: nothing is written, and the build is the dial's own.
 */
function simulate(src, { book, calendar, ai, transfer }) {
  const c = structuredClone(src.context);
  const base = c.commerce?.authority ?? DISABLED_AUTHORITY;
  const ai0 = aiAuthorityOf(base);
  c.commerce = {
    ...(c.commerce ?? { directClose: false }),
    authority: { ...base, ai: { ...ai0, capabilities: { ...ai0.capabilities, book, transfer_human: transfer } } },
  };
  c.business.aiAssistEnabled = ai;
  if (ai && c.business.agent.mode === "OFF") c.business.agent = { ...c.business.agent, mode: "AUTO_REPLY" };
  const link = "https://example.test/book";
  c.booking = { ...c.booking, availabilityQueryable: calendar === "SLOTS", bookingUrl: calendar === "LINK" ? link : null };
  c.business.bookingUrl = calendar === "LINK" ? link : null;
  return { ...src, context: c, transfer: transfer ? { mode: "ON_REQUEST", numberE164: "+442071234567" } : { mode: src.transfer.mode, numberE164: null } };
}

if (process.argv.includes("--matrix")) {
  const ROUTES = ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"];
  const rows = [];
  for (const r of ROUTES)
    for (const book of [false, true])
      for (const calendar of ["NONE", "SLOTS", "LINK"])
        for (const ai of [true, false])
          for (const recording of [true, false])
            for (const transfer of [false, true]) {
              const call = callFor(r, recording);
              const src = simulate(sources, { book, calendar, ai, transfer });
              const brief = voiceBriefFromSources(src, request(call));
              const findings = lintCallBrief({ text: brief.dynamicVariables.call_brief, dropped: brief.dropped }, factsFor(src, call, brief));
              rows.push({ combo: `${r} book=${book} cal=${calendar} ai=${ai} rec=${recording} xfer=${transfer}`, tokens: Math.ceil(brief.dynamicVariables.call_brief.length / 4), dropped: brief.dropped ?? [], findings });
            }
  const failing = rows.filter((x) => x.findings.length);
  console.log(`# Voice brief matrix: lead ${lead.id} (${lead.first_name ?? "?"}), ${rows.length} combinations, ${failing.length} with findings; max ${Math.max(...rows.map((x) => x.tokens))} tokens`);
  const byCode = new Map();
  for (const x of failing) for (const f of x.findings) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  for (const [code, n] of byCode) console.log(`${code}: ${n}`);
  for (const x of failing.slice(0, 40)) console.log(`- ${x.combo}: ${x.findings.map((f) => `${f.code} (${f.detail})`).join("; ")}`);
} else {
  const call = callFor(route);
  const brief = voiceBriefFromSources(sources, request(call));
  const v = brief.dynamicVariables;
  console.log(`# Voice brief dry run: lead ${lead.id} (${lead.first_name ?? "?"}), business ${lead.business_id}, route ${route} (${call.direction}, recording ${call.recording_enabled ? "on" : "off"})`);
  console.log(`# brief ${brief.version}; qualification_state ${lead.qualification_state}; ~${Math.ceil(v.call_brief.length / 4)} brief tokens; dropped for space: ${(brief.dropped ?? []).join(", ") || "none"}`);
  console.log("\n## call_brief\n");
  console.log(v.call_brief);
  console.log("\n## time_plan\n");
  console.log(v.time_plan);
  console.log("\n## other dynamic variables\n");
  for (const [k, val] of Object.entries(v)) if (k !== "call_brief" && k !== "time_plan") console.log(`${k}: ${val}`);
  console.log("\n## offer card (source of APPROVED OFFER LINES)\n");
  const context = sources.context;
  console.log(`hasApprovedClaims: ${context.offer.hasApprovedClaims}; tokens ${context.offer.tokens}/${context.offer.budget}; dropped: ${context.offer.dropped.join(", ") || "none"}`);
  const findings = lintCallBrief({ text: v.call_brief, dropped: brief.dropped }, factsFor(sources, call, brief));
  console.log(`\n## brief lint (${findings.length})\n`);
  for (const f of findings) console.log(`${f.code}: ${f.detail}`);
}
if (blocked.length) {
  console.log(`\n## refused by the read-only guard (${blocked.length})\n`);
  for (const b of blocked) console.log(b);
}
