export function targetForm(preset='jellyfin'){
 const jellyfin=preset==='jellyfin';
 return {id:jellyfin?'jellyfin':'app',label:jellyfin?'Jellyfin':'App',upstream:'',options:JSON.stringify(jellyfin?{entryPath:'/web/index.html',cookieNames:[],requestHeaders:['x-emby-authorization','x-mediabrowser-token','x-emby-token'],webSocketPaths:['/socket'],maxResponseBytes:1024*1024*1024}:{entryPath:'/',cookieNames:[],webSocketPaths:[]},null,2)};
}
export function gatewayForm(config){
 if(!config)return {version:1,bind:'127.0.0.1',port:8443,desktopHostname:'desktop.relay.home.arpa',appBaseDomain:'apps.relay.home.arpa',keyPath:'/etc/relay-gateway/key.pem',certPath:'/etc/relay-gateway/fullchain.pem',targets:[targetForm()]};
 return {...structuredClone(config),targets:config.targets.map(({id,label,upstream,...options})=>({id,label,upstream,options:JSON.stringify(options,null,2)}))};
}
export function configFromForm(form){
 const validName=n=>typeof n==='string'&&n.length<=220&&n.includes('.')&&n.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p));
 if(!Number.isInteger(form.port)||form.port<1024||form.port>65535)throw Error('Choose an HTTPS port between 1024 and 65535.');
 if(!validName(form.desktopHostname)||!validName(form.appBaseDomain))throw Error('Enter lowercase desktop and app hostnames, without https:// or a port.');
 if(typeof form.bind!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(form.bind))throw Error('Enter the server’s assigned IPv4 listen address.');
 if(![form.keyPath,form.certPath].every(p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0')))throw Error('Certificate and key paths must be absolute server paths.');
 if(!Array.isArray(form.targets)||!form.targets.length||form.targets.length>8)throw Error('Configure between one and eight service targets.');
 const ids=new Set();
 const targets=form.targets.map(t=>{
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(t.id)||ids.has(t.id))throw Error('Each target needs a unique lowercase ID, using letters, numbers and hyphens.');ids.add(t.id);
  if(typeof t.label!=='string'||!t.label.trim()||t.label.length>64)throw Error('Give each target a name of up to 64 characters.');
  let u;try{u=new URL(t.upstream);}catch{throw Error('Enter the service’s complete HTTP(S) origin, including its port when needed.');}
  if(!['http:','https:'].includes(u.protocol)||u.origin!==t.upstream)throw Error('Use an exact service origin without a path, credentials or trailing slash.');
  let options;try{options=JSON.parse(t.options);}catch{throw Error('Advanced target options must be valid JSON.');}
  if(!options||typeof options!=='object'||Array.isArray(options)||['id','label','upstream'].some(k=>k in options))throw Error('Advanced options must be an object without ID, name or upstream fields.');
  return {id:t.id,label:t.label,upstream:t.upstream,...options};
 });
 return {version:1,bind:form.bind,port:form.port,desktopHostname:form.desktopHostname,appBaseDomain:form.appBaseDomain,keyPath:form.keyPath,certPath:form.certPath,targets};
}
