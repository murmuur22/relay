import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
test('actual shaded 3D knot uses bounded stable ASCII cells, rotates calmly and becomes static for reduced motion',async({page})=>{
 await page.route('**/updater/api/**',route=>route.fulfill({json:route.request().url().endsWith('/auth')?{authenticated:true,csrf:'synthetic',interfaceAnimations:true,relayOrigin:'http://127.0.0.1:4180'}:{mode:'fixture',currentVersion:'v0.3.0',available:[],job:{id:'synthetic-job',phase:'downloading',downloadedBytes:25,totalBytes:100,events:[{at:Date.now(),phase:'downloading',message:'Synthetic activity for rendering qualification only'}]},history:[],canInstall:false}}));
 await page.goto('/updater/');const chamber=page.locator('#chamber');await expect(chamber).toHaveAttribute('data-character-pass','.:+*#/@');
 await expect(chamber).toHaveAttribute('data-geometry','shaded-torus-knot');await expect(chamber).toHaveAttribute('data-motion','on');
 const canvas=chamber.locator('canvas'),initial=await canvas.screenshot();await expect.poll(async()=>!(await canvas.screenshot()).equals(initial)).toBe(true);
 expect(await chamber.evaluate(el=>Number(el.dataset.cells))).toBeLessThanOrEqual(24000);
 await page.waitForTimeout(5000);
 const performance=await chamber.evaluate(el=>{const intervals=el.dataset.frameIntervals.split(',').map(Number).filter(Boolean).sort((a,b)=>a-b);return {tier:'synthetic download activity, real Three.js render, headless Chromium',samples:intervals.length,medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],meanRenderMs:Number(el.dataset.renderMs),fpsLimit:Number(el.dataset.fpsLimit),cells:Number(el.dataset.cells)};});
 await mkdir('../../screenshots',{recursive:true});
 await writeFile('../../screenshots/updater-ascii-performance.json',JSON.stringify({...performance,browser:page.context().browser().version(),platform:process.platform,arch:process.arch},null,2));
 const chromatic=await page.evaluate(()=>[...document.querySelectorAll('button,input,select,header,aside,p')].flatMap(el=>['color','backgroundColor','borderTopColor','outlineColor','accentColor'].map(key=>({key,value:getComputedStyle(el)[key]}))).filter(({value})=>{const n=value.match(/^rgba?\((\d+), (\d+), (\d+)/);return n&&Math.max(...n.slice(1).map(Number))-Math.min(...n.slice(1).map(Number))>16;}));expect(chromatic).toEqual([]);
 await page.screenshot({path:'../../screenshots/updater-ascii-motion-synthetic.png',fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});await expect(chamber).toHaveAttribute('data-motion','off');const calm=await canvas.screenshot();await page.waitForTimeout(200);expect((await canvas.screenshot()).equals(calm)).toBe(true);
 await page.screenshot({path:'../../screenshots/updater-ascii-static-synthetic.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'../../screenshots/updater-ascii-narrow-synthetic.png',fullPage:true});
});
