import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {launchBrowser} from '../../server/web-browser.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('shutdown invariant deadline: '+label)),4000))]);}finally{clearTimeout(timer);}}
test('successful shutdown leaves no active session or live new-generation browser, with no close rejection',{timeout:15000},async()=>{
 const root=await mkdtemp(tmpdir()+'/ind-shutdown-success-'),g=await createGateway({port:0,runtime:root});const browsers=[],ack=deferred(),entered=deferred();let closing,originalClose;
 try{
  const auth=await authenticate(g.origin,root),api=client(g.origin,auth),old=[...g.sessions.values()][0];const b=await launchBrowser();browsers.push(b);old.manager.browserPromise=Promise.resolve(b);assert.equal((await api('/windows','POST',{appId:'notes-lab'})).status,200);const oldResource=await old.manager.ensure(old.manager.windows.get('notes-lab'));
  originalClose=b.close.bind(b);b.close=async()=>{entered.resolve();await ack.promise;await originalClose();};closing=g.close();await bounded(entered.promise,'real old browser close entered');assert.equal(oldResource.page.isClosed(),true,'ordinary context closure already acknowledged');
  const info=await(await fetch(g.origin+'/api/auth')).json();const response=await bounded(fetch(g.origin+'/api/login',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username:'admin',password})}),'genuine login during shutdown');let freshResource,freshBrowser;
  if(response.status===200){
   const cookie=response.headers.get('set-cookie').split(';')[0],session=await(await fetch(g.origin+'/api/session',{headers:{cookie}})).json(),fresh=[...g.sessions.values()].find(s=>s.id!==old.id);assert.ok(fresh);const request=client(g.origin,{cookie,s:session});assert.equal((await request('/windows','POST',{appId:'notes-lab'})).status,200);freshBrowser=await launchBrowser();browsers.push(freshBrowser);fresh.manager.browserPromise=Promise.resolve(freshBrowser);freshResource=await bounded(fresh.manager.ensure(fresh.manager.windows.get('notes-lab')),'genuine new page');
  }
  ack.resolve();await bounded(closing,'normal shutdown acknowledgement');
  const observed={loginStatus:response.status,shutdownFulfilled:true,activeSessions:g.sessions.size,retiringSessions:g.retiringSessions.size,newPageClosed:freshResource?.page.isClosed(),newBrowserConnected:freshBrowser?.isConnected(),gatewayListening:g.server.listening};console.log('SHUTDOWN INVARIANT receipt',JSON.stringify(observed));
  // Admission could be rejected OR safely included in shutdown. Only the final ownership invariant matters.
  assert.equal(g.sessions.size,0,'successful shutdown cannot leave newly admitted active sessions');assert.equal(freshBrowser?.isConnected()||false,false,'successful shutdown cannot leave a live new browser');assert.equal(freshResource?.page.isClosed()??true,true);
 }finally{ack.resolve();if(closing)await closing.catch(()=>{});if(originalClose)browsers[0].close=originalClose;for(const b of browsers)await b.close();await g.close();await rm(root,{recursive:true,force:true});}
});
