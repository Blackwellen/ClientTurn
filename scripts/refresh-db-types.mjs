import { readFileSync,writeFileSync } from 'node:fs';
function env(file,key){const line=readFileSync(file,'utf8').split(/\r?\n/).find(l=>l.startsWith(key+'='));return line?.slice(key.length+1).replace(/^["']|["']$/g,'').trim();}
const token=env('.env','SUPABASE_PAT');const ref=env('.env.local','SUPABASE_PROJECT_REF');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/types/typescript?included_schemas=public`,{headers:{Authorization:`Bearer ${token}`}});
if(!response.ok)throw new Error(`Type generation failed: ${response.status}`);
const data=await response.json();if(!data.types)throw new Error('No types returned');writeFileSync('src/lib/supabase/database.types.ts',data.types);console.log('Database types refreshed.');
