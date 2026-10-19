import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../src/state.js';
const snapshot=()=>({mode:'fixture',capabilities:{prepare:1,apply:1},canPrepare:true,canApply:false,currentVersion:'v0.3.0',available:[{version:'v0.4.0',verified:true}],job:null});
test('staged UI admits exact capabilities and targets only, never falls back to immediate install',()=>{
 assert.equal(typeof ui.stagedEligible,'function');
 const s=snapshot(),base={state:s,fresh:true,authenticated:true,selected:'v0.4.0'};
 assert.equal(ui.stagedEligible({...base,action:'prepare',version:'v0.4.0'}),true);
 for(const patch of [{capabilities:undefined},{capabilities:{prepare:true,apply:1}},{capabilities:{prepare:1,apply:2}},{canPrepare:false},{mode:'observe'},{available:[{version:'v0.4.0',verified:false}]},{currentVersion:'v0.4.0'},{job:{phase:'unknown'}}])assert.equal(ui.stagedEligible({...base,state:{...s,...patch},action:'prepare',version:'v0.4.0'}),false);
 assert.equal(ui.stagedEligible({...base,action:'install',version:'v0.4.0'}),false);
 assert.equal(ui.stagedEligible({...base,fresh:false,action:'prepare',version:'v0.4.0'}),false);
 assert.equal(ui.stagedEligible({...base,action:'prepare',version:'v0.5.0'}),false);
});
test('Apply requires broker-ready prepared job/version, never 100% bytes or stale consent; cancel stays job-bound',()=>{
 const s=snapshot();s.canPrepare=false;s.canApply=true;s.job={id:'a'.repeat(32),version:'v0.4.0',kind:'prepare',phase:'ready',canCancel:true,downloadedBytes:100,totalBytes:100};
 const base={state:s,fresh:true,authenticated:true,selected:'v0.4.0',action:'apply',version:'v0.4.0',jobId:s.job.id};
 assert.equal(ui.stagedEligible(base),true);
 for(const patch of [{phase:'verifying'},{phase:'staging'},{kind:'start'},{id:'b'.repeat(32)},{version:'v0.5.0'}])assert.equal(ui.stagedEligible({...base,state:{...s,job:{...s.job,...patch}}}),false);
 for(const patch of [{canApply:1},{canApply:false},{capabilities:{}},{mode:'observe'}])assert.equal(ui.stagedEligible({...base,state:{...s,...patch}}),false);
 assert.equal(ui.stagedEligible({...base,authenticated:false}),false);
 assert.equal(ui.stagedEligible({...base,action:'cancel'}),true);
 assert.equal(ui.stagedEligible({...base,action:'cancel',jobId:'other'}),false);
 assert.equal(ui.phases.ready[0],'Ready to apply');assert.equal(ui.phases.succeeded[0],'Installed');
});
