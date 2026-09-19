import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
export const password='Synthetic-test-passphrase-42!';
export async function authenticate(origin,runtime,username='admin',pass=password){
 const info=await (await fetch(origin+'/api/auth')).json();
 const setup=info.setup?new URL(await readFile(runtime+'/setup-url.txt','utf8')).hash.slice(1):undefined;
 const r=await fetch(origin+(setup?'/api/enroll':'/api/login'),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':info.csrf},body:JSON.stringify({username,password:pass,setup})});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 const s=await (await fetch(origin+'/api/session',{headers:{cookie}})).json();return {cookie,s};
}
export async function browserLogin(page,origin,runtime){
 const auth=await authenticate(origin,runtime),api=client(origin,auth);
 if(auth.s.user.role==='admin'&&!auth.s.user.mustChange&&!auth.s.user.onboardingComplete)assert.equal((await api('/onboarding/complete','POST',{})).status,200);
 assert.equal((await api('/preferences','PATCH',{introAnimation:false,interfaceAnimations:false})).status,200);
 const [name,value]=auth.cookie.split('=');
 await page.context().addCookies([{name,value,url:origin,httpOnly:true,sameSite:'Strict'}]);await page.goto(origin);
}
export function client(origin,auth){return async(path,method='GET',body)=>fetch(origin+'/api'+path,{method,headers:{cookie:auth.cookie,Origin:origin,'X-CSRF-Token':auth.s.csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
