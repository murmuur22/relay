import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from '../../server/gateway.mjs';
test('private interface standalone qualification: actual WS frames, input, sandbox and restart',{timeout:130000},async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['deploy/verify-standalone.mjs','--private-lan'],{cwd:ROOT,timeout:125000,maxBuffer:1048576});
 assert.match(stdout,/PASS private-lan exact interface/);
 assert.match(stdout,/real frames and client-to-remote typed text/);
 console.log(stdout.trim());
});
