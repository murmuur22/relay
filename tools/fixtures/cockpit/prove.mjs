// Opt-in real disposable Cockpit proof, not production/device qualification.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {gatewayLab,addGateway,launchGateway,redeemGateway,edgeRequest} from '../../../tests/gateway-helper.mjs';
const stateFile=process.env.RELAY_COCKPIT_FIXTURE_STATE;
if(!stateFile)throw Error('Explicit private disposable fixture state required.');
const state=JSON.parse(await readFile(stateFile,'utf8'));
const fixtureURL=new URL(state.upstream);
assert.equal(fixtureURL.hostname,'127.0.0.1');assert.equal(state.username,'learner');
const ca=await readFile(state.caPath,'utf8');
const l=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'},targets:[{id:'files',label:'Disposable Cockpit',upstream:state.upstream,tls:{ca,serverName:state.serverName},entryPath:'/',cookieNames:['cockpit'],webSocketPaths:['/cockpit/socket'],webSocketProtocols:['cockpit1'],webSocketOrigin:'upstream',accessPolicy:'admin-only'}]});
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Disposable proof deadline exceeded')),8000);})]);}finally{clearTimeout(timer);}}
let ws;
try{
 const app=await addGateway(l),launch=await launchGateway(l,app),cap=await redeemGateway(l,launch);
 const login=await edgeRequest(l,launch.origin,'/cockpit/login',{headers:{cookie:cap.cookie,authorization:'Basic '+Buffer.from(state.username+':'+state.password).toString('base64')}});
 assert.equal(login.status,200,'real Cockpit login through Relay succeeds');
 const returning=await edgeRequest(l,launch.origin,'/cockpit/login',{headers:{cookie:cap.cookie}});
 assert.equal(returning.status,200,'private gateway cookie jar retains Cockpit session');
 ws=new WebSocket(launch.origin.replace('https:','wss:')+'/cockpit/socket',['cockpit1'],{ca:l.cert,handshakeTimeout:5000,lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{origin:launch.origin,cookie:cap.cookie}});
 ws.on('error',()=>{});
 const initial=new Promise((resolve,reject)=>{ws.on('message',data=>{const text=data.toString();if(text.startsWith('\n')){const m=JSON.parse(text.slice(1));if(m.command==='init')resolve(m);if(m.command==='close')reject(Error('Cockpit refused live session: '+m.problem));}});ws.once('error',()=>reject(Error('Cockpit gateway WebSocket failed')));});
 const init=await bounded(initial);assert.equal(init.version,1);assert.equal(ws.protocol,'cockpit1');
 ws.send('\n'+JSON.stringify({command:'init',version:1}));
 const proof=new Promise((resolve,reject)=>{ws.on('message',data=>{const text=data.toString();if(text==='proof\nrelay-fixture-proof')resolve(true);if(text.startsWith('\n')){const m=JSON.parse(text.slice(1));if(m.command==='close'&&m.channel==='proof'&&m.problem)reject(Error('Disposable bridge proof failed: '+m.problem));}});});
 ws.send('\n'+JSON.stringify({command:'open',channel:'proof',payload:'stream',spawn:['/usr/bin/printf','relay-fixture-proof']}));
 assert.equal(await bounded(proof),true);
 const closed=once(ws,'close');
 const end=await l.api('/gateway/end','POST',{appId:app.id,launchId:launch.launchId});assert.equal(end.status,200);await bounded(closed);
 assert.equal((await edgeRequest(l,launch.origin,'/cockpit/login',{headers:{cookie:cap.cookie}})).status,403);
 assert.deepEqual(l.relay.experimentalGateway.stats(),{routes:0,tickets:0,caps:0,active:0});
 const result={passed:true,scope:'Actual disposable Cockpit HTTP/WSS via genuine Relay APIs; no browser/top-level handoff qualification',login:true,sessionCookie:true,protocol:ws.protocol,authenticatedBridgeCommand:true,endClosesSocket:true,retainedCapabilityDenied:true};
 if(process.env.RELAY_COCKPIT_RESULT)await writeFile(process.env.RELAY_COCKPIT_RESULT,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{ws?.terminate();await l.close();}
