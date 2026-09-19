import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds, TITLE_HEIGHT, mapPoint } from '../../src/geometry.js';
test('content bounds stay inside desktop with compact titlebar', () => {
 const b=clampBounds({x:2000,y:-10,width:900,height:900},800,600);
 assert.equal(TITLE_HEIGHT,24); assert.equal(b.x,0); assert.equal(b.y,0);
 assert.equal(b.width,796); assert.equal(b.height,576);
});
test('narrow desktop has usable full-width bounds',()=>{
 const b=clampBounds({x:20,y:20,width:100,height:40},300,400);
 assert.equal(b.width,296);assert.equal(b.height,180);assert.equal(b.x,0);
});
test('letterboxed frame maps the visible image rather than stretched canvas',()=>{
 assert.deepEqual(mapPoint(200,400,{left:0,top:0,width:400,height:800},800,400),{x:400,y:200});
 assert.deepEqual(mapPoint(0,0,{left:0,top:0,width:400,height:800},800,400),{x:0,y:0});
});
