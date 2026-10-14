import test from 'node:test';
import assert from 'node:assert/strict';
import {statusLabel,statusDetail} from '../../src/webapps.js';
test('status distinguishes reached HTTP challenge, unobservable device check, and stale observations',()=>{
 const now=Date.now();assert.match(statusLabel({state:'Reached',source:'device',checkedAt:now,httpStatus:401}),/Reached.*device/);assert.match(statusDetail({state:'Reached',source:'device',checkedAt:now,httpStatus:401,detail:'HTTP 401; not ready'}),/not ready/);
 assert.match(statusLabel({state:'Unknown',source:'device',checkedAt:now}),/unobservable/i);assert.match(statusLabel({state:'Online',source:'relay',checkedAt:now-60000}),/Stale/);assert.match(statusDetail({state:'Online',source:'relay',checkedAt:now-60000}),/Stale/);
});
