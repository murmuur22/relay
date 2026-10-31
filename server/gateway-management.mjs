import {gatewayHTTPSOrigin} from './experimental-gateway-domains.mjs';
import {isCockpitTarget} from './gateway-service-profiles.mjs';
import {targetCheck} from './gateway-target-check.mjs';
import {caddySnippet} from './gateway-caddy.mjs';
import {open,rm,lstat} from 'node:fs/promises';
import {renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {protectedRead,validateGatewayReference,loadGatewayConfig} from './experimental-gateway-config.mjs';
import {verify,fail} from './accounts.mjs';
const notes=['DNS, browser trust and public reachability are not verified. Certificates and DNS must be provisioned externally. Keep the private management URL for updater access.'];
export async function gatewayStartup(runtime,operatorPath,programmatic){
 if(operatorPath!==undefined)return {source:'operator',settings:await loadGatewayConfig(operatorPath),reference:null};
 if(programmatic!==undefined)return {source:'operator',settings:programmatic,reference:null};
 const path=resolve(runtime,'gateway-managed.json');
 try{await lstat(path);}catch(e){if(e.code==='ENOENT')return {source:'disabled',reference:null};throw Error('Invalid managed gateway configuration');}
 try{
  const reference=JSON.parse(await protectedRead(path,16384));
  if(reference?.version===1&&reference.enabled===false&&Object.keys(reference).length===2)return {source:'disabled',reference:null};
  return {source:'managed',reference,settings:await validateGatewayReference(reference)};
 }catch{throw Error('Invalid managed gateway configuration');}
}
export function gatewayManagementRoutes(app,{runtime,startup,getEdge,setEdge,startEdge,wrap,getSession,admit,accounts,sessions,managementPort,updaterPort,hostname,onChange=()=>{}}){
 let reference=startup.reference,settings=startup.settings,source=startup.source,busy=false,failures=0,resetAt=0;
 const status=()=>{const edge=getEdge();return {source,enabled:!!edge,desktopOrigin:edge?.desktopOrigin??null,appBaseDomain:edge?.available().appBaseDomain??null,config:source==='managed'?structuredClone(reference):null,limits:{maxTargets:8},...(edge?{notes}: {})};};
 const authority=req=>{admit();const s=getSession(req);if(!s||s!==req.session||s.user.role!=='admin'||s.user.mustChange)throw fail(403,'Active administrator required');return s;};
 const writable=()=>{if(source==='operator')throw fail(409,'Gateway is operator-owned and read-only.');};
 const unchanged=req=>{if(Object.hasOwn(req.body??{},'baseConfig')&&JSON.stringify(req.body.baseConfig)!==JSON.stringify(reference))throw fail(409,'Gateway configuration changed. Refresh status and review the newer configuration before retrying.');};
 let checks=0,checkReset=0;
 app.post('/api/admin/gateway/check-target',wrap(async(req,res)=>{
  const session=authority(req);writable();unchanged(req);
  if(source!=='managed'||!getEdge())throw fail(409,'Configure the Gateway listener first.');
  if(!Object.hasOwn(req.body??{},'baseConfig'))throw fail(400,'Current configuration required.');
  if(busy)throw fail(429,'Gateway management busy.');
  if(Date.now()>checkReset){checks=0;checkReset=Date.now()+60000;}
  if(checks>=5)throw fail(429,'Check limit reached. Try again in one minute.');checks++;busy=true;
  const controller=new AbortController();let finish;
  const op={controller,done:new Promise(resolve=>finish=resolve)};session.operations.add(op);
  const cancel=()=>controller.abort(fail(403,'Check cancelled.'));res.once('close',cancel);
  const authorize=()=>{authority(req);unchanged(req);if(controller.signal.aborted||res.destroyed)throw fail(403,'Check cancelled.');};
  try{
   await confirmed(req);authorize();
   const raw=req.body.config?.targets?.find(t=>t.id===req.body.targetId);
   if(req.body.profileVersion!==1||!isCockpitTarget(raw))throw fail(400,'Expected the bounded Cockpit v1 profile and a fixed private destination.');
   const config=await validate(req.body.config);authorize();
   const target=config.targets.find(t=>t.id===raw.id);
   const result=await targetCheck(target,{signal:controller.signal,authorize,identity:JSON.stringify(req.body.config)});authorize();res.json(result);
  }finally{res.off('close',cancel);controller.abort();session.operations.delete(op);busy=false;finish();}
 },{queued:false}));
 const validate=async value=>{
  if(Buffer.byteLength(JSON.stringify(value)??'')>16384)throw fail(413,'Gateway configuration exceeds 16 KiB');
  let config;try{config=await validateGatewayReference(value);}catch{throw fail(400,'Invalid gateway configuration. Check protected certificate/key files, certificate names, complete backend chain and validity, listener and target settings.');}
  if(config.port===managementPort||config.port===updaterPort)throw fail(409,'Gateway port conflicts with management or updater.');
  const hosts=new Set([hostname,config.deployment.desktopHostname]);
  if(accounts.state.services.some(a=>a.kind==='web'&&a.mode==='native'&&hosts.has(new URL(a.address).hostname)))throw fail(409,'A Native app shares a Relay cookie hostname. Change or remove that app first.');
  return config;
 };
 const confirmed=async req=>{
  const s=authority(req),user=s.user;
  if(Date.now()>resetAt){resetAt=Date.now()+60000;failures=0;}
  if(failures>=5)throw fail(429,'Too many password attempts. Try again in one minute.');
  const valid=await verify(req.body?.password,user.password);authority(req);
  if(s.user!==user)throw fail(403,'Administrator changed. Try again.');
  if(!valid){failures++;throw fail(403,'Current password required.');}
 };
 app.get('/api/admin/gateway',wrap(async(req,res)=>{authority(req);res.json(status());}));
 app.post('/api/admin/gateway/validate',wrap(async(req,res)=>{
  authority(req);writable();if(busy)throw fail(429,'Gateway management busy.');busy=true;
  try{const config=await validate(req.body?.config);authority(req);res.json({valid:true,desktopOrigin:config.proxy?.desktopOrigin??gatewayHTTPSOrigin(config.deployment.desktopHostname,config.port),caddySnippet:caddySnippet(config),notes});}finally{busy=false;}
 },{queued:false}));
 const replace=async(nextReference,authorize,actor)=>{
  authorize();writable();if(busy)throw fail(429,'Gateway management busy.');busy=true;
  let temp,next,old,stopped=false,committed=false,earlyCleanup=[];
  try{
   const config=nextReference?await validate(nextReference):null;authorize();
   // Listener provisioning is shared with browser management, not duplicated by agents.
   // Stage and fsync protected bytes before touching a working listener.
   temp=resolve(runtime,'.gateway-managed-'+randomUUID()+'.tmp');
   const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(nextReference??{version:1,enabled:false})+'\n');await f.sync();}finally{await f.close();}
   authorize();old=getEdge();
   const samePort=old&&config&&settings.port===config.port;
   if(samePort){
    setEdge(undefined);stopped=true;
    const cleanup=[old.close({preserveManagement:true})];
    for(const s of sessions.values())for(const w of [...s.manager.windows.values()])if(w.mode==='gateway')cleanup.push(s.manager.remove(w.id));
    earlyCleanup=await Promise.allSettled(cleanup);
    authorize();
   }
   if(config){next=await startEdge(config);authorize();}
   // No await between final authority check, atomic commit and published state.
   authorize();renameSync(temp,resolve(runtime,'gateway-managed.json'));temp=null;
   reference=nextReference;settings=config;source=config?'managed':'disabled';committed=true;onChange(actor);
   // Deny new launches until every old gateway window is retired; a stale
   // window must not mint a route against the replacement configuration.
   setEdge(undefined);
   // remove() deletes in-memory authority synchronously before its cleanup/persist
   // awaits. Start every removal before waiting, and settle all cleanup even if
   // one user's layout cannot be saved. Never skip later windows or sessions.
   const cleanup=[];
   for(const s of sessions.values())for(const w of [...s.manager.windows.values()])if(w.mode==='gateway')cleanup.push(s.manager.remove(w.id));
   if(old&&!stopped)cleanup.push(old.close({preserveManagement:true}));
   const results=await Promise.allSettled(cleanup);
   if([...earlyCleanup,...results].some(result=>result.status==='rejected'))throw Error('Gateway retirement cleanup failed');
   setEdge(next);
   authorize(true);return status();
  }catch(e){
   if(committed){setEdge(next);throw e.status?e:fail(503,'Gateway configuration applied and old app windows retired, but cleanup could not be fully saved. Check protected layout storage.');}
   if(next&&getEdge()!==next)await next.close({preserveManagement:true});
   if(stopped&&!committed){try{setEdge(await startEdge(settings));}catch{setEdge(undefined);throw fail(503,'Gateway change failed and previous listener could not be restored. Restart using private management.');}}
   throw e.status?e:fail(503,'Gateway change failed. Previous configuration retained; check listener availability and protected storage.');
  }finally{if(temp)await rm(temp,{force:true});busy=false;}
 };
 for(const method of ['put','delete'])app[method]('/api/admin/gateway',wrap(async(req,res)=>{
  authority(req);writable();unchanged(req);
  await confirmed(req);unchanged(req);
  if(method==='put'&&!req.body?.config)throw fail(400,'Gateway configuration required');
  res.json(await replace(method==='put'?structuredClone(req.body.config):null,committed=>{authority(req);if(!committed)unchanged(req);},req.session.userId));
 }));
 const targetReference=change=>{
  writable();if(source!=='managed'||!getEdge())throw fail(409,'Configure the managed Gateway listener first');
  const config=structuredClone(reference),existing=config.targets.find(t=>t.id===change.id);
  if(existing)Object.assign(existing,change.set);else config.targets.push({id:change.id,...change.set});
  return config;
 };
 return {status,async previewTarget(change,authorize){const config=targetReference(change);await validate(config);authorize();return config.targets.find(t=>t.id===change.id);},async changeTarget(change,authorize,actor){return replace(targetReference(change),authorize,actor);}};
}
