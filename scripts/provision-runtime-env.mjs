import {readFileSync,appendFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const local=parseEnv(readFileSync('.env.local','utf8'));
const shared=parseEnv(readFileSync('.env','utf8'));
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectId!=='prj_hiI5zNIWJ6bv8PSmZvZiqulxNrOZ')throw new Error('Unexpected Vercel project.');
// Sensitive Vercel values are blank in `env pull`. Check metadata instead:
// treating those blanks as missing would rotate encryption and cron secrets.
const metadata=spawnSync('cmd.exe',['/d','/s','/c',`npx vercel api /v10/projects/${project.projectId}/env --raw`],{encoding:'utf8',windowsHide:true});
if(metadata.status!==0)throw new Error('Could not inspect Vercel environment metadata. No secrets changed.');
const production=JSON.parse(metadata.stdout).envs.filter(item=>item.target.includes('production'));
for(const name of ['CRON_SECRET','CREDENTIAL_ENCRYPTION_KEY']){
 if(production.some(item=>item.key===name)){console.log(`${name}: already configured in production; preserved`);continue;}
 const value=local[name]||shared[name]||randomBytes(32).toString('base64url');
 const result=spawnSync('cmd.exe',['/d','/s','/c',`npx vercel env add ${name} production --yes`],{input:value,encoding:'utf8',windowsHide:true});
 if(result.status!==0){console.error((result.stderr+'\n'+result.stdout).replaceAll(value,'[redacted]'));throw new Error(`Failed to configure ${name}.`);}
 if(!local[name]&&!shared[name])appendFileSync('.env.local',`\n${name}=${value}\n`);
 console.log(`${name}: configured in production`);
}
