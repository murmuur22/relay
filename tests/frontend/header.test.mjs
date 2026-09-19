import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createGateway,ROOT} from '../../server/gateway.mjs';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';

test('breadcrumb icon and text share a vertical center at desktop and mobile sizes',async()=>{
 const runtime=await mkdtemp(path.join(ROOT,'.test-header-'));
 const g=await createGateway({port:0,runtime});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.goto((await readFile(path.join(runtime,'bootstrap-url.txt'),'utf8')).trim());
  await page.getByRole('button',{name:'Open Parcels',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   const centers=await page.locator('.path').evaluate(node=>Array.from(node.childNodes).filter(n=>n.nodeType===1||(n.nodeType===3&&n.textContent.trim())).map(n=>{const range=document.createRange();range.selectNodeContents(n);const r=range.getBoundingClientRect();return r.y+r.height/2;}));
   assert.ok(centers.length>=2);
   assert.ok(Math.max(...centers)-Math.min(...centers)<1,`misaligned centers: ${centers}`);
   await mkdir(path.join(ROOT,'screenshots'),{recursive:true});
   await page.screenshot({path:path.join(ROOT,`screenshots/header-${width}.png`),clip:{x:0,y:0,width:280,height:50}});
  }
 }finally{await browser.close();await g.close();await rm(runtime,{recursive:true,force:true});}
});
