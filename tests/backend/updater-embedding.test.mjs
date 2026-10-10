import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {chromium,expect} from '@playwright/test';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('only the exact configured Relay ancestor is permitted for the independent document; API origins remain strict',async t=>{
 const uiOrigin=`http://127.0.0.1:${await freePort()}`,relayOrigin='http://127.0.0.1:4180';
 const web=await createUpdaterWeb({uiOrigin,relayOrigin,socketPath:'/nonexistent-fixture.sock'});t.after(()=>web.close());
 const document=await fetch(uiOrigin+'/updater/');assert.equal(document.status,200);
 assert.match(document.headers.get('content-security-policy'),/frame-ancestors http:\/\/127\.0\.0\.1:4180;/);
 assert.equal(document.headers.get('x-frame-options'),null);
 for(const origin of [relayOrigin,'http://127.0.0.1:4181','http://evil.test','null']){
  assert.equal((await fetch(uiOrigin+'/updater/api/auth',{headers:{Origin:origin}})).status,403);
  assert.equal((await fetch(uiOrigin+'/updater/api/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket:'a'.repeat(64)})})).status,403);
 }
 const api=await fetch(uiOrigin+'/updater/api/auth',{headers:{Origin:uiOrigin}});assert.equal(api.status,200);assert.equal(api.headers.get('x-frame-options'),'DENY');
});
test('Chromium admits the exact Relay frame but blocks other ports and a hostile outer ancestor',{timeout:20000},async t=>{
 const uiOrigin=`http://127.0.0.1:${await freePort()}`;let attackerOrigin;
 const parent=http.createServer((req,res)=>res.end(req.url==='/nested'?`<iframe src="${attackerOrigin}"></iframe>`:`<iframe title="Updater" src="${uiOrigin}/updater/"></iframe>`));await new Promise(r=>parent.listen(0,'127.0.0.1',r));const relayOrigin=`http://127.0.0.1:${parent.address().port}`;
 const attacker=http.createServer((req,res)=>res.end(`<iframe title="Updater" src="${uiOrigin}/updater/"></iframe>`));await new Promise(r=>attacker.listen(0,'127.0.0.1',r));attackerOrigin=`http://127.0.0.1:${attacker.address().port}`;
 const web=await createUpdaterWeb({uiOrigin,relayOrigin,socketPath:'/nonexistent-fixture.sock'}),browser=await chromium.launch({chromiumSandbox:true});
 t.after(async()=>{await browser.close();await web.close();await new Promise(r=>{parent.close(r);parent.closeAllConnections();});await new Promise(r=>{attacker.close(r);attacker.closeAllConnections();});});
 const page=await browser.newPage();await page.goto(relayOrigin);await expect(page.frameLocator('iframe').getByRole('heading',{name:'Open from Relay'})).toBeVisible();
 let apiRequests=0;page.on('request',r=>{if(r.url().startsWith(uiOrigin+'/updater/api/'))apiRequests++;});
 await page.goto(attackerOrigin);await page.waitForTimeout(200);assert.equal(apiRequests,0);assert.equal(page.frames().filter(f=>f.url().startsWith(uiOrigin)).length,0);
 await page.goto(relayOrigin+'/nested');await page.waitForTimeout(200);assert.equal(apiRequests,0);assert.equal(page.frames().filter(f=>f.url().startsWith(uiOrigin)).length,0);
});
