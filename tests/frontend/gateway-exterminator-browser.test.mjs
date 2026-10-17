import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {X509Certificate,createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
import {edgeRequest,launchGateway,redeemGateway} from '../gateway-helper.mjs';
const source=process.env.RELAY_TEST_EXTERMINATOR_SOURCE;
test('actual Exterminator compiled HTTPS browser form, missing-header failure and genuine account/grant isolation',{timeout:65000,skip:!source&&'Explicit read-only Exterminator v0.2.0 source required'},async()=>{
 const dir=await mkdtemp(tmpdir()+'/ex-browser-');let child,relay,browser;
 try{
  assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'18b832936ad47e700712fed98d662a6fab15cdbf');
  assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}),'');
  const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const origin='https://desktop.forms.test:'+port;
  child=spawn(process.env.RELAY_TEST_EXTERMINATOR_PYTHON??source+'/.venv/bin/python',[fileURLToPath(new URL('../backend/exterminator-fixture.py',import.meta.url)),source,dir+'/reports.sqlite3',origin],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const lines=createInterface({input:child.stdout});let timer;const info=await Promise.race([once(lines,'line').then(([s])=>JSON.parse(s)),once(child,'exit').then(()=>{throw Error('fixture exited before ready');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture readiness timeout')),8000);})]).finally(()=>{clearTimeout(timer);lines.close();});
  assert.equal(info.version,'0.2.0');
  await writeFile(dir+'/cert.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=desktop.forms.test\n[ext]\nsubjectAltName=DNS:desktop.forms.test,DNS:*.apps.forms.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-config',dir+'/cert.cnf'],{stdio:'ignore'});
  const cert=await readFile(dir+'/cert.pem'),key=await readFile(dir+'/key.pem');
  const target=(id,p,requestHeaders)=>({id,label:id,upstream:'http://127.0.0.1:'+p,requestHeaders});
  relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone',experimentalGateway:{key,cert,port,deployment:{bind:'127.0.0.1',desktopHostname:'desktop.forms.test',appBaseDomain:'apps.forms.test'},targets:[target('submission',info.submission,['x-exterminator']),target('missing',info.submission,[]),target('admin',info.admin,['x-exterminator'])]}});
  assert.equal(relay.experimentalGateway.desktopOrigin,origin);
  const admin=await authenticate(relay.origin,dir+'/state'),api=client(relay.origin,admin),l={relay,api,dir,cert};
  await api('/onboarding/complete','POST',{});await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  async function add(label,target){const r=await api('/admin/apps','POST',{kind:'web',mode:'gateway',label,gateway:{target},userIds:[]});assert.equal(r.status,200);return r.json();}
  const app=await add('Feedback','submission'),missing=await add('Broken feedback','missing'),adminApp=await add('Private reports','admin');
  const user=await(await api('/admin/users','POST',{username:'reporter',password,grants:[app.id,missing.id]})).json();
  await api('/admin/users','POST',{username:'otherreporter',password,grants:[app.id]});
  const reporterAPI=client(relay.origin,await authenticate(relay.origin,dir+'/state','reporter'));await reporterAPI('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false,showAppStatus:false});
  const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${spki}`,'--host-resolver-rules=MAP *.forms.test 127.0.0.1','--no-proxy-server']});
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(8000);
  async function login(name){await page.goto(origin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();await page.getByLabel('username',{exact:true}).fill(name);await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await expect(page.getByRole('button',{name:'Navigation',exact:true})).toBeVisible();}
  await login('reporter');
  assert.equal(await page.getByRole('button',{name:'Open Private reports',exact:true}).count(),0);
  await page.getByRole('button',{name:'Open Broken feedback',exact:true}).dblclick();
  const broken=page.frameLocator('iframe[title="Broken feedback"]');await expect(broken.locator('#report-form')).toBeVisible();await broken.locator('#title').fill('[Synthetic] must not save');
  const denied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/submit');await broken.getByRole('button',{name:/^Send report/}).click();assert.equal((await denied).status(),403);await expect(broken.locator('#send-error')).toBeVisible();await expect(broken.locator('#confirmation')).toBeHidden();
  await page.getByRole('button',{name:'Close Broken feedback',exact:true}).click();
  await page.getByRole('button',{name:'Open Feedback',exact:true}).dblclick();const form=page.frameLocator('iframe[title="Feedback"]');await expect(form.locator('#report-form')).toBeVisible();
  const frame=page.frames().find(f=>/\.apps\.forms\.test/.test(f.url()));assert.ok(frame);const appOrigin=new URL(frame.url()).origin;assert.notEqual(appOrigin,origin);
  await form.locator('#title').fill('[Synthetic] real HTTPS browser report');await form.locator('#service').fill('qualification');await form.locator('#detail').fill('Temporary database; compiled desktop form click.');
  const ack=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/submit');await form.getByRole('button',{name:/^Send report/}).click();const response=await ack;assert.equal(response.status(),201);assert.deepEqual(await response.json(),{ok:true});await expect(form.locator('#confirmation')).toBeVisible();await expect(form.locator('#success-heading')).toBeFocused();
  const cookies=await context.cookies(appOrigin),cookie=cookies.map(c=>c.name+'='+c.value).join('; ');assert.ok(cookie);
  const submit=(o=appOrigin,c=cookie)=>edgeRequest(l,appOrigin,'/api/submit',{method:'POST',headers:{cookie:c,origin:o,'content-type':'application/json','x-exterminator':'1'},body:{title:'must not save'}});
  for(const o of ['https://wrong.forms.test','null',origin])assert.equal((await submit(o)).status,403);
  assert.equal((await submit(appOrigin,'')).status,403);
  assert.equal((await edgeRequest(l,appOrigin,'/api/reports',{headers:{cookie}})).status,404);
  assert.equal((await reporterAPI('/windows','POST',{appId:adminApp.id})).status,403);
  const other=client(relay.origin,await authenticate(relay.origin,dir+'/state','otherreporter')),otherLaunch=await launchGateway(l,app,other),otherCap=await redeemGateway(l,otherLaunch);
  assert.equal((await edgeRequest(l,otherLaunch.origin,'/api/reports',{headers:{cookie:otherCap.cookie}})).status,404);assert.equal((await edgeRequest(l,otherLaunch.origin,'/',{headers:{cookie}})).status,403);
  const adminLaunch=await launchGateway(l,adminApp),adminCap=await redeemGateway(l,adminLaunch);
  async function reports(){const r=await edgeRequest(l,adminLaunch.origin,'/api/reports',{headers:{cookie:adminCap.cookie}});assert.equal(r.status,200);return r.json();}
  const saved=await reports();assert.equal(saved.length,1);assert.equal(saved[0].title,'[Synthetic] real HTTPS browser report');assert.equal(saved[0].detail,'Temporary database; compiled desktop form click.');
  await api('/admin/users/'+user.id,'PATCH',{grants:[]});assert.equal((await submit()).status,403);
  await other('/logout','POST',{});assert.equal((await edgeRequest(l,otherLaunch.origin,'/',{headers:{cookie:otherCap.cookie}})).status,403);
  const final=await reports();assert.deepEqual(final,saved,'all negative requests leave exactly one positive report');
  assert.equal(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}),'');
 }finally{
  await browser?.close();await relay?.close();if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}await rm(dir,{recursive:true,force:true});
 }
});
