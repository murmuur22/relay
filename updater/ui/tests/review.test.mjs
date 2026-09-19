import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewVersion,reviewHint} from '../src/review.js';
test('review versions are bounded strict nonsecret release identifiers',()=>{
 for(const value of ['v0.0.0','v10.20.30'])assert.equal(reviewVersion(value),value);
 for(const value of [null,{},42,'v01.2.3','1.2.3','v1.2.3\n','v1.2.3~secret','a'.repeat(64),'v'+ '1'.repeat(64)+'.2.3'])assert.equal(reviewVersion(value),'');
});
test('new handoff supersedes saved review and reload extracts only a validated version',()=>{
 assert.deepEqual(reviewHint('ticket~v1.2.3',{reviewedVersion:'v4.5.6'}),{ticket:'ticket',version:'v1.2.3'});
 assert.deepEqual(reviewHint('',{reviewedVersion:'v4.5.6',ticket:'secret',password:'secret'}),{ticket:'',version:'v4.5.6'});
 assert.deepEqual(reviewHint('new-ticket',{reviewedVersion:'v4.5.6'}),{ticket:'new-ticket',version:''});
 assert.deepEqual(reviewHint('ticket~v1.2.3~extra',null),{ticket:'ticket',version:''});
 assert.deepEqual(reviewHint('',{reviewedVersion:{password:'secret'}}),{ticket:'',version:''});
});
