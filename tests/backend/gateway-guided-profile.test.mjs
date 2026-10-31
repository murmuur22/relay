import test from 'node:test';
import assert from 'node:assert/strict';
import {cockpitTarget,COCKPIT_PROFILE} from '../../server/gateway-service-profiles.mjs';
const form={id:'cockpit',label:'Cockpit',upstream:'https://192.168.1.2:9090',trust:'system',serverName:'',caPath:''};
test('typed Cockpit settings preserve exact identifiers and versioned defaults without secret fields',()=>{
 const t=cockpitTarget({...form,serverName:'xn--a--b.example'});assert.equal(COCKPIT_PROFILE.version,1);assert.equal(t.entryPath,'/');assert.deepEqual(t.cookieNames,['cockpit']);assert.deepEqual(t.webSocketPaths,['/cockpit/socket']);assert.deepEqual(t.webSocketProtocols,['cockpit1']);assert.equal(t.webSocketOrigin,'upstream');assert.equal(t.presentation,'tab');assert.equal(t.accessPolicy,'admin-only');assert.deepEqual(t.upstreamTLS,{serverName:'xn--a--b.example'});
 for(const upstream of ['http://192.168.1.2/','http://192.168.001.2','http://0x7f000001','http://2130706433','http://127.1','http://8.8.8.8','http://169.254.169.254','http://100.100.100.200','http://localhost:9090','https://u:p@192.168.1.2','http://192.168.1.2:0','HTTP://192.168.1.2','http://192.168.1.2:80'])assert.throws(()=>cockpitTarget({...form,upstream}),undefined,upstream);
 for(const extra of [{password:'not-allowed'},{requestHeaders:['x-secret']},{tls:{rejectUnauthorized:false}},{serverName:'UPPER.example'},{serverName:'*.example'},{trust:'off'},{trust:'custom',caPath:'/a/../ca.pem'}])assert.throws(()=>cockpitTarget({...form,...extra}));
 assert.equal(cockpitTarget({...form,trust:'custom',caPath:'/protected/service-ca.pem'}).upstreamTLS.caPath,'/protected/service-ca.pem');
 assert.equal(cockpitTarget({...form,upstream:'http://127.0.0.1:9090'}).upstreamTLS,undefined);
});
