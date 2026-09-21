import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {launchBrowser,routeWeb} from '../../server/web-browser.mjs';
import {Transport} from '../../server/transport.mjs';

async function fixture(fn){const server=http.createServer(fn);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};}
test('runtime script URLs can exceed registration length but remain bounded',async()=>{
 const script='/script.js?q='+'x'.repeat(4096);let loaded=false;
 const site=await fixture((req,res)=>{res.setHeader('Content-Type',req.url===script?'application/javascript':'text/html');if(req.url===script){loaded=true;res.end('document.body.dataset.loaded="yes";');}else res.end(`<body><script src="${script}"></script></body>`);});
 const transport=new Transport();let browser;
 try{assert.throws(()=>transport.registration(site.origin+script));browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:site.origin+'/'},transport);const page=await context.newPage();await install(page);await page.goto(site.origin+'/');assert.equal(loaded,true);assert.equal(await page.getAttribute('body','data-loaded'),'yes');await assert.rejects(transport.request(site.origin+'/?'+'x'.repeat(32768),{address:site.origin+'/'}));}
 finally{await browser?.close();await transport.close();await site.close();}
});

test('redirects reject unapproved origins and bound loops without contacting forbidden targets',async()=>{
 let forbiddenHits=0,loopHits=0;
 const forbidden=await fixture((req,res)=>{forbiddenHits++;res.end('must not load');});
 const site=await fixture((req,res)=>{if(req.url.startsWith('/loop')){loopHits++;res.writeHead(302,{location:'/loop?n='+loopHits});}else res.writeHead(302,{location:forbidden.origin+'/secret'});res.end();});
 const transport=new Transport();let browser;
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:site.origin+'/'},transport);const page=await context.newPage();await install(page);await assert.rejects(page.goto(site.origin+'/',{timeout:5000}));assert.equal(forbiddenHits,0);await assert.rejects(page.goto(site.origin+'/loop',{timeout:5000}));assert.equal(loopHits,11);}
 finally{await browser?.close();await transport.close();await site.close();await forbidden.close();}
});

test('redirect hops re-vet DNS before the pinned connection',async()=>{
 let hits=0,lookups=0;const site=await fixture((req,res)=>{hits++;res.writeHead(302,{location:'/next'});res.end();});const origin=site.origin.replace('127.0.0.1','fixture.invalid');
 const transport=new Transport({lookup:async()=>[{address:++lookups===1?'127.0.0.1':'169.254.169.254',family:4}]});let browser;
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:origin+'/'},transport);const page=await context.newPage();await install(page);await assert.rejects(page.goto(origin+'/',{timeout:5000}));assert.equal(hits,1);assert.equal(lookups,2);}
 finally{await browser?.close();await transport.close();await site.close();}
});

for(const status of [302,307])test(`redirect ${status} preserves browser method, cookies and destination security policy`,async()=>{
 let received;const site=await fixture(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<form method="POST" action="/send"><input name="text" value="fixture"><button>Submit</button></form>');return;}
  if(req.url==='/send'){res.writeHead(status,{location:'/result','set-cookie':['a=one; Path=/; HttpOnly','b=two; Path=/']});res.end();return;}
  if(req.url==='/result'){let body='';for await(const chunk of req)body+=chunk;received={method:req.method,cookie:req.headers.cookie,body};res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"script-src 'none'"});res.end('<body><h1>Result</h1><script>document.body.dataset.unsafe="yes"</script></body>');return;}res.end();
 });const transport=new Transport();let browser;
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:site.origin+'/'},transport);const page=await context.newPage();await install(page);await page.goto(site.origin+'/');await page.getByRole('button',{name:'Submit'}).click();await page.waitForURL(site.origin+'/result');assert.equal(received.method,status===302?'GET':'POST');assert.equal(received.body,status===302?'':'text=fixture');assert.match(received.cookie,/a=one/);assert.match(received.cookie,/b=two/);assert.equal(await page.getAttribute('body','data-unsafe'),null);}
 finally{await browser?.close();await transport.close();await site.close();}
});

test('browser-blocked redirect chains release capacity for later navigation',async()=>{
 let forbiddenHits=0;const other=await fixture((req,res)=>{forbiddenHits++;res.end('blocked by CSP');});
 const site=await fixture((req,res)=>{if(req.url==='/blocked'){res.writeHead(302,{location:other.origin+'/'});res.end();}else if(req.url==='/good'){res.writeHead(302,{location:'/result'});res.end();}else{res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"connect-src 'self'"});res.end('<h1>Capacity available</h1>');}});
 const transport=new Transport();let browser;
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:site.origin+'/',allowedOrigins:[other.origin]},transport);const page=await context.newPage();await install(page);await page.goto(site.origin+'/');await page.evaluate(async()=>{for(let i=0;i<140;i++)await fetch('/blocked').catch(()=>{});});assert.equal(forbiddenHits,0);await page.goto(site.origin+'/good',{timeout:5000});assert.equal(page.url(),site.origin+'/result');}
 finally{await browser?.close();await transport.close();await site.close();await other.close();}
});

test('redirect traversal commits the actual destination URL and origin with pinned subresources',async()=>{
 const hits=[];
 const destination=await fixture((req,res)=>{hits.push(req.url);res.setHeader('Content-Type',req.url==='/script.js'?'application/javascript':'text/html');res.end(req.url==='/script.js'?'document.body.dataset.loaded=location.origin;':'<h1>Destination</h1><script src="/script.js"></script>');});
 const destinationOrigin=destination.origin.replace('127.0.0.1','destination.invalid');
 const source=await fixture((req,res)=>{res.writeHead(302,{location:destinationOrigin+'/final'});res.end();});
 const transport=new Transport({lookup:async()=>[{address:'127.0.0.1',family:4}]});let browser;
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address:source.origin+'/',allowedOrigins:[destinationOrigin]},transport);const page=await context.newPage();await install(page);await page.goto(source.origin+'/',{timeout:5000});assert.equal(page.url(),destinationOrigin+'/final');assert.equal(await page.textContent('h1'),'Destination');assert.equal(await page.getAttribute('body','data-loaded'),destinationOrigin);assert.ok(hits.includes('/final')&&hits.includes('/script.js'));}
 finally{await browser?.close();await transport.close();await source.close();await destination.close();}
});
