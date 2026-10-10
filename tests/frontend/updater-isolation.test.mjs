import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';

// Real compiled host/auth/HTTP with a visibly synthetic protocol broker.
// This fixture does not install software or establish release provenance.
async function fixture(t){
 const root=await mkdtemp(tmpdir()+'/relay-monitor-isolation-');
 const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const uiOrigin=`http://127.0.0.1:${port}`;await writeFile(root+'/key',Buffer.alloc(32,7),{mode:0o600});
 let owner,logoutReads=0;
 const broker=net.createServer(socket=>{let text='';socket.on('data',b=>{text+=b;if(!text.includes('\n'))return;const request=JSON.parse(text);let result;
  if(request.action==='issue-ui'){owner=JSON.parse(Buffer.from(request.payload,'base64')).userId;result={ticket:'t'.repeat(64),expiresAt:Date.now()+60000};}
  else if(request.action==='redeem-ui')result={token:'r'.repeat(64),userId:owner,expiresAt:Date.now()+60000,interfaceAnimations:false};
  else result={mode:'fixture',currentVersion:'v0.6.3',available:[{version:'v0.6.4',verified:true,size:100,notes:'Synthetic protocol isolation fixture'}],job:null,history:[],canInstall:true};
  socket.end(JSON.stringify({ok:true,result})+'\n');
 });});await new Promise(r=>broker.listen(root+'/socket',r));
 const g=await createGateway({port:0,profile:'standalone',runtime:root+'/relay',updater:{socketPath:root+'/socket',keyFile:root+'/key',uiOrigin}});
 const web=await createUpdaterWeb({uiOrigin,relayOrigin:g.origin,socketPath:root+'/socket'});
 web.server.prependListener('request',req=>{if(req.url==='/updater/api/logout')logoutReads++;});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true}),context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(5000);
 const cleanups=[];
 t.after(async()=>{for(const cleanup of cleanups)await cleanup();await browser.close();await web.close();await g.close();await new Promise(r=>broker.close(r));await rm(root,{recursive:true,force:true});});
 await browserLogin(page,g.origin,root+'/relay');await page.getByRole('button',{name:'Open Updater',exact:true}).click();
 const browse=page.locator('[data-window-id="system-updater"]');await expect(browse.getByLabel('Available release')).toHaveValue('v0.6.4');
 const start=()=>browse.getByRole('button',{name:'Start update',exact:true}).click();
 const signout=async()=>{await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();};
 return {page,context,g,web,uiOrigin,start,signout,cleanups,runtime:root+'/relay',logoutReads:()=>logoutReads};
}

test('accepted launch cannot mount monitoring after explicit logout intent while logout response is held',{timeout:25000},async t=>{
 const {page,start,signout,cleanups}=await fixture(t);let launchArrived,releaseLaunch,logoutArrived,releaseLogout;
 const launched=new Promise(r=>launchArrived=r),launchGate=new Promise(r=>releaseLaunch=r),loggedOut=new Promise(r=>logoutArrived=r),logoutGate=new Promise(r=>releaseLogout=r);
 cleanups.push(async()=>{releaseLaunch();releaseLogout();await page.unrouteAll({behavior:'wait'});});
 await page.route('**/api/updater/launch',async route=>{const response=await route.fetch();assert.equal(response.status(),200);launchArrived();await launchGate;await route.fulfill({response}).catch(error=>{if(!page.isClosed())throw error;});},{times:1});
 await page.route('**/api/logout',async route=>{logoutArrived();await logoutGate;await route.continue();});
 await start();await launched;await signout();await loggedOut;
 const received=page.waitForResponse(r=>r.url().endsWith('/api/updater/launch'));releaseLaunch();await received;
 await expect(page.locator('iframe[title="Independent Relay updater"]')).toHaveCount(0);
 const logoutResponse=page.waitForResponse(r=>r.url()===new URL(page.url()).origin+'/api/logout');releaseLogout();await logoutResponse;await expect(page.getByLabel('username',{exact:true})).toBeVisible();
});

test('compiled host retires previous admin surface on genuine same-runtime demotion',{timeout:25000},async t=>{
 const {page,g,runtime,start}=await fixture(t);const admin=await authenticate(g.origin,runtime),a=client(g.origin,admin);
 assert.equal((await a('/admin/users','POST',{username:'review-admin',password,role:'admin',grants:[]})).status,200);
 const other=client(g.origin,await authenticate(g.origin,runtime,'review-admin'));
 await start();const frame=page.frameLocator('iframe[title="Independent Relay updater"]');await expect(frame.locator('#console')).toBeVisible();
 assert.equal((await other('/admin/users/'+admin.s.user.id,'PATCH',{role:'user'})).status,200);
 await expect(page.locator('iframe[title="Independent Relay updater"]')).toHaveCount(0,{timeout:8000});
 await expect(page.getByLabel('username',{exact:true})).toBeVisible();
});

test('host sign out verifies independent logout before discarding the concealed frame',{timeout:25000},async t=>{
 const {page,context,g,uiOrigin,start,signout,cleanups,logoutReads}=await fixture(t);let release;const gate=new Promise(r=>release=r);cleanups.push(async()=>{release();await page.unrouteAll({behavior:'wait'});});
 await start();await expect(page.frameLocator('iframe[title="Independent Relay updater"]').locator('#console')).toBeVisible();
 await page.getByRole('button',{name:'Close maintenance',exact:true}).click();
 await page.route(g.origin+'/api/logout',async route=>{await gate;await route.continue();});
 await signout();await expect.poll(logoutReads,{timeout:4000}).toBeGreaterThan(0);
 const auth=await context.request.get(uiOrigin+'/updater/api/auth');assert.equal((await auth.json()).authenticated,false,'Independent monitoring cookie must be ended even before Relay logout arrives');
 const response=page.waitForResponse(r=>r.url()===g.origin+'/api/logout');release();await response;await expect(page.getByLabel('username',{exact:true})).toBeVisible();
});
