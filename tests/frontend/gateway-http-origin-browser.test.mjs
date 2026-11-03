import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {guidedLab,password} from '../guided-helper.mjs';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';

test('httpOrigin survives actual CLI create, compiled panel edit and reverse readback',{timeout:30000},async()=>{
 const l=await guidedLab();let browser;try{
  const grant=await(await l.api('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:60})).json(),file=l.dir+'/token';await writeFile(file,grant.token,{mode:0o600});
  const run=(command,body)=>new Promise((resolve,reject)=>{const args=['tools/relay-agent.mjs',command,'--url',l.relay.origin,'--loopback-http','--token-file',file,'--json'];if(body)args.push('--input','-');const child=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>{try{assert.equal(code,0);resolve(JSON.parse(out));}catch(e){reject(e);}});child.stdin.end(body?JSON.stringify(body):undefined);});
  let state=await run('state'),plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'origin',set:{label:'Origin target',upstream:l.origin,httpOrigin:'upstream'}}});await run('apply',plan);
  await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.goto(l.relay.origin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.isVisible())await bypass.click();
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Gateway',exact:true}).click();
  const edit=async()=>{await page.getByRole('button',{name:'Edit target Origin target',exact:true}).click();await page.getByText('Advanced target options',{exact:true}).click();};
  await edit();const options=page.getByLabel('Target options JSON',{exact:true});assert.equal(JSON.parse(await options.inputValue()).httpOrigin,'upstream');
  await options.fill(JSON.stringify({httpOrigin:'omit'}));await page.getByRole('button',{name:'Check configuration',exact:true}).click();await page.getByRole('button',{name:'Apply gateway changes',exact:true}).click();await page.getByLabel('I have configured DNS and HTTPS trust for the intended clients.',{exact:true}).check();await page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await page.getByRole('button',{name:'Confirm gateway settings',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh gateway status',exact:true})).toBeEnabled();
  state=await run('state');assert.equal(state.targets.find(t=>t.id==='origin').httpOrigin,'omit');assert.equal((await(await l.api('/admin/gateway')).json()).config.targets.find(t=>t.id==='origin').httpOrigin,'omit');
  plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'origin',set:{httpOrigin:'upstream'}}});await run('apply',plan);
  await page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();await edit();await expect(options).toHaveValue(/"httpOrigin": "upstream"/);
 }finally{await browser?.close();await l.close();}
});
