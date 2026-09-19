import {chromium} from 'playwright';
import http from 'node:http';
import {fail} from './accounts.mjs';
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
export async function routeWeb(context,config,transport,signal){
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();context.once('close',()=>{abort();signal?.removeEventListener('abort',abort);});let pending=0;
 await context.routeWebSocket('**/*',ws=>ws.close());
 await context.route('**/*',async route=>{
  if(pending>=8)return route.abort();pending++;
  try{
   const request=route.request();if(request.isNavigationRequest()&&request.frame().parentFrame()===null&&context.pages().indexOf(request.frame().page())!==0)throw Error('Popup blocked');
   const response=await transport.request(request.url(),config,{method:request.method(),headers:await request.allHeaders(),body:request.postDataBuffer(),signal:controller.signal});
   // Playwright's fulfill serialization splits newline-separated Set-Cookie values.
   const headers=Object.fromEntries(Object.entries(response.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(k==='set-cookie'?'\n':', '):String(v)]));
   await route.fulfill({status:response.status,headers,body:response.body});
  }catch{await route.abort().catch(()=>{});}finally{pending--;}
 });
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
  await routeWeb(context,config,transport,controller.signal);const page=await context.newPage();context.on('page',p=>{if(p!==page)void p.close().catch(()=>{});});
  await page.goto(config.address,{waitUntil:'domcontentloaded',timeout:7000});
  const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:2500});controller.signal.throwIfAborted();if(bytes.length>1024*1024)throw fail(400,'Preview too large');
  return {image:'data:image/jpeg;base64,'+bytes.toString('base64'),checkedAt:Date.now(),detail:'Isolated Relay browser preview. WebSockets and file transfers are unsupported.'};
 }catch(e){throw fail(400,'Preview unavailable: page blocked, unresponsive or unsupported.');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await closeBrowser();}
}
