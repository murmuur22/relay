import test from 'node:test';import assert from 'node:assert/strict';
import {statusLabel,statusDetail} from '../../src/webapps.js';
test('server-centric evidence distinguishes UP, challenge, not monitored, unavailable and stale',()=>{
 const now=Date.now(),responding={state:'Online',reachability:'responding',source:'relay',checkedAt:now,detail:'HTTP response only'};
 assert.match(statusLabel(responding,now),/UP.*Relay/);assert.doesNotMatch(statusLabel(responding,now),/device|healthy/i);
 assert.match(statusLabel({...responding,authRequired:false,httpStatus:500},now),/HTTP 500.*readiness unknown/);
 assert.match(statusLabel({...responding,state:'Reached',authRequired:true,httpStatus:401},now),/UP.*authentication/i);
 assert.equal(statusLabel({state:'Unknown',reachability:'not-monitored',source:'relay',checkedAt:0},now),'Not monitored');
 assert.match(statusLabel({...responding,reachability:'unreachable',state:'Offline'},now),/Unavailable/);
 assert.match(statusLabel({...responding,checkedAt:now-60000},now),/Stale/);assert.match(statusDetail(responding,now),/HTTP response only/);
});
