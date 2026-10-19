import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {access,readFile,realpath,readdir,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,webkit,expect} from '@playwright/test';
import {createGateway,ROOT} from '../../server/gateway.mjs';
// Reproducible RED against the actual pre-delivery HEAD web module, without
// editing the independently owned reader/server. Only resolve its existing
// relative import; production module logic and auth are not mocked or rewritten.
async function webFactory(){
 if(process.env.RELAY_PRESENTATION_RED_BASELINE==='1'){
  const source=execFileSync('git',['show','HEAD:updater/web/server.mjs'],{cwd:ROOT,encoding:'utf8'}).replace("from './broker-client.mjs'",`from '${new URL('../../updater/web/broker-client.mjs',import.meta.url).href}'`);
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).createUpdaterWeb;
 }
 return (await import('../../updater/web/server.mjs')).createUpdaterWeb;
}
import {authenticate,browserLogin,password} from '../auth-helper.mjs';

// Real compiled browser + HTTP + disposable HMAC broker/service, not production,
// not public signing, and not a real release. Complete source presentation is
// copied/rebased to synthetic v0.3.0/1/2 and rehashed by the test-only helper.
const scratch=await realpath(process.env.RELAY_PRESENTATION_EVIDENCE_DIR || process.env.TMPDIR || ROOT);
const presentation=ROOT+'/updater/ui/presentation-dist';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
const oldArchive=process.env.RELAY_PRESENTATION_OLD_UPDATER_ARCHIVE;
// Current staged-engine and genuine old-engine compatibility are distinct tiers.
// No implicit scratch discovery, candidate-as-old reference, or staged old-engine claim.
async function fixture(t,engine=chromium,{old=Boolean(oldArchive),legacyUI=false}={}){
 await access(presentation+'/presentation.json'); // Parent must complete actual build first.
 const uiOrigin=`http://127.0.0.1:${await freePort()}`;
 const args=['-u','tests/helpers/updater-runtime-presentation.py','--presentation',presentation,'--ui-origin',uiOrigin];
 if(old){
  assert.ok(oldArchive,'Old tier requires an explicit verified archive');
  assert.ok(process.env.RELAY_PRESENTATION_OLD_SOURCE,'Old tier requires trusted old source');
  assert.ok(process.env.RELAY_PRESENTATION_OLD_MANIFEST,'Old tier requires already-attested manifest');
  args.push('--old-archive',oldArchive,'--old-source',process.env.RELAY_PRESENTATION_OLD_SOURCE,'--old-manifest',process.env.RELAY_PRESENTATION_OLD_MANIFEST);
 }
 const child=spawn('python3',args,{cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},stdio:['pipe','pipe','pipe']});
 let output='',errors='',gateway,web,browser;
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 t.after(async()=>{await browser?.close();await web?.close();await gateway?.close();child.stdin.end('\n');if(child.exitCode===null){const timer=setTimeout(()=>child.kill('SIGKILL'),22000);await once(child,'exit');clearTimeout(timer);}assert.equal(child.exitCode,0,errors);});
 await expect.poll(()=>{if(child.exitCode!==null)throw Error(errors);return output.includes('\n');},{timeout:15000}).toBe(true);
 const info=JSON.parse(output.split('\n')[0]);
 const options={port:await freePort(),runtime:info.root+'/presentation-relay',profile:'standalone',updater:{socketPath:info.config.socketPath,keyFile:info.config.bridgeKeyFile,uiOrigin},maintenanceFile:info.config.maintenance};
 gateway=await createGateway(options);
 const createUpdaterWeb=await webFactory();
 web=await createUpdaterWeb({uiOrigin,relayOrigin:gateway.origin,socketPath:info.config.socketPath,staticDir:legacyUI?info.oldUIDir:ROOT+'/updater/ui/dist',...(!legacyUI?{presentationFixture:{installRoot:info.config.installRoot,ownerUid:process.getuid()}}:{})});
 browser=await engine.launch({headless:true,...(engine===chromium?{chromiumSandbox:true}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),desktop=await context.newPage();
 context.setDefaultTimeout(10000);await browserLogin(desktop,gateway.origin,options.runtime);
 if(old){
  assert.equal(Object.keys(info.oldBrokerHashes).length,7);
  assert.deepEqual(Object.fromEntries(Object.entries(info.oldBrokerImports).map(([name,value])=>[name,value.sha256])),info.oldBrokerHashes);
 }
 t.diagnostic(JSON.stringify({tier:info.tier,ui:legacyUI?'genuine archived v0.6.4 static UI':'new candidate presentation UI',oldBrokerImports:info.oldBrokerImports}));
 return {info,options,web,browser,context,desktop,uiOrigin,get gateway(){return gateway;},async stopRelay(){await gateway.close();gateway=null;},async restartRelay(){gateway=await createGateway(options);}};
}
async function selectedIndex(f,version){
 const response=await fetch(f.uiOrigin+'/updater/');assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());
 const release=await realpath(f.info.config.installRoot+'/current');
 assert.deepEqual(bytes,await readFile(release+'/updater-presentation/index.html'),'Runtime presentation must be selected, not silently replaced by fallback');
 assert.equal(response.headers.get('x-relay-updater-presentation'),version);
 return release;
}
async function verifyFiles(f,release,version){
 const descriptor=JSON.parse(await readFile(release+'/updater-presentation/presentation.json','utf8'));
 assert.equal(descriptor.version,version);assert.equal(descriptor.webApi,1);assert.equal(descriptor.schema,1);
 for(const entry of descriptor.files){
  const response=await fetch(`${f.uiOrigin}/updater/presentation/${version}/${entry.path}`);
  assert.equal(response.status,200,entry.path);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,entry.size,entry.path);assert.equal(sha(bytes),entry.sha256,entry.path);
  assert.deepEqual(bytes,await readFile(release+'/updater-presentation/'+entry.path),entry.path);
  if(entry.path.startsWith('licenses/'))assert.deepEqual(bytes,await readFile(presentation+'/'+entry.path),'Original notice bytes must not be rebased');
  if(entry.path.endsWith('.woff2'))assert.match(response.headers.get('content-type'),/^font\/woff2/);
 }
 return descriptor;
}
async function fonts(page){
 const loaded=await page.evaluate(async()=>{const groups=await Promise.all([document.fonts.load('700 20px "Relay Pixel"'),document.fonts.load('400 20px "Relay Mono"')]);await document.fonts.ready;return {checks:[document.fonts.check('700 20px "Relay Pixel"'),document.fonts.check('400 20px "Relay Mono"')],faces:groups.map(faces=>faces.map(face=>({family:face.family,status:face.status})))};});
 assert.deepEqual(loaded.checks,[true,true]);assert.deepEqual(loaded.faces,[[{family:'Relay Pixel',status:'loaded'}],[{family:'Relay Mono',status:'loaded'}]],'Actual bundled FontFace objects must load, not merely a fallback family');
}

test('compiled runtime presentation is selected with genuine standalone one-use Relay launch, exact fonts and original licenses',{timeout:65000},async t=>{
 const f=await fixture(t);
 const release=await selectedIndex(f,'v0.3.0');await verifyFiles(f,release,'v0.3.0');
 await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
 let page;
 if(oldArchive){
  await expect(f.desktop.getByRole('button',{name:'Start update',exact:true})).toBeDisabled();
  page=await standalone(f);
  t.diagnostic('Old engine: native staged launch is disabled; explicit operator/test standalone launcher exercises new-presentation monitoring. The in-app recovery button is not reachable before a monitor exists.');
 }else{
  await f.desktop.getByRole('button',{name:'Start update',exact:true}).click();
  const frame=f.desktop.frameLocator('iframe[title="Independent Relay updater"]');await expect(frame.locator('#console')).toBeVisible();
  assert.equal(f.context.pages().length,1);await fonts(await (await f.desktop.locator('iframe[title="Independent Relay updater"]').elementHandle()).contentFrame());
  const opened=f.context.waitForEvent('page');await f.desktop.getByRole('button',{name:'Standalone recovery (new tab)',exact:true}).click();page=await opened;
 }
 const requests=[];page.on('response',r=>{if(r.url().endsWith('.woff2'))requests.push(r);});
 await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');assert.equal(await page.evaluate(()=>opener),null);assert.equal(await page.evaluate(()=>location.hash),'');await fonts(page);
 await page.reload();await expect(page.locator('#console')).toBeVisible();await fonts(page);assert.equal(requests.length>=2,true,'Actual browser font HTTP responses required');for(const r of requests)assert.equal(r.status(),200);
 const issue=()=>f.desktop.evaluate(async()=>{const s=await(await fetch('/api/session')).json();return(await fetch('/api/updater/launch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:'{}'})).json();});
 const launched=await issue(),ticket=new URL(launched.url).hash.slice(1);
 const exchange=()=>f.context.request.post(f.uiOrigin+'/updater/api/exchange',{headers:{Origin:f.uiOrigin},data:{ticket}});
 assert.equal((await fetch(f.uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:f.uiOrigin,'Content-Type':'application/json'},body:JSON.stringify({ticket})})).status,401,'Genuine ticket without original Relay cookie cannot redeem');
 assert.equal((await f.context.request.post(f.uiOrigin+'/updater/api/exchange',{headers:{Origin:'http://evil.test'},data:{ticket}})).status(),403);
 assert.equal((await exchange()).status(),200);assert.equal((await exchange()).status(),403,'Consumed genuine one-use ticket must be denied');
 const created=await f.desktop.evaluate(async password=>{const s=await(await fetch('/api/session')).json();return(await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({username:'presentation-other',password,role:'admin',grants:[]})})).status;},password);assert.equal(created,200);
 const other=await authenticate(f.gateway.origin,f.options.runtime,'presentation-other');
 const wrongTicket=new URL((await issue()).url).hash.slice(1);
 const wrong=await fetch(f.uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:f.uiOrigin,'Content-Type':'application/json',Cookie:other.cookie},body:JSON.stringify({ticket:wrongTicket})});
 assert.equal(wrong.status,401,'Another genuine administrator cannot redeem original-owner ticket');assert.equal(wrong.headers.get('set-cookie'),null);
 assert.equal((await f.context.request.post(f.uiOrigin+'/updater/api/exchange',{headers:{Origin:f.uiOrigin},data:{ticket:wrongTicket}})).status(),403,'Denied wrong-owner redemption still consumes ticket');
});

// Explicit test/operator standalone route, not a claim that a recovery button is
// reachable before an embedded monitor exists. Exercise the unchanged production
// launcher and real authenticated one-use issuance, never an API response mock.
async function standalone(f){
 await f.desktop.addScriptTag({content:(await readFile(ROOT+'/src/updater.js','utf8')).replaceAll('export ','')});
 const opened=f.context.waitForEvent('page');
 await f.desktop.evaluate(()=>launchUpdater(async()=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api/updater/launch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:'{}'});if(!r.ok)throw Error('Standalone issuance rejected: '+r.status);return r.json();},()=>true,window));
 return opened;
}
async function install(app,version){
 await app.locator('#release-select').selectOption(version);
 await app.getByRole('button',{name:'Download & prepare',exact:true}).click();
 await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(password);await app.getByRole('button',{name:'Authorize preparation',exact:true}).click();await expect(app.locator('#phase')).toHaveText('Ready to apply',{timeout:30000});
 await app.getByRole('button',{name:'Apply '+version,exact:true}).click();await expect(app.locator('#password')).toHaveValue('');await expect(app.locator('#confirmed')).not.toBeChecked();await expect(app.locator('#authorize')).toBeDisabled();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(password);await app.getByRole('button',{name:'Authorize Apply',exact:true}).click();
}

test('current staged-engine tier: already loaded native monitor survives actual HMAC apply and readiness rollback; full candidate pin serves delayed Three/font bytes after deletion without web or broker restart',{timeout:120000},async t=>{
 const f=await fixture(t,chromium,{old:false}),webIdentity=f.web.server,brokerPid=f.info.brokerPid;
 assert.deepEqual(f.info.oldBrokerHashes,{},'This tier qualifies changed candidate core, not unchanged old Engine');
 let installs=0;f.context.on('request',r=>{if(new URL(r.url()).pathname==='/updater/api/apply')installs++;assert.notEqual(new URL(r.url()).pathname,'/updater/api/install','No immediate-install fallback');});
 await selectedIndex(f,'v0.3.0');
 await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();await f.desktop.getByRole('button',{name:'Start update',exact:true}).click();
 const iframe=f.desktop.locator('iframe[title="Independent Relay updater"]'),app=f.desktop.frameLocator('iframe[title="Independent Relay updater"]');
 await expect(app.locator('#console')).toBeVisible();const frameIdentity=await iframe.elementHandle();
 await install(app,'v0.3.1');await expect(app.locator('#phase')).toHaveText('Installed',{timeout:30000});await expect(app.locator('#current-version')).toHaveText('v0.3.1');
 const goodRelease=await selectedIndex(f,'v0.3.1');await verifyFiles(f,goodRelease,'v0.3.1');
 await f.stopRelay();await expect(app.locator('#connection')).toHaveText('Connected to updater');
 await verifyFiles(f,goodRelease,'v0.3.1'); // Independent HTTP bytes while the genuine Relay listener is STOPPED.
 await app.getByRole('button',{name:'Sign in to Relay',exact:true}).click();await expect(f.desktop.getByLabel('username',{exact:true})).toBeVisible();
 await f.restartRelay();await f.desktop.getByRole('button',{name:'Retry Relay connection',exact:true}).click();
 await f.desktop.getByLabel('username',{exact:true}).fill('admin');await f.desktop.getByLabel('password',{exact:true}).fill(password);await f.desktop.getByRole('button',{name:'Enter →',exact:true}).click();
 await expect(iframe).toBeVisible();assert.equal(await iframe.evaluate((el,old)=>el===old,frameIdentity),true);assert.equal(installs,1,'Explicit reconnect never retries accepted mutation');
 let releaseDelayed;const gate=new Promise(r=>releaseDelayed=r),held=[],received=[];
 await f.context.route('**/updater/presentation/v0.3.2/assets/**',async route=>{
  if(/\/(?:chamber-[^/]+\.js|[^/]+\.woff2)$/.test(new URL(route.request().url()).pathname)){held.push(route.request().url());await gate;}
  await route.continue();
 });
 t.after(()=>releaseDelayed());
 await install(app,'v0.3.2');
 await expect.poll(async()=>{try{return (await realpath(f.info.config.installRoot+'/current')).split('/').pop().startsWith('v0.3.2-');}catch{return false;}},{timeout:15000,intervals:[20,40,80]}).toBe(true);
 const candidateRelease=await realpath(f.info.config.installRoot+'/current');
 const descriptor=JSON.parse(await readFile(candidateRelease+'/updater-presentation/presentation.json','utf8'));
 const indexBytes=await readFile(candidateRelease+'/updater-presentation/index.html');
 const candidate=await f.context.newPage();const pageErrors=[];candidate.on('pageerror',e=>pageErrors.push(e.message));
 candidate.on('response',r=>{if(r.url().includes('/presentation/v0.3.2/')&&(/\.woff2$|\/chamber-[^/]+\.js$/.test(r.url())))received.push(r);});
 // Exactly one explicit candidate index navigation pins the ENTIRE inventory,
 // while Three and fonts have not yet reached HTTP and readiness is failing.
 const indexResponse=await candidate.goto(f.uiOrigin+'/updater/',{waitUntil:'domcontentloaded'});assert.equal(indexResponse.status(),200);assert.deepEqual(await indexResponse.body(),indexBytes);
 await expect(candidate.locator('#console')).toBeVisible();await expect.poll(()=>held.length,{timeout:5000}).toBe(3);
 await expect(app.locator('#phase')).toHaveText('Rolled back',{timeout:30000});await expect(app.locator('#current-version')).toHaveText('v0.3.1');
 assert.equal(await realpath(f.info.config.installRoot+'/current'),goodRelease);
 assert.equal((await readdir(f.info.config.installRoot+'/releases')).some(n=>n.startsWith('v0.3.2-')),false,'Actual candidate Engine prunes failed candidate before delayed asset requests resume');
 assert.equal(await readFile(f.info.root+'/state/fixture.txt','utf8'),'initial synthetic state','Readiness failure restores matching state');
 for(const entry of descriptor.files){const response=await fetch(`${f.uiOrigin}/updater/presentation/v0.3.2/${entry.path}`);assert.equal(response.status,200,entry.path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,entry.size);assert.equal(sha(bytes),entry.sha256);if(entry.path.startsWith('licenses/'))assert.deepEqual(bytes,await readFile(presentation+'/'+entry.path));}
 releaseDelayed();await expect(candidate.locator('#chamber')).toHaveAttribute('data-renderer','webgl');await fonts(candidate);
 await expect.poll(()=>received.length).toBe(3);for(const response of received){assert.equal(response.status(),200);const path=new URL(response.url()).pathname.split('/v0.3.2/')[1],entry=descriptor.files.find(e=>e.path===path);assert.equal(sha(await response.body()),entry.sha256,'Delayed browser bytes remain the original fully pinned candidate bytes');}
 await expect(candidate.locator('#phase')).toHaveText('Rolled back');assert.equal(installs,2);assert.deepEqual(pageErrors,[]);
 assert.equal(f.web.server,webIdentity);assert.equal(webIdentity.listening,true);process.kill(brokerPid,0);
 for(const [path,hash] of Object.entries(f.info.oldBrokerHashes))assert.equal(sha(await readFile(f.info.root+'/old-control/'+path)),hash,'Genuine old broker module remains byteidentical');
 t.diagnostic(JSON.stringify({tier:f.info.tier,oldBrokerHashes:f.info.oldBrokerHashes,candidateVersion:descriptor.version,delayedHTTPFiles:received.map(r=>new URL(r.url()).pathname),webRestarted:false,brokerRestarted:false,installs}));
});

test('compiled browser uses exact built-in safe source for missing current, old runtime and incompatible API, retaining genuine auth and both licensed fonts',{timeout:65000},async t=>{
 const f=await fixture(t);const release=await selectedIndex(f,'v0.3.0');
 const current=f.info.config.installRoot+'/current',dir=release+'/updater-presentation',descriptorPath=dir+'/presentation.json';
 const originalDescriptor=await readFile(descriptorPath),originalPackage=await readFile(release+'/package.json'),builtinIndex=await readFile(ROOT+'/updater/ui/dist/index.html');
 let installs=0;f.context.on('request',r=>{if(new URL(r.url()).pathname==='/updater/api/apply')installs++;assert.notEqual(new URL(r.url()).pathname,'/updater/api/install','No immediate-install fallback');});
 const cases=[
  {name:'missing managed current',async set(){await rename(current,current+'-held');},async restore(){await rename(current+'-held',current);}},
  {name:'old runtime without presentation',async set(){await rename(dir,f.info.root+'/presentation-held');await writeFile(release+'/package.json',JSON.stringify({version:'0.2.0'}));},async restore(){await writeFile(release+'/package.json',originalPackage);await rename(f.info.root+'/presentation-held',dir);}},
  {name:'incompatible web API',async set(){await writeFile(descriptorPath,JSON.stringify({...JSON.parse(originalDescriptor),webApi:2}));},async restore(){await writeFile(descriptorPath,originalDescriptor);}},
 ];
 let app;
 for(const c of cases){
  await c.set();
  try{
   const response=await fetch(f.uiOrigin+'/updater/');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),builtinIndex,c.name+' must select exact fallback bytes');
   assert.equal(response.headers.get('x-relay-updater-presentation'),'builtin');
   if(!app){
    await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
    if(oldArchive){await expect(f.desktop.getByRole('button',{name:'Start update',exact:true})).toBeDisabled();app=await standalone(f);}
    else{await f.desktop.getByRole('button',{name:'Start update',exact:true}).click();app=await (await f.desktop.locator('iframe[title="Independent Relay updater"]').elementHandle()).contentFrame();}
   }
   else await app.goto(f.uiOrigin+'/updater/');
   await expect(app.locator('#console')).toBeVisible();await expect(app.locator('#mode')).toHaveText('FIXTURE SANDBOX');await fonts(app);
   const sourceURLs=await app.evaluate(()=>[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(el=>el.src||el.href));assert.equal(sourceURLs.every(url=>new URL(url).pathname.startsWith('/updater/assets/')),true,c.name);
   for(const font of JSON.parse(originalDescriptor).files.filter(e=>e.path.endsWith('.woff2'))){const remote=await fetch(f.uiOrigin+'/updater/'+font.path);assert.equal(remote.status,200);assert.equal(sha(Buffer.from(await remote.arrayBuffer())),font.sha256);}
   assert.equal((await fetch(f.uiOrigin+'/updater/presentation/v9.9.9/assets/unknown.js')).status,404);
   t.diagnostic(c.name+': compiled fallback, real original-owner auth, font bytes and document.fonts passed');
  }finally{await c.restore();}
 }
 for(const entry of JSON.parse(originalDescriptor).files.filter(e=>e.path.startsWith('licenses/')))assert.deepEqual(await readFile(ROOT+'/updater/ui/dist/'+entry.path),await readFile(presentation+'/'+entry.path),'Both complete bundles retain original notice bytes');
 assert.equal(installs,0,'Fallback/reloads never initiate or retry a mutation');await selectedIndex(f,'v0.3.0');
});

test('WebKit compiled runtime source has functional no-WebGL fallback with HTTP fonts and original licenses (not Safari GPU or HMAC install qualification)',{timeout:65000},async t=>{
 const f=await fixture(t,webkit);const release=await selectedIndex(f,'v0.3.0');await verifyFiles(f,release,'v0.3.0');
 await f.context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:original.call(this,kind,...args);};});
 const fontResponses=[];f.context.on('response',r=>{if(r.url().includes('/updater/presentation/v0.3.0/')&&r.url().endsWith('.woff2'))fontResponses.push(r);});
 await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
 let frame;
 if(oldArchive){await expect(f.desktop.getByRole('button',{name:'Start update',exact:true})).toBeDisabled();frame=await standalone(f);}
 else{await f.desktop.getByRole('button',{name:'Start update',exact:true}).click();frame=await (await f.desktop.locator('iframe[title="Independent Relay updater"]').elementHandle()).contentFrame();}
 const app=frame;await expect(app.locator('#console')).toBeVisible();await expect(app.locator('#fallback')).toBeVisible();await fonts(frame);
 await expect.poll(()=>fontResponses.length).toBe(2);for(const response of fontResponses){assert.equal(response.status(),200);assert.equal((await response.body()).length>0,true);}
 await expect(app.locator('#current-version')).toHaveText('v0.3.0');
 if(oldArchive){await expect(app.getByRole('button',{name:'Download & prepare'})).toBeDisabled();await expect(app.locator('#install-reason')).toContainText('Staged updates unsupported');}
 else await expect(app.getByRole('button',{name:'Download & prepare'})).toBeEnabled();
 const bounds=await frame.locator('#console').evaluate(el=>({width:el.getBoundingClientRect().width,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.equal(bounds.scroll<=bounds.client+1,true,'WebKit fallback has contained horizontal layout');
 t.diagnostic('Source-tier WebKit with deliberately unavailable WebGL, real HTTP/auth and fonts; no install or physical Safari GPU claim');
});

if(oldArchive){
 test('genuine old-engine tier: new presentation explicitly rejects staged actions and retains independent monitoring through Relay downtime',{timeout:65000},async t=>{
  const f=await fixture(t),identity=f.web.server;
  await selectedIndex(f,'v0.3.0');
  const requests=[];f.context.on('request',r=>{if(/\/updater\/api\/(?:prepare|apply|install)$/.test(new URL(r.url()).pathname))requests.push(r.url());});
  await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
  const page=await standalone(f);
  await expect(page.locator('#console')).toBeVisible();await expect(page.locator('#install-reason')).toContainText('Staged updates unsupported');await expect(page.locator('#install-reason')).toContainText('No immediate-install fallback');
  await expect(page.locator('#install')).toBeDisabled();await expect(page.locator('#apply')).toBeHidden();
  const state=await(await f.context.request.get(f.uiOrigin+'/updater/api/state')).json();assert.equal(state.capabilities,undefined);assert.equal(state.currentVersion,'v0.3.0');
  await page.locator('#install').dispatchEvent('click');await expect(page.locator('#confirm')).not.toBeVisible();assert.deepEqual(requests,[]);
  const rejected=await page.evaluate(async password=>{const {csrf}=await(await fetch('/updater/api/auth')).json();const results=[];for(const action of ['prepare','apply']){const r=await fetch('/updater/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({version:'v0.3.1',...(action==='apply'?{jobId:'a'.repeat(32)}:{}),password,confirmed:true})});results.push({status:r.status,body:await r.json()});}return results;},password);
  for(const result of rejected){assert.equal(result.status,409);assert.match(result.body.error,/unsupported/i);}
  const before=await realpath(f.info.config.installRoot+'/current');
  await f.stopRelay();await page.reload();await expect(page.locator('#connection')).toHaveText('Connected to updater');await expect(page.locator('#current-version')).toHaveText('v0.3.0');await expect(page.locator('#install')).toBeDisabled();
  assert.equal(await realpath(f.info.config.installRoot+'/current'),before);const journal=JSON.parse(await readFile(f.info.config.controlRoot+'/journal.json','utf8'));assert.equal(journal.job,null);assert.equal(journal.checkpoint,null);await assert.rejects(access(f.info.config.maintenance));
  assert.equal(f.web.server,identity);process.kill(f.info.brokerPid,0);
  t.diagnostic('Design constraint: a presentation bridge admits webApi=1 new UI over an old engine; runtime updating is intentionally disabled. Monitoring is not staged-update compatibility. A separately qualified independent control-plane migration is required.');
 });

 test('genuine old-engine + archived old static UI tier: legacy install and readiness rollback, not staged qualification',{timeout:100000},async t=>{
  const f=await fixture(t,chromium,{old:true,legacyUI:true});
  const index=await fetch(f.uiOrigin+'/updater/');assert.equal(index.headers.get('x-relay-updater-presentation'),'builtin');assert.deepEqual(Buffer.from(await index.arrayBuffer()),await readFile(f.info.oldUIDir+'/index.html'));
  await f.desktop.getByRole('button',{name:'Open Updater',exact:true}).dblclick();const page=await standalone(f);
  const mutations=[];page.on('request',r=>{if(/\/updater\/api\/(?:prepare|apply|install)$/.test(new URL(r.url()).pathname))mutations.push(new URL(r.url()).pathname);});
  await expect(page.locator('#console')).toBeVisible();assert.equal(await page.locator('#apply').count(),0);
  // Archived UI names success differently; current staged tier keeps Installed.
  for(const [version,phase] of [['v0.3.1','Update complete'],['v0.3.2','Rolled back']]){
   await page.locator('#release-select').selectOption(version);await page.locator('#install').click();await expect(page.locator('#authorize')).toHaveText('Authorize installation');await page.locator('#confirmed').check();await page.locator('#password').fill(password);await page.locator('#authorize').click();await expect(page.locator('#phase')).toHaveText(phase,{timeout:30000});await expect(page.locator('#current-version')).toHaveText('v0.3.1');
  }
  assert.deepEqual(mutations,['/updater/api/install','/updater/api/install']);assert.equal(await readFile(f.info.config.stateRoot+'/fixture.txt','utf8'),'initial synthetic state');
  await f.stopRelay();await page.reload();await expect(page.locator('#phase')).toHaveText('Rolled back');await expect(page.locator('#connection')).toHaveText('Connected to updater');
  for(const [name,hash] of Object.entries(f.info.oldBrokerHashes))assert.equal(sha(await readFile(f.info.root+'/old-control/'+name)),hash);
  t.diagnostic('Archived old UI and all seven imported old broker modules; synthetic HMAC runtime upgrade + matching-state readiness rollback only. Current web/auth transport, not unchanged old web service or production qualification.');
 });
}
