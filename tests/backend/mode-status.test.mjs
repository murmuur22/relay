import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayLab,addGateway,launchGateway,redeemGateway,edgeRequest} from '../gateway-helper.mjs';
import {authenticate,client,password} from '../auth-helper.mjs';
test('Gateway status is passive real owned upstream transport evidence, with HTTP 401 reached not ready',{timeout:20000},async()=>{
 const l=await gatewayLab();try{const app=await addGateway(l);await l.api('/preferences','PATCH',{showAppStatus:true});const initial=await(await l.api('/status')).json();assert.match(initial[app.id].detail,/No upstream response observed/);const before=l.seen.length;await l.api('/status');assert.equal(l.seen.length,before,'status must not introduce server requests');
 const target=await launchGateway(l,app),cap=await redeemGateway(l,target);for(const url of [l.relay.experimentalGateway.desktopOrigin.replace(/:\d+$/,':9999')+'/',target.origin.replace(/:\d+$/,':9999')+'/'])assert.equal((await l.api('/desktop/bookmarks','POST',{url,label:'Cookie host',parentId:null})).status,400);const response=await edgeRequest(l,target.origin,'/private',{headers:{cookie:cap.cookie}});assert.equal(response.status,401);
 const status=(await(await l.api('/status')).json())[app.id];assert.equal(status.state,'Reached');assert.equal(status.httpStatus,401);assert.equal(status.source,'relay');assert.ok(status.checkedAt);assert.match(status.detail,/not.*ready|not.*health/i);assert.ok(!JSON.stringify(status).includes(l.experimentalGateway.targets[0].upstream));
 await l.api('/admin/users','POST',{username:'viewer',password,grants:[app.id]});const viewer=client(l.relay.origin,await authenticate(l.relay.origin,l.dir+'/state','viewer'));assert.equal((await(await viewer('/status')).json())[app.id].state,'Unknown','another user cannot read my route observation');await l.api('/preferences','PATCH',{showAppStatus:false});assert.deepEqual(await(await l.api('/status')).json(),{});
 }finally{await l.close();}
});
