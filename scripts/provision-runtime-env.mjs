import {readFileSync,appendFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const local=parseEnv(readFileSync('.env.local','utf8'));
const production=parseEnv(readFileSync('.env.vercel-production.local','utf8'));
for(const name of ['CRON_SECRET','CREDENTIAL_ENCRYPTION_KEY']){
 if(production[name]){console.log(`${name}: already configured in production`);continue;}
 const value=local[name]||randomBytes(32).toString('base64url');
 const operation=Object.hasOwn(production,name)?'update':'add';
 const result=spawnSync('cmd.exe',['/d','/s','/c',`npx vercel env ${operation} ${name} production --yes`],{input:value,encoding:'utf8',windowsHide:true});
 if(result.status!==0){console.error((result.stderr+'\n'+result.stdout).replaceAll(value,'[redacted]'));throw new Error(`Failed to configure ${name}.`);}
 if(!local[name])appendFileSync('.env.local',`\n${name}=${value}\n`);
 console.log(`${name}: configured in production`);
}
