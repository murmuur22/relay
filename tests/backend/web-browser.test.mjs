import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {launchBrowser} from '../../server/web-browser.mjs';
import {Transport} from '../../server/transport.mjs';
import {routeWeb} from '../../server/web-browser.mjs';
test('browser fallback egress is denied even when a browser request misses interception',async()=>{
 let hits=0;const site=http.createServer((req,res)=>{hits++;res.setHeader('Content-Type','text/html');res.end('<h1>Fixture</h1>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${site.address().port}/`;
 let browser;const transport=new Transport();
 try{browser=await launchBrowser();const context=await browser.newContext({serviceWorkers:'block'});const install=await routeWeb(context,{address},transport);const page=await context.newPage();const cdp=await install(page);await page.goto(address);assert.equal(await page.textContent('h1'),'Fixture');const routedHits=hits;
 await cdp.send('Fetch.disable');const response=await page.goto(address+'unrouted',{timeout:2500}).catch(()=>null);assert.equal(hits,routedHits);assert.ok(!response||response.status()===403);
 }finally{await browser?.close();await transport.close();await new Promise(r=>site.close(r));}
});
