import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {guidedLab,password} from '../guided-helper.mjs';
import {browserLogin} from '../auth-helper.mjs';
import {mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const evidence=process.env.RELAY_GUIDED_EVIDENCE??(await realpath(tmpdir()))+'/relay-guided-evidence';
await mkdir(evidence,{recursive:true});
for(const scenario of ['normal','lost-response','target-lost-response'])test('compiled Add app creates guided Cockpit target, saves separately, registers and opens protected tab · '+scenario,{timeout:45000},async()=>{
 const l=await guidedLab();let browser;try{
 browser=await chromium.launch({headless:true,chromiumSandbox:true,args:[`--ignore-certificate-errors-spki-list=${l.spki}`,'--host-resolver-rules=MAP *.example.test 127.0.0.1','--no-proxy-server']});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await browserLogin(page,l.relay.origin,l.dir+'/state');
 await page.getByRole('button',{name:'Navigation',exact:true}).click();await page.getByRole('button',{name:'Control Panel',exact:true}).click();await page.getByRole('tab',{name:'Apps',exact:true}).click();await page.getByRole('button',{name:'Add app',exact:true}).click();await page.getByLabel('Gateway (experimental)',{exact:true}).check();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByLabel('App name',{exact:true}).fill('Guided Cockpit');await page.getByRole('button',{name:'Create new target',exact:true}).click();
 await page.getByRole('button',{name:'Set up Cockpit',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Destination',exact:true})).toBeVisible();assert.equal(l.hits.length,0);
 await page.getByLabel('Cockpit service origin',{exact:true}).fill(l.origin);await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Certificate',exact:true})).toBeVisible();await page.getByRole('button',{name:'Continue',exact:true}).click();
 for(const name of ['Login','Live channels','Display','Permissions']){await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await page.getByRole('button',{name:'Continue',exact:true}).click();}
 await expect(page.getByRole('heading',{name:'Review',exact:true})).toBeVisible();assert.equal(l.hits.length,0);
 await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);await page.getByRole('button',{name:'Check destination now',exact:true}).click();await expect(page.getByText('HTTP response: passed',{exact:true})).toBeVisible();await expect(page.getByText('Login: not-tested',{exact:true})).toBeVisible();
 await page.screenshot({path:evidence+'/guided-review.png'});
 if(scenario==='target-lost-response')await page.route('**/api/admin/gateway',async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');},{times:1});
 await page.getByLabel('I understand applying settings retires Gateway windows.',{exact:true}).check();await page.getByLabel('Current password for Cockpit setup',{exact:true}).fill(password);await page.getByRole('button',{name:'Save Cockpit target separately',exact:true}).click();
 if(scenario==='target-lost-response'){await expect(page.getByText(/Save outcome needs reconciliation/)).toBeVisible();await expect(page.getByRole('button',{name:'Save Cockpit target separately',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Cancel target',exact:true}).click();await page.getByRole('combobox',{name:'Gateway target',exact:true}).selectOption('cockpit');}
 await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Guided Cockpit');await expect(page.getByRole('combobox',{name:'Gateway target',exact:true})).toHaveValue('cockpit');for(let i=0;i<3;i++)await page.getByRole('button',{name:'Next',exact:true}).click();
 if(scenario==='lost-response')await page.route('**/api/admin/apps',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');},{times:1});
 await page.getByRole('button',{name:'Save app',exact:true}).click();
 if(scenario==='lost-response'){await expect(page.locator('.app-wizard').getByRole('alert')).toContainText('Gateway unreachable');await page.getByRole('button',{name:'Save app',exact:true}).click();}
 await expect(page.getByRole('button',{name:'Edit app Guided Cockpit',exact:true})).toBeVisible();
 const services=await (await l.api('/admin/services')).json();assert.equal(services.filter(s=>s.label==='Guided Cockpit').length,1);
 await page.goto(l.relay.experimentalGateway.desktopOrigin);const bypass=page.getByRole('button',{name:'[ESC] BYPASS INITIALIZATION',exact:true});if(await bypass.count())await bypass.click();await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter →',exact:true}).click();await page.getByRole('button',{name:'Open Guided Cockpit',exact:true}).dblclick();
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Open protected app tab',exact:true}).click()]);await expect(popup.getByRole('heading',{name:'Synthetic Cockpit destination',exact:true})).toBeVisible();assert.equal(await popup.evaluate(()=>opener===null),true);await popup.screenshot({path:evidence+'/guided-synthetic-open.png'});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await l.close();}
});
