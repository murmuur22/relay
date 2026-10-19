import {test,expect} from '@playwright/test';
const snapshot=()=>({protocol:1,mode:'fixture',capabilities:{prepare:1,apply:1},canPrepare:true,canApply:false,canInstall:true,currentVersion:'v0.3.0',available:[{version:'v0.4.0',verified:true,size:100,notes:'SYNTHETIC FIXTURE — not a published release\n\nA readable release note.\n'+'Details remain readable while monitoring refreshes.\n'.repeat(40)},{version:'v0.3.0',verified:true,size:90,notes:'Synthetic installed release.'}],history:[],job:null});
const ready=()=>({id:'a'.repeat(32),version:'v0.4.0',kind:'prepare',phase:'ready',canCancel:true,downloadedBytes:100,totalBytes:100,events:[]});
async function fixture(page,state){const calls=[];await page.route('**/updater/api/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();calls.push({name,body:route.request().postDataJSON()});await route.fulfill({json:name==='auth'?{authenticated:true,csrf:'synthetic',interfaceAnimations:false,relayOrigin:'http://127.0.0.1:4180'}:state});});return calls;}
async function consent(page){await expect(page.locator('#authorize')).toBeDisabled();await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirmed')).not.toBeChecked();await page.locator('#confirmed').check();await page.locator('#password').fill('synthetic-password');await expect(page.locator('#authorize')).toBeEnabled();}
const mutations=calls=>calls.filter(c=>['prepare','apply','install','cancel','rollback'].includes(c.name));
test('C release workspace prepares with fresh consent and preserves nonzero scroll, text selection and focus while polling',async({page})=>{
 const state=snapshot(),calls=await fixture(page,state);await page.goto('/updater/');
 await page.getByRole('button',{name:'Download & prepare',exact:true}).click();await expect(page.locator('#confirm-description')).toContainText('keeps running');await consent(page);await page.locator('#authorize').click();
 await expect(page.getByRole('dialog')).not.toBeVisible();expect(mutations(calls)).toEqual([{name:'prepare',body:{version:'v0.4.0',password:'synthetic-password',confirmed:true}}]);
 await page.locator('#release-select').selectOption('v0.3.0');await page.locator('#release-select').focus();state.available.reverse();
 const count=calls.filter(c=>c.name==='state').length;await expect.poll(()=>calls.filter(c=>c.name==='state').length).toBeGreaterThan(count);
 await expect(page.locator('#release-select')).toHaveValue('v0.3.0');await expect(page.locator('#release-select')).toBeFocused();
 await page.locator('#release-select').selectOption('v0.4.0');await page.locator('#release-detail').evaluate(el=>el.scrollTop=180);const scroll=await page.locator('#release-detail').evaluate(el=>el.scrollTop);expect(scroll).toBeGreaterThan(0);
 await page.locator('#release-notes').evaluate(el=>{const range=document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,25);getSelection().removeAllRanges();getSelection().addRange(range);});
 const selection=await page.evaluate(()=>getSelection().toString()),before=calls.filter(c=>c.name==='state').length;
 await expect.poll(()=>calls.filter(c=>c.name==='state').length).toBeGreaterThan(before+1);
 expect(await page.evaluate(()=>getSelection().toString())).toBe(selection);expect(await page.locator('#release-detail').evaluate(el=>el.scrollTop)).toBe(scroll);await expect(page.locator('#release-select')).toBeFocused();await expect(page.locator('#install')).toBeInViewport();
});
for(const [change,alter] of [
 ['job replaced',s=>s.job.id='b'.repeat(32)],['version changed',s=>s.job.version='v0.5.0'],['ready lost',s=>s.job.phase='cancelled'],['permission lost',s=>s.canApply=false],['capability lost',s=>s.capabilities.apply=0]
])test('Apply consent retires permanently after '+change,async({page})=>{
 const state={...snapshot(),job:ready(),canApply:true},original=structuredClone(state),calls=await fixture(page,state);await page.goto('/updater/');await page.locator('#apply').click();await consent(page);alter(state);state.currentVersion='invalidating-poll';
 await expect(page.locator('#current-version')).toHaveText('invalidating-poll');await expect(page.locator('#authorize')).toBeDisabled();await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#confirm-error')).toContainText('review again');
 Object.assign(state,original,{currentVersion:'restoring-poll'});await expect(page.locator('#current-version')).toHaveText('restoring-poll');await page.locator('#password').fill('synthetic-password');await page.locator('#confirmed').check();await page.locator('#confirm-form').dispatchEvent('submit');await expect(page.locator('#authorize')).toBeDisabled();expect(mutations(calls)).toEqual([]);
 await page.locator('#back').click();await page.locator('#apply').click();await consent(page);await page.locator('#authorize').click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(mutations(calls)).toEqual([{name:'apply',body:{version:'v0.4.0',jobId:'a'.repeat(32),password:'synthetic-password',confirmed:true}}]);
 // A successful mocked POST alone must never label installation complete.
 await expect(page.locator('#phase')).toHaveText('Ready to apply');
});
test('Apply connectivity freezes consent, never retries, and rejection clears password without optimistic success',async({page})=>{
 const state={...snapshot(),job:ready(),canApply:true},calls=await fixture(page,state);let offline=false;
 await page.route('**/updater/api/state',r=>r.fulfill({status:offline?503:200,json:state}));await page.route('**/updater/api/apply',r=>{calls.push({name:'apply',body:r.request().postDataJSON()});return r.fulfill({status:403,json:{error:'denied'}});});
 await page.goto('/updater/');await page.locator('#apply').click();await consent(page);offline=true;await expect(page.locator('#connection')).toContainText('last known state');await expect(page.locator('#authorize')).toBeDisabled();await page.locator('#confirm-form').dispatchEvent('submit');expect(mutations(calls)).toEqual([]);
 offline=false;await expect(page.locator('#connection')).toHaveText('Connected to updater');await expect(page.locator('#authorize')).toBeEnabled();expect(mutations(calls)).toEqual([]);await page.locator('#authorize').click();await expect(page.locator('#confirm-error')).toContainText('Authorization was not accepted');await expect(page.locator('#password')).toHaveValue('');await expect(page.locator('#authorize')).toBeDisabled();await expect(page.locator('#phase')).toHaveText('Ready to apply');expect(mutations(calls)).toHaveLength(1);
});
for(const capabilities of [undefined,{prepare:true,apply:1},{prepare:1,apply:2}])test('old or malformed broker fails closed: '+JSON.stringify(capabilities),async({page})=>{
 const state={...snapshot(),capabilities,job:ready(),canApply:true},calls=await fixture(page,state);await page.goto('/updater/');await expect(page.locator('#apply')).toBeDisabled();await expect(page.locator('#install-reason')).toContainText('No immediate-install fallback');await expect(page.locator('#install-reason')).toContainText('separately qualified');await page.locator('#apply').dispatchEvent('click');await expect(page.getByRole('dialog')).not.toBeVisible();expect(mutations(calls)).toEqual([]);
});
