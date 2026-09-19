import {isAbsolute} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
import {brokerRequest,loopbackOrigin,capability,actionFields} from '../updater/web/broker-client.mjs';
import {fail,verify} from './accounts.mjs';
import {systemApps} from './system-apps.mjs';
import {VERSION} from '../version.js';
export function updaterConfig(value={socketPath:process.env.RELAY_UPDATER_SOCKET,keyFile:process.env.RELAY_UPDATER_BRIDGE_KEY_FILE,uiOrigin:process.env.RELAY_UPDATER_UI_ORIGIN},hostname='127.0.0.1',networkMode='loopback'){
 if(!value||!Object.values(value).some(v=>v!==undefined))return null;
 if(typeof value.socketPath!=='string'||!isAbsolute(value.socketPath)||typeof value.keyFile!=='string'||!isAbsolute(value.keyFile)||!value.uiOrigin||Object.keys(value).some(k=>!['socketPath','keyFile','uiOrigin'].includes(k)))throw Error('Invalid updater configuration: all three settings required');
 const url=loopbackOrigin(value.uiOrigin,networkMode);if(url.hostname!==hostname)throw Error('Invalid updater configuration: same hostname required');return {...value};
}
async function issue(config,action,params){
 if(!config)throw fail(503,'Updater unavailable: not configured.');
 let handle;
 try{handle=await open(config.keyFile,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size<32||stat.size>4096||(stat.mode&7))throw Error();const key=await handle.readFile();const timestamp=Math.floor(Date.now()/1000),nonce=randomBytes(16).toString('hex'),payload=Buffer.from(JSON.stringify(params)).toString('base64');const mac=createHmac('sha256',key).update(`${timestamp}\n${nonce}\n${action}\n${payload}`).digest('hex');key.fill(0);return await brokerRequest(config.socketPath,{action,timestamp,nonce,payload,mac});}
 catch{throw fail(503,'Updater broker unavailable or issuance rejected.');}finally{await handle?.close();}
}
export function updaterRoutes(app,{config,wrap,getSession,admit}){
 let failures=0,resetAt=0,authBusy=0,launchBusy=0;const recent=[];
 const authority=req=>{admit();const s=getSession(req);if(!s||s!==req.session)throw fail(401,'Authentication required');if(!systemApps(s.user).length)throw fail(403,'Admin access required');return s;};
 const monitors=new WeakMap(),readRates=new WeakMap();let readBusy=0;
 const read=action=>wrap(async(req,res)=>{
  const s=authority(req);if(!config)throw fail(503,'Updater unavailable: not configured.');
  let rate=readRates.get(s);if(!rate||rate.until<=Date.now()){rate={until:Date.now()+60000,state:0,check:0};readRates.set(s,rate);}
  if(++rate[action]>(action==='check'?20:120))throw fail(429,'Updater read rate limited');
  if(readBusy>=4)throw fail(429,'Updater reads busy');readBusy++;
  try{
   let cached=monitors.get(s);
   if(!cached||cached.until<=Date.now()){
    const promise=(async()=>{const issued=await issue(config,'issue-ui',{userId:s.userId,interfaceAnimations:s.user.preferences.interfaceAnimations,relayVersion:VERSION});authority(req);if(!capability(issued.ticket))throw fail(503,'Invalid updater ticket');const result=await brokerRequest(config.socketPath,{action:'redeem-ui',params:{ticket:issued.ticket,origin:config.uiOrigin}});authority(req);if(!capability(result.token)||result.userId!==s.userId)throw fail(503,'Invalid updater monitor');return result.token;})();
    cached={promise,until:Date.now()+7*3600000};monitors.set(s,cached);
   }
   const token=await cached.promise;authority(req);
   const result=await brokerRequest(config.socketPath,{action,params:{token}});authority(req);
   res.set('Cache-Control','no-store').json(result);
  }catch(error){monitors.delete(s);throw error;}finally{readBusy--;}
 },{queued:false});
 app.get('/api/updater/state',read('state'));
 app.post('/api/updater/check',read('check'));
 app.post('/api/updater/launch',wrap(async(req,res)=>{
  const s=authority(req);while(recent.length&&recent[0]<Date.now()-60000)recent.shift();if(recent.length>=20||launchBusy>=2)throw fail(429,'Updater launch rate limited');recent.push(Date.now());launchBusy++;
  try{const result=await issue(config,'issue-ui',{userId:s.userId,interfaceAnimations:s.user.preferences.interfaceAnimations,relayVersion:VERSION});authority(req);if(!capability(result.ticket))throw fail(503,'Invalid updater launch response');res.json({url:config.uiOrigin+'/updater/#'+result.ticket});}finally{launchBusy--;}
 },{queued:false}));
 app.post('/api/updater/authorize',wrap(async(req,res)=>{
  const s=authority(req),fields=actionFields(req.body);if(Date.now()>resetAt){failures=0;resetAt=Date.now()+60000;}if(failures+authBusy>=5||authBusy>=2){res.set('Retry-After','60');throw fail(429,'Too many attempts. Try again in one minute.');}
  authBusy++;
  try{const user=s.user,valid=await verify(req.body.password,user.password);req.body.password='';authority(req);if(s.user!==user)throw fail(401,'Account changed. Sign in again.');if(!valid){failures++;throw fail(403,'Current password is incorrect');}
   const result=await issue(config,'issue-action',{userId:s.userId,...fields});authority(req);if(s.user!==user)throw fail(401,'Account changed. Sign in again.');if(!capability(result.authorization))throw fail(503,'Invalid updater authorization response');res.json({authorization:result.authorization,expiresAt:result.expiresAt});
  }finally{req.body.password='';authBusy--;}
 },{queued:false}));
}
