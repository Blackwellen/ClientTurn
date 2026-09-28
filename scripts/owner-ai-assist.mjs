#!/usr/bin/env node
/**
 * Switch the AI assistant on (or off) in the owner's TEST workspace, at the
 * owner's request (2026-09-28), so AI voice calls can use their tools
 * (voice/tools/core.ts gates every tool on aiAssistEnabled && mode !== OFF).
 *
 *   node scripts/owner-ai-assist.mjs on    # ai_assist_enabled = true, mode SUGGEST_ONLY
 *   node scripts/owner-ai-assist.mjs off   # ai_assist_enabled = false
 *
 * SUGGEST_ONLY, not AUTO_REPLY: the text assistant drafts replies for a person
 * to approve and never messages leads on its own. The same switch in the app is
 * Settings -> Workspace -> AI assistant.
 */
import fs from "node:fs";

const read = (file) => {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }),
    );
  } catch { return {}; }
};
const env = { ...read(".env"), ...read(".env.local") };
const BUSINESS = "7c7f61e4-ee71-42ef-b81a-2bd31f84a50b"; // Blackwellen Roofing & Exteriors (test workspace)
const mode = process.argv[2];
if (!["on", "off"].includes(mode ?? "")) {
  console.error("Usage: node scripts/owner-ai-assist.mjs on|off");
  process.exit(1);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

if (mode === "on") {
  await sql(`
update public.business_settings set ai_assist_enabled = true where business_id='${BUSINESS}';
insert into public.business_ai_settings (business_id, agent_mode) values ('${BUSINESS}', 'SUGGEST_ONLY')
on conflict (business_id) do update set agent_mode = 'SUGGEST_ONLY' where public.business_ai_settings.agent_mode is distinct from 'AUTO_REPLY';`);
} else {
  await sql(`update public.business_settings set ai_assist_enabled = false where business_id='${BUSINESS}';`);
}

const rows = await sql(`
select 'ai_assist_enabled' k, (select ai_assist_enabled::text from public.business_settings where business_id='${BUSINESS}') v
union all select 'agent_mode', (select agent_mode from public.business_ai_settings where business_id='${BUSINESS}')
union all select 'plan_allows_ai', (select ai_assist_allowed::text from public.subscriptions where business_id='${BUSINESS}' limit 1)`);
for (const r of rows) console.log(`${r.k}: ${r.v}`);
