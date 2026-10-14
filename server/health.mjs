import {Transport} from './transport.mjs';
const unknown=detail=>({state:'Unknown',source:'relay',checkedAt:Date.now(),detail});
// Health has independent network capacity. FIFO admission prevents registry tail
// starvation, while stable signatures coalesce observations across account writes.
export class HealthProbes {
 constructor(options){this.transport=new Transport(options);this.cache=new Map();this.queue=[];this.active=new Set();this.closed=false;}
 probe(config,authorized=()=>true){
  if(this.closed)return Promise.resolve(unknown('Relay health checks stopped.'));
  const key=JSON.stringify([config.address,[...(config.allowedOrigins||[])].sort()]);
  const cached=this.cache.get(key);
  if(cached&&(!cached.completed||Date.now()-cached.completed<5000)){if(!cached.completed){if(cached.waiters.size>=32)return Promise.resolve(unknown('Relay health observer limit; no new check admitted.'));cached.waiters.add(authorized);}return cached.promise;}
  for(const [k,v] of this.cache)if(v.completed&&Date.now()-v.completed>=5000)this.cache.delete(k);
  if(this.queue.length+this.active.size>=64)return Promise.resolve(unknown('Relay health checks busy; no observation made.'));
  // Keep completed cache bounded even during repeated registry edits.
  if(this.cache.size>=128)for(const [k,v] of this.cache){if(v.completed){this.cache.delete(k);break;}}
  let resolve;const entry={key,waiters:new Set([authorized]),config,promise:new Promise(r=>resolve=r),resolve:null,completed:0};entry.resolve=resolve;
  this.cache.set(key,entry);this.queue.push(entry);this.drain();return entry.promise;
 }
 drain(){
  while(!this.closed&&this.active.size<4&&this.queue.length){
   const entry=this.queue.shift(),authorize=()=>[...entry.waiters].some(fn=>{try{return fn()===true;}catch{return false;}});
   if(!authorize()){this.cache.delete(entry.key);entry.waiters.clear();entry.resolve(unknown('No live status observer; no probe made.'));continue;}
   this.active.add(entry);
   void this.transport.probe(entry.config,{authorize}).then(entry.resolve,()=>entry.resolve(unknown('Relay health check unavailable.'))).finally(()=>{entry.completed=Date.now();entry.waiters.clear();this.active.delete(entry);this.drain();});
  }
 }
 async close(){
  this.closed=true;
  for(const entry of this.queue.splice(0))entry.resolve(unknown('Relay health checks stopped.'));
  await this.transport.close();await Promise.all([...this.active].map(entry=>entry.promise));this.cache.clear();
 }
}
