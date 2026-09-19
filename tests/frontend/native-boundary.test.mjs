import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAddress,safeExternal} from '../../src/webapps.js';

test('native launch and preview reject cookie-host sharing across ports',()=>{
 const origin='http://127.0.0.1:4180';
 assert.throws(()=>nativeAddress('http://127.0.0.1:8800/',origin),/cookies are shared across ports/);
 assert.equal(safeExternal('http://127.0.0.1:8800/',origin),null);
 assert.equal(nativeAddress('http://localhost:8800/',origin),'http://localhost:8800/');
 assert.throws(()=>nativeAddress('https://relay.example.:9443/','https://relay.example/'),/different hostname/);
});
