import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createUpdaterWeb} from './server.mjs';
// No Relay state or bridge key is accepted here. Use a distinct unprivileged UID.
if(process.getuid?.()===0)throw Error('Updater web must not run as root');
let config;
if(process.argv.length===4&&process.argv[2]==='--config'){
 if(!isAbsolute(process.argv[3]))throw Error('Absolute updater web config path required');
 config=JSON.parse(await readFile(process.argv[3],'utf8'));
}else if(process.argv.length===2){config={uiOrigin:process.env.RELAY_UPDATER_UI_ORIGIN,relayOrigin:process.env.RELAY_UPDATER_RELAY_ORIGIN,socketPath:process.env.RELAY_UPDATER_SOCKET,bind:'127.0.0.1'};}else throw Error('Usage: node updater/web/index.mjs [--config /absolute/web.json]');
if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['uiOrigin','relayOrigin','socketPath','bind','staticDir'].includes(k)))throw Error('Invalid updater web configuration fields');
const web=await createUpdaterWeb(config);
console.log('Unprivileged updater web listening on configured loopback origin.');
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await web.close();process.exit(0);});
