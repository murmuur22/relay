// Ownership is registered before setup starts, not after its result is assigned.
// This helper belongs only to the updater embedding test fixture.
export function embeddingFixture(t){
 const owned=new Set();let retired=false;
 const retiredReason=()=>t.signal.reason||Error('Updater embedding fixture retired');
 const release=(entry,value)=>entry.closing??=Promise.resolve().then(()=>entry.close(value)).then(()=>{owned.delete(entry);});
 t.after(async()=>{
  retired=true;
  // Pending acquisitions stay owned until they fail or their result is closed.
  // Start every independent cleanup even when another closer throws/rejects.
  const results=await Promise.allSettled([...owned].map(entry=>entry.pending.then(value=>release(entry,value),()=>{owned.delete(entry);} )));
  const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
  if(errors.length)throw new AggregateError(errors,'Updater embedding fixture cleanup failed');
 });
 return async(start,close)=>{
  if(retired||t.signal.aborted)throw retiredReason();
  const entry={close};owned.add(entry);
  entry.pending=Promise.resolve().then(start);
  const value=await entry.pending;
  if(retired||t.signal.aborted){await release(entry,value);throw retiredReason();}
  return value;
 };
}

export function listen(server,port=0){
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.removeListener('listening',ready);reject(error);};
  const ready=()=>{server.removeListener('error',failed);resolve(server);};
  server.once('error',failed);server.once('listening',ready);
  try{server.listen(port,'127.0.0.1');}catch(error){server.removeListener('error',failed);failed(error);}
 });
}
export function closeServer(server){
 if(!server.listening)return Promise.resolve();
 return new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections?.();});
}
