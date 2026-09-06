import {readFileSync} from 'node:fs';
for(const f of ['.env','.env.local'])for(const line of readFileSync(f,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);if(m&&/VERCEL|CRON|ENCRYPT|APOLLO|HUNTER|PLACES/.test(m[1]))console.log(`${f}: ${m[1]}`);}
