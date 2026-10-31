// Real Cockpit browser proof; explicit local fixture state, never a live device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {gatewayLab,password} from '../../../tests/gateway-helper.mjs';
const file=process.env.RELAY_COCKPIT_FIXTURE_STATE,out=process.env.RELAY_COCKPIT_BROWSER_EVIDENCE;
if(!file||!out)throw Error('Explicit private fixture state and browser evidence directory required.');
const state=JSON.parse(await readFile(file,'utf8'));
assert.equal(new URL(state.upstream).hostname,'127.0.0.1');assert.equal(state.username,'learner');
await mkdir(out,{recursive:true});
const l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'},targets:[{id:'files',label:'Disposable Cockpit',upstream:state.upstream,tls:{ca:await readFile(state.caPath,'utf8'),serverName:state.serverName},entryPath:'/',cookieNames:['cockpit'],webSocketPaths:['/cockpit/socket'],webSocketProtocols:['cockpit1'],webSocketOrigin:'upstream',presentation:'tab',accessPolicy:'admin-only'}]});
let browser;
try{
 const registered=await l.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Cockpit fixture',gateway:{target:'files'},userIds:[]});assert.equal(registered.status,200);
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(8000);
 await page.goto(l.relay.experimentalGateway.desktopOrigin);
 const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
 await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await page.getByRole('button',{name:'Open Cockpit fixture',exact:true}).dblclick();
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Open protected app tab',exact:true}).click()]);popup.setDefaultTimeout(8000);
 const channel={init:false,closed:false},errors=[],policyErrors=[];
 popup.on('console',m=>{if(m.type()==='error'&&/frame|policy|sandbox|origin/i.test(m.text()))policyErrors.push(m.text());});
 popup.on('pageerror',e=>errors.push(e.message));
 popup.on('websocket',socket=>{if(new URL(socket.url()).pathname==='/cockpit/socket'){
  socket.on('framereceived',frame=>{const text=String(frame.payload);if(text.startsWith('\n')){try{const m=JSON.parse(text.slice(1));if(m.command==='init'&&m.version===1)channel.init=true;}catch{}}});socket.on('close',()=>{channel.closed=true;});
 }});
 await popup.locator('#login-user-input').fill(state.username);await popup.locator('#login-password-input').fill(state.password);await popup.locator('#login-button').click();
 await expect.poll(()=>channel.init,{timeout:12000}).toBe(true);
 await expect(popup.locator('#login-user-input')).toHaveCount(0);
 assert.equal(await popup.evaluate(()=>window.opener===null),true);
 await popup.screenshot({path:out+'/cockpit-through-relay.png',fullPage:true});
 await writeFile(out+'/frame-diagnostics.json',JSON.stringify({errors,policyErrors,frames:popup.frames().map(f=>({path:new URL(f.url()).pathname,sameOrigin:new URL(f.url()).origin===new URL(popup.url()).origin}))},null,2));
 assert.deepEqual(errors,[],'Cockpit UI must have no uncaught exceptions');
 const returning=await popup.evaluate(async()=> (await fetch('/cockpit/login')).status);assert.equal(returning,200);
 await page.getByRole('button',{name:'End app session',exact:true}).click();
 await expect.poll(()=>channel.closed,{timeout:8000}).toBe(true);
 await expect.poll(()=>l.relay.experimentalGateway.stats().routes).toBe(0);
 if(!popup.isClosed())assert.equal(await popup.evaluate(async()=> (await fetch('/cockpit/login')).status),403);
 const result={passed:true,scope:'Actual disposable Cockpit Chromium login/live channel through protected tab and genuine Relay browser handoff',browserTLS:'Exact fixture-SPKI exception only; not normal browser PKI trust. Upstream TLS verified by Node.',openerSevered:true,authenticatedInit:true,returningSession:true,endClosesObservedWebSocket:true,retainedAccessDenied:true,pageErrors:errors};
 await writeFile(out+'/RESULT.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await l.close();}
