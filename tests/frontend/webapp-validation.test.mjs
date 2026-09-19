import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webAddress,origins,statusLabel} from '../../src/webapps.js';
test('explicit HTTP addresses only; credentials, fragments, malformed ports rejected',()=>{
 for(const value of ['127.0.0.1:8080','javascript:alert(1)','http://user:pass@example.test','http://example.test/#x','http://example.test:99999']) assert.throws(()=>webAddress(value));
 assert.equal(webAddress('http://127.0.0.1:8080'),'http://127.0.0.1:8080/');
 assert.deepEqual(origins('https://example.test\nhttp://127.0.0.1:8080'),['https://example.test','http://127.0.0.1:8080']);
 assert.throws(()=>origins('https://example.test/path'));
});
test('health copy scopes each observation',()=>{
 assert.equal(statusLabel({state:'Online',source:'relay'}),'Reachable from Relay');
 assert.equal(statusLabel({state:'Offline',source:'relay'}),'Not responding from Relay');
 assert.equal(statusLabel({state:'Online',source:'device'}),'Reachable from this device');
 assert.equal(statusLabel(), 'Unknown');
});
