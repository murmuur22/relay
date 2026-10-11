import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const evidence=process.env.RELAY_TERMINAL_EVIDENCE || '../../screenshots/terminal';
const snapshot=()=>({mode:'fixture',currentVersion:'v0.6.4',available:[{version:'v0.6.4',size:303000000,verified:true,notes:'Synthetic visual fixture. Not a published update target.'}],canInstall:false,history:[],job:{id:'synthetic-visual',version:'v0.6.4',phase:'downloading',downloadedBytes:206040000,totalBytes:303000000,canCancel:true,events:[{at:'2026-10-11T12:00:00Z',phase:'downloading',message:'Receiving synthetic artifact bytes'},{at:'2026-10-11T12:00:01Z',phase:'downloading',message:'Verification follows the transfer'}]}});
async function fixture(page,state){await page.route('**/updater/api/**',route=>route.fulfill({json:route.request().url().endsWith('/auth')?{authenticated:true,csrf:'synthetic',interfaceAnimations:true,relayOrigin:'http://127.0.0.1:4180'}:state}));}
async function capture(page,name){await page.evaluate(()=>{let label=document.getElementById('synthetic-provenance');if(!label){label=document.createElement('div');label.id='synthetic-provenance';label.style.cssText='position:relative;z-index:9999;background:#efeee5;color:#0b0b0a;font:11px monospace;padding:4px;text-align:center';document.body.prepend(label);}label.textContent='SYNTHETIC VISUAL FIXTURE / route-mocked state / actual Three.js renderer / NOT installation evidence';});await mkdir(evidence,{recursive:true});await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});}
test('reference terminal loads redistributed fonts, monochrome progress and dominant knot with honest bytes',async({page})=>{
 await page.setViewportSize({width:1100,height:726});const resources=[];page.on('response',r=>{if(/\.woff2(?:\?|$)/.test(r.url()))resources.push({url:r.url(),status:r.status()});});
 const state=snapshot();await fixture(page,state);await page.goto('/updater/');await expect(page.locator('#percentage')).toHaveText('68% of artifact');
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('700 44px "Relay Pixel"')&&document.fonts.check('400 12px "Relay Mono"'))).toBe(true);
 expect(resources.length).toBe(2);expect(resources.every(r=>r.status===200)).toBe(true);
 await expect(page.locator('.brand')).toHaveText('Relay updater');expect(await page.locator('.brand').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(18);await expect(page.locator('header .path')).toHaveCount(0);await expect(page.locator('.edge-caption')).toHaveCount(0);
 expect(await page.locator('#percentage').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(239, 238, 229)');
 await expect(page.locator('#percentage .percent-symbol')).toHaveText('%');
 expect(await page.locator('#percentage .percent-symbol').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(60);
 await expect(page.locator('#progress')).toHaveAttribute('aria-label','Artifact download');await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow','68');
 expect(await page.locator('#progress-fill').evaluate(el=>el.textContent)).toBe('█'.repeat(27)+'░'.repeat(13));
 const left=await page.locator('.transfer').boundingBox(),right=await page.locator('.release').boundingBox();expect(left.width/right.width).toBeGreaterThan(2);
 await expect(page.locator('#chamber')).toHaveAttribute('data-renderer','webgl');await expect(page.locator('#chamber')).toHaveAttribute('data-geometry','shaded-torus-knot');
 expect(await page.locator('#chamber').evaluate(el=>Number(el.dataset.cells))).toBeGreaterThanOrEqual(17000);
 await expect(page.locator('#chamber')).toHaveAttribute('data-guides','dotted-coordinate-field');
 expect(await page.locator('.brand').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(239, 238, 229)');
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#chamber')).toHaveAttribute('data-motion','off');await capture(page,'independent-68-desktop');
 state.job.phase='verifying';state.job.downloadedBytes=303000000;await page.locator('#check').click();await expect(page.locator('#phase')).toHaveText('Verifying');await expect(page.locator('#percentage')).toHaveText('100% of artifact');await capture(page,'independent-verifying');
 state.job.phase='succeeded';await page.locator('#check').click();await expect(page.locator('#phase')).toHaveText('Update complete');await capture(page,'independent-success');
 state.job=null;await page.locator('#check').click();await expect(page.locator('#percentage')).toHaveText('—');await expect(page.locator('#progress')).not.toHaveAttribute('aria-valuenow');await capture(page,'independent-idle');
 state.job=snapshot().job;await page.locator('#check').click();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'independent-68-mobile');
});
test('reference terminal unknown totals and missing WebGL do not invent progress',async({page})=>{
 const fonts=[];page.on('response',r=>{if(r.url().endsWith('.woff2'))fonts.push(r.status());});
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.includes('webgl')?null:original.call(this,type,...args);};});const state=snapshot();state.job.totalBytes=null;await fixture(page,state);await page.goto('/updater/');await expect(page.locator('#chamber')).toHaveAttribute('data-renderer','static');await expect(page.locator('#percentage')).toHaveText('—');await expect(page.locator('#progress')).not.toHaveAttribute('aria-valuenow');await expect(page.locator('#fallback')).toBeVisible();await page.evaluate(()=>document.fonts.ready);expect(fonts).toEqual([200,200]);expect(await page.evaluate(()=>document.fonts.check('700 44px "Relay Pixel"')&&document.fonts.check('400 12px "Relay Mono"'))).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'independent-unknown-fallback');
});
