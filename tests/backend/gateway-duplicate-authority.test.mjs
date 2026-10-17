import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {gatewayLab,addGateway,launchGateway,redeemGateway} from '../gateway-helper.mjs';
test('direct HTTPS desktop and app reject duplicate Host authorities before any forwarding',{timeout:10000},async()=>{
 const l=await gatewayLab();try{const app=await addGateway(l),route=await launchGateway(l,app),cap=await redeemGateway(l,route);
 const request=(origin,path,cookie)=>new Promise((resolve,reject)=>{const u=new URL(origin);const req=https.request({hostname:'127.0.0.1',port:u.port,servername:u.hostname,ca:l.cert,path,headers:['Host',u.host,'Host','foreign.invalid','Cookie',cookie,'Sec-Fetch-Site','same-origin']},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
 const before=l.seen.length;assert.equal(await request(route.origin,'/',cap.cookie),403);assert.equal(l.seen.length,before);assert.equal(await request(l.relay.experimentalGateway.desktopOrigin,'/api/auth',''),403);
 }finally{await l.close();}
});
