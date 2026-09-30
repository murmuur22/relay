import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProxyRequest} from '../../server/gateway-proxy-boundary.mjs';
const request=(extra=[])=>({socket:{remoteAddress:'127.0.0.1'},rawHeaders:['Host','desktop.example.com','X-Forwarded-Host','desktop.example.com','X-Forwarded-Proto','https',...extra],headers:{host:'desktop.example.com','x-forwarded-host':'desktop.example.com','x-forwarded-proto':'https'}});
test('proxy boundary admits only exact peer and single canonical HTTPS metadata',()=>{
 const config={trustedProxy:'127.0.0.1'};
 assert.doesNotThrow(()=>validateProxyRequest(request(),config));
 for(const [name,value] of [['X-Forwarded-Proto','http'],['X-Forwarded-Host','evil.example.com'],['Host','desktop.example.com'],['Forwarded','proto=https'],['X-Forwarded-For','127.0.0.1'],['X-Forwarded-Port','443'],['X-Real-IP','127.0.0.1']])assert.throws(()=>validateProxyRequest(request([name,value]),config));
 for(const peer of ['127.0.0.2','::1','192.0.2.1',undefined]){const r=request();r.socket.remoteAddress=peer;assert.throws(()=>validateProxyRequest(r,config));}
 for(const value of ['http','https, https','HTTPS','']){const r=request();r.rawHeaders[5]=value;r.headers['x-forwarded-proto']=value;assert.throws(()=>validateProxyRequest(r,config));}
 const missing=request();missing.rawHeaders.splice(2,2);delete missing.headers['x-forwarded-host'];assert.throws(()=>validateProxyRequest(missing,config));
 const conflict=request();conflict.rawHeaders[3]='evil.example.com';conflict.headers['x-forwarded-host']='evil.example.com';assert.throws(()=>validateProxyRequest(conflict,config));
});
