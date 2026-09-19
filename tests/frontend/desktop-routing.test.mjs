import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveDesktop,folderPath,itemToken,slotAt,slotPosition} from '../../src/desktop.js';
const items=[{id:'f',key:'1234abcd',kind:'folder',label:'My things',parentId:null},{id:'g',key:'2234abcd',kind:'folder',label:'Photos & art',parentId:'f'},{id:'a',key:'3234abcd',kind:'app',label:'My Parcels',parentId:'g',appId:'parcels'}];
test('private routes resolve stable keys and canonical current ancestry without repairing malformed keys',()=>{
 assert.equal(folderPath(items,'g'),'/desktop/my-things--1234abcd/photos-art--2234abcd');
 assert.equal(itemToken(items[2]),'my-parcels--3234abcd');
 const r=resolveDesktop(items,'/desktop/old--2234abcd','?app=old--3234abcd&view=maximized&redirect=https://evil.test');
 assert.equal(r.folderId,'g');assert.equal(r.app.id,'a');assert.equal(r.maximized,true);assert.equal(r.url,'/desktop/my-things--1234abcd/photos-art--2234abcd?app=my-parcels--3234abcd&view=maximized');
 for(const path of ['/desktop/x--1234ABCD','/desktop/x--1234abcdx','/desktop/x--deadbeef','/desktop/x--3234abcd'])assert.equal(resolveDesktop(items,path,'').unavailable,true);
 assert.equal(resolveDesktop(items,'/desktop','?app=x--deadbeef').unavailable,true);
});
test('expanded Unicode labels still produce valid canonical route tokens after truncation',()=>{
 const label='ﬄ'.repeat(26)+'a-x';assert.ok(label.length<=64);
 const folder={id:'unicode',key:'abcdef12',kind:'folder',parentId:null,label};
 const path=folderPath([folder],folder.id);assert.equal(resolveDesktop([folder],path,'').unavailable,false);
});
test('grid slots fill down before right and snap within bounded ordinals',()=>{
 assert.deepEqual(slotPosition(4,3),{x:130,y:154});
 assert.equal(slotAt(140,170,3),4);assert.equal(slotAt(-100,-100,3),0);assert.equal(slotAt(1e6,1e6,3),1023);
});
