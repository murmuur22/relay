import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin} from '../auth-helper.mjs';

test('a slow streamed preview can be cancelled from the wizard',{timeout:30000},async()=>{
 let stalled=false,disconnected=false;
 const fixture=http.createServer((req,res)=>{if(req.url==='/stall'){stalled=true;res.on('close',()=>disconnected=true);return;}res.setHeader('Content-Type','text/html');res.end('<h1>Slow fixture</h1><script src="/stall"></script>');});
 await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
 const runtime=await mkdtemp(tmpdir()+'/relay-cancel-preview-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await browserLogin(page,g.origin,runtime);
  const button=name=>page.getByRole('button',{name,exact:true});await button('Navigation').click();await button('Control Panel').click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await button('Add app').click();await page.getByLabel('Streamed',{exact:true}).check();await button('Next').click();await page.getByLabel('App name',{exact:true}).fill('Slow app');await page.getByLabel('Address',{exact:true}).fill(`http://127.0.0.1:${fixture.address().port}/`);await button('Next').click();await button('Preview').click();
  await expect.poll(()=>stalled).toBe(true);await expect(button('Cancel')).toBeEnabled({timeout:1000});await button('Cancel').click();await expect(page.getByRole('table',{name:'Apps',exact:true})).toBeVisible();
  await expect.poll(()=>disconnected,{timeout:2500}).toBe(true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(runtime,{recursive:true,force:true});}
});
