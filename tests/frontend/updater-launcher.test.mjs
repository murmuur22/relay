import test from 'node:test';
import assert from 'node:assert/strict';
import {launchUpdater} from '../../src/updater.js';
test('LAN launcher keeps canonical same-host distinct-port and fragment-only review handoff',async()=>{
 for(const host of ['10.20.30.40','172.16.2.3','192.168.2.3']){
  let destination;const tab={closed:false,opener:'parent',location:{replace:url=>destination=url},close(){this.closed=true;}};
  const browser={location:{origin:`http://${host}:4190`},open:()=>tab},ticket='a'.repeat(64);
  const valid=`http://${host}:4191/updater/#${ticket}`;
  await launchUpdater(async()=>({url:valid}),()=>true,browser,'v0.4.1');assert.equal(destination,valid+'~v0.4.1');assert.equal(tab.opener,null);
  for(const url of [valid.replace(':4191',':4190'),valid.replace(host,'8.8.8.8'),valid.replace(host,'10.020.30.40'),valid.replace('/updater/','/foo/../updater/'),valid.replace('/#','/?review=v0.4.1#'),valid.replace(host,'user@'+host)]){
   tab.closed=false;await assert.rejects(launchUpdater(async()=>({url}),()=>true,browser));assert.equal(tab.closed,true);
  }
 }
});
test('trusted launcher opens synchronously, severs opener, validates ticket URL and closes on stale or unavailable',async()=>{
 const {launchUpdater}=await import('../../src/updater.js');let resolve;const events=[];const tab={opener:'parent',closed:false,location:{replace:url=>events.push(url)},close(){this.closed=true;}};const browser={location:{origin:'http://127.0.0.1:4180'},open(){events.push('open');return tab;}};
 const pending=launchUpdater(()=>new Promise(r=>resolve=r),()=>true,browser);assert.deepEqual(events,['open']);assert.equal(tab.opener,null);resolve({url:'http://127.0.0.1:4190/updater/#'+'a'.repeat(64)});await pending;assert.match(events[1],/\/updater\/#/);
 for(const url of ['http://evil.test/updater/#'+'a'.repeat(64),'http://127.0.0.1:4180/updater/#'+'a'.repeat(64),'http://127.0.0.1:4190/not-updater/#'+'a'.repeat(64),'http://127.0.0.1:4190/updater/?token=secret#'+'a'.repeat(64),'javascript:alert(1)']){tab.closed=false;await assert.rejects(launchUpdater(async()=>({url}),()=>true,browser));assert.equal(tab.closed,true);}
 await assert.rejects(launchUpdater(async()=>{throw Error('Unavailable');},()=>true,browser),/Unavailable/);
 await assert.rejects(launchUpdater(async()=>({url:'http://127.0.0.1:4190/updater/#'+'a'.repeat(64)}),()=>false,browser),/expired/i);
});
