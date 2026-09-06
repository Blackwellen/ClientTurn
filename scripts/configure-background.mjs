import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const local=parseEnv(readFileSync('.env.local','utf8'));
const shared=parseEnv(readFileSync('.env','utf8'));
const production=parseEnv(readFileSync('.env.vercel-production.local','utf8'));
const ref=local.SUPABASE_PROJECT_REF;
if(ref!=='losieaikadkadtmezini')throw new Error('Unexpected Supabase project');
const token=shared.SUPABASE_PAT;
const secret=production.CRON_SECRET || local.CRON_SECRET;
if(!secret)throw new Error('CRON_SECRET missing from Vercel production');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sql=`do $$ declare item record; begin
 for item in select * from (values ('clientturn_site_url','https://clientturn.com'),('clientturn_cron_secret',${quote(secret)})) as v(name,value) loop
 if exists(select 1 from vault.secrets where name=item.name) then
 perform vault.update_secret((select id from vault.secrets where name=item.name limit 1),item.value);
 else perform vault.create_secret(item.value,item.name); end if;
 end loop; end $$;`;
if(process.argv.includes('--inspect')){
 console.log(JSON.stringify({productionCronConfigured:!!secret,encryptionConfigured:!!production.CREDENTIAL_ENCRYPTION_KEY,googlePlacesConfigured:!!(production.GOOGLE_PLACES_API_KEY||production.GOOGLE_MAPS_API_KEY),apolloConfigured:!!production.APOLLO_API_KEY,hunterConfigured:!!production.HUNTER_API_KEY}));
}else{
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
 if(!response.ok)throw new Error(`Vault setup failed (${response.status}); response withheld to protect secrets.`);
 console.log('Production origin and cron authentication configured in Supabase Vault.');
}
