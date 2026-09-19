import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {password} from '../auth-helper.mjs';

async function neutral(page){
 const tinted=await page.locator('.settings-window').evaluate(root=>[root,...root.querySelectorAll('*')].flatMap(el=>{
  const s=getComputedStyle(el);return ['color','backgroundColor','borderTopColor','outlineColor','accentColor'].filter(key=>{
   const c=s[key].match(/[\d.]+/g)?.map(Number);return c?.length>=3&&(c.length<4||c[3]>0)&&c[1]>c[0]&&c[1]>c[2];
  }).map(key=>`${el.tagName}.${el.className} ${key}: ${s[key]}`);
 }));assert.deepEqual(tinted,[],'Settings must use neutral colors, including focus and status messages');
}
async function narrow(page){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.settings-window').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
}
test('real accounts pages, searchable tables, focused editors, service confirmation and neutral responsive profile',{timeout:90000},async()=>{
 const runtime=await mkdtemp(ROOT+'.test-accounts-ui-');const g=await createGateway({port:0,runtime});const browser=await chromium.launch({headless:true,chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 const tab=name=>page.getByRole('tab',{name,exact:true});
 try{
  await mkdir(ROOT+'screenshots',{recursive:true});
  await page.goto(await readFile(runtime+'/setup-url.txt','utf8'));
  await page.getByLabel('password',{exact:true}).fill(password);await button('Create admin').click();
  await button('Navigation').click();await button('Sign out').click();
  await expect(page.getByRole('heading',{name:'login',exact:true})).toBeVisible();await page.screenshot({path:ROOT+'screenshots/login.png'});
  await page.getByLabel('username',{exact:true}).fill('admin');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();
  await button('Navigation').click();await page.screenshot({path:ROOT+'screenshots/navigation.png'});await button('Control Panel').click();
  await expect(tab('Users')).toHaveAttribute('aria-selected','true');
  const users=page.getByRole('table',{name:'Users'});
  await expect(users.getByRole('columnheader')).toHaveText(['User','Role','Status','Grants','Actions']);
  await expect(users.locator('input,select,form')).toHaveCount(0);
  await expect(tab('Users')).toBeEnabled();await tab('Users').press('ArrowRight');await expect(tab('Services')).toBeFocused();await tab('Services').press('ArrowLeft');
  await button('New user').click();await expect(page.getByLabel('New username',{exact:true})).toBeFocused();
  await page.getByLabel('New username',{exact:true}).fill('alice');await page.getByLabel('Initial password',{exact:true}).fill(password);await page.getByLabel('Grant Parcels',{exact:true}).check();await button('Create user').click();
  await expect(users.getByRole('row').filter({hasText:'alice'})).toBeVisible();await expect(button('New user')).toBeFocused();
  await page.getByLabel('Search users').fill('ALICE');await expect(users.getByRole('row')).toHaveCount(2);
  await button('Edit user alice').click();await expect(page.getByLabel('Role for alice')).toBeFocused();
  await page.getByLabel('Role for alice').selectOption('admin');await page.keyboard.press('Escape');await expect(button('Edit user alice')).toBeFocused();
  await expect(users.getByRole('row').filter({hasText:'alice'}).getByRole('cell').nth(0)).toHaveText('user');
  await button('Edit user alice').click();await page.getByLabel('Grant Notes Lab to alice',{exact:true}).check();await button('Save alice').click();await expect(page.getByRole('status')).toContainText('User saved');
  await expect(users.getByRole('row').filter({hasText:'alice'}).getByRole('cell').nth(2)).toHaveText('2');
  await page.getByLabel('Search users').fill('no such user');await expect(page.getByText('No matching users.')).toBeVisible();await page.getByLabel('Search users').fill('');
  await button('Edit user admin').click();await page.getByLabel('Disabled admin',{exact:true}).check();await button('Save admin').click();await expect(page.getByRole('alert')).toBeVisible();await expect(button('Save admin')).toBeEnabled();await button('Cancel').click();
  await button('New user').click();await page.getByLabel('New username',{exact:true}).fill('bob');await page.getByLabel('Initial password',{exact:true}).fill(password);await button('Create user').click();await expect(button('Edit user bob')).toBeVisible();
  await button('Edit user bob').click();await page.getByLabel('Role for bob').selectOption('admin');await page.getByLabel('Disabled bob',{exact:true}).check();await page.getByLabel('Reset password for bob').fill(password+' reset');await button('Save bob').click();
  await expect(users.getByRole('row').filter({hasText:'bob'}).getByRole('cell').nth(0)).toHaveText('admin');await expect(users.getByRole('row').filter({hasText:'bob'}).getByRole('cell').nth(1)).toHaveText('Disabled');
  await button('Edit user bob').click();await page.getByLabel('Disabled bob',{exact:true}).uncheck();await page.getByLabel('Role for bob').selectOption('user');await button('Save bob').click();await expect(users.getByRole('row').filter({hasText:'bob'}).getByRole('cell').nth(1)).toHaveText('Password reset');
  await neutral(page);await page.screenshot({path:ROOT+'screenshots/control-panel-users.png'});
  await tab('Services').click();
  const services=page.getByRole('table',{name:'Services'});
  await expect(services.getByRole('columnheader')).toHaveText(['Service','Template','Mode','Status','Actions']);await expect(services.locator('input,select,form')).toHaveCount(0);
  await button('New service').click();await expect(page.getByLabel('Service template')).toBeFocused();await page.getByLabel('Service label',{exact:true}).fill('Browser notes');await button('Add service').click();
  await page.getByLabel('Search services').fill('browser');await expect(services.getByRole('row')).toHaveCount(2);await button('Edit service Browser notes').click();
  await page.getByLabel('Service label',{exact:true}).fill('Discarded');await button('Back to services').click();await expect(button('Edit service Browser notes')).toBeFocused();
  await button('Edit service Browser notes').click();await page.getByLabel('Enabled',{exact:true}).uncheck();await page.getByLabel('Service label',{exact:true}).fill('Renamed browser notes');await button('Save service').click();
  await expect(page.getByRole('status')).toHaveText('Service saved.');await expect(button('Open Renamed browser notes')).toHaveCount(0);await expect(services.getByRole('cell',{name:'Disabled',exact:true})).toBeVisible();
  await button('Edit service Renamed browser notes').click();await button('Remove service').click();await expect(page.getByRole('alertdialog')).toContainText('Renamed browser notes');await expect(button('Cancel removal')).toBeFocused();await page.keyboard.press('Escape');await expect(button('Remove service')).toBeFocused();
  await button('Remove service').click();await expect(tab('Users')).toBeDisabled();await expect(button('Back to services')).toBeDisabled();await button('Confirm removal').focus();await page.keyboard.press('Tab');await expect(button('Cancel removal')).toBeFocused();await button('Cancel removal').click();await expect(page.getByLabel('Service label')).toHaveValue('Renamed browser notes');
  await button('Remove service').click();await button('Confirm removal').click();await expect(page.getByRole('status')).toHaveText('Service removed.');await expect(button('New service')).toBeFocused();
  await page.getByLabel('Search services').fill('');await neutral(page);await page.screenshot({path:ROOT+'screenshots/control-panel-services.png'});
  await tab('System').click();await expect(page.getByRole('table',{name:'Resource limits'})).toBeVisible();await expect(page.getByText('Resident memory')).toBeVisible();await expect(page.locator('.settings-body')).not.toContainText('"sessionsPerUser"');await button('Refresh diagnostics').click();await expect(button('Refresh diagnostics')).toBeEnabled();await neutral(page);await page.screenshot({path:ROOT+'screenshots/control-panel-system.png'});
  await page.setViewportSize({width:390,height:844});
  for(const name of ['Users','Services','System']){await tab(name).click();await narrow(page);await page.screenshot({path:ROOT+`screenshots/control-panel-${name.toLowerCase()}-narrow.png`});}
  await page.setViewportSize({width:320,height:700});await tab('Services').click();await narrow(page);const scroller=page.getByRole('region',{name:'Services table'});assert.equal(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),true);await button('Edit service Notes Lab').click();await expect(page.getByLabel('Service label')).toBeFocused();await narrow(page);await button('Remove service').click();await narrow(page);await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(button('Edit service Notes Lab')).toBeFocused();
  await tab('Users').click();await button('New user').click();await narrow(page);await page.keyboard.press('Escape');await button('Close settings').click();await expect(button('Navigation')).toBeFocused();await page.setViewportSize({width:390,height:844});
  await button('Navigation').click();await button('Sign out').click();
  await page.getByLabel('username',{exact:true}).fill('alice');await page.getByLabel('password',{exact:true}).fill(password);await button('Enter →').click();
  await expect(button('Open Parcels')).toBeVisible();await expect(button('Open Notes Lab')).toBeVisible();await expect(button('Open Keepsakes')).toHaveCount(0);
  await button('Navigation').click();await expect(button('Control Panel')).toHaveCount(0);await button('Profile settings').click();await expect(page.getByLabel('Display name',{exact:true})).toBeFocused();
  await page.getByLabel('Display name',{exact:true}).fill('Alice Example');await page.getByLabel('Current password',{exact:true}).fill('incorrect password');await button('Save profile').click();await expect(page.getByRole('alert')).toBeVisible();await neutral(page);
  await page.getByLabel('Current password',{exact:true}).fill(password);await button('Save profile').click();await expect(page.getByRole('status')).toHaveText('Profile saved.');
  await page.getByLabel('Display name',{exact:true}).focus();await neutral(page);await narrow(page);await page.screenshot({path:ROOT+'screenshots/profile-settings-narrow.png'});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:ROOT+'screenshots/profile-settings.png'});
  await page.keyboard.press('Escape');await expect(button('Navigation')).toBeFocused();await button('Navigation').click();await expect(page.getByText('Alice Example',{exact:true})).toBeVisible();await button('Sign out').click();await expect(page.locator('iframe')).toHaveCount(0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
