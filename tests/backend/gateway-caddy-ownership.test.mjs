import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
const fixture=await import(process.env.CADDY_FIXTURE_HELPER || '../caddy-fixture-helper.mjs');
const {reserveCaddyPorts}=fixture;
async function listener(port=0){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',resolve);});return s;}
const close=s=>new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));
async function unused(){const s=await listener();const p=s.address().port;await close(s);return p;}
test('duplicate explicit Caddy candidates reject before handing out ownership',{timeout:5000},async()=>{
 const p=await unused();let owned;
 try{await assert.rejects(async()=>{owned=await reserveCaddyPorts({internal:p,external:p});},/distinct|duplicate/i);}finally{await owned?.close();}
 const s=await listener(p);await close(s);
});
test('both candidate ports remain owned throughout setup, not released by allocation',{timeout:5000},async()=>{
 const owned=await reserveCaddyPorts();
 try{
  assert.notEqual(owned.internal,owned.external);
  for(const p of [owned.internal,owned.external]){
   let intruder;
   try{await assert.rejects(async()=>{intruder=await listener(p);},e=>e.code==='EADDRINUSE');}finally{if(intruder)await close(intruder);}
  }
 }finally{await owned.close();}
 for(const p of [owned.internal,owned.external]){const s=await listener(p);await close(s);}
});
import http from 'node:http';
import https from 'node:https';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('external handoff lost to a live listener is a visible bind failure, never a hidden reallocation',{timeout:15000},async()=>{
 const owned=await reserveCaddyPorts(),dir=await mkdtemp(tmpdir()+'/caddy-race-');let proxy,intruder;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop.example.test','-addext','subjectAltName=DNS:desktop.example.test'],{stdio:'ignore'});
  const cert=await readFile(dir+'/cert.pem');
  await writeFile(dir+'/Caddyfile',`{\n admin off\n auto_https off\n}\nhttps://desktop.example.test:${owned.external} {\n bind 127.0.0.1\n tls ${dir}/cert.pem ${dir}/key.pem\n respond "synthetic"\n}\n`);
  await owned.releaseExternal();
  intruder=http.createServer((q,r)=>r.end('plaintext contender'));await new Promise(r=>intruder.listen(owned.external,'127.0.0.1',r));
  proxy=fixture.startCaddy(process.env.RELAY_TEST_CADDY,dir);
  const request=()=>new Promise((resolve,reject)=>{const q=https.get({host:'127.0.0.1',port:owned.external,servername:'desktop.example.test',ca:cert},r=>{r.resume();resolve({status:r.statusCode});});q.on('error',reject);});
  let failure;try{await fixture.caddyReady(proxy,request);}catch(e){failure=e;}
  assert.ok(failure,'lost handoff must fail');
  assert.match(failure.message,/address already in use|bind:/i,'actual Caddy stderr must survive');
  assert.match(failure.message,/"code":1/,'actual Caddy exit code must survive');
  assert.ok(Array.isArray(failure.diagnostics?.attempts),'individual readiness errors must survive');
  for(const attempt of failure.diagnostics.attempts)if(attempt.error)assert.ok(attempt.error.message,'not just EPROTO');
  assert.ok(failure.diagnostics.attempts.length<100,'dead Caddy must not consume all retries');
 }finally{
  if(proxy)await fixture.stopCaddy(proxy);
  if(intruder){intruder.closeAllConnections();await close(intruder);}
  await owned.close();await rm(dir,{recursive:true,force:true});
 }
});
