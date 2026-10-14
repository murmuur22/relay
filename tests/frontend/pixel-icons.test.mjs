import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('bundled free Pixelarticons are bounded audited path data with pinned source and original MIT notice',async()=>{
 const {pixelIcons}=await import('../../server/pixel-icons.mjs');
 assert.equal(pixelIcons.constructor,undefined);assert.equal(pixelIcons.__proto__,undefined);assert.equal(pixelIcons.toString,undefined);
 const source=JSON.parse(await readFile(new URL('../../public/licenses/pixelarticons-sources.json',import.meta.url),'utf8'));
 assert.equal(source.version,'1.8.1');assert.equal(source.iconCount,Object.keys(pixelIcons).length);assert.ok(source.iconCount>=32&&source.iconCount<=80);
 for(const [id,icon] of Object.entries(pixelIcons)){assert.match(id,/^pixel-[a-z0-9-]+$/);assert.ok(icon.paths.length);for(const d of icon.paths)assert.match(d,/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\s-]+$/);assert.equal(createHash('sha256').update(JSON.stringify(icon.paths)).digest('hex'),source.icons[id].pathDataSha256);assert.ok(icon.group);}
 const notice=await readFile(new URL('../../public/licenses/pixelarticons-MIT.txt',import.meta.url),'utf8');assert.match(notice,/Copyright \(c\) 2019 Gerrit Halfmann/);assert.match(notice,/Permission is hereby granted/);
});
