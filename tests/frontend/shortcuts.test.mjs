import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {shortcuts,catalog,matches} from '../../src/shortcuts.js';import {documentation} from './shortcuts-docs.mjs';
test('help/docs and actual handler references share one context-aware registry',async()=>{
 assert.equal(await readFile(new URL('../../docs/desktop-interactions.md',import.meta.url),'utf8'),documentation);
 const source=(await Promise.all(['PersonalDesktop.svelte','Settings.svelte','Hotkeys.svelte'].map(p=>readFile(new URL('../../src/'+p,import.meta.url),'utf8')))).join('\n');
 for(const s of shortcuts){assert.ok(source.includes("'"+s.id+"'"),'missing handler '+s.id);const event={key:s.key,ctrlKey:!!s.primary,metaKey:false,shiftKey:s.shift===true,altKey:false};assert.ok(matches(s.id,event,s.contexts[0]));assert.equal(matches(s.id,event,'native-iframe'),false);}
 assert.match(catalog('desktop',true).find(s=>s.id==='selectAll').keys,/Cmd/);assert.match(catalog('folder',false).find(s=>s.id==='selectAll').keys,/Ctrl/);assert.ok(catalog('modal').every(s=>!['selectAll','move','open'].includes(s.id)));
});
