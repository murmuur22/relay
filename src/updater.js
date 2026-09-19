// Deliberately independent: Relay session resets must not unmount maintenance UI.
// Invoke directly from a click, before any await. Never store the launch ticket.
function trustedHost(host){
 if(['127.0.0.1','localhost'].includes(host))return true;
 if(!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host))return false;
 const n=host.split('.').map(Number);return n.every(v=>v<=255)&&(n[0]===10||(n[0]===172&&n[1]>=16&&n[1]<=31)||(n[0]===192&&n[1]===168));
}
export async function launchUpdater(issue,current=()=>true,browser=window,version=''){
 const tab=browser.open('about:blank','_blank');if(!tab)throw Error('Allow a new tab to open Updater.');
 tab.opener=null;
 try{const {url}=await issue();if(!current()||tab.closed)throw Error('Updater launch expired or tab closed.');const target=new URL(url),relay=new URL(browser.location.origin);
  if(target.href!==url||target.protocol!=='http:'||target.hostname!==relay.hostname||!trustedHost(target.hostname)||target.origin===relay.origin||target.username||target.password||target.pathname!=='/updater/'||target.search||!/^#[A-Za-z0-9_-]{32,256}$/.test(target.hash))throw Error('Invalid trusted updater address.');
  if(version){if(version.length>64||!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version))throw Error('Invalid release version');target.hash+='~'+version;}
  tab.location.replace(target.href);
 }catch(error){tab.close();throw error;}
}
