// Opt-in real-service acceptance: requires the isolated Jellyfin fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('repeatable Jellyfin demo verifies actual desktop playback and cleanup', {timeout:120000}, async()=>{
 const {stdout}=await exec(process.execPath,['tools/demo-jellyfin.mjs','--verify'],{timeout:110000});
 for(const marker of ['PASS playback/audio/seek','PASS minimize/restore','PASS End/reopen/Close','PASS demo cleanup'])assert(stdout.includes(marker),marker);
});
