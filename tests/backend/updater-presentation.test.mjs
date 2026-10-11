import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,unlink,chmod,rename,link,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPresentationReader} from '../../updater/web/presentation.mjs';
import {createUpdaterWeb} from '../../updater/web/server.mjs';

// Disposable filesystem/HTTP presentation fixtures, not an authentication claim.
const scratch=await fs.realpath(process.env.RELAY_PRESENTATION_EVIDENCE_DIR||process.env.TMPDIR||fileURLToPath(new URL('../../',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(t){
 const root=await mkdtemp(scratch+'/.test-reader-fixture-'),installRoot=join(root,'install'),fallback=join(root,'fallback');
 await mkdir(join(installRoot,'releases'),{recursive:true,mode:0o755});await mkdir(fallback);await writeFile(join(fallback,'index.html'),'INDEPENDENT FALLBACK');
 t.after(()=>rm(root,{recursive:true,force:true}));
 const f={root,installRoot,fallback,options:{installRoot,ownerUid:process.getuid()}};
 f.runtime=async(version='v0.6.5',suffix='0123456789abcdef',extra={})=>{
  const release=join(installRoot,'releases',version+'-'+suffix),dir=join(release,'updater-presentation');
  await mkdir(join(dir,'assets'),{recursive:true,mode:0o755});await mkdir(join(dir,'licenses'),{mode:0o755});
  const files={'index.html':`<!doctype html><script type="module" src="/updater/presentation/${version}/assets/index-abc123.js"></script>RUNTIME ${version}`,'assets/index-abc123.js':'export const runtime=true;','assets/chamber-def456.js':'export const lazy=true;','assets/share-tech-mono-abc123.woff2':Buffer.from([0,1,2,3]),'licenses/three.txt':'THREE NOTICE',...extra};
  for(const [name,bytes] of Object.entries(files))await writeFile(join(dir,name),bytes,{mode:0o644});
  const descriptor={schema:1,webApi:1,version,files:Object.entries(files).map(([path,b])=>({path,size:Buffer.byteLength(b),sha256:hash(b)}))};
  await writeFile(join(dir,'presentation.json'),JSON.stringify(descriptor),{mode:0o644});await writeFile(join(release,'package.json'),JSON.stringify({version:version.slice(1)}),{mode:0o644});
  return {release,dir,version,files,descriptor};
 };
 f.switch=async r=>{await symlink(r.release,join(installRoot,'.next'));await rename(join(installRoot,'.next'),join(installRoot,'current'));};
 f.web=async(options={})=>{const uiOrigin=`http://127.0.0.1:${await port()}`;const web=await createUpdaterWeb({uiOrigin,relayOrigin:'http://127.0.0.1:4180',socketPath:join(root,'absent.sock'),staticDir:fallback,presentationFixture:f.options,...options});t.after(()=>web.close());return web;};
 return f;
}
function raw(web,path,headers={},method='GET'){
 return new Promise((resolve,reject)=>{const q=http.request(web.origin+ '/', {path,method,headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks),text:Buffer.concat(chunks).toString()}));});q.on('error',reject);q.end();});
}
const index=web=>raw(web,'/updater/');

test('unrelated trusted ancestor sibling changes do not hide an otherwise immutable current presentation',async t=>{
 const f=await fixture(t),r=await f.runtime();await f.switch(r);const reader=createPresentationReader({presentationFixture:f.options});
 const original=fs.lstat;let changed=false;
 const mock=t.mock.method(fs,'lstat',async function(path,...args){const info=await original(path,...args);if(!changed&&String(path)===join(r.release,'package.json')){changed=true;await mkdir(join(f.root,'unrelated-owned-sibling'));}return info;});
 try{assert.match((await reader.index())?.toString()||'',/RUNTIME v0.6.5/);assert.equal(changed,true);}
 finally{mock.mock.restore();}
});

test('eight exact-limit presentations account for 32 MiB including metadata and retain all deferred assets',async t=>{
 const f=await fixture(t),reader=createPresentationReader({presentationFixture:f.options}),versions=[];
 for(let i=0;i<8;i++){
  const r=await f.runtime(`v1.0.${i}`),path='assets/chamber-def456.js';
  // Settle decimal size-length changes, then prove the actual total exactly.
  for(let pass=0;pass<3;pass++){
   const metadata=(await readFile(join(r.dir,'presentation.json'))).length+(await readFile(join(r.release,'package.json'))).length;
   const others=r.descriptor.files.filter(e=>e.path!==path).reduce((n,e)=>n+e.size,0);
   await writeFile(join(r.dir,path),Buffer.alloc(4*1024*1024-metadata-others,i));await redescribe(r);
  }
  const total=r.descriptor.files.reduce((n,e)=>n+e.size,0)+(await readFile(join(r.dir,'presentation.json'))).length+(await readFile(join(r.release,'package.json'))).length;
  assert.equal(total,4*1024*1024);await f.switch(r);assert.match((await reader.index()).toString(),new RegExp(`RUNTIME v1\\.0\\.${i}`));versions.push(r);
 }
 assert.equal(reader.stats().pins,8);assert.equal(reader.stats().retainedBytes,32*1024*1024);
 const ninth=await f.runtime('v1.0.8');await f.switch(ninth);assert.equal(await reader.index(),null);
 for(const [i,r] of versions.entries()){await rm(r.release,{recursive:true});const bytes=reader.asset(`/updater/presentation/${r.version}/assets/chamber-def456.js`);assert.equal(bytes.length,r.descriptor.files.find(e=>e.path==='assets/chamber-def456.js').size);assert.equal(bytes[0],i);assert.equal(hash(bytes),r.descriptor.files.find(e=>e.path==='assets/chamber-def456.js').sha256);}
 t.diagnostic(JSON.stringify({pins:reader.stats().pins,retainedBytes:reader.stats().retainedBytes,processRSSBytes:process.memoryUsage().rss,tier:'macOS source fixture, not systemd memory qualification'}));
});

test('a version pin also refuses changed descriptor or package bytes while retaining the original frontend',async t=>{
 for(const name of ['descriptor whitespace','package unused field'])await t.test(name,async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);const web=await f.web();assert.match((await index(web)).text,/RUNTIME v0.6.5/);
  if(name==='descriptor whitespace')await writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor)+'\n');
  else await writeFile(join(r.release,'package.json'),'{"version":"0.6.5","unused":true}');
  assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');assert.equal((await raw(web,'/updater/presentation/v0.6.5/assets/index-abc123.js')).text,r.files['assets/index-abc123.js']);
 });
});

test('bounded index scanning and final installed-directory snapshots reject mid-load extra paths',async t=>{
 await t.test('too many index references',async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);await writeFile(join(r.dir,'index.html'),'<script src="/updater/presentation/v0.6.5/assets/index-abc123.js"></script>'.repeat(65));await redescribe(r);
  const web=await f.web();assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');
 });
 await t.test('extra file appears after enumeration',async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);const real=fs.open;
  const mock=t.mock.method(fs,'open',async(...args)=>{if(args[0]===join(r.dir,'assets/chamber-def456.js')){await unlink(join(r.dir,'assets/index-abc123.js'));await writeFile(join(r.dir,'assets/unlisted-abc.js'),'unlisted');}return real(...args);});
  try{const reader=createPresentationReader({presentationFixture:f.options});assert.equal(await reader.index(),null);assert.equal(reader.stats().pins,0);}finally{mock.mock.restore();}
 });
 await t.test('asset ancestor replaced during load',async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);const real=fs.open;
  const mock=t.mock.method(fs,'open',async(...args)=>{if(args[0]===join(r.dir,'assets/index-abc123.js')){await rename(join(r.dir,'assets'),join(f.root,'assets'));await symlink(join(f.root,'assets'),join(r.dir,'assets'));}return real(...args);});
  try{const reader=createPresentationReader({presentationFixture:f.options});assert.equal(await reader.index(),null);assert.equal(reader.stats().pins,0);}finally{mock.mock.restore();}
 });
 await t.test('current link switches during load',async t=>{
  const f=await fixture(t),r=await f.runtime(),next=await f.runtime('v0.6.6');await f.switch(r);const real=fs.open;
  const mock=t.mock.method(fs,'open',async(...args)=>{if(args[0]===join(r.dir,'assets/index-abc123.js'))await f.switch(next);return real(...args);});
  try{const reader=createPresentationReader({presentationFixture:f.options});assert.equal(await reader.index(),null);assert.equal(reader.stats().pins,0);}finally{mock.mock.restore();}
 });
});

test('fixture seam is explicit trusted constructor data and cannot enter through web configuration or environment',async t=>{
 const f=await fixture(t);
 for(const presentationFixture of [null,{},[],{installRoot:f.installRoot,ownerUid:-1},{installRoot:f.installRoot,ownerUid:'502'},{installRoot:f.installRoot+'/',ownerUid:process.getuid()},{installRoot:f.installRoot,ownerUid:process.getuid(),url:'https://evil.test'}]){
  assert.throws(()=>createPresentationReader({presentationFixture}),/fixture/i);
 }
 const deep=join(f.root,...Array(35).fill('x'));await mkdir(join(deep,'releases'),{recursive:true});
 assert.throws(()=>createPresentationReader({presentationFixture:{installRoot:deep,ownerUid:process.getuid()}}),/fixture/i);
 const config=join(f.root,'web-config.json');await writeFile(config,JSON.stringify({presentationFixture:f.options}));
 const blocked=spawnSync(process.execPath,['updater/web/index.mjs','--config',config],{encoding:'utf8',timeout:5000});assert.equal(blocked.status,1);assert.match(blocked.stderr,/Invalid updater web configuration fields/);
 const r=await f.runtime();await f.switch(r);
 const previous=process.env.RELAY_UPDATER_PRESENTATION_ROOT;process.env.RELAY_UPDATER_PRESENTATION_ROOT=f.installRoot;
 try{const reader=createPresentationReader({installRoot:f.installRoot,ownerUid:process.getuid()});assert.equal(await reader.index(),null,'arbitrary top-level roots and environment are ignored');}finally{if(previous===undefined)delete process.env.RELAY_UPDATER_PRESENTATION_ROOT;else process.env.RELAY_UPDATER_PRESENTATION_ROOT=previous;}
});

test('five-second absolute load deadline falls back while outstanding IO stays single-flight and cannot publish later',{timeout:12000},async t=>{
 const f=await fixture(t),r=await f.runtime();await f.switch(r);const reader=createPresentationReader({presentationFixture:f.options});
 let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;}),real=fs.lstat;
 // Real filesystem result delayed by a barrier; no fabricated filesystem data.
 const mock=t.mock.method(fs,'lstat',async(...args)=>{if(args[0]===f.installRoot){entered();await held;}return real(...args);});
 const first=reader.index();await started;
 try{
  assert.equal(await Promise.race([first,delay(5500,'DEADLINE NOT ENFORCED')]),null);
  assert.equal(reader.stats().pins,0);assert.equal(reader.stats().loading,true);
  for(let i=0;i<32;i++)assert.equal(reader.index(),first);
  assert.equal(reader.stats().loads,1);
 }finally{release();mock.mock.restore();await first;}
 // Give cleanup the event-loop turn needed after the held operation finishes.
 for(let i=0;i<20&&reader.stats().loading;i++)await delay(5);
 assert.equal(reader.stats().loading,false);assert.equal(reader.stats().pins,0);
 assert.match((await reader.index()).toString(),/RUNTIME v0.6.5/);assert.equal(reader.stats().pins,1);
});

test('versioned HTTP routes are pin-only, canonical, traversal-safe and preserve static/API guards',async t=>{
 const f=await fixture(t),r=await f.runtime('v0.6.5',undefined,{'licenses/updater-font-sources.json':'{}'});await f.switch(r);const web=await f.web();
 assert.equal((await raw(web,'/updater/presentation/v0.6.5/index.html')).status,404,'asset requests do not load candidates');
 const document=await index(web);assert.match(document.headers['content-security-policy'],/frame-ancestors http:\/\/127\.0\.0\.1:4180;/);assert.equal(document.headers['x-frame-options'],undefined);
 assert.equal(document.headers['cache-control'],'no-store');assert.equal(document.headers['referrer-policy'],'no-referrer');assert.equal(document.headers['x-content-type-options'],'nosniff');
 assert.equal((await raw(web,'/updater/index.html')).text,document.text);
 const head=await raw(web,'/updater/',{},'HEAD');assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(Number(head.headers['content-length']),document.bytes.length);
 assert.equal((await raw(web,'/updater/presentation/v0.6.5/licenses/three.txt')).headers['content-type'],'text/plain; charset=utf-8');
 assert.equal((await raw(web,'/updater/presentation/v0.6.5/licenses/updater-font-sources.json')).headers['content-type'],'application/json');
 const font=await raw(web,'/updater/presentation/v0.6.5/assets/share-tech-mono-abc123.woff2');assert.equal(font.status,200);assert.equal(font.headers['content-type'],'font/woff2');assert.equal(font.headers['x-frame-options'],'DENY');
 for(const path of [
  '/updater/presentation/v0.6.6/index.html','/updater/presentation/v0.6.5/presentation.json','/updater/presentation/v0.6.5/package.json','/updater/presentation/v0.6.5/assets/nope-abc.js',
  '/updater/presentation/v0.6.5/../../api/auth','/updater/presentation/v0.6.5/../../index.html','/updater/presentation/v0.6.5/../v0.6.5/index.html','/updater/presentation/v0.6.5/./index.html',
  '/updater/presentation/v0.6.5/%2e%2e/v0.6.5/index.html','/updater/presentation/v0.6.5/%69ndex.html','/updater/presentation/v0.6.5/assets%2findex-abc123.js',
  '/updater/%70resentation/v0.6.5/index.html','/updater/presentation%2fv0.6.5/index.html','/updater/presentation/v0.6.5/..\\..\\index.html',
  '/updater/presentation/v0.6.5//index.html','/updater/presentation/v0.6.5/index.html%00','/updater/presentation/v0.6.5/%252e%252e/index.html',
 ])assert.equal((await raw(web,path)).status,404,path);
 for(const origin of ['http://127.0.0.1:4180','http://evil.test','null']){assert.equal((await raw(web,'/updater/',{Origin:origin})).status,403);assert.equal((await raw(web,'/updater/api/auth',{Origin:origin})).status,403);}
 assert.equal((await raw(web,'/updater/',{Host:'evil.test'})).status,403);
 const api=await raw(web,'/updater/api/auth',{Origin:web.origin});assert.equal(api.status,200);assert.deepEqual(JSON.parse(api.text),{authenticated:false,relayOrigin:'http://127.0.0.1:4180'});assert.equal(api.headers['x-frame-options'],'DENY');assert.match(api.headers['content-security-policy'],/frame-ancestors 'none';/);
 assert.equal((await raw(web,'/updater/',{},'POST')).status,405);assert.equal((await raw(web,'/updater/?root=/etc')).status,400);
});

test('raw HTTP aliases entering or leaving the presentation namespace are rejected after a valid pin',async t=>{
 const f=await fixture(t),r=await f.runtime();await f.switch(r);const web=await f.web();
 const document=await index(web);assert.equal(document.status,200);assert.match(document.text,/RUNTIME v0.6.5/);assert.equal(document.headers['x-relay-updater-presentation'],'v0.6.5');
 for(const path of ['index.html','assets/index-abc123.js']){
  const response=await raw(web,`/updater/presentation/v0.6.5/${path}`);assert.equal(response.status,200);assert.equal(response.text,r.files[path]);
 }
 for(const path of [
  '/updater/x/../presentation/v0.6.5/index.html',
  '/updater/x/%2e%2e/presentation/v0.6.5/assets/index-abc123.js',
  '/updater/x/..\\presentation/v0.6.5/index.html',
 ])await t.test(path,async()=>{
  const response=await raw(web,path);t.diagnostic(JSON.stringify({rawPath:path,status:response.status,expected:404}));assert.equal(response.status,404,path);
 });
 for(const path of [
  '/updater/presentation/x/../../api/auth',
  '/updater/presentation/x/%2e%2e/%2e%2e/api/auth',
  '/updater/presentation/x/..\\..\\api/auth',
 ])await t.test(path,async()=>{
  for(const method of ['GET','POST'])assert.equal((await raw(web,path,{Origin:web.origin},method)).status,404,`${method} ${path}`);
 });
 const api=await raw(web,'/updater/api/auth',{Origin:web.origin});assert.equal(api.status,200);assert.deepEqual(JSON.parse(api.text),{authenticated:false,relayOrigin:'http://127.0.0.1:4180'});
});

test('inert descriptors reject duplicate JSON keys, nonallowlisted files and unpinned index references',async t=>{
 const cases={
  'duplicate top key':async r=>writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor).replace('"schema":1','"schema":2,"schema":1')),
  'escaped duplicate top key':async r=>writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor).replace('"schema":1','"schema":2,"\\u0073chema":1')),
  'duplicate entry key':async r=>writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor).replace('"size":','"size":0,"size":')),
  'duplicate package version':async r=>writeFile(join(r.release,'package.json'),'{"version":"0.6.4","version":"0.6.5"}'),
  'excess JSON depth':async r=>writeFile(join(r.release,'package.json'),'{"version":"0.6.5","unused":'+'['.repeat(20)+'0'+']'.repeat(20)+'}'),
  'nonallowlisted root file':async r=>{r.files['config.json']='{}';await writeFile(join(r.dir,'config.json'),'{}');await redescribe(r);},
  'nonallowlisted notice':async r=>{r.files['licenses/secret.txt']='secret';await writeFile(join(r.dir,'licenses/secret.txt'),'secret');await redescribe(r);},
  'control-character asset path':async r=>{r.files['assets/index-abc.js\n']='x';await writeFile(join(r.dir,'assets/index-abc.js\n'),'x');await redescribe(r);},
  'nonhashed JS':async r=>{r.files['assets/plain.js']='x';await writeFile(join(r.dir,'assets/plain.js'),'x');await redescribe(r);},
  'unapproved font':async r=>{r.files['assets/private-abc.woff2']='x';await writeFile(join(r.dir,'assets/private-abc.woff2'),'x');await redescribe(r);},
  'inventory descriptor excluded':async r=>{r.descriptor.files.push({path:'presentation.json',size:0,sha256:'0'.repeat(64)});await writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor));},
  'unversioned index reference':async r=>{await writeFile(join(r.dir,'index.html'),'<script src="/updater/assets/index-abc123.js"></script>');await redescribe(r);},
  'other-version index reference':async r=>{await writeFile(join(r.dir,'index.html'),'<script src="/updater/presentation/v0.6.4/assets/index-abc123.js"></script>');await redescribe(r);},
  'external index reference':async r=>{await writeFile(join(r.dir,'index.html'),'<script src="https://evil.test/evil.js"></script>');await redescribe(r);},
  'absent index reference':async r=>{await writeFile(join(r.dir,'index.html'),'<script src="/updater/presentation/v0.6.5/assets/absent-abc.js"></script>');await redescribe(r);},
  'unreferenced index':async r=>{await writeFile(join(r.dir,'index.html'),'<html>NO REFERENCES</html>');await redescribe(r);},
  'version does not match engine directory':async r=>{r.descriptor.version='v0.6.6';await writeFile(join(r.release,'package.json'),'{"version":"0.6.6"}');await writeFile(join(r.dir,'index.html'),'<script src="/updater/presentation/v0.6.6/assets/index-abc123.js"></script>');await redescribe(r);},
 };
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async t=>{const f=await fixture(t),r=await f.runtime();await f.switch(r);await mutate(r);const web=await f.web();assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');});
});

async function redescribe(r){
 r.descriptor.files=[];
 for(const path of Object.keys(r.files)){const bytes=await readFile(join(r.dir,path));r.descriptor.files.push({path,size:bytes.length,sha256:hash(bytes)});}
 await writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor));
}
test('candidate count, bytes including metadata, metadata and traversal bounds are enforced',async t=>{
 for(const [name,mutate] of Object.entries({
  '65 files':async(f,r)=>{for(let i=0;i<60;i++){const path=`assets/file${i}-abc.js`;r.files[path]='x';await writeFile(join(r.dir,path),'x');}await redescribe(r);},
  'aggregate bytes':async(f,r)=>{await writeFile(join(r.dir,'assets/index-abc123.js'),Buffer.alloc(3*1024*1024));await writeFile(join(r.dir,'assets/chamber-def456.js'),Buffer.alloc(2*1024*1024));await redescribe(r);},
  'metadata counts toward candidate bytes':async(f,r)=>{await writeFile(join(r.dir,'assets/index-abc123.js'),Buffer.alloc(4*1024*1024-256));await redescribe(r);},
  'oversized descriptor':async(f,r)=>writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor)+' '.repeat(16384)),
  'oversized package':async(f,r)=>writeFile(join(r.release,'package.json'),'{"version":"0.6.5","padding":"'+'x'.repeat(16384)+'"}'),
  'nested directory':async(f,r)=>mkdir(join(r.dir,'assets','nested')),
  'unexpected empty directory':async(f,r)=>mkdir(join(r.dir,'private')),
  'overlong path':async(f,r)=>{const path='assets/'+ 'x'.repeat(244)+'-abc.js';r.files[path]='x';await writeFile(join(r.dir,path),'x');await redescribe(r);},
 }))await t.test(name,async t=>{const f=await fixture(t),r=await f.runtime();await f.switch(r);await mutate(f,r);const web=await f.web();assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');});
 await t.test('64 small presentation files are admitted',async t=>{
  const f=await fixture(t),extra={};for(let i=0;i<59;i++)extra[`assets/file${i}-abc.js`]='x';const r=await f.runtime('v0.6.5',undefined,extra);await f.switch(r);const web=await f.web();assert.match((await index(web)).text,/RUNTIME v0.6.5/);
 });
});

test('single-flight candidate loading and eight sticky pins overload to fallback, never eviction',async t=>{
 const f=await fixture(t),r=await f.runtime();await f.switch(r);const reader=createPresentationReader({presentationFixture:f.options});
 const first=reader.index(),second=reader.index();assert.equal(first,second,'concurrent calls must share the exact in-flight promise');await first;
 assert.equal(reader.stats().loads,1);assert.equal(reader.stats().pins,1);
 const web=await f.web(),runtimes=[];
 for(let i=0;i<9;i++){const current=i===0?r:await f.runtime(`v0.6.${5+i}`);runtimes.push(current);await f.switch(current);const document=await index(web);if(i<8)assert.match(document.text,new RegExp(`RUNTIME v0\\.6\\.${5+i}`));else assert.equal(document.text,'INDEPENDENT FALLBACK');}
 for(const r of runtimes.slice(0,8)){await rm(r.release,{recursive:true});const asset=await raw(web,`/updater/presentation/${r.version}/assets/chamber-def456.js`);assert.equal(asset.status,200);assert.equal(asset.text,r.files['assets/chamber-def456.js']);}
 assert.equal((await raw(web,'/updater/presentation/v0.6.13/index.html')).status,404);
});

test('only trusted installed paths, owners, permissions and single-link regular bytes are eligible',async t=>{
 const cases={
  'setuid asset':async(f,r)=>chmod(join(r.dir,'assets/index-abc123.js'),0o4644),
  'FIFO asset':async(f,r)=>{const p=join(r.dir,'assets/index-abc123.js');await unlink(p);const result=spawnSync('mkfifo',[p],{timeout:2000});assert.equal(result.status,0);},
  'FIFO descriptor':async(f,r)=>{const p=join(r.dir,'presentation.json');await unlink(p);const result=spawnSync('mkfifo',[p],{timeout:2000});assert.equal(result.status,0);},
  'FIFO package':async(f,r)=>{const p=join(r.release,'package.json');await unlink(p);const result=spawnSync('mkfifo',[p],{timeout:2000});assert.equal(result.status,0);},
  'asset socket':async(f,r)=>{const p=join(r.dir,'assets/index-abc123.js'),short=join(f.root,'s');await unlink(p);const s=net.createServer();await new Promise(resolve=>s.listen(short,resolve));await rename(short,p);f.socket=s;},
  'asset symlink':async(f,r)=>{const p=join(r.dir,'assets/index-abc123.js');await rename(p,p+'.target');await symlink(p+'.target',p);await unlink(p+'.target');},
  'valid-byte asset symlink':async(f,r)=>{const p=join(r.dir,'assets/index-abc123.js');const target=join(f.root,'asset-target');await rename(p,target);await symlink(target,p);},
  'descriptor symlink':async(f,r)=>{const p=join(r.dir,'presentation.json'),target=join(f.root,'descriptor-target');await rename(p,target);await symlink(target,p);},
  'package symlink':async(f,r)=>{const p=join(r.release,'package.json'),target=join(f.root,'package-target');await rename(p,target);await symlink(target,p);},
  'asset hardlink':async(f,r)=>link(join(r.dir,'assets/index-abc123.js'),join(f.root,'hardlink')),
  'descriptor hardlink':async(f,r)=>link(join(r.dir,'presentation.json'),join(f.root,'hardlink')),
  'package hardlink':async(f,r)=>link(join(r.release,'package.json'),join(f.root,'hardlink')),
  'writable asset':async(f,r)=>chmod(join(r.dir,'assets/index-abc123.js'),0o664),
  'world writable descriptor':async(f,r)=>chmod(join(r.dir,'presentation.json'),0o666),
  'writable package':async(f,r)=>chmod(join(r.release,'package.json'),0o664),
  'writable assets directory':async(f,r)=>chmod(join(r.dir,'assets'),0o775),
  'writable presentation directory':async(f,r)=>chmod(r.dir,0o777),
  'writable release directory':async(f,r)=>chmod(r.release,0o775),
  'writable releases directory':async f=>chmod(join(f.installRoot,'releases'),0o775),
  'writable install root':async f=>chmod(f.installRoot,0o777),
  'writable ancestor':async f=>chmod(f.root,0o777),
  'wrong owner':async f=>{f.options.ownerUid=process.getuid()+1;},
  'current ordinary directory':async f=>{await unlink(join(f.installRoot,'current'));await mkdir(join(f.installRoot,'current'));},
  'current dangling link':async f=>{await unlink(join(f.installRoot,'current'));await symlink('releases/absent',join(f.installRoot,'current'));},
  'current outside releases':async(f,r)=>{const outside=join(f.root,'v0.6.5-0123456789abcdef');await rename(r.release,outside);await unlink(join(f.installRoot,'current'));await symlink(outside,join(f.installRoot,'current'));},
  'current nested release':async(f,r)=>{const nested=join(f.installRoot,'releases','nested');await mkdir(nested);await rename(r.release,join(nested,'v0.6.5-0123456789abcdef'));await unlink(join(f.installRoot,'current'));await symlink(join(nested,'v0.6.5-0123456789abcdef'),join(f.installRoot,'current'));},
  'current through second link':async(f,r)=>{await symlink(r.release,join(f.installRoot,'alias'));await unlink(join(f.installRoot,'current'));await symlink('alias',join(f.installRoot,'current'));},
  'invalid engine release name':async(f,r)=>{const p=join(f.installRoot,'releases','v0.6.5-not-an-engine-digest');await rename(r.release,p);await unlink(join(f.installRoot,'current'));await symlink(p,join(f.installRoot,'current'));},
  'release directory symlink':async(f,r)=>{const p=join(f.root,'release-target');await rename(r.release,p);await symlink(p,r.release);},
  'releases ancestor symlink':async f=>{const p=join(f.installRoot,'releases');await rename(p,p+'-target');await symlink(p+'-target',p);},
  'install ancestor symlink':async f=>{const p=f.installRoot;await rename(p,p+'-target');await symlink(p+'-target',p);},
  'presentation ancestor symlink':async(f,r)=>{await rename(r.dir,r.dir+'-target');await symlink(r.dir+'-target',r.dir);},
  'assets ancestor symlink':async(f,r)=>{const p=join(r.dir,'assets'),target=join(f.root,'assets-target');await rename(p,target);await symlink(target,p);},
  'descriptor directory':async(f,r)=>{await unlink(join(r.dir,'presentation.json'));await mkdir(join(r.dir,'presentation.json'));},
  'listed asset directory':async(f,r)=>{const p=join(r.dir,'assets/index-abc123.js');await unlink(p);await mkdir(p);},
 };
 if(process.platform==='linux')cases['current hardlink']=async f=>link(join(f.installRoot,'current'),join(f.installRoot,'current-copy'));
 else t.diagnostic('macOS refuses hardlink-to-symlink with EPERM; Linux runs the current-link nlink negative. Real regular-file hardlinks are covered on both platforms.');
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);await mutate(f,r);if(f.socket)t.after(()=>new Promise(resolve=>f.socket.close(resolve)));const web=await f.web();
  assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');assert.equal((await raw(web,'/updater/presentation/v0.6.5/index.html')).status,404);
 });
 await t.test('canonical relative current link is permitted',async t=>{
  const f=await fixture(t),r=await f.runtime();await symlink('releases/v0.6.5-0123456789abcdef',join(f.installRoot,'current'));const web=await f.web();assert.match((await index(web)).text,/RUNTIME v0.6.5/);
 });
});

// Compatible means webApi=1, not newest-version-wins. Selection follows current.
test('whole pins survive switching, candidate deletion, failed reload and rollback; same-version changes never replace bytes',async t=>{
 const f=await fixture(t),old=await f.runtime('v0.6.4'),candidate=await f.runtime('v0.6.5');await f.switch(old);const web=await f.web();
 assert.match((await index(web)).text,/RUNTIME v0.6.4/);
 await f.switch(candidate);assert.match((await index(web)).text,/RUNTIME v0.6.5/);
 await rm(candidate.release,{recursive:true});assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');
 for(const r of [old,candidate])for(const [path,bytes] of Object.entries(r.files)){
  const response=await raw(web,`/updater/presentation/${r.version}/${path}`);assert.equal(response.status,200);assert.deepEqual(response.bytes,Buffer.from(bytes));
 }
 await f.switch(old);assert.match((await index(web)).text,/RUNTIME v0.6.4/);
 const replacement=await f.runtime('v0.6.4','fedcba9876543210',{'assets/chamber-def456.js':'CHANGED LAZY BYTES'});await f.switch(replacement);
 assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');
 assert.equal((await raw(web,'/updater/presentation/v0.6.4/assets/chamber-def456.js')).text,old.files['assets/chamber-def456.js']);
 await f.switch(old);assert.match((await index(web)).text,/RUNTIME v0.6.4/);
 await writeFile(join(old.dir,'assets/chamber-def456.js'),'CORRUPT');assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');
 assert.equal((await raw(web,'/updater/presentation/v0.6.4/assets/chamber-def456.js')).text,old.files['assets/chamber-def456.js']);
});

test('compatible current runtime supplies HTTP index and its exact versioned assets',async t=>{
 const f=await fixture(t),r=await f.runtime();await f.switch(r);const web=await f.web();
 const document=await index(web);assert.equal(document.status,200);assert.match(document.text,/RUNTIME v0.6.5/);assert.equal(document.headers['x-relay-updater-presentation'],'v0.6.5');
 const asset=await raw(web,'/updater/presentation/v0.6.5/assets/index-abc123.js');assert.equal(asset.status,200);assert.equal(asset.text,r.files['assets/index-abc123.js']);
});

test('runtime descriptor compatibility, exact schema, package version and hashes fail closed',async t=>{
 const cases={
  'missing descriptor':async r=>unlink(join(r.dir,'presentation.json')),
  'old runtime without presentation':async r=>rm(r.dir,{recursive:true}),
  'invalid JSON':async r=>writeFile(join(r.dir,'presentation.json'),'{'),
  'descriptor array':async r=>writeFile(join(r.dir,'presentation.json'),'[]'),
  'schema type':r=>{r.descriptor.schema='1';},
  'schema unsupported':r=>{r.descriptor.schema=2;},
  'API unsupported':r=>{r.descriptor.webApi=2;},
  'API boolean':r=>{r.descriptor.webApi=true;},
  'unexpected metadata':r=>{r.descriptor.root='/etc';},
  'noncanonical version':r=>{r.descriptor.version='v00.6.5';},
  'package mismatch':async r=>writeFile(join(r.release,'package.json'),'{"version":"0.6.4"}'),
  'package malformed':async r=>writeFile(join(r.release,'package.json'),'{'),
  'package version wrong type':async r=>writeFile(join(r.release,'package.json'),'{"version":65}'),
  'files wrong type':r=>{r.descriptor.files={};},
  'entry wrong type':r=>{r.descriptor.files[0]=null;},
  'entry extra field':r=>{r.descriptor.files[0].url='https://evil.test';},
  'entry missing field':r=>{delete r.descriptor.files[0].size;},
  'size float':r=>{r.descriptor.files[0].size=1.5;},
  'size negative':r=>{r.descriptor.files[0].size=-1;},
  'size boolean':r=>{r.descriptor.files[0].size=true;},
  'size mismatch':r=>{r.descriptor.files[0].size++;},
  'hash mismatch':r=>{r.descriptor.files[0].sha256='0'.repeat(64);},
  'hash wrong type':r=>{r.descriptor.files[0].sha256=123;},
  'hash uppercase':r=>{r.descriptor.files[0].sha256=r.descriptor.files[0].sha256.toUpperCase();},
  'duplicate inventory path':r=>{r.descriptor.files.push(r.descriptor.files[0]);},
  'missing index inventory':r=>{r.descriptor.files.shift();},
  'unlisted file':async r=>writeFile(join(r.dir,'assets','unlisted-abc123.js'),'secret'),
  'missing listed file':async r=>unlink(join(r.dir,'assets','chamber-def456.js')),
 };
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async t=>{
  const f=await fixture(t),r=await f.runtime();await f.switch(r);await mutate(r);
  if(!['missing descriptor','old runtime without presentation','invalid JSON','descriptor array'].includes(name))await writeFile(join(r.dir,'presentation.json'),JSON.stringify(r.descriptor));
  const web=await f.web();const document=await index(web);assert.equal(document.status,200);assert.equal(document.text,'INDEPENDENT FALLBACK');
  assert.equal((await raw(web,'/updater/presentation/v0.6.5/assets/index-abc123.js')).status,404);
 });
 await t.test('no current link',async t=>{const f=await fixture(t),web=await f.web();assert.equal((await index(web)).text,'INDEPENDENT FALLBACK');});
});

