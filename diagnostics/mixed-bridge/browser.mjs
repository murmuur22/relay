import assert from 'node:assert/strict';
import {readFile,writeFile,access,stat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
const root='/var/lib/relay-mixed-browser';
const modulePath='/opt/relay/current/node_modules/playwright/index.mjs';
let spec,chromium,browser,context,page,stage='bootstrap',passed=false,observerStop=false,observer,cancelled=false,closing;
const closeBrowser=()=>closing??=(browser?browser.close():Promise.resolve());
process.on('SIGTERM',()=>{cancelled=true;observerStop=true;void closeBrowser().catch(()=>{});});
const result={passed:false,gates:{},requests:[],monitorSamples:0,monitorDuringRuntimeUnavailable:0};
// Fixed paths/keys and vocabulary only. Never retain arbitrary exception text,
// environment, browser launch logs, input spec, cookies or credential-bearing URLs.
const symptoms=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','EACCES','EPERM','ENOENT','Permission denied','Operation not permitted','Executable doesn\'t exist','No usable sandbox','Failed to move to new namespace','Target page, context or browser has been closed'];
async function probe(path){
 const row={};
 try{const s=await stat(path);Object.assign(row,{uid:s.uid,gid:s.gid,mode:s.mode&0o7777,directory:s.isDirectory()});}catch(e){row.statCode=['EACCES','EPERM','ENOENT','ENOTDIR'].includes(e.code)?e.code:'OTHER';}
 for(const [name,mode] of [['read',constants.R_OK],['execute',constants.X_OK],['write',constants.W_OK]]){
  try{await access(path,mode);row[name]=true;}catch(e){row[name]=false;row[name+'Code']=['EACCES','EPERM','ENOENT','ENOTDIR','EROFS'].includes(e.code)?e.code:'OTHER';}
 }
 return row;
}
async function bootstrapEvidence(){
 const paths={opt:'/opt',install:'/opt/relay',current:'/opt/relay/current',modules:'/opt/relay/current/node_modules',playwright:'/opt/relay/current/node_modules/playwright',module:modulePath,browsers:'/opt/relay/current/browsers',kit:'/opt/relay-mixed-kit',home:root,input:root+'/input.json',node:'/usr/bin/node'};
 const evidence={uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),groups:process.getgroups(),homeMatches:process.env.HOME===root,tmpMatches:process.env.TMPDIR===root,cacheMatches:process.env.PLAYWRIGHT_BROWSERS_PATH==='/opt/relay/current/browsers',cwdMatches:process.cwd()==='/opt/relay-updater',paths:{}};
 for(const [label,path] of Object.entries(paths))evidence.paths[label]=await probe(path);
 try{const status=await readFile('/proc/self/status','utf8');evidence.procStatus=Object.fromEntries(['NoNewPrivs','CapEff','Seccomp'].map(key=>[key,status.match(new RegExp('^'+key+':\\s*([0-9a-f]+)$','m'))?.[1]??'unavailable']));}catch{evidence.procStatusUnavailable=true;}
 return evidence;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,timeout=45000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{if(await fn())return;}catch(e){last=e;}await pause(100);}throw Error(label);}
async function text(locator,value,timeout=45000){await wait(async()=>await locator.textContent()===value,'text-gate',timeout);}
async function login(){
 await page.getByLabel('username',{exact:true}).waitFor({state:'visible',timeout:30000});
 if(await page.getByRole('button',{name:'Retry Relay connection',exact:true}).isVisible())await page.getByRole('button',{name:'Retry Relay connection',exact:true}).click();
 await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(spec.password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await page.getByLabel('username',{exact:true}).waitFor({state:'hidden',timeout:30000});
}
try{
 result.bootstrap=await bootstrapEvidence();
 stage='module-import';({chromium}=await import(modulePath));
 stage='input-read';assert.equal(process.argv[2],root+'/input.json');const input=await open(process.argv[2],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await input.stat();assert.ok(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o7777)===0o600&&s.nlink===1&&s.size<=4096);const b=Buffer.alloc(4097);const {bytesRead}=await input.read(b,0,b.length,0);assert.ok(bytesRead<=4096);spec=JSON.parse(b.subarray(0,bytesRead).toString('utf8'));}finally{await input.close();}
 assert.ok(spec.expectedUid>0&&spec.expectedGid>0);assert.equal(process.getuid(),spec.expectedUid);assert.equal(process.geteuid(),spec.expectedUid);assert.equal(process.getgid(),spec.expectedGid);
 assert.equal(result.bootstrap.procStatus.CapEff,'0000000000000000');assert.equal(result.bootstrap.procStatus.NoNewPrivs,'1');assert.equal(cancelled,false);
 stage='executable-probe';const executable=chromium.executablePath();
 result.bootstrap.executableInConfiguredCache=executable.startsWith('/opt/relay/current/browsers/');
 result.bootstrap.executable=await probe(executable);
 stage='launch';browser=await chromium.launch({headless:true,chromiumSandbox:true,handleSIGTERM:false});if(cancelled){closing=undefined;await closeBrowser();throw Error('cancelled');}
 stage='new-context';context=await browser.newContext({viewport:{width:1440,height:1050}});stage='new-page';page=await context.newPage();
 context.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='POST'&&p.startsWith('/updater/api/'))result.requests.push(p);});
 stage='navigation';await page.goto(spec.origin);stage='compiled-login';await login();result.gates.compiledLogin=true;
 stage='native-launch';await page.getByRole('button',{name:'Open Updater',exact:true}).dblclick();
 const browse=page.locator('[data-window-id="system-updater"]');await wait(async()=>await browse.getByLabel('Available release').inputValue()==='v0.6.8','signed-selection');
 await browse.getByRole('button',{name:'Start update',exact:true}).click();
 const iframe=page.locator('iframe[title="Independent Relay updater"]');await iframe.waitFor({state:'visible'});const original=await iframe.elementHandle();
 const app=page.frameLocator('iframe[title="Independent Relay updater"]');await text(app.locator('#current-version'),'v0.6.11');assert.equal(context.pages().length,1);result.gates.nativeCompiledStartAndTicketExchange=true;
 const initialCookies=await context.cookies(spec.uiOrigin+'/updater/');const monitor=initialCookies.find(c=>c.name!=='relay_session');assert.ok(monitor);
 stage='password-denial';await app.getByRole('button',{name:'Review installation',exact:true}).click();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill('deliberately invalid disposable password');await app.getByRole('button',{name:'Authorize installation',exact:true}).click();await app.locator('#confirm-error').waitFor({state:'visible'});
 const denied=await context.request.get(spec.uiOrigin+'/updater/api/state');assert.equal(denied.status(),200);assert.equal((await denied.json()).job,null);await app.getByRole('button',{name:'Go back',exact:true}).click();result.gates.wrongPasswordCreatesNoJob=true;
 stage='signed-install';
 observer=(async()=>{while(!observerStop){let unavailable=false;try{const r=await context.request.get(spec.origin+'/health/ready',{timeout:600});unavailable=r.status()!==200;}catch{unavailable=true;}
  const r=await context.request.get(spec.uiOrigin+'/updater/api/state',{timeout:5000});assert.equal(r.status(),200);result.monitorSamples++;if(unavailable)result.monitorDuringRuntimeUnavailable++;await pause(100);
 }})();
 await app.getByRole('button',{name:'Review installation',exact:true}).click();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(spec.password);await app.getByRole('button',{name:'Authorize installation',exact:true}).click();
 await text(app.locator('#current-version'),'v0.6.8',240000);await text(app.locator('#phase'),'Update complete',45000);result.gates.realSignedImmediateInstall=true;
 assert.equal(await iframe.evaluate((el,old)=>el===old,original),true);assert.equal((await context.cookies(spec.uiOrigin+'/updater/')).find(c=>c.name===monitor.name)?.value,monitor.value);result.gates.originalMonitorRetained=true;
 // Select v0.6.8 in the same web process; the reader eagerly pins its complete
 // descriptor without requesting the lazy assets, then rollback/prune tests them.
 const selected=await context.request.get(spec.uiOrigin+'/updater/');assert.equal(selected.status(),200);assert.equal(selected.headers()['x-relay-updater-presentation'],'v0.6.8');
 const desc=JSON.parse(await readFile('/opt/relay/current/updater-presentation/presentation.json','utf8'));assert.equal(desc.version,'v0.6.8');await writeFile(root+'/retained-assets.json',JSON.stringify(desc.files.filter(f=>f.path!=='index.html')));
 stage='genuine-relogin';await app.getByRole('button',{name:'Sign in to Relay',exact:true}).click();await login();await iframe.waitFor({state:'visible'});assert.equal(await iframe.evaluate((el,old)=>el===old,original),true);
 const mutation=await page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api/desktop/folders',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({label:'Signed lifecycle state must disappear on rollback',parentId:null})});return {status:r.status,body:await r.json()};});assert.equal(mutation.status,200);assert.ok(mutation.body.itemId);await writeFile(root+'/mutation.json',JSON.stringify({itemId:mutation.body.itemId}));result.gates.genuinePostInstallStateMutation=true;
 stage='matching-state-rollback';await app.getByRole('button',{name:'Review rollback',exact:true}).click();await app.locator('#confirmed').check();await app.getByLabel('Current Relay password').fill(spec.password);await app.getByRole('button',{name:'Authorize rollback',exact:true}).click();await text(app.locator('#current-version'),'v0.6.11',90000);await text(app.locator('#phase'),'Rolled back',45000);
 assert.equal(await iframe.evaluate((el,old)=>el===old,original),true);assert.equal((await context.cookies(spec.uiOrigin+'/updater/')).find(c=>c.name===monitor.name)?.value,monitor.value);
 assert.ok(result.monitorDuringRuntimeUnavailable>0,'no actual runtime-unavailability monitoring sample');result.gates.originalMonitorDuringRealRuntimeLoss=true;
 assert.equal(result.requests.filter(p=>p==='/updater/api/install').length,2);assert.equal(result.requests.filter(p=>p==='/updater/api/rollback').length,1);assert.equal(result.requests.filter(p=>/prepare|apply/.test(p)).length,0);result.gates.actualCompiledLegacyInstallNotStaged=true;
 result.gates.matchingRollbackThroughOriginalMonitor=true;passed=true;
}catch(e){result.error={stage,type:['Error','TypeError','SyntaxError','AssertionError','TimeoutError'].includes(e.name)?e.name:'OTHER',code:['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','EACCES','EPERM','ENOENT','ENOTDIR','ERR_REQUIRE_ASYNC_MODULE'].includes(e.code)?e.code:null,symptoms:symptoms.filter(s=>String(e.message).includes(s)),modulePathMentioned:String(e.message).includes(modulePath)};}
finally{
 observerStop=true;try{await observer;}catch{passed=false;result.observerFailed=true;}
 try{result.browserStarted=Boolean(browser);if(browser){await closeBrowser();result.browserCloseAcknowledged=true;}else result.browserCloseAcknowledged=false;}catch{passed=false;result.browserCloseAcknowledged=false;}
 result.cancelled=cancelled;passed=passed&&!cancelled;result.passed=passed;await writeFile(root+'/browser-result.next',JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});await (await import('node:fs/promises')).rename(root+'/browser-result.next',root+'/browser-result.json');
}
process.exitCode=passed?0:1;
