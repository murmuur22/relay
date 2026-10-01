// Backend transport identity is independent of the browser certificate.
import {isIP} from 'node:net';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {createSecureContext} from 'node:tls';
export const exactDNS=n=>typeof n==='string'&&n.length<=220&&n.includes('.')&&n.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p));
export function privatePeer(ip){
 if(isIP(ip)!==4)return false;
 const [a,b]=ip.split('.').map(Number);
 return ip==='127.0.0.1'||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
}
export function currentCertificate(x,now=Date.now()){return Date.parse(x.validFrom)<=now&&Date.parse(x.validTo)>now;}
export function exactCertificateName(x,name){return !!x.checkHost(name,{subject:'never',wildcards:false,partialWildcards:false,multiLabelWildcards:false,singleLabelSubdomains:false});}
const policies=new WeakMap(),connections=new WeakMap();
function certificateChain(pem){
 const text=pem.toString(),blocks=text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
 if(!blocks?.length||blocks.length>8||text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())throw Error('Invalid bounded certificate chain');
 return blocks.map(block=>new X509Certificate(block));
}
export function validateRemoteTLS(t){
 if(!t||typeof t!=='object'||Object.keys(t).some(k=>!['key','cert','ca','serverName','clientName','caddyTLS'].includes(k))||!exactDNS(t.serverName)||!exactDNS(t.clientName))throw Error('Invalid backend TLS policy');
 const chain=certificateChain(t.cert),x=chain[0],anchors=certificateChain(t.ca),ca=anchors[0];
 // One explicit client trust anchor; every supplied server chain element must be current.
 if(anchors.length!==1||!chain.every(c=>currentCertificate(c))||!ca.ca||!currentCertificate(ca)||x.ca||!exactCertificateName(x,t.serverName)||!x.checkPrivateKey(createPrivateKey(t.key))||!x.keyUsage?.includes('1.3.6.1.5.5.7.3.1'))throw Error('Invalid backend TLS certificates');
 const root=chain.at(-1);
 if(chain.length<2||!root.ca||!root.checkIssued(root)||!root.verify(root.publicKey)||!ca.checkIssued(ca)||!ca.verify(ca.publicKey))throw Error('Complete server chain and self-signed client root required');
 for(let i=1;i<chain.length;i++)if(!chain[i].ca||!chain[i-1].checkIssued(chain[i])||!chain[i-1].verify(chain[i].publicKey))throw Error('Invalid ordered server chain');
 const c=t.caddyTLS;
 if(!c||Object.keys(c).length!==3||!['serverCAPath','clientCertPath','clientKeyPath'].every(k=>typeof c[k]==='string'&&/^\/[a-zA-Z0-9_./-]+$/.test(c[k])&&!c[k].split('/').includes('..')))throw Error('Invalid Caddy TLS paths');
 createSecureContext({key:t.key,cert:t.cert,ca:t.ca,minVersion:'TLSv1.2'});
 policies.set(t,{ca,expires:Math.min(...[...chain,ca].map(c=>Date.parse(c.validTo)))});
 return t;
}
export function remoteSocketAuthorized(socket,t){
 if(!socket.encrypted||!socket.authorized||socket.isSessionReused())return false;
 try{
  const policy=policies.get(t);if(!policy)return false;
  let state=connections.get(socket);
  if(!state||state.policy!==policy){
   const leaf=socket.getPeerX509Certificate();
   if(!leaf||leaf.ca||!exactCertificateName(leaf,t.clientName)||!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.2'))return false;
   // Node's server-side peer API exposes only the leaf, even when a client
   // sends intermediates. Require direct issuance by the configured CA so no
   // unobservable intermediate lifetime can outlive connection authorization.
   if(!leaf.checkIssued(policy.ca)||!leaf.verify(policy.ca.publicKey)||!currentCertificate(leaf))return false;
   state={policy,expires:Math.min(policy.expires,Date.parse(leaf.validTo))};connections.set(socket,state);
  }
  return Date.now()<state.expires;
 }catch{return false;}
}
