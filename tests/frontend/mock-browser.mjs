// Explicit frontend-only mock. Does not validate the real engine or native integrations.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mockAssets } from './mock-assets.mjs';
const serve=await mockAssets();
const artifacts=fileURLToPath(new URL('./artifacts/review-mock/',import.meta.url));
const browser=await chromium.launch({chromiumSandbox:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await serve(page);
const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
let locked=true, windows=[], serial=0;const writes=[],inputs=[],sockets=[];let gatewayError=false;
const apps=[{id:'parcels',label:'Parcels',mode:'native',description:'Pack files. Take them with you.'},{id:'keepsakes',label:'Keepsakes',mode:'native',description:'A place for things worth keeping.'},{id:'notes-lab',label:'Notes Lab',mode:'stream',description:'Synthetic remote text workspace.'},{id:'signal-lab',label:'Signal Lab',mode:'stream',description:'Synthetic live signal.'}];
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),method=req.method();let status=200,body;
 if(gatewayError){await route.fulfill({status:503,json:{error:'Mock worker unavailable'}});return;}
 if(locked){status=401;body={error:'Authentication required'};}
 else if(url.pathname==='/api/session')body={csrf:'mock-only-csrf',apps,windows,limits:{maxStreams:2}};
 else if(method==='POST'&&url.pathname==='/api/windows'){
 const app=apps.find(a=>a.id===req.postDataJSON().appId);let w=windows.find(w=>w.appId===app.id);
 if(!w){w={id:`w${++serial}`,appId:app.id,title:app.label,mode:app.mode,x:170+serial*45,y:35+serial*40,width:650,height:410,visible:true,focused:true,...(app.mode==='native'?{url:`/native/${app.id}/`}:{})};windows.push(w);}w.visible=true;windows.forEach(other=>other.focused=other.id===w.id);body=w;
 }else {const id=url.pathname.split('/')[3],w=windows.find(w=>w.id===id);if(method==='PATCH'){assert.equal(req.headers()['x-csrf-token'],'mock-only-csrf');const patch=req.postDataJSON();writes.push({id,...patch});if(patch.focused)await new Promise(r=>setTimeout(r,150));Object.assign(w,patch);if(patch.focused)windows.forEach(other=>other.focused=other.id===id);body=w;}else if(method==='DELETE'){windows=windows.filter(w=>w.id!==id);body={closed:true};}else body=w;}
 await route.fulfill({status,json:body});
});
await page.route('**/native/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="background:#eeece6;color:#24211e;font:16px monospace;padding:24px"><h1>MOCK NATIVE FIXTURE</h1><p>Frontend test only — not Parcels or Keepsakes</p><label>Fixture note <input aria-label="Fixture note"></label><p><input type="file" aria-label="Fixture upload"></p><a download="mock.txt" href="data:text/plain,synthetic">Download fixture</a></body></html>'}));
const mockFrame=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=650;c.height=410;const x=c.getContext('2d');x.fillStyle='#171715';x.fillRect(0,0,650,410);x.fillStyle='#eeeae0';x.font='20px monospace';x.fillText('NOTES LAB / MOCK STREAM FIXTURE',28,45);x.font='13px monospace';x.fillStyle='#99968d';x.fillText('Frontend protocol validation — not a live remote browser',28,76);x.strokeStyle='#77736c';x.strokeRect(28,115,594,180);x.fillStyle='#eeeae0';x.fillText('Synthetic workspace. No personal content.',45,145);return c.toDataURL('image/png').split(',')[1];});
await page.routeWebSocket('**/ws/stream/*',ws=>{sockets.push(ws);ws.send(JSON.stringify({type:'state',state:'live'}));ws.send(JSON.stringify({type:'frame',seq:1,data:mockFrame,mime:'image/png',width:650,height:410,sentAt:Date.now()}));ws.onMessage(m=>inputs.push(JSON.parse(m)));});
try {
 await page.goto('http://relay-test.invalid/');
 await page.getByText('Desktop locked',{exact:true}).waitFor();await mkdir(artifacts,{recursive:true});await page.screenshot({path:artifacts+'mock-locked-desktop.png'});
 assert.equal(await page.locator('iframe').count(),0);
 locked=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'Open Parcels',exact:true}).waitFor();await page.screenshot({path:artifacts+'mock-empty-desktop.png'});
 await page.getByRole('button',{name:'Open Parcels',exact:true}).click();
 const native=page.locator('[data-app="parcels"]');await native.waitFor();
 const frame=page.frameLocator('iframe[title="Parcels"]');await frame.getByLabel('Fixture note',{exact:true}).fill('synthetic persistence');
 await native.getByRole('button',{name:'Minimize Parcels'}).click();
 await page.getByRole('button',{name:'Restore Parcels'}).click();
 assert.equal(await frame.getByLabel('Fixture note',{exact:true}).inputValue(),'synthetic persistence');
 await frame.getByLabel('Fixture upload').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic only')});
 const download=page.waitForEvent('download');await frame.getByText('Download fixture').click();assert.equal((await download).suggestedFilename(),'mock.txt');
 const title=native.locator('.titlebar');const before=await native.boundingBox(),tb=await title.boundingBox();
 await page.mouse.move(tb.x+150,tb.y+12);await page.mouse.down();await page.mouse.move(tb.x+230,tb.y+55,{steps:8});await page.mouse.up();
 const after=await native.boundingBox();assert.ok(after.x>before.x+50);
 await native.getByRole('button',{name:'Maximize Parcels'}).click();assert.ok((await native.boundingBox()).width>1400);
 await native.getByRole('button',{name:'Restore size Parcels'}).click();
 await page.getByRole('button',{name:'Open Notes Lab',exact:true}).click();
 const remote=page.locator('[data-app="notes-lab"]');await remote.locator('.stream-status.live').waitFor();await remote.getByLabel('Notes Lab remote input').click();await page.keyboard.type('relay');
 await page.waitForTimeout(350);assert.equal(inputs.filter(m=>m.type==='text').map(m=>m.text).join(''),'relay');
 await page.getByRole('button',{name:'Restore Parcels'}).click();assert.equal(await frame.getByLabel('Fixture note',{exact:true}).inputValue(),'synthetic persistence');
 await page.waitForTimeout(400);const pointerStart=inputs.length;await remote.getByLabel('Notes Lab remote input').click({position:{x:5,y:50}});await page.waitForTimeout(400);assert.deepEqual(inputs.slice(pointerStart).filter(m=>m.type==='pointer'&&m.phase!=='move').map(m=>m.phase),['down','up']);
 assert.ok(inputs.some(m=>m.type==='ack'&&m.seq===1));
 const content=await remote.locator('.window-content').boundingBox();assert.equal(content.width,650);assert.equal(content.height,410);
 const handle=await remote.getByRole('button',{name:'Resize Notes Lab'}).boundingBox();await page.mouse.move(handle.x+10,handle.y+10);await page.mouse.down();await page.mouse.move(handle.x+60,handle.y+40,{steps:5});await page.mouse.up();assert.equal((await remote.locator('.window-content').boundingBox()).width,700);
 await remote.getByLabel('Notes Lab remote input').click();await page.mouse.wheel(0,80);await page.keyboard.down('Shift');await remote.getByRole('button',{name:'Minimize Notes Lab'}).click();await page.waitForTimeout(200);assert.ok(inputs.some(m=>m.type==='wheel'));assert.ok(inputs.some(m=>m.type==='release'));await page.keyboard.up('Shift');await page.getByRole('button',{name:'Restore Notes Lab'}).click();
 sockets.at(-1).send(JSON.stringify({type:'state',state:'failed',message:'Mock page failed'}));await page.getByText('Remote app unavailable',{exact:true}).waitFor();sockets.at(-1).close();await page.getByText('Stream disconnected',{exact:true}).waitFor();await page.keyboard.type('discarded');await remote.locator('.stream-status.live').waitFor();assert.ok(sockets.length>=2);assert.equal(inputs.filter(m=>m.type==='text').map(m=>m.text).join(''),'relay');
 gatewayError=true;await page.getByRole('button',{name:'Open Signal Lab',exact:true}).click();await page.getByText('Mock worker unavailable',{exact:true}).waitFor();gatewayError=false;await page.getByRole('button',{name:'Dismiss error'}).click();
 const rt=await remote.locator('.titlebar').boundingBox();await page.mouse.move(rt.x+150,rt.y+8);await page.mouse.down();await page.mouse.move(rt.x+550,rt.y+210,{steps:6});await page.mouse.up();await page.waitForTimeout(350);
 await mkdir(artifacts,{recursive:true});await page.screenshot({path:artifacts+'mock-mixed-desktop.png'});
 await page.reload();await page.locator('[data-app="notes-lab"]').waitFor();assert.ok(writes.some(w=>w.x===after.x-8));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:artifacts+'mock-narrow-desktop.png'});
 assert.ok((await page.locator('[data-app="notes-lab"]').boundingBox()).width<=390);
 assert.deepEqual(errors,[]);console.log('PASS: MOCK-ONLY locked/bootstrap retry; native retained DOM, upload/download; local drag, maximize; stream text protocol; persistence; narrow screen; zero page errors.');
}finally{await browser.close();}
