import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {guidedLab,password} from '../guided-helper.mjs';
import {gatewayLab,addGateway} from '../gateway-helper.mjs';
const MiB=1024*1024;
test('upload cap survives actual CLI create, compiled panel edit and reverse readback',{timeout:30000},async()=>{
 const l=await guidedLab();let browser;try{
  const grant=await(await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:60})).json(),file=l.dir+'/token';await writeFile(file,grant.token,{mode:0o600});
  const run=(command,body)=>new Promise((resolve,reject)=>{const args=['tools/relay-agent.mjs',command,'--url',l.relay.origin,'--loopback-http','--token-file',file,'--json'];if(body)args.push('--input','-');const child=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.stderr.resume();child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>{try{assert.equal(code,0);resolve(JSON.parse(out));}catch(e){reject(e);}});child.stdin.end(body?JSON.stringify(body):undefined);});
  let state=await run('state'),plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{label:'Forum target',upstream:l.origin,maxRequestBytes:24*MiB}}});await run('apply',plan);
  await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.goto(l.relay.origin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.isVisible())await bypass.click();
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();
  const edit=async()=>{await page.getByRole('button',{name:'Edit target Forum target',exact:true}).click();await page.getByText('Advanced target options',{exact:true}).click();};
  await edit();const options=page.getByLabel('Target options JSON',{exact:true});const data=JSON.parse(await options.inputValue());assert.equal(data.maxRequestBytes,24*MiB);data.maxRequestBytes=2*MiB;
  await options.fill(JSON.stringify(data));await page.getByRole('button',{name:'Check configuration',exact:true}).click();await page.getByRole('button',{name:'Apply gateway changes',exact:true}).click();await page.getByLabel('I have configured DNS and HTTPS trust for the intended clients.',{exact:true}).check();await page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await page.getByRole('button',{name:'Confirm gateway settings',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh gateway status',exact:true})).toBeEnabled();
  state=await run('state');assert.equal(state.targets.find(t=>t.id==='forum').maxRequestBytes,2*MiB);assert.equal((await(await l.api('/admin/gateway')).json()).config.targets.find(t=>t.id==='forum').maxRequestBytes,2*MiB);
  plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'forum',set:{maxRequestBytes:24*MiB}}});await run('apply',plan);
  await page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();await edit();await expect(options).toHaveValue(/"maxRequestBytes": 25165824/);
 }finally{await browser?.close();await l.close();}
});
for(const optIn of [false,true])test('real multipart browser form '+(optIn?'accepts opted-in upload':'shows a useful 413 and can reopen'),{timeout:30000},async()=>{
 let l,browser,uploads=0;
 const upstream=http.createServer((req,res)=>{
  if(req.method==='POST'){uploads++;let bytes=0;req.on('data',b=>bytes+=b.length);req.on('end',()=>{res.setHeader('content-type','text/html');res.end('<h1>Upload received</h1><p>'+bytes+'</p>');});return;}
  res.writeHead(200,{'content-type':'text/html','referrer-policy':'same-origin'});res.end('<!doctype html><h1>Upload fixture</h1><form action="/upload" method="post" enctype="multipart/form-data"><label>Attachment<input name="attachment" type="file"></label><button>Upload</button></form>');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{
  l=await gatewayLab({targets:[{id:'files',label:'Files',upstream:`http://127.0.0.1:${upstream.address().port}`,...(optIn?{maxRequestBytes:24*MiB}:{})}]});await addGateway(l);
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.relay.test 127.0.0.1','--no-proxy-server']});const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.goto(l.relay.experimentalGateway.desktopOrigin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.isVisible())await bypass.click();await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await page.getByRole('button',{name:'Open Files',exact:true}).dblclick();
  const frame=page.frameLocator('iframe[title="Files"]');await expect(frame.getByRole('heading',{name:'Upload fixture',exact:true})).toBeVisible();
  await frame.getByLabel('Attachment',{exact:true}).setInputFiles({name:'synthetic.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(2*MiB)});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/upload');await frame.getByRole('button',{name:'Upload',exact:true}).click();assert.equal((await response).status(),optIn?200:413);
  await expect(frame.getByRole('heading',{name:optIn?'Upload received':'Upload too large',exact:true})).toBeVisible();assert.equal(uploads,optIn?1:0);
  if(!optIn){await expect(frame.getByText(/Use Back to return to the form/)).toBeVisible();await page.getByRole('button',{name:'End app session',exact:true}).click();await page.getByRole('button',{name:'Reopen app',exact:true}).click();await expect(frame.getByRole('heading',{name:'Upload fixture',exact:true})).toBeVisible();}
 }finally{await browser?.close();await l?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
