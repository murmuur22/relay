import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayForm,configFromForm,targetForm} from '../../src/gateway-settings.js';
test('gateway form creates an explicit Jellyfin config without certificate material',()=>{
 const form=gatewayForm();form.targets[0].upstream='http://192.168.10.20:8096';
 const config=configFromForm(form);
 assert.equal(config.version,1);assert.equal(config.targets[0].entryPath,'/web/index.html');assert.deepEqual(config.targets[0].webSocketPaths,['/socket']);
 assert.equal(config.keyPath,'/etc/relay-gateway/key.pem');assert(!('key' in config));
});
test('existing operator-reference fields and advanced target options round trip without dropping settings',()=>{
 const config={version:1,bind:'127.0.0.1',port:8443,desktopHostname:'desktop.example.test',appBaseDomain:'apps.example.test',keyPath:'/safe/key.pem',certPath:'/safe/chain.pem',targets:[{id:'files',label:'Files',upstream:'https://100.64.0.20:8443',upstreamTLS:{serverName:'files.example.test'},cookieNames:['sid'],allowDownloads:true}]};
 assert.deepEqual(configFromForm(gatewayForm(config)),config);
});
test('draft validation refuses malformed values rather than silently repairing them',()=>{
 for(const change of [f=>f.port=443,f=>f.desktopHostname='Desktop.example.test',f=>f.targets[0].id='Bad ID',f=>f.targets[0].upstream='http://user:secret@127.0.0.1:8096',f=>f.targets[0].options='[]',f=>f.keyPath='relative',f=>f.targets.push({...f.targets[0]})]){
  const f=gatewayForm();f.targets[0].upstream='http://127.0.0.1:8096';change(f);assert.throws(()=>configFromForm(f));
 }
 const generic=targetForm('generic');assert.equal(generic.id,'app');assert.equal(JSON.parse(generic.options).entryPath,'/');
});
