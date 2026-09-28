#!/usr/bin/env node
/**
 * A second demo test lead in the owner's TEST workspace, for Michael Thomas
 * (owner request 2026-09-28), with a DEMO enquiry.
 *
 *   node scripts/seed-demo-lead-michael.mjs            # create (idempotent)
 *   node scripts/seed-demo-lead-michael.mjs consent    # ONLY after the owner confirms Michael agreed to a test AI call
 *   node scripts/seed-demo-lead-michael.mjs remove
 *
 * Consent is deliberately separate. An AI call needs a number the person gave
 * and a recorded request/consent to be called (voice/eligibility.ts). Until the
 * owner confirms Michael agreed, the lead is created with phone_source UNKNOWN
 * and no call permission, so "Call with AI" correctly refuses. The `consent`
 * step records it with the owner's confirmation as the evidence, copying the
 * shape of the owner's own test lead's permission row.
 *
 * No enrichment: ClientTurn never looks a person up by phone number
 * (CLAUDE.md resolved conflict 6). "Enriched" here means a DEMO enquiry.
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

const BUSINESS = "7c7f61e4-ee71-42ef-b81a-2bd31f84a50b";
const OWNER_USER = "7bc6ba12-7141-42c8-9755-be47cca51810";
const TEMPLATE_LEAD = "c112519c-21c2-4467-9b22-c9b8c537ebb0"; // the owner's own test lead
const PHONE = "+447946754220";
const mode = process.argv[2] ?? "create";
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);

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

const NOTES =
  "DEMO enquiry: Flat roof over the kitchen extension (about 18 m²) is old felt that has blistered and now lets water in when it rains heavily. Wants it replaced with GRP or rubber, and asked whether the guttering on that side can be looked at while the scaffolding is up. Semi-retired, usually free weekday mornings.";

const existing = await sql(`select id from public.leads where business_id=${q(BUSINESS)} and phone_normalized=${q(PHONE)} and anonymised_at is null limit 1`);
const leadId = existing[0]?.id ?? null;

if (mode === "remove") {
  if (leadId) await sql(`delete from public.leads where id=${q(leadId)} and business_id=${q(BUSINESS)} and notes like 'DEMO enquiry:%'`);
  console.log(leadId ? `removed ${leadId}` : "nothing to remove");
  process.exit(0);
}

if (mode === "create") {
  if (leadId) {
    await sql(`update public.leads set notes=${q(NOTES)} where id=${q(leadId)}`);
    console.log(`exists ${leadId}; notes refreshed`);
  } else {
    const [row] = await sql(`
insert into public.leads (business_id, first_name, last_name, phone, phone_normalized, postcode, service_id, source_id,
  status, qualification_state, assigned_user_id, automation_active, human_takeover, notes, intake_method,
  subscriber_type, relationship_type, created_via, created_by_user_id, conversion_goal_type, phone_source)
select t.business_id, 'Michael', 'Thomas', ${q(PHONE)}, ${q(PHONE)}, 'BR1 4HZ',
       (select id from public.services where business_id=t.business_id and name='Flat roof / GRP'),
       t.source_id, 'NEW', 'PENDING', ${q(OWNER_USER)}, false, true, ${q(NOTES)}, t.intake_method,
       'UNKNOWN', t.relationship_type, 'MANUAL_WIZARD', ${q(OWNER_USER)}, t.conversion_goal_type, 'UNKNOWN'
  from public.leads t where t.id=${q(TEMPLATE_LEAD)}
returning id`);
    console.log(`created ${row.id}`);
  }
}

if (mode === "consent") {
  if (!leadId) throw new Error("Create the lead first.");
  const cols = await sql(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='contact_permissions'`);
  const names = cols[0].c.split(",").filter((c) => !["id", "created_at", "updated_at"].includes(c));
  const template = await sql(`select * from public.contact_permissions where subject_type='LEAD' and subject_id=${q(TEMPLATE_LEAD)} limit 1`);
  if (!template.length) throw new Error("Template permission row not found.");
  const WORDING = "Owner confirmed on 2026-09-28 that Michael Thomas (the owner's father) agreed to receive a test AI call on this mobile.";
  const override = {
    subject_id: leadId,
    phone_e164: PHONE,
    email: null,
    relationship_detail: "Test lead: the owner's father, who agreed to a test call",
    consent_source: "owner_confirmation",
    consent_captured_at: new Date().toISOString(),
    call_consent_wording: WORDING,
    consent_evidence: null,
    tps_listed: null,
    ctps_listed: null,
    tps_checked_at: null,
  };
  const select = names.map((n) => (n in override ? `${q(override[n])} as ${n}` : n)).join(", ");
  await sql(`
insert into public.contact_permissions (${names.join(", ")})
select ${select} from public.contact_permissions where subject_type='LEAD' and subject_id=${q(TEMPLATE_LEAD)} limit 1
on conflict do nothing;
update public.contact_permissions
   set phone_e164=${q(PHONE)}, email=null, relationship_detail=${q(override.relationship_detail)},
       consent_source=${q(override.consent_source)}, consent_captured_at=now(), call_consent_wording=${q(WORDING)},
       consent_evidence=null, tps_listed=null, ctps_listed=null, tps_checked_at=null
 where subject_type='LEAD' and subject_id=${q(leadId)} and business_id=${q(BUSINESS)};
update public.leads set phone_source='MANUAL_BY_LEAD_REQUEST' where id=${q(leadId)};`);
  console.log(`consent recorded for ${leadId}`);
}

const check = await sql(`select id, first_name, last_name, phone_normalized, postcode, phone_source, left(notes, 50) notes,
  (select name from public.services s where s.id=l.service_id) service,
  (select count(*) from public.contact_permissions p where p.subject_type='LEAD' and p.subject_id=l.id) permissions
  from public.leads l where business_id=${q(BUSINESS)} and phone_normalized=${q(PHONE)}`);
console.log(JSON.stringify(check, null, 1));
