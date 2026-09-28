export const UPDATER=Object.freeze({id:'system-updater',label:'Updater',kind:'system',mode:'native',openMode:'window',icon:'tools',enabled:true,description:'Browse releases here; start an update in an independent maintenance tab.'});
export const CONTROL_PANEL=Object.freeze({id:'system-control-panel',label:'Control Panel',kind:'system',mode:'native',openMode:'window',icon:'tools',enabled:true,description:'Manage users, apps, gateway and system diagnostics.'});
export const SYSTEM_APPS=Object.freeze([UPDATER,CONTROL_PANEL]);
export const systemApps=user=>user?.role==='admin'&&!user.disabled&&!user.mustChange?[...SYSTEM_APPS]:[];
