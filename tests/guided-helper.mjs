// Disposable loopback-only managed configuration. No operator-owned auth bypass.
import {mkdtemp,realpath,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {createHash,X509Certificate} from 'node:crypto';
import {createGateway} from '../server/gateway.mjs';
import {authenticate,client,password} from './auth-helper.mjs';
export {password};
export async function guidedLab(){
 const dir=await realpath(await mkdtemp(tmpdir()+'/guided-'));let relay;
 const hits=[];const upstream=http.createServer((req,res)=>{hits.push({url:req.url,headers:req.headers});res.setHeader('Content-Type','text/html');res.end('<!doctype html><h1>Synthetic Cockpit destination</h1><p>Not authentic Cockpit</p>');});
 try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-subj','/CN=desktop.example.test','-addext','subjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test'],{stdio:'ignore'});
 await chmod(dir+'/key.pem',0o600);await chmod(dir+'/cert.pem',0o600);
 await new Promise((r,j)=>{upstream.once('error',j);upstream.listen(0,'127.0.0.1',r);});
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://127.0.0.1:${upstream.address().port}`;
 const config={version:1,bind:'127.0.0.1',port,desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:dir+'/key.pem',certPath:dir+'/cert.pem',targets:[{id:'existing',label:'Existing target',upstream:origin}]};
 relay=await createGateway({port:0,runtime:dir+'/state',profile:'standalone'});const auth=await authenticate(relay.origin,dir+'/state'),api=client(relay.origin,auth);
 const saved=await api('/admin/gateway','PUT',{config,password});if(saved.status!==200)throw Error('Managed fixture activation failed: '+saved.status);
 const cert=await readFile(dir+'/cert.pem');const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
 return {dir,relay,api,auth,config,origin,hits,cert,spki,async close(){try{await relay.close();}finally{try{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}finally{await rm(dir,{recursive:true,force:true});}}}};
 }catch(e){await relay?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});throw e;}
}
