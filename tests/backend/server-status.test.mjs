import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayLab,addGateway} from '../gateway-helper.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('Gateway server status actively checks only registered fixed entry without launching or authenticating',{timeout:20000},async()=>{
 const l=await gatewayLab();try{const app=await addGateway(l);await l.api('/preferences','PATCH',{showAppStatus:true});
 const status=(await(await l.api('/status')).json())[app.id];assert.equal(status.reachability,'responding');assert.equal(status.httpStatus,200);assert.equal(status.source,'relay');assert.equal(status.reason,'http-response');assert.match(status.detail,/not.*health|not.*readiness/i);assert.ok(status.checkedAt);assert.ok(l.seen.length>0);assert.equal(l.relay.experimentalGateway.stats().routes,0);assert.ok(!JSON.stringify(status).includes(l.experimentalGateway.targets[0].upstream));
 const before=l.seen.length;await l.api('/status');assert.equal(l.seen.length,before,'bounded cache');
 await l.api('/preferences','PATCH',{showAppStatus:false});assert.deepEqual(await(await l.api('/status')).json(),{});assert.equal(l.seen.length,before);
 await l.api('/admin/users','POST',{username:'viewer',password,grants:[]});const viewer=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','viewer'));assert.equal((await(await viewer('/status')).json())[app.id],undefined);assert.equal(l.seen.length,before);
 }finally{await l.close();}
});
