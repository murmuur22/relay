// Compiled Svelte + genuine management APIs. No route mocks or injected authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {chromium,expect} from '@playwright/test';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function lab(operator=false){
 const runtime=await mkdtemp(tmpdir()+'/gateway-inline-');let g,browser;
 try{
  const config={version:2,mode:'reverse-proxy',bind:'127.0.0.1',port:await freePort(),desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy:'127.0.0.1',targets:[{id:'existing',label:'Existing readable target',upstream:'http://127.0.0.1:18302'}]};
  await writeFile(runtime+'/gateway-managed.json',JSON.stringify(config),{mode:0o600});g=await createGateway({port:0,runtime,profile:'standalone',...(operator?{gatewayConfigPath:runtime+'/gateway-managed.json'}:{})});
  browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);await browserLogin(page,g.origin,runtime);
  const auth=await authenticate(g.origin,runtime),api=client(g.origin,auth);
  return {runtime,g,browser,page,api,config,async close(){await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}};
 }catch(e){await browser?.close();await g?.close();await rm(runtime,{recursive:true,force:true});throw e;}
}
async function wizard(page){await page.getByRole('button',{name:'Open Control Panel',exact:true}).dblclick();await page.getByRole('tab',{name:'Apps',exact:true}).click();await page.getByRole('button',{name:'Add app',exact:true}).click();await page.getByLabel('Gateway (experimental)',{exact:true}).check();await page.getByRole('button',{name:'Next',exact:true}).click();}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
test('inline target is a separate protected save; app draft, new selection and saved target survive app cancel',{timeout:40000},async()=>{
 const l=await lab();const {page}=l;
 try{
  await wizard(page);await page.getByLabel('App name',{exact:true}).fill('Kept app draft');await page.getByRole('combobox',{name:/^Icon(?! group)/}).selectOption('folder');
  await expect(page.getByRole('combobox',{name:'Gateway target',exact:true})).toContainText('Existing readable target');
  await button(page,'Create new target').click();await expect(page.getByRole('region',{name:'Create Gateway target',exact:true})).toBeVisible();
  await expect(page.getByLabel('Gateway connection mode',{exact:true})).toHaveCount(0);
  for(const [name,value] of [['Target ID','new-target'],['Target name','New readable target'],['Service address','http://127.0.0.1:18303']])await page.getByLabel(name,{exact:true}).fill(value);
  await button(page,'Cancel target').click();await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Kept app draft');
  assert.equal(JSON.parse(await readFile(l.runtime+'/gateway-managed.json')).targets.length,1);
  await button(page,'Create new target').click();
  for(const [name,value] of [['Target ID','new-target'],['Target name','New readable target'],['Service address','http://127.0.0.1:18303']])await page.getByLabel(name,{exact:true}).fill(value);
  await button(page,'Check target configuration').click();await button(page,'Save target separately').click();
  await expect(page.getByText(/ends all active Gateway app sessions/)).toBeVisible();
  await page.getByRole('checkbox',{name:'I have configured DNS and HTTPS trust for the intended clients.',exact:true}).check();await page.getByLabel('Current password for gateway changes',{exact:true}).fill('wrong-password');await button(page,'Confirm gateway settings').click();
  await expect(page.getByRole('alert')).toContainText('Current password required');assert.equal(JSON.parse(await readFile(l.runtime+'/gateway-managed.json')).targets.length,1);
  await button(page,'Refresh gateway status').click();
  for(const [name,value] of [['Target ID','new-target'],['Target name','New readable target'],['Service address','http://127.0.0.1:18303']])await page.getByLabel(name,{exact:true}).fill(value);
  await button(page,'Check target configuration').click();await button(page,'Save target separately').click();await page.getByRole('checkbox',{name:'I have configured DNS and HTTPS trust for the intended clients.',exact:true}).check();await page.getByLabel('Current password for gateway changes',{exact:true}).fill(password);await button(page,'Confirm gateway settings').click();
  await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Kept app draft');await expect(page.getByRole('combobox',{name:'Gateway target',exact:true})).toHaveValue('new-target');await expect(page.getByRole('combobox',{name:/^Icon(?! group)/})).toHaveValue('folder');
  await expect(page.getByText(/saved separately.*Cancel.*app/i)).toBeVisible();
  await button(page,'Cancel').click();assert.equal(l.g.accounts.state.services.length,0);assert.equal(JSON.parse(await readFile(l.runtime+'/gateway-managed.json')).targets.length,2);
  await button(page,'Add app').click();await page.getByLabel('Gateway (experimental)',{exact:true}).check();await button(page,'Next').click();await page.getByLabel('App name',{exact:true}).fill('Saved target app');await page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('new-target');await button(page,'Next').click();await button(page,'Next').click();await button(page,'Next').click();await button(page,'Save app').click();await expect(button(page,'Edit app Saved target app')).toBeVisible();assert.equal(l.g.accounts.state.services[0].gateway.target,'new-target');
  await page.reload();await page.getByRole('tab',{name:'Gateway',exact:true}).click();
  const table=page.getByRole('table',{name:'Gateway targets',exact:true});await expect(table).toBeVisible();await expect(table.getByRole('row')).toHaveCount(3);await expect(page.getByLabel('Service address',{exact:true})).toHaveCount(0);
  await table.scrollIntoViewIfNeeded();await mkdir('screenshots',{recursive:true});await page.screenshot({path:'screenshots/069-gateway-targets-wide.png'});await page.setViewportSize({width:560,height:900});await table.scrollIntoViewIfNeeded();await page.screenshot({path:'screenshots/069-gateway-targets-narrow.png'});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await button(page,'Edit target New readable target').click();await expect(page.getByLabel('Target ID',{exact:true})).toHaveValue('new-target');await button(page,'Cancel target edits').click();await expect(table).toBeVisible();
 }catch(error){console.log('INLINE FAILURE visible UI:',await page.locator('.settings-body').innerText());throw error;}finally{await l.close();}
});

test('inline target editor loses authority on genuine logout without persisting a target',{timeout:20000},async()=>{
 const l=await lab();try{await wizard(l.page);await button(l.page,'Create new target').click();await l.page.getByLabel('Target name',{exact:true}).fill('Never saved');await l.page.evaluate(async()=>{const s=await(await fetch('/api/session')).json();await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:'{}'});});await button(l.page,'Check target configuration').click();await expect(l.page.getByLabel('username',{exact:true})).toBeVisible();assert.equal(JSON.parse(await readFile(l.runtime+'/gateway-managed.json')).targets.length,1);await expect(l.page.getByRole('region',{name:'Create Gateway target'})).toHaveCount(0);}finally{await l.close();}
});
test('operator targets remain selectable but inline creation cannot overwrite operator configuration',{timeout:20000},async()=>{
 const l=await lab(true);try{const before=await readFile(l.runtime+'/gateway-managed.json');await wizard(l.page);await l.page.getByLabel('App name',{exact:true}).fill('Operator draft');await button(l.page,'Create new target').click();await expect(l.page.getByText('Managed by the server operator',{exact:true})).toBeVisible();await expect(l.page.getByLabel('Service address',{exact:true})).toHaveCount(0);await expect(button(l.page,'Save target separately')).toHaveCount(0);await button(l.page,'Cancel target').click();await expect(button(l.page,'Create new target')).toBeFocused();await expect(l.page.getByLabel('App name',{exact:true})).toHaveValue('Operator draft');await l.page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('existing');assert.equal((await l.api('/admin/gateway','PUT',{config:l.config,password})).status,409);assert.deepEqual(await readFile(l.runtime+'/gateway-managed.json'),before);}finally{await l.close();}
});
test('wizard semantic grant table persists exact selected user identities and rejects nonadmin grants',{timeout:25000},async()=>{
 const l=await lab();const {page}=l;try{
  const a=await(await l.api('/admin/users','POST',{username:'alex',password,role:'user',grants:[]})).json(),b=await(await l.api('/admin/users','POST',{username:'blair',password,role:'user',grants:[]})).json();assert.ok(a.id&&b.id);
  await wizard(page);await page.getByLabel('App name',{exact:true}).fill('Granted target');await page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('existing');await button(page,'Next').click();await button(page,'Next').click();
  const table=page.getByRole('table',{name:'App access',exact:true});await expect(table).toBeVisible();await expect(table.getByRole('row')).toHaveCount(3);await expect(table.getByRole('checkbox',{name:'alex',exact:true})).toBeVisible();await expect(table.getByText(/^Allow /)).toHaveCount(0);
  await table.getByRole('checkbox',{name:'alex',exact:true}).check();await table.getByRole('checkbox',{name:'blair',exact:true}).focus();await page.keyboard.press('Space');await expect(table.getByRole('checkbox',{name:'blair',exact:true})).toBeChecked();await table.getByRole('checkbox',{name:'blair',exact:true}).uncheck();
  await page.setViewportSize({width:560,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mkdir('screenshots',{recursive:true});await page.screenshot({path:'screenshots/069-grants-narrow.png'});
  await button(page,'Next').click();await button(page,'Save app').click();await expect(button(page,'Edit app Granted target')).toBeVisible();const app=l.g.accounts.state.services.find(s=>s.label==='Granted target');assert.ok(app);await page.reload();
  const users=await(await l.api('/admin/users')).json();assert.ok(users.find(u=>u.id===a.id).grants.includes(app.id));assert.ok(!users.find(u=>u.id===b.id).grants.includes(app.id));
  const reader=await authenticate(l.g.origin,l.runtime,'alex'),api=client(l.g.origin,reader);assert.equal((await api('/admin/apps','POST',{kind:'web',mode:'gateway',label:'Forbidden',gateway:{target:'existing'},userIds:[b.id]})).status,403);
 }finally{await l.close();}
});
