// Only Relay-owned handlers belong here; upstream inputs/frames keep their own keys.
export const shortcuts=Object.freeze([
 {id:'selectAll',contexts:['desktop','folder'],key:'a',primary:true,label:'Select all visible items'},
 {id:'clear',contexts:['desktop','folder'],key:'Escape',label:'Clear selection'},
 {id:'open',contexts:['desktop','folder'],key:'Enter',label:'Open focused item'},
 {id:'select',contexts:['desktop','folder'],key:' ',label:'Toggle focused item selection'},
 {id:'menu',contexts:['desktop','folder'],key:'ContextMenu',label:'Actions for focused item'},
 {id:'menuAlt',contexts:['desktop','folder'],key:'F10',shift:true,label:'Actions for focused item'},
 {id:'move',contexts:['desktop','folder'],key:'m',primary:true,shift:true,label:'Move selection…'},
 {id:'dismiss',contexts:['modal','menu'],key:'Escape',label:'Close dialog / dismiss menu'},
 {id:'tab',contexts:['modal'],key:'Tab',shift:'either',label:'Next / previous dialog control'},
 {id:'menuNext',contexts:['menu'],key:'ArrowDown',label:'Next menu action'},
 {id:'menuPrevious',contexts:['menu'],key:'ArrowUp',label:'Previous menu action'},
 {id:'menuFirst',contexts:['menu'],key:'Home',label:'First menu action'},
 {id:'menuLast',contexts:['menu'],key:'End',label:'Last menu action'},
 {id:'submenu',contexts:['menu'],key:'ArrowRight',label:'Open Sort by submenu'},
 {id:'parentMenu',contexts:['menu'],key:'ArrowLeft',label:'Return to parent menu'},
 {id:'menuTab',contexts:['menu'],key:'Tab',shift:'either',label:'Dismiss menu'},
 {id:'tabNext',contexts:['settings-tabs'],key:'ArrowRight',label:'Next Control Panel tab'},
 {id:'tabPrevious',contexts:['settings-tabs'],key:'ArrowLeft',label:'Previous Control Panel tab'},
 {id:'tabFirst',contexts:['settings-tabs'],key:'Home',label:'First Control Panel tab'},
 {id:'tabLast',contexts:['settings-tabs'],key:'End',label:'Last Control Panel tab'}
]);
export const platformMac=()=>typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform);
export function catalog(context,mac=platformMac()){return shortcuts.filter(s=>s.contexts.includes(context)).map(s=>({...s,keys:[s.primary?(mac?'Cmd':'Ctrl'):null,s.shift===true?'Shift':s.shift==='either'?'[Shift]':null,s.key===' '?'Space':s.key].filter(Boolean).join('+')}));}
export function matches(id,event,context){const s=shortcuts.find(s=>s.id===id&&s.contexts.includes(context));if(!s)return false;return event.key.toLowerCase()===s.key.toLowerCase()&&!event.altKey&&Boolean(event.metaKey||event.ctrlKey)===Boolean(s.primary)&&(s.shift==='either'||Boolean(event.shiftKey)===Boolean(s.shift));}
export function shortcutDocs(){return ['Desktop interaction catalog','',...['desktop','folder','menu','modal','settings-tabs'].flatMap(context=>[context,...catalog(context,false).map(s=>'  '+s.keys+' — '+s.label),'']), 'On macOS, Cmd replaces Ctrl. Only the focused Relay desktop/menu/dialog handles these keys.', 'Native iframe and streamed app inputs are not Relay shortcut contexts. Browser-native dialogs retain native Escape/Tab behavior.', ''].join('\n');}
