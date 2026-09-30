import test from 'node:test';
import assert from 'node:assert/strict';
import * as domains from '../../server/experimental-gateway-domains.mjs';

// External URL construction must not inherit an internal listener's port.
test('gateway HTTPS origins omit default 443 and preserve explicit nondefault ports',()=>{
 assert.equal(typeof domains.gatewayHTTPSOrigin,'function');
 assert.equal(domains.gatewayHTTPSOrigin('desktop.example.test',443),'https://desktop.example.test');
 assert.equal(domains.gatewayHTTPSOrigin('desktop.example.test',8443),'https://desktop.example.test:8443');
});
test('launch origin inherits external HTTPS port, never an empty trailing colon',()=>{
 assert.equal(typeof domains.gatewayLaunchOrigin,'function');
 const id='a'.repeat(32);
 assert.equal(domains.gatewayLaunchOrigin(id,'apps.example.test','https://desktop.example.test'),`https://${id}.apps.example.test`);
 assert.equal(domains.gatewayLaunchOrigin(id,'apps.example.test','https://desktop.example.test:8443'),`https://${id}.apps.example.test:8443`);
});
test('origin helpers refuse noncanonical authority and invalid port input',()=>{
 assert.equal(typeof domains.gatewayHTTPSOrigin,'function');
 for(const name of ['Desktop.example.test','desktop.example.test:443','user@desktop.example.test','desktop.example.test/path','desktop.example.test.','localhost','desktop.example.test\n'])assert.throws(()=>domains.gatewayHTTPSOrigin(name,443),name);
 for(const port of [0,-1,65536,443.5,'443',undefined,null,NaN])assert.throws(()=>domains.gatewayHTTPSOrigin('desktop.example.test',port));
});
test('launch origins refuse malformed IDs and noncanonical or non-HTTPS desktop origins',()=>{
 assert.equal(typeof domains.gatewayLaunchOrigin,'function');
 const id='a'.repeat(32);
 for(const origin of ['http://desktop.example.test','https://desktop.example.test/','https://desktop.example.test:443','https://user:pass@desktop.example.test','https://desktop.example.test?x=1','https://Desktop.example.test'])assert.throws(()=>domains.gatewayLaunchOrigin(id,'apps.example.test',origin),origin);
 for(const bad of ['x','A'.repeat(32),id+'.evil',id+'\n'])assert.throws(()=>domains.gatewayLaunchOrigin(bad,'apps.example.test','https://desktop.example.test'));
});
