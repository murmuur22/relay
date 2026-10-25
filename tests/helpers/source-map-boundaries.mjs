import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const flat={version:3,sources:['fixture.js'],sourcesContent:['fixture'],names:[],mappings:'AAAA'};
const indexed=(line,map=flat)=>({version:3,sections:[{offset:{line,column:0},map}]});

export function assertSourceMapBoundaries(root){
 // Exact file avoids resolving a missing selected package from another consumer.
 const {SourceMapConsumer}=require(fileURLToPath(new URL('node_modules/source-map-js/source-map.js',root)));
 assert.throws(()=>new SourceMapConsumer(indexed(10000001)),/must not exceed/);
 assert.throws(()=>new SourceMapConsumer(indexed(5000000,indexed(5000001))),/nested/);
 const consumer=new SourceMapConsumer(indexed(10)),mappings=[];
 consumer.eachMapping(mapping=>mappings.push(mapping));
 assert.equal(mappings[0].source,'fixture.js');
 assert.equal(mappings[0].generatedLine,11);
}
