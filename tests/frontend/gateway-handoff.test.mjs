import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGatewayHandoff} from '../../src/gateway-handoff.js';
const id='a'.repeat(64),ticket='b'.repeat(64),host='c'.repeat(32);
const config={enabled:true,desktopOrigin:'https://desktop.example.test:8443',appBaseDomain:'apps.example.test'};
const target={origin:`https://${host}.apps.example.test:8443`,launchId:id,ticket,allowDownloads:true};
test('gateway handoff accepts operator configured HTTPS names without fixed test hostnames',()=>{
 assert.deepEqual(validateGatewayHandoff(target,config,config.desktopOrigin,id),{origin:target.origin,ticket,allowDownloads:true,allowPopups:false});
});
test('gateway handoff rejects changed authority, malformed origins and unrelated app hosts',()=>{
 for(const origin of ['http://'+host+'.apps.example.test:8443','https://desktop.example.test:8443','https://'+host+'.apps.example.test.evil.test:8443','https://'+host+'.apps.example.test:8444',target.origin+'/',target.origin+'#secret','https://user@'+host+'.apps.example.test:8443'])assert.throws(()=>validateGatewayHandoff({...target,origin},config,config.desktopOrigin,id));
 for(const override of [{ticket:'bad'},{launchId:'d'.repeat(64)}])assert.throws(()=>validateGatewayHandoff({...target,...override},config,config.desktopOrigin,id));
 assert.throws(()=>validateGatewayHandoff(target,config,'http://127.0.0.1:4180',id));
 assert.throws(()=>validateGatewayHandoff(target,{...config,enabled:false},config.desktopOrigin,id));
});
