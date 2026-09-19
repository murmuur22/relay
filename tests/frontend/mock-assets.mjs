import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Build into memory and serve via Playwright routes: no listener or runtime state.
export async function mockAssets(entry=new URL('../../index.html',import.meta.url)) {
  const result=await build({configFile:false,root:fileURLToPath(new URL('../../',import.meta.url)),
    logLevel:'error',plugins:[svelte()],build:{write:false,rollupOptions:{input:fileURLToPath(entry)}}});
  const output=Array.isArray(result)?result.flatMap(r=>r.output):result.output;
  const assets=new Map(output.map(asset=>['/'+asset.fileName,asset.type==='chunk'?asset.code:asset.source]));
  const html=output.find(asset=>asset.fileName.endsWith('.html')).source;
  return async function serve(page) {
    await page.route('http://relay-test.invalid/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const body=path==='/'?html:assets.get(path);
      return route.fulfill({status:body===undefined?404:200,body:body??'',contentType:path==='/'?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/octet-stream'});
    });
  };
}
