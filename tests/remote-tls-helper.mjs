// Offline disposable PKI; OpenSSL only, no trust-store changes.
import {execFileSync} from 'node:child_process';
import {writeFile,readFile,chmod} from 'node:fs/promises';
export async function remotePKI(dir){
 const run=args=>execFileSync('openssl',args,{stdio:'ignore'});
 for(const ca of ['server-ca','client-ca','other-ca']){
  run(['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout',`${dir}/${ca}.key`,'-out',`${dir}/${ca}.pem`,'-subj',`/CN=${ca}`,'-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 }
 async function leaf(name,ca,dns,usage){
  run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',`${dir}/${name}.key`,'-out',`${dir}/${name}.csr`,'-subj',`/CN=${dns}`]);
  await writeFile(`${dir}/${name}.ext`,`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=${usage}\nsubjectAltName=DNS:${dns}\n`);
  // Explicit historic validity for actual TLS expiry negatives, without changing the clock.
  if(name.startsWith('expired-')){
   await writeFile(`${dir}/${name}.index`,'');await writeFile(`${dir}/${name}.serial`,'1000\n');
   await writeFile(`${dir}/${name}.ca.cnf`,`[ca]\ndefault_ca=local\n[local]\ndatabase=${dir}/${name}.index\nserial=${dir}/${name}.serial\nnew_certs_dir=${dir}\ncertificate=${dir}/${ca}.pem\nprivate_key=${dir}/${ca}.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n`);
   run(['ca','-batch','-notext','-config',`${dir}/${name}.ca.cnf`,'-in',`${dir}/${name}.csr`,'-startdate','200101000000Z','-enddate','200102000000Z','-extfile',`${dir}/${name}.ext`,'-out',`${dir}/${name}.pem`]);
  }else run(['x509','-req','-in',`${dir}/${name}.csr`,'-CA',`${dir}/${ca}.pem`,'-CAkey',`${dir}/${ca}.key`,'-CAcreateserial','-days','1','-extfile',`${dir}/${name}.ext`,'-out',`${dir}/${name}.pem`]);
 }
 await leaf('server','server-ca','backend.example.test','serverAuth');
 await leaf('client','client-ca','caddy.example.test','clientAuth');
 await leaf('wrong-name','client-ca','other.example.test','clientAuth');
 await leaf('wrong-ca','other-ca','caddy.example.test','clientAuth');
 await leaf('wrong-usage','client-ca','caddy.example.test','serverAuth');
 await leaf('expired-client','client-ca','caddy.example.test','clientAuth');
 await leaf('expired-server','server-ca','backend.example.test','serverAuth');
 await writeFile(`${dir}/server.pem`,Buffer.concat([await readFile(`${dir}/server.pem`),await readFile(`${dir}/server-ca.pem`)]));
 const names=['expired-client','expired-server','server-ca','client-ca','other-ca','server','client','wrong-name','wrong-ca','wrong-usage'];
 const material={};for(const name of names){await chmod(`${dir}/${name}.pem`,0o600);await chmod(`${dir}/${name}.key`,0o600);material[name]={cert:await readFile(`${dir}/${name}.pem`),key:await readFile(`${dir}/${name}.key`)};}
 return material;
}
export async function shortCertificate(dir,name,issuer,dns,purpose,{ca=false,selfSigned=false,expires=Date.now()+8000}={}){
 const run=args=>execFileSync('openssl',args,{stdio:'ignore'});
 run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',`${dir}/${name}.key`,'-out',`${dir}/${name}.csr`,'-subj',`/CN=${dns}`]);
 await writeFile(`${dir}/${name}.ext`,`basicConstraints=critical,CA:${ca?'TRUE':'FALSE'}\nkeyUsage=critical,${ca?'keyCertSign,cRLSign':'digitalSignature,keyEncipherment'}\n${ca?'':`extendedKeyUsage=${purpose}\nsubjectAltName=DNS:${dns}\n`}`);
 await writeFile(`${dir}/${name}.index`,'');await writeFile(`${dir}/${name}.serial`,'1000\n');
 await writeFile(`${dir}/${name}.ca.cnf`,`[ca]\ndefault_ca=local\n[local]\ndatabase=${dir}/${name}.index\nserial=${dir}/${name}.serial\nnew_certs_dir=${dir}\ncertificate=${dir}/${issuer}.pem\nprivate_key=${dir}/${issuer}.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n`);
 const end=new Date(expires).toISOString().replace(/[-:TZ]/g,'').slice(2,14)+'Z';
 run(['ca','-batch','-notext','-config',`${dir}/${name}.ca.cnf`,'-in',`${dir}/${name}.csr`,'-startdate','200101000000Z','-enddate',end,...(selfSigned?['-selfsign','-keyfile',`${dir}/${name}.key`]:[]),'-extfile',`${dir}/${name}.ext`,'-out',`${dir}/${name}.pem`]);
 await chmod(`${dir}/${name}.pem`,0o600);await chmod(`${dir}/${name}.key`,0o600);
 return {cert:await readFile(`${dir}/${name}.pem`),key:await readFile(`${dir}/${name}.key`)};
}
export function remoteReference(dir,port,bind='127.0.0.1',trustedProxy='127.0.0.1'){
 return {version:3,mode:'reverse-proxy',bind,port,desktopOrigin:'https://desktop.example.test',appBaseDomain:'apps.example.test',trustedProxy,sourceRanges:['127.0.0.1/32'],backendTLS:{keyPath:dir+'/server.key',certPath:dir+'/server.pem',clientCAPath:dir+'/client-ca.pem',serverName:'backend.example.test',clientName:'caddy.example.test'},caddyTLS:{serverCAPath:dir+'/server-ca.pem',clientCertPath:dir+'/client.pem',clientKeyPath:dir+'/client.key'},targets:[{id:'files',label:'Files',upstream:'http://127.0.0.1:18302'}]};
}
