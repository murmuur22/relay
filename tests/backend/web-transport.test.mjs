import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Transport,safeIP} from '../../server/transport.mjs';
import {webURL} from '../../server/webapps.mjs';
test('Tailnet unicast is allowed while cloud metadata and transition addresses are blocked',()=>{
 for(const address of ['100.64.0.1','100.80.0.2','100.127.255.254'])assert.equal(safeIP(address),true,address);
 for(const address of ['100.100.100.200','2001::1','2001:0:0:0:0:0:0:1','2002:a9fe:a9fe::1'])assert.equal(safeIP(address),false,address);
});
test('DNS validation and transport timeouts are bounded before connection',async()=>{
 const transport=new Transport({lookup:()=>new Promise(()=>{}),dnsTimeout:30});
 await assert.rejects(transport.validate('http://never.invalid/'),/DNS lookup timed out/);
 await assert.rejects(transport.request('http://never.invalid/',{address:'http://never.invalid/'},{timeout:15}),/timed out/);await transport.close();
});
test('pinned transport validates DNS, origin, gateway aliases, redirects and bounded bodies',async()=>{
 const hits=[];const server=http.createServer((req,res)=>{hits.push(req.headers.host);if(req.url==='/redirect'){res.writeHead(302,{location:'http://forbidden.invalid/'});res.end();}else if(req.url==='/big')res.end('x'.repeat(10000));else res.end('fixture');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,base=`http://fixture.invalid:${port}`;let lookups=0;
 const transport=new Transport({gatewayOrigin:'http://127.0.0.1:12345',lookup:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];}});
 try{
 const policy={address:base,allowedOrigins:[]};assert.equal((await transport.request(base,policy)).body.toString(),'fixture');assert.equal(lookups,1);assert.equal(hits[0],`fixture.invalid:${port}`);
 await assert.rejects(transport.request('http://forbidden.invalid/',policy));
 assert.equal((await transport.request(base+'/redirect',policy)).status,302);
 await assert.rejects(transport.request(base+'/big',policy,{maxBytes:100}));
 for(const address of ['169.254.169.254','168.63.129.16','fd00:ec2::254','fd00:0ec2:0:0:0:0:0:0254','0.0.0.0','224.0.0.1','::','fe80::1','ff02::1','::ffff:169.254.169.254']){assert.equal(safeIP(address),false,address);const t=new Transport({lookup:async()=>[{address,family:address.includes(':')?6:4}]});await assert.rejects(t.request(base,policy));}
 await assert.rejects(transport.request('http://alias.invalid:12345',{address:'http://alias.invalid:12345'}));
 for(const value of ['127.0.0.1','ftp://fixture.invalid','http://user:pass@fixture.invalid','http://fixture.invalid/#hash','http://fixture.invalid:99999'])assert.throws(()=>webURL(value));
 }finally{await transport.close();await new Promise(r=>server.close(r));}
});
