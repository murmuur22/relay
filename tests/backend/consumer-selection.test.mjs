import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as readFile,globSync} from 'node:fs';
import {requiredConsumers} from '../helpers/required-consumers.mjs';
const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('standalone security selects exactly Relay and independent updater packages',()=>{
 assert.deepEqual(requiredConsumers.map(c=>[c.label,c.root.href]),[
  ['Relay',root.href],['updater UI',new URL('updater/ui/',root).href],
 ]);
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.equal(scripts['test:security:consumers'],'node --test --test-concurrency=1 --test-timeout=90000 tests/backend/consumer-selection.test.mjs tests/backend/dependency-regressions.test.mjs tests/backend/vite-boundaries.test.mjs');
 assert.equal(scripts['test:optional:parcels'],'node --test --test-concurrency=1 --test-timeout=90000 tests/optional/parcels-security.test.mjs');
 const backend=globSync('tests/backend/*.test.mjs',{cwd:root});
 assert.ok(backend.includes('tests/backend/vite-boundaries.test.mjs'));
 assert.ok(backend.includes('tests/backend/dependency-regressions.test.mjs'));
 assert.ok(!backend.some(p=>p.includes('optional')||p.includes('parcels-security')));
});

test('full development test command explicitly retains optional Parcels security coverage',()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.match(scripts.test,/npm run test:optional:parcels && node tests\/integration\/experience\.mjs$/);
 assert.doesNotMatch(scripts['test:backend'],/test:optional:parcels|tests\/optional/);
});

for(const workflow of ['check.yml','release.yml']){
 test(workflow+' installs required consumers and selects their shared security gate only',()=>{
  const text=read('.github/workflows/'+workflow);
  assert.match(text,/npm ci --ignore-scripts/);
  assert.match(text,/npm --prefix updater\/ui ci --ignore-scripts/);
  assert.match(text,/^\s+npm run test:security:consumers\s*$/m);
  assert.doesNotMatch(text,/npm[^\n]*(?:integrations\/parcels|test:optional:parcels)|npm run setup(?:\s|$)/);
 });
}
