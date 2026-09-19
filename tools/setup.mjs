import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const [command,args,cwd] of [
 ['uv',['sync','--frozen','--project',root+'integrations/keepsakes','--python','3.11'],root],
 ['npm',['ci','--ignore-scripts'],root+'integrations/parcels'],
 ['npm',['run','build'],root+'integrations/parcels'],
 ['npx',['playwright','install','chromium'],root]
]){
 const result=spawnSync(command,args,{cwd,stdio:'inherit'});
 if(result.error||result.status!==0){console.error('Setup failed for',command);process.exit(result.status||1);}
}
console.log('Local integration dependencies prepared. Build Relay, then start the gateway.');
