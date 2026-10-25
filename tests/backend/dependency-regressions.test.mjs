import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify,parse} from 'devalue';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const flat={version:3,sources:['fixture.js'],sourcesContent:['fixture'],names:[],mappings:'AAAA'};
const indexed=(line,map=flat)=>({version:3,sections:[{offset:{line,column:0},map}]});
test('devalue rejects shared-pool Buffer rather than serializing unrelated backing bytes',()=>{
 assert.deepEqual([...parse(stringify(new Uint8Array([7,8])))],[7,8]);
 const pool=Buffer.allocUnsafe(8192);pool.fill(65);const small=pool.subarray(100,102);
 let serialized;try{serialized=stringify(small);}catch(error){assert.match(error.message,/Buffer|serializ|support/i);return;}
 const decoded=parse(serialized);assert.equal(decoded.byteLength,2);assert.equal(decoded.buffer.byteLength,2,'shared backing bytes must not escape');
 assert.deepEqual([...parse(stringify(new Uint8Array([7,8])))],[7,8]);
});
for(const base of ['../../node_modules/source-map-js','../../updater/ui/node_modules/source-map-js','../../integrations/parcels/node_modules/source-map-js'])test('indexed source-map offsets are bounded with valid maps retained: '+base,()=>{
 const {SourceMapConsumer}=require(base);
 assert.throws(()=>new SourceMapConsumer(indexed(10000001)),/must not exceed/);
 assert.throws(()=>new SourceMapConsumer(indexed(5000000,indexed(5000001))),/nested/);
 const c=new SourceMapConsumer(indexed(10)),mappings=[];c.eachMapping(m=>mappings.push(m));assert.equal(mappings[0].source,'fixture.js');assert.equal(mappings[0].generatedLine,11);
});
