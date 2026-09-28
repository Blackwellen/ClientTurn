#!/usr/bin/env node
/**
 * The owner's capped voice test call (approved by the owner 2026-09-28:
 * at most 3 calls and 10 minutes, to the owner's own phone only).
 *
 *   node scripts/owner-voice-test-call.mjs setup      # 10 test minutes + temporary voice number
 *   node scripts/owner-voice-test-call.mjs status
 *   node scripts/owner-voice-test-call.mjs teardown   # remove the temporary number, zero the leftover test minutes
 *
 * Setup writes, for the owner's workspace only:
 *   - 600 s of pack minutes through the append-only voice_minute_ledger
 *     (ADJUSTMENT, idempotent key), mirrored onto voice_minute_balances;
 *   - the `voice_sales_enabled` grant a pack purchase would write
 *     (billing/voice-webhook.ts), expiring by itself after 24 hours;
 *   - the owner's Twilio number (TWILIO_SMS_FROM) as the workspace's ACTIVE
 *     voice number (business_numbers), with messaging_service_sid left null so
 *     SMS keeps using the shared platform sender.
 *
 * While that number row exists, inbound calls/texts to the number resolve to
 * this workspace (numbers/sender.ts resolveInbound), so teardown must run
 * straight after the test. Teardown deletes only the row this script created
 * and writes a closing ADJUSTMENT for any unused test minutes, so the ledger
 * stays a true record.
 */
import fs from "node:fs";

const mode = process.argv[2];
if (!["setup", "status", "teardown"].includes(mode ?? "")) {
  console.error("Usage: node scripts/owner-voice-test-call.mjs setup|status|teardown");
  process.exit(1);
}

const read = (file) => {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }),
    );
  } catch { return {}; }
};
const env = { ...read(".env"), ...read(".env.local") };

const BUSINESS = "7c7f61e4-ee71-42ef-b81a-2bd31f84a50b"; // the owner's workspace
const GRANT_KEY = "owner-test-call-2026-09-28-grant";
const CLOSE_KEY = "owner-test-call-2026-09-28-close";
const MARK = "OWNER TEST CALL 2026-09-28";
const E164 = env.TWILIO_SMS_FROM;
if (!/^\+44\d{10}$/.test(E164 ?? "")) throw new Error("TWILIO_SMS_FROM is not a UK number.");

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

const STATUS = `
select 'balance' k, coalesce((select row_to_json(m)::text from public.voice_minute_balances m where business_id='${BUSINESS}'), 'none') v
union all select 'number', coalesce((select json_agg(n)::text from (select provisioning_state, e164, messaging_service_sid, last_error from public.business_numbers where business_id='${BUSINESS}') n), 'none')
union all select 'grant', coalesce((select json_agg(g)::text from (select entitlement_key, boolean_value, expires_at, revoked_at, reason from public.business_entitlement_grants where business_id='${BUSINESS}' and entitlement_key='voice_sales_enabled') g), 'none')
union all select 'ledger', coalesce((select json_agg(l)::text from (select kind, pack_delta_sec, idempotency_key from public.voice_minute_ledger where business_id='${BUSINESS}' and idempotency_key like 'owner-test-call-%') l), 'none')`;

if (mode === "setup") {
  await sql(`
with g as (
  insert into public.voice_minute_ledger (business_id, kind, pack_delta_sec, idempotency_key, reason)
  values ('${BUSINESS}', 'ADJUSTMENT', 600, '${GRANT_KEY}', '${MARK}: 10 minutes for the capped test call to the owner')
  on conflict (business_id, idempotency_key) do nothing
  returning pack_delta_sec
)
insert into public.voice_minute_balances (business_id, pack_remaining_sec)
select '${BUSINESS}', pack_delta_sec from g
on conflict (business_id) do update
  set pack_remaining_sec = public.voice_minute_balances.pack_remaining_sec + excluded.pack_remaining_sec;
insert into public.business_entitlement_grants (business_id, entitlement_key, numeric_value, boolean_value, reason, expires_at, revoked_at)
values ('${BUSINESS}', 'voice_sales_enabled', 1, true, '${MARK}: voice switched on for the test call only', now() + interval '24 hours', null)
on conflict (business_id, entitlement_key) do nothing;
insert into public.business_numbers (business_id, provisioning_state, e164, phone_number_sid, capabilities, activated_at, configured_at, last_error)
select '${BUSINESS}', 'ACTIVE', '${E164}', 'PNa77ab9fc453db5c31358ebf05fb71f9e',
       '{"voice": true, "sms": true, "mms": false}'::jsonb, now(), now(), '${MARK}: temporary, remove after the test'
where not exists (
  select 1 from public.business_numbers
  where business_id='${BUSINESS}' and provisioning_state not in ('RELEASED','QUARANTINED'));`);
}

if (mode === "teardown") {
  await sql(`
delete from public.business_numbers
 where business_id='${BUSINESS}' and last_error like '${MARK}%';
update public.business_entitlement_grants set revoked_at = now()
 where business_id='${BUSINESS}' and entitlement_key='voice_sales_enabled' and reason like '${MARK}%' and revoked_at is null;
with b as (select pack_remaining_sec s from public.voice_minute_balances where business_id='${BUSINESS}'),
     left_over as (select least(s, 600) s from b),
     c as (
       insert into public.voice_minute_ledger (business_id, kind, pack_delta_sec, idempotency_key, reason)
       select '${BUSINESS}', 'ADJUSTMENT', -s, '${CLOSE_KEY}', '${MARK}: unused test minutes removed'
       from left_over where s > 0
       on conflict (business_id, idempotency_key) do nothing
       returning pack_delta_sec
     )
update public.voice_minute_balances
   set pack_remaining_sec = pack_remaining_sec + (select coalesce(sum(pack_delta_sec), 0) from c)
 where business_id='${BUSINESS}';`);
}

for (const row of await sql(STATUS)) console.log(`${row.k}: ${row.v}`);
