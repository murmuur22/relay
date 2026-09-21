import {chromium} from 'playwright';
import http from 'node:http';
import {fail} from './accounts.mjs';
import {RUNTIME_URL_LIMIT} from './webapps.mjs';
export async function launchBrowser(){
 // This is an owned deny-only proxy, not an assumed unused port or an upstream proxy.
 // Any browser background/non-intercepted HTTP, CONNECT or upgrade fails closed.
 const deny=http.createServer((_req,res)=>{res.writeHead(403,{'Connection':'close'});res.end('Browser egress requires Relay interception.');});
 deny.on('connect',(_req,socket)=>socket.destroy());deny.on('upgrade',(_req,socket)=>socket.destroy());deny.on('clientError',(_err,socket)=>socket.destroy());
 deny.maxConnections=32;deny.requestTimeout=1000;deny.headersTimeout=1000;
 await new Promise((resolve,reject)=>{deny.once('error',reject);deny.listen(0,'127.0.0.1',resolve);});
 const shutdown=()=>{deny.closeAllConnections();return new Promise(resolve=>deny.close(resolve));};
 try{
  const browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:10000,args:['--disable-background-networking','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND'],proxy:{server:`http://127.0.0.1:${deny.address().port}`,bypass:'<-loopback>'}});
  browser.once('disconnected',()=>void shutdown());return browser;
 }catch(e){await shutdown();throw e;}
}
const REQUEST_BODY_LIMIT=1024*1024;
function requestBody(request){
 const entries=request.postDataEntries;
 let size=0;
 if(entries!==undefined){
  if(!Array.isArray(entries)||!entries.length)throw Error('Incomplete request body');
  // Validate the entire decoded budget before allocating even the first chunk.
  for(const entry of entries){
   const bytes=entry?.bytes;
   if(typeof bytes!=='string'||bytes.length%4||bytes.length>4*Math.ceil(REQUEST_BODY_LIMIT/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(bytes))throw Error('Invalid request body');
   size+=Buffer.byteLength(bytes,'base64');
   if(size>REQUEST_BODY_LIMIT)throw Error('Request body too large');
  }
 }else if(typeof request.postData==='string'){
  size=Buffer.byteLength(request.postData);
  if(size>REQUEST_BODY_LIMIT)throw Error('Request body too large');
 }else if(request.hasPostData)throw Error('Incomplete request body');
 const length=Object.entries(request.headers||{}).find(([name])=>name.toLowerCase()==='content-length')?.[1];
 if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)!==size))throw Error('Incomplete request body');
 if(entries)return Buffer.concat(entries.map(entry=>Buffer.from(entry.bytes,'base64')),size);
 return typeof request.postData==='string'?Buffer.from(request.postData):undefined;
}
export async function routeWeb(context,config,transport,signal){
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 context.once('close',()=>{abort();signal?.removeEventListener('abort',abort);});
 await context.routeWebSocket('**/*',ws=>ws.close());
 // Playwright routes only the first request of an HTTP redirect chain. Fetch
 // pauses EVERY hop, letting Chromium handle URL/origin, cookies, referrers,
 // CORS and redirect method semantics while all connections stay DNS-pinned.
 // Call and await this installer before navigating the one permitted page.
 return async page=>{
  const cdp=await context.newCDPSession(page);let pending=0;
  const chains=new Map();
  const finish=({requestId})=>{for(const [id,chain] of chains)if(chain.networkId===requestId)chains.delete(id);};
  cdp.on('Network.loadingFinished',finish);cdp.on('Network.loadingFailed',finish);
  cdp.on('Fetch.requestPaused',async event=>{
   const {requestId,request,redirectedRequestId,networkId}=event;
   for(const [id,chain] of chains)if(Date.now()-chain.started>=15000)chains.delete(id);
   const failRequest=()=>cdp.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});
   const previous=chains.get(redirectedRequestId);chains.delete(redirectedRequestId);
   const chain=previous||{hops:0,started:Date.now()};
   if(pending>=8||controller.signal.aborted||context.pages()[0]!==page)return void failRequest();
   pending++;
   try{
    if(redirectedRequestId&&!previous||chain.hops>10||Date.now()-chain.started>=15000)throw Error('Redirect limit');
    const response=await transport.request(request.url,config,{method:request.method,headers:request.headers,body:requestBody(request),signal:controller.signal,timeout:Math.min(5000,15000-(Date.now()-chain.started))});
    if([301,302,303,307,308].includes(response.status)&&response.headers.location){
     if(chain.hops>=10||chains.size>=128)throw Error('Redirect limit');
     // Syntax/origin checks now; DNS validation and pinning occur again on
     // the actual next request. Never fetch a destination on its old origin.
     transport.registration(new URL(response.headers.location,request.url).href,config,RUNTIME_URL_LIMIT);
     chains.set(requestId,{hops:chain.hops+1,started:chain.started,networkId});
    }
    const responseHeaders=Object.entries(response.headers).flatMap(([name,value])=>(Array.isArray(value)?value:[value]).map(v=>({name,value:String(v)})));
    await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:response.body.toString('base64')});
   }catch{chains.delete(requestId);await failRequest();}finally{pending--;}
  });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  return cdp;
 };
}
export async function previewWeb(config,transport,signal){
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,10000);let browser,closing;
 const closeBrowser=()=>browser?(closing??=browser.close().catch(()=>{})):Promise.resolve();
 controller.signal.addEventListener('abort',()=>{void closeBrowser();},{once:true});
 try{
  controller.signal.throwIfAborted();
  browser=await launchBrowser();controller.signal.throwIfAborted();
  const context=await browser.newContext({viewport:{width:960,height:600},serviceWorkers:'block',acceptDownloads:false});controller.signal.throwIfAborted();
  const install=await routeWeb(context,config,transport,controller.signal);const page=await context.newPage();context.on('page',p=>{if(p!==page)void p.close().catch(()=>{});});await install(page);
  await page.goto(config.address,{waitUntil:'domcontentloaded',timeout:7000});
  const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:2500});controller.signal.throwIfAborted();if(bytes.length>1024*1024)throw fail(400,'Preview too large');
  return {image:'data:image/jpeg;base64,'+bytes.toString('base64'),checkedAt:Date.now(),detail:'Isolated Relay browser preview. WebSockets and file transfers are unsupported.'};
 }catch(e){throw fail(400,'Preview unavailable: page blocked, unresponsive or unsupported.');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await closeBrowser();}
}
