import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('initial navigation failure remains recoverable by Reload in the compiled stream',{timeout:30000},async()=>{
 let broken=true;
 const site=http.createServer((req,res)=>{if(broken){req.socket.destroy();return;}res.setHeader('Content-Type','text/html');res.end('<h1>Recovered</h1>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const runtime=await mkdtemp(tmpdir()+'/relay-initial-error-ui-');const g=await createGateway({port:0,runtime,profile:'standalone'});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();
 try{await browserLogin(page,g.origin,runtime);
  const entry=await page.evaluate(async address=>{const s=await(await fetch('/api/session')).json();return (await fetch('/api/admin/apps',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({kind:'web',mode:'stream',label:'Recovery fixture',address})})).json();},`http://127.0.0.1:${site.address().port}/?token=secret-fixture`);
  await page.reload();await page.getByRole('button',{name:'Open Recovery fixture',exact:true}).click();
  await expect(page.locator('.stream-overlay')).toContainText('Page navigation failed');assert.doesNotMatch(await page.locator('.stream-overlay').innerText(),/secret-fixture/);await expect(page.getByRole('button',{name:'Back in Recovery fixture',exact:true})).toBeDisabled();
  broken=false;await page.getByRole('button',{name:'Reload Recovery fixture',exact:true}).click();await expect(page.locator('.stream-overlay')).toHaveCount(0);await expect.poll(()=>g.manager.resources.get(entry.id)?.page.locator('h1').textContent()).toBe('Recovered');
 }finally{await browser.close();await g.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
});

for(const scenario of ['204','replaced'])test(`compiled Back recovers after ${scenario} navigation`,{timeout:45000},async()=>{
 const held=new Map();
 const site=http.createServer((req,res)=>{
  if(req.url==='/empty'){res.writeHead(204);res.end();return;}
  if(['/slow','/replacement'].includes(req.url)){held.set(req.url,res);return;}
  res.setHeader('Content-Type','text/html');res.end(`<h1>${req.url}</h1><a href="/empty">Empty</a>`);
 });await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${site.address().port}`;
 const runtime=await mkdtemp(tmpdir()+'/relay-terminal-navigation-ui-');const g=await createGateway({port:0,runtime,profile:'standalone'});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();
 try{
  await browserLogin(page,g.origin,runtime);
  const entry=await page.evaluate(async address=>{const s=await(await fetch('/api/session')).json();return (await fetch('/api/admin/apps',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({kind:'web',mode:'stream',label:'Terminal fixture',address})})).json();},origin+'/one');
  await page.reload();await page.getByRole('button',{name:'Open Terminal fixture',exact:true}).click();await expect(page.locator('.stream-status')).toContainText('live');
  const r=g.manager.resources.get(entry.id),back=page.getByRole('button',{name:'Back in Terminal fixture',exact:true});
  await r.page.goto(origin+'/two');await expect(back).toBeEnabled();
  if(scenario==='204'){
   const failed=r.page.waitForEvent('requestfailed',request=>request.url()===origin+'/empty');
   await r.page.getByRole('link',{name:'Empty',exact:true}).click();
   assert.equal((await failed).failure().errorText,'net::ERR_ABORTED');assert.equal(r.page.url(),origin+'/two');
  }else{
   const failed=r.page.waitForEvent('requestfailed',request=>request.url()===origin+'/slow');
   const slow=r.page.goto(origin+'/slow').catch(e=>e);await expect.poll(()=>held.has('/slow')).toBe(true);
   const replacement=r.page.goto(origin+'/replacement');await expect.poll(()=>held.has('/replacement')).toBe(true);
   const obsolete=await failed;await slow;
   // Replay the real obsolete request after the replacement starts to cover
   // delayed event delivery independently of Chromium's usual event ordering.
   r.page.emit('requestfailed',obsolete);
   assert.equal(r.pageLoading,true,'An old abort cannot settle the replacement');
   await expect(back).toBeDisabled();
   held.get('/replacement').writeHead(200,{'Content-Type':'text/html'});held.get('/replacement').end('<h1>Replacement</h1>');await replacement;
  }
  await expect(back).toBeEnabled();assert.equal(r.pageLoading,false);await expect(page.locator('.stream-overlay')).toHaveCount(0);
  await back.click();await expect.poll(()=>r.page.url()).toBe(origin+(scenario==='204'?'/one':'/two'));
 }finally{for(const res of held.values())res.end();await browser.close();await g.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
});

test('compiled streamed Back and Forward use remote history, not desktop URL history',{timeout:45000},async()=>{
 const site=http.createServer((req,res)=>{if(req.url.startsWith('/broken')){res.writeHead(302,{location:'http://unapproved.invalid/?secret=never-expose-me'});res.end();return;}res.setHeader('Content-Type','text/html');res.end(`<h1>${req.url==='/two'?'Two':'One'}</h1><a href="/two">Next page</a><a href="/broken?secret=never-expose-me">Broken page</a>`);});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const runtime=await mkdtemp(tmpdir()+'/relay-navigation-ui-');const g=await createGateway({port:0,runtime,profile:'standalone'});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await browserLogin(page,g.origin,runtime);
  const entry=await page.evaluate(async address=>{const s=await(await fetch('/api/session')).json();return (await fetch('/api/admin/apps',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({kind:'web',mode:'stream',label:'History fixture',address})})).json();},`http://127.0.0.1:${site.address().port}/one`);
  await page.reload();await page.getByRole('button',{name:'Open History fixture',exact:true}).click();
  const back=page.getByRole('button',{name:'Back in History fixture',exact:true}),forward=page.getByRole('button',{name:'Forward in History fixture',exact:true});
  await expect(back).toBeVisible();await expect(back).toBeDisabled();await expect(forward).toBeDisabled();
  await expect(page.locator('.stream-status')).toContainText('live');const desktopURL=page.url();const r=g.manager.resources.get(entry.id);
  await r.page.getByRole('link',{name:'Next page'}).click();await expect(back).toBeEnabled();await expect(forward).toBeDisabled();
  await back.click();await expect.poll(()=>r.page.locator('h1').textContent()).toBe('One');await expect(back).toBeDisabled();await expect(forward).toBeEnabled();assert.equal(page.url(),desktopURL);
  await forward.click();await expect.poll(()=>r.page.locator('h1').textContent()).toBe('Two');await expect(back).toBeEnabled();await expect(forward).toBeDisabled();
  await r.page.evaluate(()=>history.pushState({},'', '/same-document'));await expect(back).toBeEnabled();await back.click();await expect.poll(()=>r.page.url()).toBe(`http://127.0.0.1:${site.address().port}/two`);await expect(forward).toBeEnabled();
  await r.page.getByRole('link',{name:'Broken page'}).click();
  await expect(page.locator('.stream-overlay')).toContainText('Page navigation failed');
  await expect(page.locator('.stream-overlay')).toContainText('Back or Reload');
  assert.doesNotMatch(await page.locator('.stream-overlay').innerText(),/never-expose-me|unapproved/);
  await expect(back).toBeEnabled();await back.click();await expect.poll(()=>r.page.locator('h1').textContent()).toBe('Two');await expect(page.locator('.stream-overlay')).toHaveCount(0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
});
