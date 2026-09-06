import { mkdirSync,writeFileSync } from 'node:fs';
const brands={pipedrive:'pipedrive.com',instantly:'instantly.ai',clay:'clay.com',folk:'folk.app',smartlead:'smartlead.ai',breakcold:'breakcold.com',zapier:'zapier.com',heyreach:'heyreach.io',smartreach:'smartreach.io',attio:'attio.com'};
mkdirSync('public/brands/apps',{recursive:true});
for(const [id,domain] of Object.entries(brands)){const r=await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);if(!r.ok)throw new Error(`${id}: ${r.status}`);writeFileSync(`public/brands/apps/${id}.png`,Buffer.from(await r.arrayBuffer()));console.log(`${id} mark saved`);}
writeFileSync('public/brands/apps/README.md','# App marks\n\nSite favicons retrieved through Google’s favicon cache for the official provider domains listed in src/lib/integrations/apps.ts. Marks remain the property of their respective owners and identify the integration only. Webhooks uses a generic protocol icon.\n');
