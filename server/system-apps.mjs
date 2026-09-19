export const UPDATER=Object.freeze({id:'system-updater',label:'Updater',kind:'system',mode:'native',openMode:'window',icon:'tools',enabled:true,description:'Browse releases here; start an update in an independent maintenance tab.'});
export const systemApps=user=>user?.role==='admin'&&!user.disabled&&!user.mustChange?[UPDATER]:[];
