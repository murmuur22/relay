// Real verified HTTPS, genuine Relay authority; synthetic upstream CSRF boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {gatewayLab,launchGateway,redeemGateway,edgeRequest,password} from '../gateway-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';

async function fixture(t,policy={},trust='valid'){
 const seed=await gatewayLab();let lab,upstream;const seen=[];
 t.after(async()=>{try{await lab?.close();}finally{if(upstream?.listening){upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}await seed.close();assert.equal(upstream?.listening??false,false);}});
 const canonical=()=>`https://127.0.0.1:${upstream.address().port}`;
 upstream=https.createServer({key:seed.experimentalGateway.key,cert:seed.cert},(req,res)=>{
  req.resume();seen.push({method:req.method,origin:req.headers.origin,referer:req.headers.referer,forwarded:req.headers['x-forwarded-host'],cookie:req.headers.cookie});
  if(['GET','HEAD'].includes(req.method)){res.setHeader('Set-Cookie','csrftoken=synthetic-private; Path=/; Secure; HttpOnly');res.end('form');return;}
  res.writeHead(req.headers.origin===canonical()&&req.headers.cookie==='csrftoken=synthetic-private'&&req.headers['x-csrftoken']==='synthetic-valid'?204:403);res.end();
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 lab=await gatewayLab({gatewayConfig:{desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test'},targets:[{id:'forum',label:'Forum',upstream:canonical(),tls:{...(trust==='untrusted'?{}:{ca:seed.cert.toString()}),serverName:trust==='wrong-name'?'wrong.example.test':'desktop.relay.test'},cookieNames:['csrftoken'],requestHeaders:['x-csrftoken'],...policy}]});
 const user=await(await lab.api('/admin/users','POST',{username:'reader',password})).json();assert(user.id);
 const appResponse=await lab.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Forum',gateway:{target:'forum'},userIds:[user.id]});assert.equal(appResponse.status,200);const app=await appResponse.json();
 const api=client(lab.relay.origin,await authenticate(lab.relay.origin,lab.dir+'/state','reader'));
 const launch=await launchGateway(lab,app,api),cap=await redeemGateway(lab,launch);assert.equal(cap.status,200);
 const request=(method='POST',headers={},cookie=cap.cookie)=>edgeRequest(lab,launch.origin,'/join/',{method,headers:Object.fromEntries(Object.entries({origin:launch.origin,cookie,'x-csrftoken':'synthetic-valid',...headers}).filter(([,value])=>value!==undefined))});
 const form=await request('GET');assert.equal(form.status,trust==='valid'?200:502);assert.equal(form.headers['set-cookie'],undefined,'upstream CSRF cookie stays private');
 if(trust==='valid')assert.equal(seen.at(-1).origin,undefined);else assert.equal(seen.length,0,'invalid TLS cannot reach upstream HTTP');
 return {lab,app,api,launch,cap,request,seen,ca:seed.cert,canonical:canonical()};
}

test('authorized HTTPS mutation supplies canonical upstream Origin only after authority checks',{timeout:20000},async t=>{
 const f=await fixture(t,{httpOrigin:'upstream'});
 // Positive control proves verified TLS, cookie and token fixture validity independently.
 const direct=await new Promise((resolve,reject)=>{const q=https.request(f.canonical+'/join/',{method:'POST',ca:f.ca,servername:'desktop.relay.test',headers:{origin:f.canonical,cookie:'csrftoken=synthetic-private','x-csrftoken':'synthetic-valid'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.end();});
 // The upstream uses seed's distinct certificate, not the edge's certificate.
 assert.equal(direct,204);
 const response=await f.request('POST',{referer:'https://attacker.example/form','x-forwarded-host':'attacker.example','x-forwarded-proto':'http'});
 assert.equal(f.seen.at(-1).cookie,'csrftoken=synthetic-private');
 assert.equal(f.seen.at(-1).referer,undefined);assert.equal(f.seen.at(-1).forwarded,undefined);
 assert.equal(response.status,204,'valid enrolled/granted mutation rejected because upstream Origin is omitted');
 assert.equal(f.seen.at(-1).origin,f.canonical);
 for(const method of ['PUT','PATCH','DELETE']){assert.equal((await f.request(method)).status,204);assert.equal(f.seen.at(-1).origin,f.canonical);}
 for(const method of ['GET','HEAD']){assert.equal((await f.request(method)).status,200);assert.equal(f.seen.at(-1).origin,undefined);}
 const count=f.seen.length;
 for(const origin of ['https://attacker.example','null','',undefined])assert.equal((await f.request('POST',{origin})).status,403);
 for(const site of ['cross-site','same-site','none',''])assert.equal((await f.request('POST',{'sec-fetch-site':site})).status,403);
 assert.equal((await f.request('OPTIONS')).status,403);
 assert.equal(f.seen.length,count,'denied authority must never reach upstream');
 const outsider=await(await f.lab.api('/admin/users','POST',{username:'outsider',password})).json();
 const unrelated=await(await f.lab.api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Unrelated',gateway:{target:'forum'},userIds:[outsider.id]})).json();
 const outsideApi=client(f.lab.relay.origin,await authenticate(f.lab.relay.origin,f.lab.dir+'/state','outsider'));
 assert.equal((await outsideApi('/gateway/launch','POST',{appId:f.app.id})).status,403);
 assert.equal((await outsideApi('/admin/users')).status,403);
 const otherLaunch=await launchGateway(f.lab,unrelated,outsideApi),otherCap=await redeemGateway(f.lab,otherLaunch);
 assert.equal((await f.request('POST',{},otherCap.cookie)).status,403);assert.equal(f.seen.length,count);
 assert.equal((await f.request('POST',{'x-csrftoken':'wrong'})).status,403,'upstream still enforces token');
 assert.equal((await f.lab.api('/admin/users/'+outsider.id,'PATCH',{grants:[]})).status,200);
 assert.equal((await edgeRequest(f.lab,otherLaunch.origin,'/join/',{method:'POST',headers:{origin:otherLaunch.origin,cookie:otherCap.cookie}})).status,403);
 assert.equal((await f.lab.api('/admin/users/'+(await(await f.api('/session')).json()).user.id,'PATCH',{grants:[]})).status,200);
 const retired=f.seen.length;assert.equal((await f.request()).status,403);assert.equal(f.seen.length,retired);
});

for(const trust of ['untrusted','wrong-name'])test('httpOrigin opt-in preserves '+trust+' TLS denial',{timeout:20000},async t=>{
 const f=await fixture(t,{httpOrigin:'upstream'},trust);assert.equal((await f.request()).status,502);assert.equal(f.seen.length,0);
});

for(const policy of [{},{httpOrigin:'omit'}])test('default/explicit omission retains secure upstream denial '+JSON.stringify(policy),{timeout:20000},async t=>{
 const f=await fixture(t,policy);assert.equal((await f.request()).status,403);assert.equal(f.seen.at(-1).origin,undefined);assert.equal(f.seen.at(-1).referer,undefined);
});
