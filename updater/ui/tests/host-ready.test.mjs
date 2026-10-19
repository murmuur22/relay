import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/host-ready.js').catch(()=>({}));
const snapshot={mode:'fixture',capabilities:{prepare:1,apply:1},canApply:true,currentVersion:'v0.3.0',job:{id:'a'.repeat(32),version:'v0.3.1',kind:'prepare',phase:'ready'}};
test('host observation contains only exact current prepared job identity, never credentials',()=>{
 assert.equal(typeof module.readyObservation,'function');
 assert.deepEqual(module.readyObservation(snapshot,true),{type:'relay-updater-observation',jobId:'a'.repeat(32),version:'v0.3.1',phase:'ready'});
});
test('strict shape, job/version and fresh snapshot reject stale, corrupted and terminal Ready hints',()=>{
 assert.equal(typeof module.parseReadyMessage,'function');
 const good=module.readyObservation(snapshot,true);
 assert.deepEqual(module.parseReadyMessage(good),good);
 for(const bad of [null,[],{...good,extra:true},{...good,password:'secret'},{...good,jobId:'bad'},{...good,version:'v999'},{...good,phase:'install'},'ready'])assert.equal(module.parseReadyMessage(bad),null);
 // Malformed identities must be rejected without coercion or invoking object hooks.
 for(const value of [['a'.repeat(32)],{}, {toString(){throw Error('must not coerce');}},null,42,true,'a'.repeat(32)+'\n']){
  assert.equal(module.parseReadyMessage({...good,jobId:value}),null);
  assert.equal(module.parseReadyMessage({...good,jobId:value},'relay-updater-review'),null);
  assert.equal(module.readyObservation({...snapshot,job:{...snapshot.job,id:value}},true).phase,'unavailable');
 }
 for(const value of [['v0.3.1'],{}, {toString(){throw Error('must not coerce');}},null,42,true,'v0.3.1\n']){
  assert.equal(module.parseReadyMessage({...good,version:value}),null);
  assert.equal(module.readyObservation({...snapshot,job:{...snapshot.job,version:value}},true).phase,'unavailable');
 }
 for(const state of [{...snapshot,canApply:false},{...snapshot,mode:'observe'},{...snapshot,job:{...snapshot.job,phase:'cancelled'}},{...snapshot,job:{...snapshot.job,id:'bad'}}])assert.equal(module.readyObservation(state,true).phase,'unavailable');
 assert.equal(module.readyObservation(snapshot,false).phase,'unavailable');
 const installed={...snapshot,currentVersion:'v0.3.1',job:{...snapshot.job,kind:'apply',phase:'succeeded'}};
 assert.equal(module.readyObservation(installed,true).phase,'succeeded');
 assert.equal(module.readyObservation({...installed,currentVersion:'v0.3.0'},true).phase,'unavailable');
});
