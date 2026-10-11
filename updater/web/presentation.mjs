import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,basename} from 'node:path';
import {performance} from 'node:perf_hooks';

const LIMITS=Object.freeze({files:64,bytes:4*1024*1024,metadata:16384,pins:8,retainedBytes:32*1024*1024,path:256,ancestors:32,entries:67});
const version=/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const releaseName=/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-[0-9a-f]{16}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>object(value)&&Object.keys(value).sort().join(',')===expected;
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink;
// Ancestor directory link counts legitimately change when a protected sibling
// is created. Identity/owner/type/mode must remain stable; installed subtree
// timestamps and all regular-file/current-link single-link checks remain strict.
const directoryIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid;
function trusted(info,owner,directory=false,ancestor=false){
 if((info.uid!==owner&&!(ancestor&&info.uid===0))||(info.mode&0o7022)||!(directory?info.isDirectory():info.isFile())||(!directory&&info.nlink!==1))throw Error('Untrusted installed path');
}
const notices=new Set(['licenses/three.txt','licenses/silkscreen-OFL.txt','licenses/sharetechmono-OFL.txt','licenses/updater-font-sources.json']);
const allowed=path=>typeof path==='string'&&path.length<=LIMITS.path&&(path==='index.html'||notices.has(path)||/^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:js|css)$/.test(path)||/^assets\/(?:silkscreen-bold|share-tech-mono)-[A-Za-z0-9_-]+\.woff2$/.test(path));
// Bounded JSON parser: JSON.parse alone silently accepts duplicate object keys.
// Never import/evaluate package metadata. Reject duplicates even when escaped.
function inertJSON(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let at=0,nodes=0;
 const space=()=>{while(/[\t\r\n ]/.test(text[at]??'!'))at++;};
 const string=()=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='"')return JSON.parse(text.slice(start,at));if(c==='\\')at++;}throw Error('Invalid JSON string');};
 function value(depth=0){
  if(depth>8||++nodes>1024)throw Error('JSON depth/count bound');space();const c=text[at];
  if(c==='"')return string();
  if(c==='{'||c==='['){
   at++;space();const end=c==='{'?'}':']',out=c==='{'?Object.create(null):[],seen=new Set();
   if(text[at]===end){at++;return out;}
   for(;;){
    if(c==='{'){if(text[at]!=='"')throw Error('Invalid JSON key');const key=string();if(seen.has(key))throw Error('Duplicate JSON key');seen.add(key);space();if(text[at++]!==':')throw Error('Invalid JSON colon');out[key]=value(depth+1);}
    else out.push(value(depth+1));
    space();if(text[at]===end){at++;return out;}if(text[at++]!==',')throw Error('Invalid JSON separator');space();
   }
  }
  const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
  if(!match)throw Error('Invalid JSON value');at+=match[0].length;const result=JSON.parse(match[0]);if(typeof result==='number'&&!Number.isFinite(result))throw Error('Nonfinite JSON');return result;
 }
 const result=value();space();if(at!==text.length)throw Error('Trailing JSON');return result;
}
function descriptorSchema(d){
 if(!keys(d,'files,schema,version,webApi')||d.schema!==1||d.webApi!==1||typeof d.version!=='string'||d.version.length>64||!version.test(d.version)||!Array.isArray(d.files)||d.files.length>LIMITS.files)throw Error('Incompatible descriptor');
 const paths=new Set();
 for(const e of d.files){
  if(!keys(e,'path,sha256,size')||!allowed(e.path)||paths.has(e.path)||!Number.isSafeInteger(e.size)||e.size<0||e.size>LIMITS.bytes||typeof e.sha256!=='string'||!/^[0-9a-f]{64}$/.test(e.sha256))throw Error('Invalid inventory');
  paths.add(e.path);
 }
 if(!paths.has('index.html'))throw Error('Missing index');
 return paths;
}
async function fileSet(dir,owner,remember,check){
 const found=[];let entries=0;
 async function walk(base,prefix=''){
  check();const stream=await fs.opendir(base,{bufferSize:16});
  try{
   for(;;){
    check();const entry=await stream.read();check();if(!entry)break;
    if(++entries>LIMITS.entries)throw Error('Entry bound');
    const path=join(base,entry.name),rel=prefix+entry.name,info=await fs.lstat(path);check();
    if(info.isDirectory()){if(prefix||!['assets','licenses'].includes(rel))throw Error('Directory depth/path bound');trusted(info,owner,true);remember(path,info);await walk(path,rel+'/');}
    else {trusted(info,owner);if(rel!=='presentation.json')found.push(rel);}
   }
  }finally{await stream.close();}
 }
 await walk(dir);return found;
}
async function installedBytes(path,owner,limit,check){
 check();const before=await fs.lstat(path);check();trusted(before,owner);if(!Number.isSafeInteger(before.size)||before.size<0||before.size>limit)throw Error('File byte bound');
 const fd=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  check();const opened=await fd.stat();check();trusted(opened,owner);if(!identity(before,opened)||opened.size!==before.size)throw Error('File changed');
  const buffer=Buffer.allocUnsafe(opened.size+1);let length=0;
  while(length<buffer.length){check();const {bytesRead}=await fd.read(buffer,length,Math.min(65536,buffer.length-length),length);check();if(!bytesRead)break;length+=bytesRead;}
  const after=await fd.stat();check();trusted(after,owner);
  if(!identity(opened,after)||opened.size!==after.size||opened.mtimeMs!==after.mtimeMs||opened.ctimeMs!==after.ctimeMs||length!==opened.size)throw Error('File changed');
  return buffer.subarray(0,length);
 }finally{await fd.close();}
}

// Runtime presentation is inert first-party frontend data, never broker code.
// The fixture seam is trusted JS only; web/index.mjs does not admit it in config.
export function createPresentationReader({presentationFixture}={}){
 if(presentationFixture!==undefined&&(!keys(presentationFixture,'installRoot,ownerUid')||typeof presentationFixture.installRoot!=='string'||!presentationFixture.installRoot.startsWith('/')||presentationFixture.installRoot==='/'||presentationFixture.installRoot.length>4096||resolve(presentationFixture.installRoot)!==presentationFixture.installRoot||presentationFixture.installRoot.split('/').length-1>LIMITS.ancestors||!Number.isSafeInteger(presentationFixture.ownerUid)||presentationFixture.ownerUid<0||presentationFixture.ownerUid>0xffffffff))throw Error('Invalid presentation fixture');
 const installRoot=presentationFixture?.installRoot??'/opt/relay',owner=presentationFixture?.ownerUid??0;
 const pins=new Map();let flight=null,loads=0,retainedBytes=0;
 const load=async check=>{
   loads++;
   const inspect=async path=>{check();const info=await fs.lstat(path);check();return info;};
   try{
    const directories=new Map(),remember=(path,info)=>directories.set(path,info);
    const ancestors=[];for(let path=dirname(installRoot);;path=dirname(path)){ancestors.unshift(path);if(path==='/')break;}
    if(ancestors.length>LIMITS.ancestors)throw Error('Ancestor depth bound');
    for(const path of ancestors){const info=await inspect(path);trusted(info,owner,true,!!presentationFixture);remember(path,info);}
    for(const path of [installRoot,join(installRoot,'releases')]){const info=await inspect(path);trusted(info,owner,true);remember(path,info);}
    const current=join(installRoot,'current'),currentInfo=await inspect(current);
    if(!currentInfo.isSymbolicLink()||currentInfo.uid!==owner||currentInfo.nlink!==1)throw Error('Untrusted current link');
    const target=await fs.readlink(current),name=basename(target);check();
    if(!releaseName.test(name)||(target!=='releases/'+name&&target!==join(installRoot,'releases',name)))throw Error('Unmanaged release target');
    const release=join(installRoot,'releases',name),dir=join(release,'updater-presentation');
    for(const path of [release,dir]){const info=await inspect(path);trusted(info,owner,true);remember(path,info);}
    const descriptorBytes=await installedBytes(join(dir,'presentation.json'),owner,LIMITS.metadata,check),descriptor=inertJSON(descriptorBytes),paths=descriptorSchema(descriptor);
    const packageBytes=await installedBytes(join(release,'package.json'),owner,LIMITS.metadata,check),pkg=inertJSON(packageBytes);
    if(!object(pkg)||typeof pkg.version!=='string'||'v'+pkg.version!==descriptor.version||name!==descriptor.version+'-'+name.slice(-16))throw Error('Package/directory mismatch');
    const candidateBytes=descriptorBytes.length+packageBytes.length+descriptor.files.reduce((sum,e)=>sum+e.size,0);
    if(candidateBytes>LIMITS.bytes||(!pins.has(descriptor.version)&&(pins.size>=LIMITS.pins||retainedBytes+candidateBytes>LIMITS.retainedBytes)))throw Error('Presentation capacity');
    const found=await fileSet(dir,owner,remember,check);if(found.length!==paths.size||found.some(p=>!paths.has(p)))throw Error('File set mismatch');
    const files=new Map();for(const entry of descriptor.files){const bytes=await installedBytes(join(dir,entry.path),owner,entry.size,check);if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw Error('Bytes mismatch');files.set(entry.path,bytes);}
    const prefix='/updater/presentation/'+descriptor.version+'/';let references=0;
    for(const [,ref] of files.get('index.html').toString('utf8').matchAll(/(?:src|href)=["']([^"']+)["']/g)){
     check();if(++references>LIMITS.files||!ref.startsWith(prefix)||!paths.has(ref.slice(prefix.length)))throw Error('Unpinned/excess index reference');
    }
    if(!references)throw Error('Missing index reference');
    for(const [path,info] of directories){const after=await inspect(path);if(!directoryIdentity(info,after)||(path.startsWith(installRoot+'/')&&(info.mtimeMs!==after.mtimeMs||info.ctimeMs!==after.ctimeMs)))throw Error('Directory changed');}
    if(!identity(currentInfo,await inspect(current))||target!==await fs.readlink(current))throw Error('Current changed');check();
    const existing=pins.get(descriptor.version),metadataHash=hash(Buffer.concat([descriptorBytes,Buffer.from([0]),packageBytes]));
    if(existing){if(existing.metadataHash!==metadataHash||existing.files.size!==files.size||[...files].some(([path,bytes])=>!existing.files.get(path)?.equals(bytes)))throw Error('Version bytes changed');return existing.files.get('index.html');}
    check();pins.set(descriptor.version,{files,metadataHash});retainedBytes+=candidateBytes;return files.get('index.html');
   }catch{return null;}
 };
 return {
  index(){
   if(flight)return flight;
   const deadline=performance.now()+5000;let expired=false,timer;
   const check=()=>{if(expired||performance.now()>=deadline)throw Error('Presentation deadline');};
   const pending=load(check),timeout=new Promise(resolve=>{timer=setTimeout(()=>{expired=true;resolve(null);},5000);});
   const response=Promise.race([pending,timeout]);flight=response;
   // A timed-out kernel IO cannot be cancelled portably. Keep its single-flight
   // admission until cleanup settles; never start another candidate behind it.
   void pending.finally(()=>{clearTimeout(timer);if(flight===response)flight=null;});
   return response;
  },
  stats(){return {loads,pins:pins.size,retainedBytes,loading:!!flight};},
  versionForIndex(bytes){for(const [version,pin] of pins)if(pin.files.get('index.html')===bytes)return version;return 'builtin';},
  asset(path){const match=/^\/updater\/presentation\/([^/]+)\/(.+)$/.exec(path);return match?pins.get(match[1])?.files.get(match[2])??null:null;}
 };
}
