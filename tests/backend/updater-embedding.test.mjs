import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {chromium,expect} from '@playwright/test';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {embeddingFixture,listen,closeServer} from '../updater-embedding-fixture.mjs';
async function freePort(acquire){const s=await acquire(()=>listen(net.createServer()),closeServer);const p=s.address().port;await closeServer(s);return p;}
test('only the exact configured Relay ancestor is permitted for the independent document; API origins remain strict',async t=>{
 const acquire=embeddingFixture(t);
 const uiOrigin=`http://127.0.0.1:${await freePort(acquire)}`,relayOrigin='http://127.0.0.1:4180';
 const web=await acquire(()=>createUpdaterWeb({uiOrigin,relayOrigin,socketPath:'/nonexistent-fixture.sock'}),web=>web.close());
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
 const acquire=embeddingFixture(t);
 const uiOrigin=`http://127.0.0.1:${await freePort(acquire)}`;let attackerOrigin;
 const parent=await acquire(()=>listen(http.createServer((req,res)=>res.end(req.url==='/nested'?`<iframe src="${attackerOrigin}"></iframe>`:`<iframe title="Updater" src="${uiOrigin}/updater/"></iframe>`))),closeServer);const relayOrigin=`http://127.0.0.1:${parent.address().port}`;
 const attacker=await acquire(()=>listen(http.createServer((req,res)=>res.end(`<iframe title="Updater" src="${uiOrigin}/updater/"></iframe>`))),closeServer);attackerOrigin=`http://127.0.0.1:${attacker.address().port}`;
 const web=await acquire(()=>createUpdaterWeb({uiOrigin,relayOrigin,socketPath:'/nonexistent-fixture.sock'}),web=>web.close());
 const browser=await acquire(()=>chromium.launch({chromiumSandbox:true}),browser=>browser.close());
 const page=await browser.newPage();await page.goto(relayOrigin);await expect(page.frameLocator('iframe').getByRole('heading',{name:'Open from Relay'})).toBeVisible();
 let apiRequests=0;page.on('request',r=>{if(r.url().startsWith(uiOrigin+'/updater/api/'))apiRequests++;});
 await page.goto(attackerOrigin);await page.waitForTimeout(200);assert.equal(apiRequests,0);assert.equal(page.frames().filter(f=>f.url().startsWith(uiOrigin)).length,0);
 await page.goto(relayOrigin+'/nested');await page.waitForTimeout(200);assert.equal(apiRequests,0);assert.equal(page.frames().filter(f=>f.url().startsWith(uiOrigin)).length,0);
});
