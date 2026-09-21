import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {createGateway} from '../../server/gateway.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';

test('navigation API enforces session, exact Origin, CSRF, grants and direction-only payloads',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-navigation-api-');const g=await createGateway({port:0,runtime});
 try{const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);await api('/windows','POST',{appId:'notes-lab'});const r=await g.manager.ensure(g.manager.windows.get('notes-lab'));
 const endpoint='/windows/notes-lab/navigate';
 assert.equal((await fetch(g.origin+'/api'+endpoint,{method:'POST'})).status,401);
 for(const headers of [{Origin:g.origin},{Origin:'http://localhost:'+new URL(g.origin).port,'X-CSRF-Token':auth.s.csrf}])assert.equal((await fetch(g.origin+'/api'+endpoint,{method:'POST',headers:{cookie:auth.cookie,'Content-Type':'application/json',...headers},body:JSON.stringify({direction:'back'})})).status,403);
 for(const body of [{direction:'https://example.com'}, {direction:'back',url:'http://example.com'}, {direction:'reload'}, {},null,[]])assert.equal((await api(endpoint,'POST',body)).status,400);
 const response=await api(endpoint,'POST',{direction:'back'});assert.equal(response.status,200);const navigation=await response.json();assert.equal(navigation.canGoBack,false);assert.equal(navigation.busy,false);assert.equal(r.page.url(),'http://relay-synthetic.invalid/notes-lab');
 await api('/admin/users','POST',{username:'viewer',password,grants:[]});const denied=client(g.origin,await authenticate(g.origin,runtime,'viewer'));assert.equal((await denied(endpoint,'POST',{direction:'back'})).status,403);
 const other=client(g.origin,await authenticate(g.origin,runtime));assert.equal((await other(endpoint,'POST',{direction:'back'})).status,400,'Other sessions cannot control this page');
 await api('/windows','POST',{appId:'parcels'});assert.equal((await api('/windows/parcels/navigate','POST',{direction:'back'})).status,400,'No fake native iframe history');
 }finally{await g.close();await rm(runtime,{recursive:true,force:true});}
});

test('a disconnect during the first history read removes the stream client',async()=>{
 const runtime=await mkdtemp(tmpdir()+'/relay-history-attach-');const g=await createGateway({port:0,runtime});let release;
 try{const api=client(g.origin,await authenticate(g.origin,runtime));await api('/windows','POST',{appId:'notes-lab'});const m=g.manager,r=await m.ensure(m.windows.get('notes-lab'));const send=r.cdp.send.bind(r.cdp);let reached;const waiting=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>release=resolve);
 r.cdp.send=async(method,...args)=>{if(method==='Page.getNavigationHistory'){reached();await gate;}return send(method,...args);};
 const ws=new EventEmitter();ws.readyState=1;ws.bufferedAmount=0;ws.send=()=>{};ws.close=()=>{ws.readyState=3;ws.emit('close');};
 const attaching=m.attach('notes-lab',ws);await waiting;ws.close();release();await attaching;assert.equal(r.clients.size,0);
 }finally{release?.();await g.close();await rm(runtime,{recursive:true,force:true});}
});

for(const action of ['navigate','reload'])test(`${action} has one active action, and logout cancels slow navigation without waiting on the write queue`,async()=>{
 let slow=false,started;const hit=new Promise(r=>started=r);const site=http.createServer((req,res)=>{if(slow&&req.url==='/one'){started();return;}res.setHeader('Content-Type','text/html');res.end('<h1>Fixture</h1>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const runtime=await mkdtemp(tmpdir()+'/relay-navigation-cancel-');const g=await createGateway({port:0,runtime,profile:'standalone'});
 try{const api=client(g.origin,await authenticate(g.origin,runtime));const address=`http://127.0.0.1:${site.address().port}`;const app=await(await api('/admin/apps','POST',{kind:'web',mode:'stream',label:'Fixture',address:address+'/one'})).json();await api('/windows','POST',{appId:app.id});const r=await g.manager.ensure(g.manager.windows.get(app.id));if(action==='navigate')await r.page.goto(address+'/two');slow=true;
 const pending=api('/windows/'+app.id+'/'+action,'POST',action==='navigate'?{direction:'back'}:{});await hit;assert.equal((await api('/windows/'+app.id+'/navigate','POST',{direction:'forward'})).status,429);
 const before=Date.now();assert.equal((await api('/logout','POST')).status,200);assert.ok(Date.now()-before<2000,'Logout must cancel rather than await the upstream timeout');assert.ok([400,401].includes((await pending).status));assert.equal(g.sessions.size,0);
 }finally{await g.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}
});
