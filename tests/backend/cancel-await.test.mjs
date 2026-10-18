import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {WebSocket} from 'ws';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const phase=process.env.RELAY_CANCEL_PHASE||'newPage';
function bounded(p,label,ms=4000){let timer;return Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('DIAG-067 bounded wait: '+label)),ms))]).finally(()=>clearTimeout(timer));}
test('genuine demotion during real '+phase+' settles creation and releases resources',{timeout:30000},async()=>{
 const root=await mkdtemp(tmpdir()+'/relay-cancel-'),g=await createGateway({port:0,runtime:root,profile:'development'});let browser,ws,manager,demotion,attachDone;
 try{
  const admin=await authenticate(g.origin,root),api=client(g.origin,admin);manager=g.manager;
  assert.equal((await api('/admin/users','POST',{username:'operator',role:'admin',password})).status,200);
  const op=client(g.origin,await authenticate(g.origin,root,'operator'));
  assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);
  browser=await launchBrowser();manager.browserPromise=Promise.resolve(browser);
  let began;const started=new Promise(r=>began=r);
  const trigger=()=>{if(demotion)return;console.log('DIAG-067 cancel at',phase,Math.round(performance.now()));demotion=op('/admin/users/'+admin.s.user.id,'PATCH',{role:'user'});began();};
  const nc=browser.newContext.bind(browser);browser.newContext=async(...args)=>{const creating=nc(...args);if(phase==='newContext')trigger();const c=await creating;
   for(const method of ['newPage','newCDPSession']){const old=c[method].bind(c);c[method]=(...a)=>{const pending=old(...a);if(phase===method)trigger();return pending;};}return c;};
  const attach=manager.attach.bind(manager);manager.attach=(...args)=>attachDone=attach(...args);
  ws=new WebSocket(g.origin.replace('http','ws')+'/ws/stream/notes-lab',{headers:{cookie:admin.cookie,Origin:g.origin}});ws.on('error',()=>{});
  await bounded(started,'target phase reached');const response=await bounded(demotion,'demotion response');assert.equal(response.status,200);
  await bounded(attachDone,'actual attach completion');assert.equal(g.sessions.has([...g.sessions.values()].find(s=>s.userId===admin.s.user.id)?.id),false);
  assert.equal(manager.resources.size,0);assert.equal(manager.opening.size,0);assert.equal(browser.contexts().length,0);assert.equal(manager.closed,true);
  assert.equal((await api('/session')).status,401);console.log('DIAG-067 authority revoked, demotion and attach settled, zero contexts/resources');
 }finally{
  ws?.terminate();if(browser)await bounded(browser.close(),'owned browser finalizer');
  if(attachDone)await bounded(attachDone.catch(()=>{}),'final attach');if(demotion)await bounded(demotion.catch(()=>{}),'final demotion');
  await bounded(g.close(),'gateway close');await rm(root,{recursive:true,force:true});console.log('DIAG-067 finalizer completed');
 }
});
