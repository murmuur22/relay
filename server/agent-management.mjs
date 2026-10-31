// Ephemeral delegated app configuration; never browser-session impersonation.
import {createHash,randomUUID} from 'node:crypto';
import {token,verify,fail} from './accounts.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export function agentManagement({app,wrap,getSession,sessions,accounts,admit,getState,revisionSeed,previewTarget,changeTarget,previewApp,changeApp}){
 const grants=new Map(),plans=new Map(),epoch=token();let failures=0,reset=0;
 const browser=req=>{admit();const s=getSession(req);if(!s||s!==req.session||s.user.role!=='admin'||s.user.mustChange)throw fail(403,'Active administrator required');return s;};
 const live=g=>{admit();if(grants.get(g.hash)!==g)throw fail(401,'Agent authorization unavailable');const s=sessions.get(g.sessionId),u=accounts.state.users.find(u=>u.id===s?.userId);if(g.expires<=Date.now()||!s||s.revoked||s.expires<=Date.now()||!u||u.disabled||u.mustChange||u.role!=='admin')throw fail(401,'Agent authorization unavailable');return g;};
 const prune=()=>{for(const [id,g] of grants)try{live(g);}catch{grants.delete(id);}};
 const revision=()=>digest(epoch+revisionSeed());
 const snapshot=()=>({version:1,revision:revision(),...getState()});
 const validateChange=c=>{
  if(!fields(c,['type','id','set'])||!['target','app'].includes(c.type))throw fail(400,'Expected a bounded target or app change');
  const target=c.type==='target',keys=target?['label','upstream','entryPath','presentation','accessPolicy']:['label','icon','enabled','gateway','userIds'];
  const idOK=target?typeof c.id==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(c.id):c.id===null||typeof c.id==='string'&&/^service-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.id);
  if(!idOK||!fields(c.set,keys)||!Object.keys(c.set).length)throw fail(400,'Expected a bounded target or app change');
 };
 const current=(g,p)=>{live(g);if(p.expectedRevision!==revision())throw fail(409,'Revision changed. Read state and review a new plan.');};
 const authorize=req=>{if(req.headers.origin||req.headers.cookie||req.url.includes('?')||!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization??''))throw fail(401,'Agent authorization required');const g=grants.get(digest(req.headers.authorization.slice(7)));if(!g)throw fail(401,'Agent authorization unavailable');return live(g);};
 // This exact versioned prefix terminates here, including unknown routes.
 app.use('/api/agent/v1',wrap(async(req,res)=>{
  const g=authorize(req);if(req.method==='GET'&&req.path==='/state')return res.json(snapshot());
  if(req.method==='POST'&&['/plans','/apply'].includes(req.path)){
   if(g.scope!=='configure')throw fail(403,'Configure scope required');
   if(req.path==='/plans'){
    const b=req.body;if(!fields(b,['expectedRevision','change'])||typeof b.expectedRevision!=='string')throw fail(400,'Expected revision and change');validateChange(b.change);current(g,b);
    for(const [id,p] of plans)if(p.plan.expires<=Date.now())plans.delete(id);
    if(plans.size>=128||[...plans.values()].filter(p=>p.plan.principal===g.id).length>=16)throw fail(429,'Plan limit reached');
    await (b.change.type==='target'?previewTarget:previewApp)(b.change,()=>current(g,b));
    const plan={version:1,id:randomUUID(),principal:g.id,scope:g.scope,expectedRevision:b.expectedRevision,expires:Math.min(g.expires,Date.now()+300000),change:structuredClone(b.change),warning:'Single object only. Target changes retire Gateway windows. Target and app writes are not atomic. Login/live compatibility: not-tested.'};
    plans.set(plan.id,{plan});return res.json(plan);
   }
   const entry=plans.get(req.body?.id);if(!entry||entry.plan.principal!==g.id||entry.plan.expires<=Date.now()||canonical(entry.plan)!==canonical(req.body))throw fail(409,'Exact live plan required. Read state before replanning.');
   if(entry.result)return res.json(entry.result);
   current(g,entry.plan);const before=revision();
   try{const result=await (entry.plan.change.type==='target'?changeTarget:changeApp)(entry.plan.change,committed=>committed?live(g):current(g,entry.plan),g.id);entry.result={version:1,planId:entry.plan.id,outcome:'applied',revision:revision(),objectId:entry.plan.change.id??result.id};}
   catch(e){if(revision()!==before){entry.result={version:1,planId:entry.plan.id,outcome:'applied-cleanup-unconfirmed',revision:revision(),objectId:entry.plan.change.id??e.objectId,next:'Read state; do not create another object. Sign out or retry Relay shutdown for cleanup.'};}else throw e;}
   live(g);return res.json(entry.result);
  }
  throw fail(404,'Agent route not found');
 }));
 return {snapshot,installBrowser(){
  app.get('/api/admin/agent-access',wrap(async(req,res)=>{browser(req);prune();res.json([...grants.values()].map(({id,scope,expires})=>({id,scope,expires})));}));
  const confirmed=async req=>{const s=browser(req),u=s.user;if(Date.now()>reset){failures=0;reset=Date.now()+60000;}if(failures>=5)throw fail(429,'Too many password attempts');const ok=await verify(req.body?.password,u.password);browser(req);if(s.user!==u)throw fail(403,'Administrator changed');if(!ok){failures++;throw fail(403,'Current password required');}return s;};
  app.post('/api/admin/agent-access',wrap(async(req,res)=>{
   const s=await confirmed(req),b=req.body;
   if(!b||Object.keys(b).some(k=>!['password','scope','ttlSeconds'].includes(k))||!['read','configure'].includes(b.scope)||!Number.isInteger(b.ttlSeconds)||b.ttlSeconds<1||b.ttlSeconds>900)throw fail(400,'Expected read/configure scope and TTL of 1–900 seconds');
   prune();if(grants.size>=8)throw fail(429,'Agent credential limit reached');const secret=token(),g={id:randomUUID(),hash:digest(secret),sessionId:s.id,scope:b.scope,expires:Math.min(s.expires,Date.now()+b.ttlSeconds*1000)};grants.set(g.hash,g);res.json({id:g.id,scope:g.scope,expires:g.expires,token:secret});
  }));
  app.delete('/api/admin/agent-access/:id',wrap(async(req,res)=>{await confirmed(req);for(const [key,g] of grants)if(g.id===req.params.id)grants.delete(key);res.json({revoked:true});}));
 }};
}
