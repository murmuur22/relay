import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify,parse} from 'devalue';
import {requiredConsumers} from '../helpers/required-consumers.mjs';
import {assertSourceMapBoundaries} from '../helpers/source-map-boundaries.mjs';
test('devalue rejects shared-pool Buffer rather than serializing unrelated backing bytes',()=>{
 assert.deepEqual([...parse(stringify(new Uint8Array([7,8])))],[7,8]);
 const pool=Buffer.allocUnsafe(8192);pool.fill(65);const small=pool.subarray(100,102);
 let serialized;try{serialized=stringify(small);}catch(error){assert.match(error.message,/Buffer|serializ|support/i);return;}
 const decoded=parse(serialized);assert.equal(decoded.byteLength,2);assert.equal(decoded.buffer.byteLength,2,'shared backing bytes must not escape');
 assert.deepEqual([...parse(stringify(new Uint8Array([7,8])))],[7,8]);
});
for(const {label,root} of requiredConsumers){
 test('indexed source-map offsets are bounded with valid maps retained: '+label,()=>assertSourceMapBoundaries(root));
}
