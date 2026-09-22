import {webConfig} from './webapps.mjs';
import {randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
const derive=promisify(scrypt);
export const token=()=>randomBytes(32).toString('hex');
export const fail=(status,message)=>Object.assign(new Error(message),{status});
export function strong(password){if(typeof password!=='string'||password.length<14||password.length>128||!password.trim())throw fail(400,'Password must be 14–128 characters.');}
export async function hash(password){strong(password);const salt=token();return {salt,key:(await derive(password,salt,64)).toString('hex')};}
export async function verify(password,record){const safe=typeof password==='string'&&password.length<=128?password:'';const actual=await derive(safe,record.salt,64);return timingSafeEqual(actual,Buffer.from(record.key,'hex'));}
const defaultPreferences={showAppStatus:true,introAnimation:true,interfaceAnimations:true};
const validateAppFields=body=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['kind','mode','label','address','icon','openMode','allowedOrigins','userIds','enabled','gateway'].includes(k)))throw fail(400,'Invalid app fields');};
const validPreferences=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0&&Object.entries(value).every(([key,value])=>Object.hasOwn(defaultPreferences,key)&&typeof value==='boolean');
export const publicUser=({id,username,displayName,role,grants,disabled,mustChange,onboardingComplete,onboardingAppId=null,preferences})=>({id,username,displayName,role,grants,disabled,mustChange,onboardingComplete,onboardingAppId,preferences:preferences??{...defaultPreferences}});
export class Accounts{
 constructor(runtime,templates){this.runtime=runtime;this.templates=templates;this.queue=Promise.resolve();}
 async init(){
  try{this.state=JSON.parse(await readFile(this.runtime+'/accounts.json','utf8'));
   if(this.state.version!==1||!Array.isArray(this.state.users)||!Array.isArray(this.state.services)||!this.state.users.some(u=>u.role==='admin'&&!u.disabled)||this.state.users.some(u=>! /^[0-9a-f-]{36}$/.test(u.id)||! /^[0-9a-f]{128}$/.test(u.password?.key)||! /^[0-9a-f]{64}$/.test(u.password?.salt)))throw Error('Invalid account state');
   if(this.state.users.length>64||this.state.services.length>64||new Set(this.state.users.map(u=>u.id)).size!==this.state.users.length||new Set(this.state.users.map(u=>u.username)).size!==this.state.users.length||new Set(this.state.services.map(s=>s.id)).size!==this.state.services.length)throw Error('Invalid account state');
   for(const user of this.state.users){if(!('preferences' in user))user.preferences={...defaultPreferences};if(!validPreferences(user.preferences)||typeof user.preferences.showAppStatus!=='boolean')throw Error('Invalid preferences');user.preferences={...defaultPreferences,...user.preferences};this.validateUser(user,this.state);if(!('onboardingAppId' in user))user.onboardingAppId=null;if(user.onboardingAppId!==null&&(typeof user.onboardingAppId!=='string'||!/^service-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(user.onboardingAppId)||!this.state.services.some(s=>s.id===user.onboardingAppId&&s.kind==='web')))throw Error('Invalid onboarding app');if(!('onboardingComplete' in user))user.onboardingComplete=true;if(typeof user.onboardingComplete!=='boolean'||typeof user.mustChange!=='boolean')throw Error('Invalid account state');}
   for(const service of this.state.services){if(service.id==='system-updater'||service.kind==='system')throw Error('Reserved system app');if(service.kind==='web'){webConfig(service);if(!/^service-[0-9a-f-]{36}$/.test(service.id))throw Error('Invalid registry state');continue;}const template=this.templates.find(t=>t.id===service.template);if(!template||service.mode!==template.mode||service.url!==template.url||! /^(?:[a-z]+(?:-[a-z]+)*|service-[0-9a-f-]{36})$/.test(service.id)||typeof service.label!=='string'||!service.label.trim()||service.label.length>64||typeof service.enabled!=='boolean')throw Error('Invalid registry state');}
  }catch(e){if(e.code!=='ENOENT')throw Error('Account state unreadable; refusing enrollment');this.state={version:1,users:[],services:structuredClone(this.templates).map(a=>({...a,template:a.id,enabled:true}))};}
  this.dummy=await hash(token());
 }
 mutate(fn){const job=this.queue.catch(()=>{}).then(async()=>{const next=structuredClone(this.state);const result=await fn(next);await writeFile(this.runtime+'/accounts.tmp',JSON.stringify(next),{mode:0o600});await chmod(this.runtime+'/accounts.tmp',0o600);await rename(this.runtime+'/accounts.tmp',this.runtime+'/accounts.json');this.state=next;return result;});this.queue=job;return job;}
 validateUser(user,state){
  if(typeof user.username!=='string'||!/^[a-z][a-z0-9_-]{2,31}$/.test(user.username)||typeof user.displayName!=='string'||!user.displayName.trim()||user.displayName.length>64||!['admin','user'].includes(user.role)||typeof user.disabled!=='boolean'||!Array.isArray(user.grants)||user.grants.length>64||user.grants.some(id=>!state.services.some(s=>s.id===id)))throw fail(400,'Invalid user fields');
 }
 async createUser(body){return this.mutate(async state=>{if(state.users.length>=64||state.users.some(u=>u.username===body.username))throw fail(400,'User unavailable');const user={id:randomUUID(),username:body.username,displayName:body.displayName||body.username,role:body.role||'user',grants:body.grants||[],disabled:false,mustChange:false,onboardingAppId:null,onboardingComplete:true,preferences:{...defaultPreferences},password:await hash(body.password)};this.validateUser(user,state);state.users.push(user);return publicUser(user);});}
 async updateUser(id,body){return this.mutate(async state=>{const user=state.users.find(u=>u.id===id);if(!user)throw fail(404,'User unavailable');for(const key of ['role','grants','disabled'])if(key in body)user[key]=body[key];if('password' in body){user.password=await hash(body.password);user.mustChange=true;}this.validateUser(user,state);if(!state.users.some(u=>u.role==='admin'&&!u.disabled))throw fail(400,'Cannot remove the last active admin');return publicUser(user);});}
 async profile(id,body){return this.mutate(async state=>{const user=state.users.find(u=>u.id===id);if(!user||!await verify(body.currentPassword,user.password))throw fail(401,'Current password is incorrect');if('displayName' in body)user.displayName=body.displayName;if('password' in body){if(body.password===body.currentPassword)throw fail(400,'Choose a different password');user.password=await hash(body.password);user.mustChange=false;}this.validateUser(user,state);return publicUser(user);});}
 async preferences(id,body){if(!validPreferences(body))throw fail(400,'Invalid preference');return this.mutate(state=>{const u=state.users.find(u=>u.id===id);u.preferences={...u.preferences,...body};return publicUser(u);});}
 async completeOnboarding(id){return this.mutate(state=>{const user=state.users.find(u=>u.id===id);if(!user||user.disabled||user.role!=='admin'||user.mustChange)throw fail(403,'Admin access required');user.onboardingComplete=true;return publicUser(user);});}
 async onboardingApp(id,body){return this.mutate(state=>{
  const user=state.users.find(u=>u.id===id);
  if(!user||user.disabled||user.role!=='admin'||user.mustChange||user.onboardingComplete)throw fail(403,'Pending administrator onboarding required');
  validateAppFields(body);if(body.kind!=='web')throw fail(400,'Web app required');
  const saved=state.services.find(s=>s.id===user.onboardingAppId);if(saved)return saved;
  const service=this.mutateService(state,null,body);user.onboardingAppId=service.id;return service;
 });}
 async service(id,body,remove=false){return this.mutate(state=>this.mutateService(state,id,body,remove));}
 mutateService(state,id,body,remove=false){
  let service=state.services.find(s=>s.id===id);
  if(!remove&&(body.kind==='web'||service?.kind==='web')){
   validateAppFields(body);
   if(id&&(!service||('mode' in body&&body.mode!==service.mode)||('kind' in body&&body.kind!==service.kind)))throw fail(400,'App kind and mode cannot change');
   if(!id&&state.services.length>=64)throw fail(400,'Registry full');
   const config=webConfig({...service,...body});
   if('userIds' in body&&(!Array.isArray(body.userIds)||body.userIds.length>64||body.userIds.some(id=>!state.users.some(u=>u.id===id&&!u.disabled))))throw fail(400,'Invalid app access');
   if(!id){service={id:'service-'+randomUUID(),...config};state.services.push(service);}else Object.assign(service,config);
   if('userIds' in body)for(const u of state.users){u.grants=u.grants.filter(g=>g!==service.id);if(body.userIds.includes(u.id))u.grants.push(service.id);}
   return service;
  }
  if(Object.keys(body).some(k=>!['template','label','enabled'].includes(k)))throw fail(400,'Only registered templates are supported; URL navigation is unavailable');
  if(remove){if(!service)throw fail(404,'Service unavailable');state.services=state.services.filter(s=>s.id!==id);for(const user of state.users){user.grants=user.grants.filter(g=>g!==id);if(user.onboardingAppId===id)user.onboardingAppId=null;}return {removed:true};}
  if(!id){const template=this.templates.find(t=>t.id===body.template);if(!template||state.services.length>=64)throw fail(400,'Unsupported template or registry full');if(template.mode==='native'&&state.services.some(s=>s.template===template.id))throw fail(400,'Native templates allow one entry');service={...template,id:'service-'+randomUUID(),template:template.id,enabled:true};state.services.push(service);}else if(!service)throw fail(404,'Service unavailable');
  if(id&&'template' in body&&body.template!==service.template)throw fail(400,'Template cannot be changed');
  for(const key of ['label','enabled'])if(key in body)service[key]=body[key];
  if(typeof service.label!=='string'||!service.label.trim()||service.label.length>64||typeof service.enabled!=='boolean')throw fail(400,'Invalid service fields');return service;
 }
 async enroll(password){return this.mutate(async state=>{if(state.users.length)throw fail(403,'Setup unavailable');const user={id:randomUUID(),username:'admin',displayName:'admin',role:'admin',grants:[],disabled:false,mustChange:false,onboardingAppId:null,onboardingComplete:false,preferences:{...defaultPreferences},password:await hash(password)};state.users.push(user);return user;});}
 allowed(user,service){return !!service?.enabled&&!user.disabled&&!user.mustChange&&(user.role==='admin'||(service.template!=='keepsakes'&&user.grants.includes(service.id)));}
 apps(user){return this.state.services.filter(a=>this.allowed(user,a));}
}
