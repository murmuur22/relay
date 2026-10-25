// Diagnostic-only observation. No request bodies, headers, account records or cookies.
import './protocol-buffered.mjs';
import {registerHooks} from 'node:module';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{const url=String(args[0]);const at=Date.now();(globalThis.__relayBoundary??=[]).push({event:'node-fetch-start',url,at});try{const r=await nativeFetch(...args);(globalThis.__relayBoundary??=[]).push({event:'node-fetch-headers',url,status:r.status,at:Date.now(),started:at});return r;}catch(e){(globalThis.__relayBoundary??=[]).push({event:'node-fetch-error',url,at:Date.now()});throw e;}};
export function instrument(source,url){
 const changes=[
 ['async function fixture(fn){',`async function fixture(fn){
 globalThis.__relayProtocol=[];globalThis.__relayBoundary=[];
 const boundary=globalThis.__relayBoundary;const mark=(event,extra={})=>boundary.push({event,at:Date.now(),...extra});let observedPage,fetchSnapshot=[];
 const requestKind=req=>(req.headers['user-agent']||'').includes('Mozilla/')?'browser':/undici|node/i.test(req.headers['user-agent']||'')?'node':/Playwright/i.test(req.headers['user-agent']||'')?'playwright':'other';`],
 ["g=await createGateway({port:0,runtime,profile:'standalone'});",`g=await createGateway({port:0,runtime,profile:'standalone'});
 g.server.on('connection',socket=>{const remotePort=socket.remotePort;mark('server-connection',{remotePort});socket.on('end',()=>mark('server-socket-end',{remotePort}));socket.on('close',hadError=>mark('server-socket-close',{remotePort,hadError}));});
 g.server.on('request',(req,res)=>{const extra={url:req.originalUrl||req.url,method:req.method,remotePort:req.socket.remotePort,requestKind:requestKind(req)};mark('server-arrival',extra);res.on('finish',()=>mark('server-response-finish',{...extra,status:res.statusCode}));});`],
 ["await page.goto(g.origin);",`observedPage=page;
 await page.addInitScript(()=>{const native=window.fetch;window.__diagRequests=[];window.fetch=async(...args)=>{const path=String(args[0]),history=[{event:'client-fetch-start',at:Date.now()}];const row={path,history};window.__diagRequests.push(row);try{const r=await native(...args);history.push({event:'client-fetch-headers',at:Date.now()});const json=r.json.bind(r);r.json=async()=>{const body=await json();history.push({event:'client-json-consumed',at:Date.now()});return body;};return r;}catch(e){history.push({event:'client-fetch-error',at:Date.now()});throw e;}};});
 await page.goto(g.origin);`],
 ["if(once||route.request().method()!=='POST'){await route.continue();return;}","if(once||route.request().method()!=='POST'){mark('route-pass-through',{method:route.request().method()});await route.continue();return;}"],
 ['await held;await route.fulfill({response});','await held;mark(\'fulfill-start\');await route.fulfill({response});mark(\'fulfill-ack\');'],
 ['async function settle(){release();await routeDone;',"async function settle(){mark('release');release();await routeDone;mark('route-handler-done');"],
 ["await page.waitForFunction(","mark('settle-wait-start');await page.waitForFunction("],
 ['await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));',"mark('settle-wait-ack');await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,300)));"],
 ['}finally{release?.();await routeDone.catch(()=>{});await browser?.close();await g?.close();site.closeAllConnections();await new Promise(r=>site.close(r));await rm(runtime,{recursive:true,force:true});}',` }finally{
 mark('teardown-start');try{fetchSnapshot=await observedPage?.evaluate(()=>window.__diagRequests)||[];}catch{mark('page-snapshot-unavailable');}
 release?.();await routeDone.catch(()=>{});mark('browser-close-start');await browser?.close();mark('browser-close-ack');await g?.close();mark('gateway-close-ack');site.closeAllConnections();await new Promise(r=>site.close(r));mark('site-close-ack');await rm(runtime,{recursive:true,force:true});mark('runtime-remove-ack');
 console.log('BOUNDARY-TRACE '+JSON.stringify({mode:process.env.DIAG_MODE,fixture:${JSON.stringify(url.split('/').pop())},trace:[...boundary,...(globalThis.__relayProtocol||[]),...fetchSnapshot.flatMap(f=>f.history.map(e=>({...e,path:f.path})))].sort((a,b)=>a.at-b.at),fetches:fetchSnapshot}));
 }`]
 ];
 for(const [old,replacement] of changes){if(source.split(old).length!==2)throw Error('Fixture observer seam not unique: '+old);source=source.replace(old,replacement);}
 return source;
}
registerHooks({load(url,context,next){const result=next(url,context);if(!/\/tests\/frontend\/personal-(launch-race|parallel-aba)\.test\.mjs$/.test(url))return result;return {...result,source:instrument(String(result.source),url)};}});
