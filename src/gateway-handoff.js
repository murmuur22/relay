// The authenticated configuration defines the only accepted handoff namespace.
export function validateGatewayHandoff(result,config,desktopOrigin,launchId){
 const invalid=()=>{throw Error('Invalid gateway handoff');};
 if(!config?.enabled||config.desktopOrigin!==desktopOrigin||typeof config.appBaseDomain!=='string')invalid();
 let desktop,origin;
 try{desktop=new URL(desktopOrigin);origin=new URL(result?.origin);}catch{invalid();}
 if(desktop.protocol!=='https:'||origin.protocol!=='https:'||origin.origin!==result.origin||origin.username||origin.password||origin.port!==desktop.port)invalid();
 const suffix='.'+config.appBaseDomain;
 if(!origin.hostname.endsWith(suffix)||! /^[a-f0-9]{32}$/.test(origin.hostname.slice(0,-suffix.length)))invalid();
 if(result.launchId!==launchId||typeof result.ticket!=='string'||! /^[a-f0-9]{64}$/.test(result.ticket))invalid();
 return {origin:result.origin,ticket:result.ticket,allowDownloads:result.allowDownloads===true,allowPopups:result.allowPopups===true};
}
