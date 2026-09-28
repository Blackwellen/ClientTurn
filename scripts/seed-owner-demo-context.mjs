#!/usr/bin/env node
/**
 * Demo business context and a demo enquiry for the owner's TEST workspace
 * ("Blackwellen Roofing & Exteriors"), so AI calls and messages have real
 * material to work from (owner request 2026-09-28: "add demo business info for
 * it and demo lead info for me").
 *
 *   node scripts/seed-owner-demo-context.mjs          # add / refresh (idempotent)
 *   node scripts/seed-owner-demo-context.mjs remove   # take it all out again
 *
 * Everything written is DEMO content for testing: fictional claims about a
 * fictional roofing business. It lives only in this test workspace and is
 * marked "DEMO" wherever a field allows, so it is never mistaken for real
 * customer proof (CLAUDE.md: never fabricate proof on the public site; this is
 * not the public site). No prices are added: the AI must not quote.
 *
 * Writes: services.description / average_value, one default business_playbooks
 * row, business_profiles summary + outreach guidance, and the owner's test lead's
 * notes (lead c112519c…, the one used for the first live test call).
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
const LEAD = "c112519c-21c2-4467-9b22-c9b8c537ebb0"; // the owner's test lead
const PLAYBOOK = "DEMO playbook (test workspace)";
const remove = process.argv[2] === "remove";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const json = (v) => `${q(JSON.stringify(v))}::jsonb`;

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

const SERVICES = {
  "Roof replacement": [
    "DEMO: Full strip and re-roof for houses and small commercial buildings: slate, concrete or clay tile, with new breathable membrane, battens and ventilation. Scaffolding, skip and clear-up included in every quote. Free survey and written quote.",
    9500,
  ],
  "Roof repair": [
    "DEMO: Leaks, slipped or broken tiles, ridge and hip re-bedding, lead flashing and valley repairs. Emergency temporary cover within 24 hours where it is safe to work.",
    650,
  ],
  "Flat roof / GRP": [
    "DEMO: GRP fibreglass and EPDM rubber flat roofs for extensions, garages and dormers, replacing felt that has blistered or leaks.",
    3200,
  ],
  "Guttering & fascias": [
    "DEMO: uPVC fascias, soffits and guttering replaced or repaired, gutter cleaning and downpipe clearing.",
    1800,
  ],
  "Chimney works": [
    "DEMO: Chimney repointing, flaunching, new lead flashing, cowls, and taking down unused stacks safely.",
    1400,
  ],
};

const PROFILE = {
  summary:
    "DEMO: Family-run roofing contractor covering South East London and North West Kent: roof replacement, repairs, flat roofs, guttering and chimneys for homeowners and landlords.",
  outreach_tone: "Friendly, plain-spoken and practical. Short sentences. No jargon, no pressure.",
  outreach_value_proposition:
    "DEMO: A free survey and a written, itemised quote, with the same team from survey to sign-off.",
  outreach_key_messages:
    "DEMO: Free survey and written quote. Scaffolding and clear-up included. Photos of the finished work sent on completion.",
  outreach_proof_points:
    "DEMO: 10-year workmanship guarantee on full roof replacements. Fully insured (public liability). Over 15 years trading in South East London.",
  outreach_avoid:
    "Never give a price or estimate on a call or message: pricing follows the free survey. Never promise a start date. Never criticise other roofers.",
  outreach_call_to_action: "Book a free roof survey at a time that suits them.",
  outreach_claim_restrictions:
    "Only use the proof points above. No 'cheapest', 'best' or 'guaranteed lowest price' claims.",
};

const LEAD_NOTES =
  "DEMO enquiry: 1930s semi-detached house with the original concrete-tile roof. Several tiles slipped in the last storm and there's now a leak over the back bedroom ceiling. Would like a quote for a full roof replacement, but open to a repair if that would do. Best contact is mobile.";

if (remove) {
  await sql(`
update public.services set description = null, average_value = null
 where business_id=${q(BUSINESS)} and description like 'DEMO:%';
delete from public.business_playbooks where business_id=${q(BUSINESS)} and name=${q(PLAYBOOK)};
update public.business_profiles set summary=null, outreach_tone=null, outreach_value_proposition=null,
       outreach_key_messages=null, outreach_proof_points=null, outreach_avoid=null,
       outreach_call_to_action=null, outreach_claim_restrictions=null
 where business_id=${q(BUSINESS)} and summary like 'DEMO:%';
update public.leads set notes=null where id=${q(LEAD)} and business_id=${q(BUSINESS)} and notes like 'DEMO enquiry:%';`);
} else {
  const serviceUpdates = Object.entries(SERVICES)
    .map(([name, [description, value]]) =>
      `update public.services set description=${q(description)}, average_value=${value} where business_id=${q(BUSINESS)} and name=${q(name)};`)
    .join("\n");
  const profileSet = Object.entries(PROFILE).map(([k, v]) => `${k}=${q(v)}`).join(", ");
  await sql(`
${serviceUpdates}
insert into public.business_playbooks (business_id, name, tone, value_propositions, proof_points, prohibited_claims, notes, is_default)
select ${q(BUSINESS)}, ${q(PLAYBOOK)}, ${q(PROFILE.outreach_tone)},
       ${json(["DEMO: Free survey and written, itemised quote", "DEMO: Scaffolding, skip and clear-up included", "DEMO: Same team from survey to sign-off"])},
       ${json(["DEMO: 10-year workmanship guarantee on full roof replacements", "DEMO: Fully insured (public liability)", "DEMO: Over 15 years trading in South East London"])},
       ${json(["cheapest", "best in London", "guaranteed lowest price", "no-obligation price over the phone"])},
       'DEMO content for testing the AI assistant. Not real proof.', true
where not exists (select 1 from public.business_playbooks where business_id=${q(BUSINESS)} and name=${q(PLAYBOOK)});
update public.business_profiles set ${profileSet}, outreach_guidance_updated_at=now() where business_id=${q(BUSINESS)};
update public.leads set notes=${q(LEAD_NOTES)} where id=${q(LEAD)} and business_id=${q(BUSINESS)};`);
}

const check = await sql(`
select 'services_with_desc' k, count(*)::text v from public.services where business_id=${q(BUSINESS)} and description like 'DEMO:%'
union all select 'playbook', count(*)::text from public.business_playbooks where business_id=${q(BUSINESS)} and name=${q(PLAYBOOK)}
union all select 'profile_summary', coalesce((select left(summary, 60) from public.business_profiles where business_id=${q(BUSINESS)}), 'none')
union all select 'lead_notes', coalesce((select left(notes, 60) from public.leads where id=${q(LEAD)}), 'none')`);
for (const row of check) console.log(`${row.k}: ${row.v}`);
