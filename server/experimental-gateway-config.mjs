// Read-only operator configuration. No trust installation, DNS, or state writes.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,dirname,normalize} from 'node:path';
import {isIP} from 'node:net';
import {networkInterfaces} from 'node:os';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {createSecureContext} from 'node:tls';
import {safeIP} from './transport.mjs';
import {sameSiteDomains} from './experimental-gateway-domains.mjs';
import {experimentalConfig} from './experimental-gateway.mjs';
const invalid=()=>Error('Invalid gateway deployment configuration');
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
async function protectedRead(path,limit){
 if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path)throw invalid();
 // Trusted, non-symlink ancestry; root-owned sticky temporary roots are allowed
 // for disposable tests. A writable ancestor owned by another principal is not.
 for(let p=dirname(path);;p=dirname(p)){
  const s=await lstat(p);
  if(!s.isDirectory()||![0,process.getuid()].includes(s.uid)||((s.mode&0o022)&&!(s.uid===0&&(s.mode&0o1000))))throw invalid();
  if(p===dirname(p))break;
 }
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await f.stat();
  if(!s.isFile()||s.nlink!==1||![0,process.getuid()].includes(s.uid)||(s.mode&0o027)||s.size<1||s.size>limit)throw invalid();
  const b=Buffer.alloc(limit+1);let size=0;
  while(size<b.length){const {bytesRead}=await f.read(b,size,b.length-size,null);if(!bytesRead)break;size+=bytesRead;}
  if(size>limit)throw invalid();return b.subarray(0,size);
 }finally{await f.close();}
}
export function validateDeployment(value){
 if(!keys(value,['bind','desktopHostname','appBaseDomain'])||isIP(value.bind)!==4||!safeIP(value.bind)||!sameSiteDomains(value.desktopHostname,value.appBaseDomain))throw invalid();
 if(!Object.values(networkInterfaces()).flat().some(n=>n.family==='IPv4'&&n.address===value.bind))throw invalid();
 return {...value};
}
export async function loadGatewayConfig(path){
 if(path===undefined)return undefined;
 try{
  const v=JSON.parse(await protectedRead(path,65536));
  if(!keys(v,['version','bind','port','desktopHostname','appBaseDomain','keyPath','certPath','targets'])||v.version!==1||!Number.isInteger(v.port)||v.port<1024||v.port>65535)throw invalid();
  const deployment=validateDeployment({bind:v.bind,desktopHostname:v.desktopHostname,appBaseDomain:v.appBaseDomain});
  const key=await protectedRead(v.keyPath,65536),cert=await protectedRead(v.certPath,262144);
  const x=new X509Certificate(cert),now=Date.now();
  if(Date.parse(x.validFrom)>now||Date.parse(x.validTo)<=now||!x.checkPrivateKey(createPrivateKey(key))||!x.checkHost(v.desktopHostname,{subject:'never'})||!x.subjectAltName?.split(', ').includes('DNS:*.'+v.appBaseDomain))throw invalid();
  createSecureContext({key,cert});
  if(!Array.isArray(v.targets))throw invalid();
  const targets=[];
  for(const raw of v.targets){
   const target={...raw};
   if(Object.hasOwn(target,'tls'))throw invalid();
   if(target.upstreamTLS!==undefined){
    const t=target.upstreamTLS;
    if(!keys(t,['caPath','serverName'])||new URL(target.upstream).protocol!=='https:')throw invalid();
    target.tls={};
    if(t.caPath!==undefined){target.tls.ca=(await protectedRead(t.caPath,262144)).toString();createSecureContext({ca:target.tls.ca});new X509Certificate(target.tls.ca);}
    if(t.serverName!==undefined)target.tls.serverName=t.serverName;
    delete target.upstreamTLS;
   }
   targets.push(target);
  }
  return experimentalConfig({key,cert,port:v.port,targets,deployment});
 }catch{throw invalid();}
}
