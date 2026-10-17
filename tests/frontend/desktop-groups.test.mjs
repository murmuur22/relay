import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createGateway} from '../../server/gateway.mjs';
import {browserLogin,authenticate,client,password} from '../auth-helper.mjs';

async function fixture(fn){const runtime=await mkdtemp(process.env.TMPDIR+'/r67g-'),g=await createGateway({port:0,runtime,profile:'standalone'}),browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({viewport:{width:1100,height:850},hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(3000);
 const button=name=>page.getByRole('button',{name,exact:true});
 const read=()=>page.evaluate(async()=>await(await fetch('/api/desktop')).json());
 const api=(path,method,body)=>page.evaluate(async({path,method,body})=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,method,body});
 const folder=async name=>{await button('Navigation').click();await button('New folder').click();await page.getByLabel('Folder name').fill(name);await button('Create folder').click();await expect(button('Open '+name)).toBeVisible();};
 const drag=async(from,to)=>{const a=await button('Open '+from).boundingBox(),b=await button('Open '+to).boundingBox();await page.mouse.move(a.x+45,a.y+45);await page.mouse.down();await page.mouse.move(b.x+45,b.y+45,{steps:8});await page.mouse.up();};
 try{await page.goto((await readFile(runtime+'/setup-url.txt','utf8')).trim());await page.getByLabel('password',{exact:true}).fill(password);await button('Create admin').click();await button('Set up later').click();await expect(button('Open Updater')).toBeVisible();await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false});await fn({page,button,read,api,folder,drag,g,runtime});}finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}}

test('mixed app/folder group drag and keyboard/touch move commit a full batch',{timeout:45000},()=>fixture(async({page,button,read,api,folder,drag})=>{
 await folder('Box');await expect(button('Open Box').locator('svg')).toHaveAttribute('data-icon','pixel-folder');await folder('Notes');
 assert.equal((await api('/desktop/bookmarks','POST',{parentId:null,label:'Bookmark',url:'https://example.invalid/',icon:'pixel-bookmark'})).status,200);await page.reload();
 await button('Open Notes').click();await button('Open Bookmark').click({modifiers:['Control']});
 await expect(button('Open Notes')).toHaveAttribute('aria-pressed','true');await expect(button('Open Bookmark')).toHaveAttribute('aria-pressed','true');
 const before=await read(),box=before.items.find(i=>i.label==='Box');
 await drag('Notes','Box');
 await expect.poll(async()=>(await read()).items.filter(i=>['Notes','Bookmark'].includes(i.label)).map(i=>i.parentId)).toEqual([box.id,box.id]);
 await button('Open Box').dblclick();await expect(button('Open Notes')).toBeVisible();await expect(button('Open Notes')).toHaveAttribute('aria-pressed','false');
 await button('Open Notes').focus();await page.keyboard.press('Control+a');await expect(button('Open Bookmark')).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Control+Shift+m');await page.getByLabel('Destination').selectOption('');await button('Save').tap();
 await expect(button('Open Notes')).toHaveCount(0);await page.getByRole('link',{name:'Home',exact:true}).click();await expect(button('Open Notes')).toBeVisible();
 const after=await read();assert.ok(after.items.filter(i=>['Notes','Bookmark'].includes(i.label)).every(i=>i.parentId===null));assert.equal(new Set(after.items.filter(i=>i.parentId===null).map(i=>i.slot)).size,after.items.filter(i=>i.parentId===null).length);
}));

test('Sort by submenu supports focus, touch and current-folder atomic order',{timeout:45000},()=>fixture(async({page,button,read,folder})=>{
 await folder('zebra');await folder('Alpha');
 const snapshot=await read(),nested=snapshot.items.find(i=>i.label==='Alpha');
 await button('Open Alpha').dblclick();await folder('Child');await page.getByRole('link',{name:'Home',exact:true}).click();
 await page.locator('.desktop-grid').click({button:'right',position:{x:800,y:450}});
 const sort=page.getByRole('menuitem',{name:'Sort by ›'});await sort.focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('menuitem',{name:'Name',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect.poll(async()=>(await read()).items.filter(i=>i.parentId===null).sort((a,b)=>a.slot-b.slot)[0].label).toBe('Alpha');
 assert.equal((await read()).items.find(i=>i.label==='Child').parentId,nested.id);
 await page.locator('.desktop-grid').click({button:'right',position:{x:800,y:450}});await sort.tap();await page.getByRole('menuitem',{name:'Type',exact:true}).tap();
 await expect.poll(async()=>(await read()).items.filter(i=>i.parentId===null).sort((a,b)=>a.slot-b.slot).slice(0,2).map(i=>i.kind)).toEqual(['folder','folder']);
 assert.deepEqual((await read()).items.find(i=>i.id===nested.id).icon,nested.icon);
 await page.locator('.desktop-grid').click({button:'right',position:{x:800,y:450}});await sort.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await expect(sort).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Desktop actions',exact:true})).toHaveCount(0);
}));

test('batch collision is visible without partial movement',{timeout:45000},()=>fixture(async({page,button,folder,read,drag})=>{
 await folder('Box');await expect(button('Open Box').locator('svg')).toHaveAttribute('data-icon','pixel-folder');await folder('Notes');await button('Open Notes').click();await button('Open Updater').click({modifiers:['Meta']});const before=await read();await drag('Notes','Control Panel');await expect(page.getByRole('alert')).toContainText(/occupied|full/);assert.deepEqual((await read()).items,before.items);
}));

test('marquee, empty clear, input protection and account-switch teardown',{timeout:45000},()=>fixture(async({page,button,api,g,runtime})=>{
 const a=await button('Open Control Panel').boundingBox(),b=await button('Open Updater').boundingBox();
 await page.mouse.move(Math.min(a.x,b.x)-4,Math.min(a.y,b.y)-4);await page.mouse.down();await page.mouse.move(Math.max(a.x+a.width,b.x+b.width)+4,Math.max(a.y+a.height,b.y+b.height)+4,{steps:8});await page.mouse.up();await expect(button('Open Updater')).toHaveAttribute('aria-pressed','true');
 await page.locator('.desktop-grid').click({position:{x:800,y:450}});await expect(button('Open Updater')).toHaveAttribute('aria-pressed','false');
 await button('Open Updater').click();await button('Navigation').click();await button('Profile settings').click();
 const profile=page.getByRole('dialog',{name:'Profile settings'});await page.getByLabel('Display name',{exact:true}).fill('Synthetic name');await page.keyboard.press('Control+a');await expect(button('Open Control Panel')).toHaveAttribute('aria-pressed','false');
 await page.locator('.settings-scrim').click({position:{x:4,y:4}});await expect(profile).toBeVisible();
 await button('Close settings').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);
 assert.equal((await api('/admin/users','POST',{username:'second',password,role:'user',grants:[]})).status,200);
 const auth=await authenticate(g.origin,runtime,'second');const [name,value]=auth.cookie.split('=');await page.context().addCookies([{name,value,url:g.origin,httpOnly:true,sameSite:'Strict'}]);
 await expect(profile).toHaveCount(0,{timeout:9000});await expect(page.locator('.settings-scrim')).toHaveCount(0);await expect(page.getByRole('button',{name:'Enter →',exact:true})).toBeVisible();assert.equal(await page.locator('footer').evaluate(el=>el.inert),false);
}));
