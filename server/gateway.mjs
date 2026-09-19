import {VERSION} from '../version.js';
import {Desktop} from './desktop.mjs';
import {normalizeIcon,iconPython} from './icons.mjs';
import express from 'express';
import {publicApp,webConfig} from './webapps.mjs';
import {Transport} from './transport.mjs';
import {HealthProbes} from './health.mjs';
import {previewWeb} from './web-browser.mjs';
import {WebSocketServer} from 'ws';
import {Manager} from './streams.mjs';
import {installNative} from './native.mjs';
import {Accounts,token,verify,fail,publicUser} from './accounts.mjs';
import http from 'node:http';
import {mkdir,writeFile,chmod,rm,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const APPS=[
 {id:'parcels',label:'Parcels',mode:'native',description:'Client-side ZIP packing',url:'/native/parcels/'},
 {id:'keepsakes',label:'Keepsakes',mode:'native',description:'Shared admin-only isolated image collection',url:'/native/keepsakes/'},
 {id:'notes-lab',label:'Notes Lab',mode:'stream',description:'Synthetic editable notes'},
 {id:'signal-lab',label:'Signal Lab',mode:'stream',description:'Synthetic live signals'},
];
export async function createGateway({port=4180,runtime=ROOT+'.runtime',native=false,keepsakesPort=4181,data=ROOT+'.data/keepsakes',sessionMs=8*60*60*1000,profile='development',hostname='127.0.0.1'}={}){
 iconPython(); // Validate trusted operator configuration before state or listener creation.
 if(!['127.0.0.1','localhost'].includes(hostname))throw Error('Invalid Relay hostname');
 if(!['development','standalone'].includes(profile))throw Error('Invalid Relay profile');
 if(profile==='standalone'&&native)throw Error('Standalone profile cannot start native integrations');
 await mkdir(runtime,{recursive:true,mode:0o700});await chmod(runtime,0o700);
 const accounts=new Accounts(runtime,profile==='standalone'?[]:APPS);await accounts.init();
 const app=express(),server=http.createServer(app),sessions=new Map();
 let setup=accounts.state.users.length?null:token();const authCsrf=token();
 const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const origin=`http://${hostname}:${server.address().port}`;
 const transport=new Transport({gatewayOrigin:origin});
 // Registration is not a reachability test: client-only DNS and offline apps are valid.
 // Every actual Relay connection still resolves, vets and pins its destination.
 const validateDraft=async body=>{const config=webConfig(body);if(config.mode==='native'&&new URL(config.address).hostname===new URL(origin).hostname)throw fail(400,'Native apps must use a different hostname from Relay; cookies are not port isolated.');transport.registration(config.address,config);for(const extra of config.allowedOrigins)transport.registration(extra,config);return config;};
 // Serialize application writes, including login, and recheck authority when dequeued.
 let writeQueue=Promise.resolve(),queuedWrites=0;
 const wrap=(fn,{queued=true}={})=>async(req,res,next)=>{
  const mutation=queued&&!['GET','HEAD'].includes(req.method);
  if(mutation&&queuedWrites>=32)return res.status(429).json({error:'Busy. Try again shortly.'});
  const run=async()=>{
   if(res.destroyed)return;
   if(req.session){const s=getSession(req);if(!s)throw fail(401,'Authentication required');req.session=s;if(mutation&&req.headers['x-csrf-token']!==s.csrf)throw fail(403,'CSRF required');if(req.path.startsWith('/api/admin')&&(s.user.role!=='admin'||s.user.mustChange))throw fail(403,'Admin access required');}
   await fn(req,res);
  };
  try{if(mutation){queuedWrites++;const job=writeQueue.catch(()=>{}).then(run);writeQueue=job;await job;}else await run();}catch(e){next(e);}finally{if(mutation)queuedWrites--;}
 };
 const revoke=async s=>{if(!s||s.revoked)return;s.revoked=true;sessions.delete(s.id);clearTimeout(s.timer);for(const op of s.operations)op.controller.abort();for(const ws of s.sockets)ws.terminate();for(const res of s.responses)res.destroy();await Promise.allSettled([s.manager.close(),...[...s.operations].map(op=>op.done)]);};
 const getSession=req=>{const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('relay_session='))?.slice(14);const s=sessions.get(id);if(!s)return null;const user=accounts.state.users.find(u=>u.id===s.userId);if(s.expires<=Date.now()||!user||user.disabled){void revoke(s);return null;}s.user=user;return s;};
 const layouts=new Map();
 const login=async(req,res,user)=>{
  await revoke(getSession(req));
  if(sessions.size>=16||[...sessions.values()].filter(s=>s.userId===user.id).length>=4)throw fail(429,'Session limit reached. Sign out of another browser.');
  const id=token(),dir=runtime+'/users/'+user.id;await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
  const manager=new Manager(dir,accounts.apps(user));manager.transport=transport;
  if(!layouts.has(user.id))layouts.set(user.id,{queue:Promise.resolve()});manager.persistence=layouts.get(user.id);
  await manager.init();
  if(accounts.state.users.find(u=>u.id===user.id)!==user)throw fail(401,'Account changed. Sign in again.');
  const counts=()=>{let total=0,own=0;for(const s of sessions.values()){const n=[...s.manager.windows.values()].filter(w=>w.mode==='stream').length;total+=n;if(s.userId===user.id)own+=n;}return {total,own};};
  manager.checkQuota=()=>{const {total,own}=counts();if(total>=8||own>=2)throw fail(429,'Stream limit reached. Close another stream.');};
  const restored=counts();let admitted=0;for(const [key,w] of manager.windows){if(w.mode==='stream'){if(restored.total+admitted>=8||restored.own+admitted>=2)manager.windows.delete(key);else admitted++;}}
  const s={id,userId:user.id,user,csrf:token(),expires:Date.now()+sessionMs,manager,sockets:new Set(),responses:new Set(),operations:new Set()};sessions.set(id,s);
  s.timer=setTimeout(()=>void revoke(s),sessionMs).unref();
  res.cookie('relay_session',id,{httpOnly:true,sameSite:'strict',path:'/',maxAge:sessionMs});res.json({user:publicUser(user)});
 };
 app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.status(403).json({error:'Invalid Host or Origin'});next();});
 app.use('/api',express.json({limit:'16kb'}));
 app.get('/api/auth',(req,res)=>res.json({setup:!!setup,csrf:authCsrf}));
 const authGuard=(req,res,next)=>{if(req.headers.origin!==origin||req.headers['x-csrf-token']!==authCsrf)return res.status(403).json({error:'Origin and CSRF required'});next();};
 app.post('/api/enroll',authGuard,wrap(async(req,res)=>{if(!setup||req.body?.setup!==setup)throw fail(403,'Setup unavailable');const user=await accounts.enroll(req.body.password);setup=null;await rm(runtime+'/setup-url.txt',{force:true});await writeFile(runtime+'/open-url.txt',origin+'/',{mode:0o600});await login(req,res,user);}));
 let failures=0,resetAt=0,authBusy=0;
 app.post('/api/login',authGuard,wrap(async(req,res)=>{
  if(Date.now()>resetAt){failures=0;resetAt=Date.now()+60000;}
  if(failures+authBusy>=5||authBusy>=2){res.set('Retry-After','60');throw fail(429,'Too many attempts. Try again in one minute.');}
  authBusy++;
  try{const user=accounts.state.users.find(u=>u.username===req.body?.username);const valid=await verify(req.body?.password,user?.password||accounts.dummy);if(!user||!valid||user.disabled){failures++;throw fail(401,'Invalid username or password');}if(accounts.state.users.find(u=>u.id===user.id)!==user)throw fail(401,'Account changed. Sign in again.');await login(req,res,user);}finally{authBusy--;}
 }));
 app.get(/^\/desktop(?:\/.*)?$/, (req,res)=>{if(req.originalUrl.length>4096||req.path.split('/').length>131)return res.status(414).json({error:'Desktop path too long'});res.sendFile(ROOT+'dist/index.html');});
 app.use((req,res,next)=>{
  if(req.path==='/'||req.path.startsWith('/assets/')||req.path.startsWith('/fonts/'))return next();
  const s=getSession(req);if(!s)return res.status(401).json({error:'Authentication required'});req.session=s;next();
 });
 app.use('/api',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&(req.headers.origin!==origin||req.headers['x-csrf-token']!==req.session.csrf))return res.status(403).json({error:'Origin and CSRF required'});next();});
 app.get('/api/session',(req,res)=>{const s=req.session;res.json({csrf:s.csrf,user:publicUser(s.user),apps:accounts.apps(s.user).map(publicApp),windows:[...s.manager.windows.values()],limits:{maxStreams:2}});});
 const desktop=new Desktop(runtime,()=>accounts.state.services);
 const desktopAuthority=req=>()=>{const s=getSession(req);if(!s||s!==req.session)throw fail(401,'Authentication required');return accounts.apps(s.user);};
 app.get('/api/desktop',wrap(async(req,res)=>res.json(await desktop.run(req.session.userId,desktopAuthority(req)))));
 app.post('/api/desktop/folders',wrap(async(req,res)=>res.json(await desktop.run(req.session.userId,desktopAuthority(req),(s)=>desktop.folder(s,req.body)))));
 app.patch('/api/desktop/items/:id',wrap(async(req,res)=>res.json(await desktop.run(req.session.userId,desktopAuthority(req),(s,apps)=>desktop.patch(s,apps,req.params.id,req.body)))));
 app.delete('/api/desktop/items/:id',wrap(async(req,res)=>res.json(await desktop.run(req.session.userId,desktopAuthority(req),(s,apps)=>desktop.remove(s,apps,req.params.id)))));
 app.get('/api/desktop/icons/:id',wrap(async(req,res)=>{const bytes=await desktop.readIcon(req.session.userId,desktopAuthority(req),req.params.id);res.set({'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).send(bytes);}));
 const commitIcon=wrap(async(req,res)=>res.json(await desktop.run(req.session.userId,desktopAuthority(req),(s,apps)=>desktop.upload(req.session.userId,s,apps,req.params.id,req.normalizedIcon))));
 app.post('/api/desktop/items/:id/icon',express.raw({type:()=>true,limit:'1mb'}),wrap(async(req,res)=>{
  const authority=desktopAuthority(req),state=await desktop.load(req.session.userId);desktop.item(state,req.params.id,authority());
  req.normalizedIcon=await normalizeIcon(req.body,req.headers['content-type']);authority();await commitIcon(req,res,error=>{throw error;});
 },{queued:false}));
 const revokeUser=async id=>{await Promise.all([...sessions.values()].filter(s=>s.userId===id).map(revoke));};
 app.patch('/api/profile',wrap(async(req,res)=>{const user=await accounts.profile(req.session.userId,req.body||{});if('password' in req.body)await revokeUser(user.id);res.json(user);}));
 app.use('/api/admin',(req,res,next)=>{if(req.session.user.role!=='admin'||req.session.user.mustChange)return res.status(403).json({error:'Admin access required'});next();});
 app.get('/api/admin/users',(req,res)=>res.json(accounts.state.users.map(publicUser)));
 app.post('/api/admin/users',wrap(async(req,res)=>res.json(await accounts.createUser(req.body||{}))));
 app.patch('/api/admin/users/:id',wrap(async(req,res)=>{const user=await accounts.updateUser(req.params.id,req.body||{});await revokeUser(user.id);res.json(user);}));
 app.post('/api/onboarding/app',wrap(async(req,res)=>{
  const user=req.session.user;
  if(user.role!=='admin'||user.mustChange||user.onboardingComplete)throw fail(403,'Pending administrator onboarding required');
  await validateDraft(req.body);
  const service=await accounts.onboardingApp(req.session.userId,req.body);
  for(const s of sessions.values())s.manager.apps=accounts.apps(accounts.state.users.find(u=>u.id===s.userId));
  res.json(service);
 }));
 app.post('/api/onboarding/complete',wrap(async(req,res)=>{
  if(req.session.user.role!=='admin'||req.session.user.mustChange)throw fail(403,'Admin access required');
  if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw fail(400,'Expected empty body');
  res.json(await accounts.completeOnboarding(req.session.userId));
 }));
 app.patch('/api/preferences',wrap(async(req,res)=>res.json(await accounts.preferences(req.session.userId,req.body))));
 app.use((req,res,next)=>{if(/^\/api\/admin\/apps(?=\/|\?|$)/.test(req.url))req.url=req.url.replace('/api/admin/apps','/api/admin/services');next();});
 const networkActive={check:0,preview:0};
 const networkOperation=kind=>wrap(async(req,res)=>{
  const s=req.session,limit=kind==='preview'?1:4;
  if(networkActive[kind]>=limit)throw fail(429,'App '+kind+' busy. Try again shortly.');
  const controller=new AbortController();let finish;
  const op={controller,done:new Promise(resolve=>finish=resolve)};
  s.operations.add(op);networkActive[kind]++;
  const abort=()=>controller.abort();res.once('close',abort);
  try{
   const config=await validateDraft(req.body);controller.signal.throwIfAborted();
   if(kind==='preview'&&config.mode!=='stream')throw fail(400,'Only streamed apps support Relay preview');
   const result=kind==='preview'?await previewWeb(config,transport,controller.signal):await transport.probe(config,{signal:controller.signal});
   if(getSession(req)!==s)throw fail(401,'Authentication required');
   controller.signal.throwIfAborted();res.json(result);
  }catch(e){if(getSession(req)!==s)throw fail(401,'Authentication required');throw e;}
  finally{res.removeListener('close',abort);s.operations.delete(op);networkActive[kind]--;finish();}
 },{queued:false});
 app.post('/api/admin/services/check',networkOperation('check'));
 app.post('/api/admin/services/preview',networkOperation('preview'));
 app.get('/api/admin/services',(req,res)=>res.json(accounts.state.services));
 app.post('/api/admin/services',wrap(async(req,res)=>{if(req.body?.kind==='web')await validateDraft(req.body);const service=await accounts.service(null,req.body||{});for(const s of sessions.values())s.manager.apps=accounts.apps(accounts.state.users.find(u=>u.id===s.userId));res.json(service);}));
 for(const method of ['patch','delete'])app[method]('/api/admin/services/:id',wrap(async(req,res)=>{
  const service=accounts.state.services.find(s=>s.id===req.params.id);
  if(method==='patch'&&service?.kind==='web')await validateDraft({...service,...req.body});
  const affected=[...sessions.values()].filter(s=>s.user.role!=='admin'&&accounts.allowed(accounts.state.users.find(u=>u.id===s.userId),service));
  const result=await accounts.service(req.params.id,req.body||{},method==='delete');
  await Promise.all(affected.map(revoke));
  for(const s of sessions.values()){for(const response of s.responses)if(response.serviceId===req.params.id)response.destroy();s.manager.apps=accounts.apps(accounts.state.users.find(u=>u.id===s.userId));await s.manager.remove(req.params.id);}
  res.json(result);
 }));
 app.get('/api/admin/diagnostics',(req,res)=>res.json({version:VERSION,uptimeSeconds:Math.floor(process.uptime()),sessions:sessions.size,users:accounts.state.users.length,services:accounts.state.services.length,streams:[...sessions.values()].reduce((n,s)=>n+s.manager.resources.size,0),memory:process.memoryUsage(),limits:{sessionsPerUser:4,sessionsGlobal:16,streamsPerUser:2,streamsGlobal:8},externalConnections:'HTTP(S) web apps with approved origins; WebSockets and streamed file transfers unsupported'}));
 app.post('/api/logout',wrap(async(req,res)=>{await revoke(req.session);res.clearCookie('relay_session',{path:'/',httpOnly:true,sameSite:'strict'});res.json({ok:true});}));
 const operation=fn=>wrap(async(req,res)=>{try{res.json(await fn(req,req.session.manager));}catch(e){throw fail(e.status||400,e.status?e.message:'Invalid window operation');}});
 const permit=(req,id)=>{if(!accounts.allowed(req.session.user,accounts.state.services.find(a=>a.id===id)))throw fail(403,'Service access denied');};
 app.post('/api/windows',operation((req,m)=>{permit(req,req.body?.appId);return m.open(req.body.appId);}));
 for(const method of ['patch','delete','post'])app[method]('/api/windows/:id'+(method==='post'?'/reload':''),operation(async(req,m)=>{permit(req,req.params.id);if(method==='patch')return m.patch(req.params.id,req.body||{});if(method==='post')return m.reload(req.params.id);if(!m.windows.has(req.params.id))throw Error();await m.remove(req.params.id);return {closed:true};}));
 let health={checkedAt:0,keepsakes:false,parcels:false},probing;
 const webHealth=new HealthProbes({gatewayOrigin:origin});
 const appHealth=a=>webHealth.probe(a);
 app.get('/api/status',wrap(async(req,res)=>{
  if(Date.now()-health.checkedAt>5000){probing??=(async()=>{let parcels=false;try{await access(ROOT+'integrations/parcels/dist/index.html');parcels=!!nativeService;}catch{}health={checkedAt:Date.now(),parcels,keepsakes:await nativeService?.probe()||false};})().finally(()=>probing=null);await probing;}
  const status={};await Promise.all(accounts.apps(req.session.user).map(async a=>{
   if(a.kind==='web'){status[a.id]=await appHealth(a);return;}
   const r=req.session.manager.resources.get(a.id);
   status[a.id]=a.mode==='native'?{state:health[a.template]?'Online':'Offline',source:'relay',checkedAt:health.checkedAt,detail:'Native runtime readiness'}:{state:r?(r.page.isClosed()||r.failed?'Offline':'Online'):'Unknown',source:'relay',checkedAt:Date.now(),detail:r?'Synthetic browser readiness':'Synthetic template; no running page. Upstream health not measured.'};
  }));res.json(status);
 }));
 app.get('/api/metrics',operation((req,m)=>m.metrics()));
 server.on('upgrade',(req,socket,head)=>{
  const s=getSession(req),match=/^\/ws\/stream\/([a-z0-9-]+)$/.exec(req.url);
  if(req.headers.host!==new URL(origin).host||req.headers.origin!==origin||!s||!match||!accounts.allowed(s.user,accounts.state.services.find(a=>a.id===match[1]))||s.manager.windows.get(match[1])?.mode!=='stream'){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{ws.on('error',()=>{});s.sockets.add(ws);ws.once('close',()=>s.sockets.delete(ws));s.manager.attach(match[1],ws);});
 });
 if(profile==='development')app.use('/native/:service',(req,res,next)=>{const s=req.session;const service=accounts.state.services.find(a=>a.template===req.params.service&&a.mode==='native'&&accounts.allowed(s.user,a));if(!service)return res.status(403).json({error:'Service access denied'});res.serviceId=service.id;s.responses.add(res);res.once('close',()=>s.responses.delete(res));next();});
 let nativeService;
 try{if(native)nativeService=await installNative(app,{root:ROOT,origin,port:keepsakesPort,data});}catch(e){await new Promise(r=>server.close(r));throw e;}
 app.use(express.static(ROOT+'dist',{index:'index.html'}));app.use((req,res)=>res.status(404).json({error:'Not found'}));
 app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.status?err.message:'Request rejected'}));
 await rm(runtime+'/bootstrap-url.txt',{force:true});
 if(setup){await writeFile(runtime+'/setup-url.txt',origin+'/#'+setup,{mode:0o600});await chmod(runtime+'/setup-url.txt',0o600);}
 await writeFile(runtime+'/open-url.txt',origin+'/',{mode:0o600});await chmod(runtime+'/open-url.txt',0o600);
 return {origin,app,server,accounts,sessions,get manager(){return [...sessions.values()][0]?.manager;},nativeService,authorized:req=>!!getSession(req),close:async()=>{await webHealth.close();await transport.close();for(const s of [...sessions.values()])await revoke(s);await nativeService?.close();await new Promise(r=>server.close(r));}};
}
