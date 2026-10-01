import {privatePeer,validateRemoteTLS} from './gateway-remote-tls.mjs';
import {isIP} from 'node:net';
export function validateSourceRanges(sourceRanges){
 if(!Array.isArray(sourceRanges)||sourceRanges.length>16)throw Error('Invalid source ranges');
 for(const cidr of sourceRanges){
  if(typeof cidr!=='string'||!/^\d+\.\d+\.\d+\.\d+\/(?:[1-9]|[12][0-9]|3[0-2])$/.test(cidr))throw Error('Use explicit canonical IPv4 source CIDRs, not a public catch-all');
  const [ip,bits]=cidr.split('/');if(isIP(ip)!==4)throw Error('Invalid source range');const n=ip.split('.').reduce((n,v)=>n*256+Number(v),0);if(n%2**(32-Number(bits)))throw Error('Use the network address for a source CIDR');
 }
 return [...sourceRanges];
}
export function caddySnippet(config,sourceRanges=config.proxy?.sourceRanges??[]){
 if(!config.proxy)return null;
 const u=new URL(config.proxy.desktopOrigin),base=config.deployment.appBaseDomain;
 if(u.protocol!=='https:'||u.origin!==config.proxy.desktopOrigin||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(base)||(config.proxy.mtls?!privatePeer(config.deployment.bind):config.deployment.bind!=='127.0.0.1')||!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('Invalid snippet configuration');
 validateSourceRanges(sourceRanges);
 const t=config.proxy.mtls;
 if(t)validateRemoteTLS(t);
 const transport=t?`\n  transport http {\n   tls\n   tls_server_name ${t.serverName}\n   tls_trust_pool file ${t.caddyTLS.serverCAPath}\n   tls_client_auth ${t.caddyTLS.clientCertPath} ${t.caddyTLS.clientKeyPath}\n  }`:'';
 const policy=sourceRanges.length?` @denied not remote_ip ${sourceRanges.join(' ')}\n respond @denied "Access denied" 403`:' respond "Configure source restrictions before enabling access" 403';
 return `# Add only these Relay sites; preserve unrelated Caddy sites. Review before use.\n# Browser certificate issuance/renewal belongs to Caddy. Backend mTLS\n# certificates require separate operator renewal and explicit reload. Wildcard DNS-01 needs\n# an operator-installed DNS provider module and protected credentials.\n# Supply the appropriate tls block; Relay never configures credentials.\n# Caddy outbound routing must actually use trusted peer ${config.proxy.trustedProxy}.\n# This snippet does not bind its outbound source address.\n# Local DNS is not access control. remote_ip is Caddy's immediate peer.\n# Subnet SNAT/upstream proxies can erase client identity: use a separate\n# network/listener boundary if public and private sources look identical.\nhttps://${u.host}, https://*.${base}${u.port?':'+u.port:''} {\n${policy}\n request_header -X-Forwarded-*\n reverse_proxy ${config.deployment.bind}:${config.port} {${transport}\n  header_up -Forwarded\n  header_up -X-Forwarded-For\n  header_up -X-Real-IP\n  header_up Host {http.request.hostport}\n  header_up X-Forwarded-Proto https\n  header_up X-Forwarded-Host {http.request.hostport}\n }\n}\n`;
}
