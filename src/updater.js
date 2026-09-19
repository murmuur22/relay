// Deliberately independent: Relay session resets must not unmount maintenance UI.
// Invoke directly from a click, before any await. Never store the launch ticket.
export async function launchUpdater(issue,current=()=>true,browser=window,version=''){
 const tab=browser.open('about:blank','_blank');if(!tab)throw Error('Allow a new tab to open Updater.');
 tab.opener=null;
 try{const {url}=await issue();if(!current()||tab.closed)throw Error('Updater launch expired or tab closed.');const target=new URL(url),relay=new URL(browser.location.origin);
  if(target.protocol!=='http:'||target.hostname!==relay.hostname||!['127.0.0.1','localhost'].includes(target.hostname)||target.origin===relay.origin||target.username||target.password||target.pathname!=='/updater/'||target.search||!/^#[A-Za-z0-9_-]{32,256}$/.test(target.hash))throw Error('Invalid trusted updater address.');
  if(version){if(version.length>64||!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version))throw Error('Invalid release version');target.hash+='~'+version;}
  tab.location.replace(target.href);
 }catch(error){tab.close();throw error;}
}
