import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({plugins:[svelte()],optimizeDeps:{entries:['index.html']},server:{watch:{usePolling:true,interval:250,ignored:['**/integrations/**','**/.runtime/**','**/.data/**']},host:'127.0.0.1',port:4182,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:4180'},'/native':{target:'http://127.0.0.1:4180'},'/ws':{target:'ws://127.0.0.1:4180',ws:true}}}});
