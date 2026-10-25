import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createUpdaterWeb} from '../../updater/web/server.mjs';
import {embeddingFixture,listen,closeServer} from '../updater-embedding-fixture.mjs';

function controlledFixture(){
 const controller=new AbortController();let cleanup;
 const acquire=embeddingFixture({signal:controller.signal,after:hook=>{cleanup=hook;}});
 return {acquire,controller,cleanup:()=>cleanup()};
}
function barrier(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}

for(const kind of ['listener','web'])test(`retired embedding fixture owns a pending ${kind} result until actual closure`,{timeout:5000},async()=>{
 const fixture=controlledFixture(),held=barrier(),started=barrier(),reason=Error('controlled fixture timeout');let resource,closes=0,closed=false;
 const pending=fixture.acquire(async()=>{
  const server=await listen(http.createServer((req,res)=>res.end('fixture')));
  if(kind==='web'){
   const port=server.address().port;await closeServer(server);
   resource=await createUpdaterWeb({uiOrigin:`http://127.0.0.1:${port}`,relayOrigin:'http://127.0.0.1:4180',socketPath:'/nonexistent-fixture.sock'});
  }else resource=server;
  started.release();await held.promise;return resource;
 },async value=>{closes++;if(kind==='web')await value.close();else await closeServer(value);closed=true;});
 const rejected=assert.rejects(pending,error=>error===reason);
 // All barriers are released even if an assertion fails.
 try{
  await started.promise;fixture.controller.abort(reason);
  let acknowledged=false;const closing=fixture.cleanup().then(()=>{acknowledged=true;});
  await Promise.resolve();assert.equal(acknowledged,false);assert.equal(closed,false);
  let admitted=false;await assert.rejects(fixture.acquire(()=>{admitted=true;},()=>{}),error=>error===reason);assert.equal(admitted,false);
  held.release();await Promise.all([closing,rejected]);assert.equal(closes,1);assert.equal(closed,true);
  assert.equal((kind==='web'?resource.server:resource).listening,false);
 }finally{held.release();await Promise.allSettled([pending,fixture.cleanup()]);if(resource)await (kind==='web'?resource.close():closeServer(resource));}
});

test('embedding cleanup settles every closer and retains synchronous/rejected closure errors',{timeout:5000},async()=>{
 const fixture=controlledFixture(),one=Error('synchronous close failure'),two=Error('rejected close failure');let third=false;
 await fixture.acquire(()=>({}),()=>{throw one;});
 await fixture.acquire(()=>({}),async()=>{throw two;});
 await fixture.acquire(()=>({}),async()=>{third=true;});
 await assert.rejects(fixture.cleanup(),error=>error instanceof AggregateError&&error.errors.includes(one)&&error.errors.includes(two));assert.equal(third,true);
});

test('embedding acquisition keeps original sync and async setup failures',{timeout:5000},async()=>{
 const fixture=controlledFixture(),sync=Error('sync setup'),asyncError=Error('async setup');let closes=0;
 await assert.rejects(fixture.acquire(()=>{throw sync;},()=>{closes++;}),error=>error===sync);
 await assert.rejects(fixture.acquire(async()=>{throw asyncError;},()=>{closes++;}),error=>error===asyncError);
 await fixture.cleanup();assert.equal(closes,0);
});

test('embedding free-port net listener closes without an HTTP-only API',{timeout:5000},async()=>{
 const fixture=controlledFixture(),server=await fixture.acquire(()=>listen(net.createServer()),closeServer);
 await closeServer(server);await fixture.cleanup();assert.equal(server.listening,false);
});

test('embedding listener acquisition rejects a real occupied-port error',{timeout:5000},async()=>{
 const fixture=controlledFixture(),occupied=await listen(http.createServer());
 try{
  await assert.rejects(fixture.acquire(()=>listen(http.createServer(),occupied.address().port),closeServer),{code:'EADDRINUSE'});
  await fixture.cleanup();assert.equal(occupied.listening,true);
 }finally{await closeServer(occupied);}
});
