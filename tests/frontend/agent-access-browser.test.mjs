import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {guidedLab,password} from '../guided-helper.mjs';
import {authenticate,client} from '../auth-helper.mjs';
import {spawn} from 'node:child_process';
import {writeFile,stat,access} from 'node:fs/promises';
import {join} from 'node:path';
const evidence=process.env.RELAY_AGENT_EVIDENCE;
function cli(l,file,command,body){return new Promise((resolve,reject)=>{const args=['tools/relay-agent.mjs',command,'--url',l.relay.origin,'--loopback-http','--token-file',file,'--json'];if(body)args.push('--input','-');const child=spawn(process.execPath,args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>resolve({code,data:JSON.parse(code?err:out)}));child.stdin.end(body?JSON.stringify(body):undefined);});}
async function issued(page,l,file,scope='configure'){
 await page.getByLabel('Agent scope',{exact:true}).selectOption(scope);await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/admin/agent-access')&&r.request().method()==='POST');await page.getByRole('button',{name:'Issue credential',exact:true}).click();const r=await response;assert.equal(r.status(),200);const g=await r.json();
 await writeFile(file,g.token,{mode:0o600});assert.equal((await stat(file)).mode&0o777,0o600);
 await page.waitForFunction(()=>!!document.querySelector('textarea[autocomplete="off"]')?.value);
 await page.getByRole('button',{name:'Hide credential',exact:true}).click();await page.waitForFunction(()=>![...document.querySelectorAll('textarea')].some(e=>e.value));
 assert.equal(await page.getByLabel('Current password for Agent access',{exact:true}).inputValue(),'');
 return {id:g.id,scope:g.scope};
}

async function login(page,l){
 await page.goto(l.relay.origin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();
 await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();
 await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'System',exact:true}).click();
}
test('compiled System offers scoped short-lived Agent access and clears cancelled password',{timeout:30000},async()=>{
 const l=await guidedLab();let browser;try{
 await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);await login(page,l);
 await expect(page.getByRole('heading',{name:'Agent access',exact:true})).toBeVisible();
 await expect(page.getByLabel('Agent scope',{exact:true})).toHaveValue('read');await expect(page.getByLabel('Credential lifetime (seconds)',{exact:true})).toHaveValue('300');
 await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);await page.getByRole('button',{name:'Cancel Agent access',exact:true}).click();await expect(page.getByLabel('Current password for Agent access',{exact:true})).toHaveValue('');
 }finally{await browser?.close();await l.close();}
});
test('compiled credential issuance and genuine CLI/panel stable-ID roundtrip, stale plan and revoke',{timeout:45000},async()=>{
 const l=await guidedLab();let browser;const file=join(l.dir,'agent-token');try{
 await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);await login(page,l);
 const grant=await issued(page,l,file);
 const run=async(cmd,body)=>{const r=await cli(l,file,cmd,body);assert.equal(r.code,0);return r.data;};
 let state=await run('state');let plan=await run('plan',{expectedRevision:state.revision,change:{type:'target',id:'panel-cli',set:{label:'CLI target',upstream:l.origin}}});await run('apply',plan);
 state=await run('state');plan=await run('plan',{expectedRevision:state.revision,change:{type:'app',id:null,set:{label:'CLI app',gateway:{target:'panel-cli'},userIds:[]}}});const app=await run('apply',plan),id=app.objectId;
 await page.getByRole('tab',{name:'Gateway',exact:true}).click();await page.getByRole('button',{name:'Refresh gateway status',exact:true}).click();await expect(page.getByRole('table',{name:'Gateway targets',exact:true})).toContainText('panel-cli');
 await page.getByRole('button',{name:'Reload Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await expect(page.locator('#edit-app-'+id)).toBeVisible();
 state=await run('state');const stale=await run('plan',{expectedRevision:state.revision,change:{type:'app',id,set:{label:'Stale edit'}}});
 await page.locator('#edit-app-'+id).click();await expect(page.getByRole('combobox',{name:'Gateway target',exact:true})).toHaveValue('panel-cli');await page.getByLabel('App label',{exact:true}).fill('Panel edit');await page.getByRole('button',{name:'Save app',exact:true}).click();
 state=await run('state');assert.equal(state.apps.find(a=>a.id===id).label,'Panel edit');const refused=await cli(l,file,'apply',stale);assert.equal(refused.code,1);assert.equal(refused.data.error.status,409);
 plan=await run('plan',{expectedRevision:state.revision,change:{type:'app',id,set:{label:'CLI reverse'}}});await run('apply',plan);
 await page.getByRole('button',{name:'Reload Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await expect(page.locator('#edit-app-'+id)).toHaveAccessibleName('Edit app CLI reverse');
 if(evidence)await page.screenshot({path:join(evidence,'canonical-app-token-hidden.png')});
 await page.getByRole('tab',{name:'System',exact:true}).click();await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);await page.getByRole('button',{name:'Revoke credential '+grant.id,exact:true}).click();await expect(page.getByRole('table',{name:'Active agent credentials',exact:true})).not.toContainText(grant.id);
 const revoked=await cli(l,file,'state');assert.equal(revoked.code,1);assert.equal(revoked.data.error.status,401);
 const read=await issued(page,l,file,'read');state=(await cli(l,file,'state')).data;const denied=await cli(l,file,'plan',{expectedRevision:state.revision,change:{type:'app',id,set:{label:'Denied'}}});assert.equal(denied.code,1);assert.equal(denied.data.error.status,403);
 await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);await page.getByRole('button',{name:'Revoke credential '+read.id,exact:true}).click();await expect(page.getByRole('table',{name:'Active agent credentials',exact:true})).not.toContainText(read.id);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/token|credential|agent/i.test(k))),false);
 if(evidence){await page.getByRole('heading',{name:'Agent access',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'agent-access-token-hidden.png')});await writeFile(join(evidence,'roundtrip-identities.json'),JSON.stringify({targetId:'panel-cli',appId:id,credentialFileMode:'0600',staleStatus:409,revokedStatus:401,readOnlyStatus:403})+'\n');}
 }finally{await browser?.close();await l.close();await assert.rejects(access(l.dir));}
});
test('compiled disclosure survives held inventory but still clears on hide, leave and actual expiry',{timeout:30000},async()=>{
 const l=await guidedLab();let browser,release;
 try{
  await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage();page.setDefaultTimeout(5000);await login(page,l);
  await expect(page.getByRole('button',{name:'Refresh Agent access',exact:true})).toBeEnabled();
  for(const action of ['hide','leave','expire']){
   await page.getByLabel('Credential lifetime (seconds)',{exact:true}).fill(action==='expire'?'3':'30');
   let entered;const pending=new Promise(r=>entered=r),barrier=new Promise(r=>release=r),handlers=[];
   const hold=route=>{const task=(async()=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();entered();await barrier;await route.fulfill({response});})();handlers.push(task);return task;};
   await page.route('**/api/admin/agent-access',hold);
   try{
    await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);
    const issuance=page.waitForResponse(r=>r.url().endsWith('/api/admin/agent-access')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Issue credential',exact:true}).click();const response=await issuance;assert.equal(response.status(),200);const grant=await response.json();await pending;
    await page.waitForFunction(()=>!!document.querySelector('textarea[autocomplete="off"]')?.value);
    // Cross the real one-second expiry interval while holding only the genuine inventory response.
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('textarea[autocomplete="off"]').count(),1,'Pending inventory must not erase unexpired disclosure');
    assert.equal((await (await l.api('/admin/agent-access')).json()).some(g=>g.id===grant.id&&g.expires>Date.now()),true);
    if(action==='hide')await page.getByRole('button',{name:'Hide credential',exact:true}).click();
    else if(action==='leave')await page.getByRole('tab',{name:'Apps',exact:true}).click();
    else await page.waitForFunction(()=>!document.querySelector('textarea[autocomplete="off"]'));
    assert.equal(await page.locator('textarea[autocomplete="off"]').count(),0);
    release();await Promise.all(handlers);await page.unroute('**/api/admin/agent-access',hold);
    if(action==='leave')await page.getByRole('tab',{name:'System',exact:true}).click();
    await expect(page.getByRole('button',{name:'Refresh Agent access',exact:true})).toBeEnabled();
    assert.equal(await page.locator('textarea[autocomplete="off"]').count(),0,'Completing inventory must not redisclose a cleared credential');
   }finally{release?.();try{await Promise.all(handlers);}finally{await page.unroute('**/api/admin/agent-access',hold);}}
  }
 }finally{release?.();try{await browser?.close();}finally{await l.close();}}
});
test('compiled disclosure leaves no credential after cancel, tab leave, expiry, wrong password or regular-user login',{timeout:30000},async()=>{
 const l=await guidedLab();let browser;try{
 await l.api('/onboarding/complete','POST',{});await l.api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});
 browser=await chromium.launch({headless:true,chromiumSandbox:true});const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(5000);await login(page,l);
 const region=page.getByRole('region',{name:'Agent access',exact:true});
 await page.getByLabel('Current password for Agent access',{exact:true}).fill('Incorrect-password');await page.getByRole('button',{name:'Issue credential',exact:true}).click();await expect(region.getByRole('alert')).toContainText('Current password required');assert.equal(await page.getByLabel('Current password for Agent access',{exact:true}).inputValue(),'');
 async function issue(){await page.getByLabel('Current password for Agent access',{exact:true}).fill(password);const pending=page.waitForResponse(r=>r.url().endsWith('/api/admin/agent-access')&&r.request().method()==='POST');await page.getByRole('button',{name:'Issue credential',exact:true}).click();const response=await pending;assert.equal(response.status(),200);await page.waitForFunction(()=>!!document.querySelector('textarea[autocomplete="off"]')?.value);return response.json();}
 let g=await issue();
 const privateValue=g.token;assert.equal(await page.evaluate(value=>Object.values(localStorage).some(v=>v.includes(value))||Object.values(sessionStorage).some(v=>v.includes(value))||location.href.includes(value),privateValue),false);
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:l.relay.origin});await page.getByRole('button',{name:'Copy credential',exact:true}).click();assert.equal(await page.evaluate(async value=>(await navigator.clipboard.readText())===value,privateValue),true);await page.evaluate(()=>navigator.clipboard.writeText(''));
 await page.getByRole('button',{name:'Cancel Agent access',exact:true}).click();assert.equal(await page.locator('textarea').count(),0);
 await issue();await page.getByRole('tab',{name:'Apps',exact:true}).click();assert.equal(await page.locator('textarea').count(),0);await page.getByRole('tab',{name:'System',exact:true}).click();assert.equal(await page.locator('textarea').count(),0);
 await page.getByLabel('Credential lifetime (seconds)',{exact:true}).fill('1');await issue();await page.waitForFunction(()=>!document.querySelector('textarea[autocomplete="off"]'));
 const current=await (await l.api('/admin/agent-access')).json();for(const item of current)assert.equal((await l.api('/admin/agent-access/'+item.id,'DELETE',{password})).status,200);
 const created=await l.api('/admin/users','POST',{username:'ordinary',password,role:'user',grants:[]});assert.equal(created.status,200);
 const ordinary=await authenticate(l.relay.origin,l.dir+'/state','ordinary');const ordinaryApi=client(l.relay.origin,ordinary);assert.equal((await ordinaryApi('/admin/agent-access')).status,403);assert.equal((await ordinaryApi('/admin/agent-access','POST',{password,scope:'configure',ttlSeconds:30})).status,403);
 await page.goto(l.relay.origin);await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('username',{exact:true}).fill('ordinary');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await page.getByRole('button',{name:'Navigation',exact:true}).click();await expect(page.getByRole('button',{name:'Control Panel',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Agent access',exact:true})).toHaveCount(0);
 }finally{await browser?.close();await l.close();}
});
