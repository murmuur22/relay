import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {launchBrowser,routeWeb} from '../../server/web-browser.mjs';
import {Transport} from '../../server/transport.mjs';

const limit=1024*1024;
async function paused(request){
 const cdp=new EventEmitter(),context=new EventEmitter(),page={};const calls=[];
 let settled;const done=new Promise(resolve=>settled=resolve);
 cdp.send=async(method)=>{if(['Fetch.failRequest','Fetch.fulfillRequest'].includes(method))settled(method);};
 context.routeWebSocket=async()=>{};context.newCDPSession=async()=>cdp;context.pages=()=>[page];
 const install=await routeWeb(context,{}, {request:async(_url,_config,options)=>{calls.push(options.body);return {status:200,headers:{},body:Buffer.alloc(0)};}});await install(page);
 cdp.emit('Fetch.requestPaused',{requestId:'fixture',request:{url:'http://fixture.invalid/',method:'POST',headers:{},...request}});
 return {result:await done,calls};
}

test('CDP body budget rejects aggregate decoded bytes before allocating buffers',async t=>{
 const entries=[{bytes:Buffer.alloc(limit/2).toString('base64')},{bytes:Buffer.alloc(limit/2+1).toString('base64')}];
 const original=Buffer.from,decoded=[];
 t.mock.method(Buffer,'from',function(value,encoding,...rest){if(encoding==='base64')decoded.push(value.length);return original(value,encoding,...rest);});
 const {result,calls}=await paused({hasPostData:true,postDataEntries:entries});
 assert.equal(result,'Fetch.failRequest');assert.equal(calls.length,0);assert.deepEqual(decoded,[],'No partial decoding before aggregate validation');
});

test('CDP incomplete bodies fail closed and exact body boundary is accepted',async()=>{
 for(const request of [{hasPostData:true},{hasPostData:true,postDataEntries:[{}]}, {hasPostData:true,postDataEntries:[]}, {hasPostData:true,postData:'partial',headers:{'Content-Length':'100'}}, {hasPostData:true,postDataEntries:[{bytes:'!!!!'}]}, {postData:'é'.repeat(limit/2+1)}]){
  const {result,calls}=await paused(request);assert.equal(result,'Fetch.failRequest');assert.equal(calls.length,0);
 }
 for(const request of [{hasPostData:true,postDataEntries:[{bytes:Buffer.alloc(limit,7).toString('base64')}]},{postData:'é'.repeat(limit/2)}]){
  const {result,calls}=await paused(request);assert.equal(result,'Fetch.fulfillRequest');assert.equal(calls[0].length,limit);
 }
});

test('real binary and multipart requests accept exactly 1 MiB and deny oversized bodies before transport',async()=>{
 const received=[];const site=http.createServer(async(req,res)=>{if(req.method==='POST'){let size=0;for await(const chunk of req)size+=chunk.length;received.push(size);res.end('ok');}else{res.setHeader('Content-Type','text/html');res.end('<h1>Body fixture</h1>');}});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${site.address().port}`,transport=new Transport(),bodies=[];const send=transport.request.bind(transport);transport.request=(url,config,options)=>{if(options.method==='POST')bodies.push(options.body?.length);return send(url,config,options);};let browser;
 try{
  browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:origin+'/'},transport);const page=await context.newPage();await install(page);await page.goto(origin+'/');
  const outcomes=await page.evaluate(async limit=>{
   const out=[];
   for(const size of [limit,limit+1])for(const multipart of [false,true]){
    let body=new Uint8Array(size),headers={};
    if(multipart){const prefix='--fixture\r\nContent-Disposition: form-data; name="file"; filename="fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\n',suffix='\r\n--fixture--\r\n';body=new Blob([prefix,new Uint8Array(size-prefix.length-suffix.length),suffix]);headers={'Content-Type':'multipart/form-data; boundary=fixture'};}
    out.push(await fetch('/upload',{method:'POST',headers,body}).then(r=>r.ok,()=>false));
   }
   const form=new FormData();form.append('file',new Blob([new Uint8Array(limit)]),'fixture.bin');out.push(await fetch('/upload',{method:'POST',body:form}).then(r=>r.ok,()=>false));return out;
  },limit);
  assert.deepEqual(outcomes,[true,true,false,false,false]);assert.deepEqual(received,[limit,limit]);assert.deepEqual(bodies,[limit,limit],'Oversized bodies never reach transport');
 }finally{await browser?.close();await transport.close();site.closeAllConnections();await new Promise(r=>site.close(r));}
});
