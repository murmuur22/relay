<script>
 import { onMount } from 'svelte';
 import { mapPoint } from './geometry.js';
 let {win,onactivate}=$props();
 let canvas, input, socket, retryTimer, stopped=false,attempt=0, composing=false, inputReady=false, inputEpoch=0;
 let state=$state('opening'),message=$state(''),hasFrame=$state(false);
 let frameWidth=1,frameHeight=1, pointerFocus=Promise.resolve();const keys=new Map(),buttons=new Map();
 function send(data){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));}
 // Preserve the 4096 UTF-16-unit paste/composition limit, truncating before
 // a codepoint that crosses it. 1024-unit chunks fit the backend's 2048 limit
 // and remain below 8192 wire bytes even with worst-case JSON escaping.
 function sendText(text){
  let chunk='',total=0;
  for(const point of text){
   if(total+point.length>4096)break;
   if(chunk.length+point.length>1024){send({type:'text',text:chunk});chunk='';}
   chunk+=point;total+=point.length;
  }
  if(chunk)send({type:'text',text:chunk});
 }
 function enabled(){return win.visible&&win.focused&&inputReady&&state==='live'&&socket?.readyState===WebSocket.OPEN;}
 function release(){inputEpoch++;send({type:'release'});keys.clear();buttons.clear();inputReady=false;composing=false;}
 function connect(){if(stopped)return;state='opening';const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/stream/${encodeURIComponent(win.id)}`);socket=ws;
  ws.onopen=()=>{attempt=0;};
  ws.onmessage=async event=>{let data;try{data=JSON.parse(event.data);}catch{return;}
   if(data.type==='state'){state=data.state;message=data.message||'';return;}
   if(data.type!=='frame'||(data.windowId&&data.windowId!==win.id)||!['image/jpeg','image/png'].includes(data.mime))return;
   const image=new Image();image.src=`data:${data.mime};base64,${data.data}`;
   try{await image.decode();if(stopped||socket!==ws)return;frameWidth=data.width;frameHeight=data.height;canvas.width=frameWidth;canvas.height=frameHeight;canvas.getContext('2d').drawImage(image,0,0,frameWidth,frameHeight);hasFrame=true;state=win.visible?'live':'paused';send({type:'ack',seq:data.seq});}catch{if(socket===ws)send({type:'ack',seq:data.seq});}
  };
  ws.onclose=()=>{if(socket!==ws)return;release();if(stopped)return;state='disconnected';message='Connection lost. Reconnecting; unsent input is discarded.';retryTimer=setTimeout(connect,Math.min(10000,500*2**attempt++));};
  ws.onerror=()=>{state='disconnected';};
 }
 function point(e){return mapPoint(e.clientX,e.clientY,input.getBoundingClientRect(),frameWidth,frameHeight);}
 async function pointer(e,phase){const epoch=inputEpoch,connection=socket,p=point(e);if(phase==='down'){e.preventDefault();input.focus({preventScroll:true});input.setPointerCapture(e.pointerId);pointerFocus=onactivate();await pointerFocus;if(epoch!==inputEpoch||connection!==socket)return;inputReady=true;}else if(phase==='up'){await pointerFocus;}if(epoch!==inputEpoch||connection!==socket||!enabled())return;if(phase==='down')buttons.set(e.button,p);if(phase==='up')buttons.delete(e.button);send({type:'pointer',phase,...p,button:Math.max(0,e.button),buttons:e.buttons});}
 function modifiers(e){return (e.altKey?1:0)|(e.ctrlKey?2:0)|(e.metaKey?4:0)|(e.shiftKey?8:0);}
 function key(e,phase){if(!enabled()||composing||e.isComposing)return;e.preventDefault();if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){if(phase==='down')send({type:'text',text:e.key});return;}if(phase==='down')keys.set(e.code,e.key);else keys.delete(e.code);send({type:'key',phase,key:e.key,code:e.code,modifiers:modifiers(e)});}
 function wheel(e){if(!enabled())return;e.preventDefault();const unit=e.deltaMode===1?16:e.deltaMode===2?frameHeight:1;send({type:'wheel',...point(e),deltaX:e.deltaX*unit,deltaY:e.deltaY*unit});}
 $effect(()=>{if(!win.visible||!win.focused)release();});
 onMount(()=>{connect();input.addEventListener('wheel',wheel,{passive:false});const blur=()=>release(),visibility=()=>{if(document.hidden)release();};window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);return()=>{stopped=true;release();clearTimeout(retryTimer);socket?.close();input.removeEventListener('wheel',wheel);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};});
</script>
<div class="stream-wrapper">
 <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
 <div class="stream-input" bind:this={input} tabindex="0" role="application" aria-label={win.title+' remote input'} onfocus={async()=>{const epoch=inputEpoch,connection=socket;await onactivate();if(!stopped&&epoch===inputEpoch&&connection===socket)inputReady=true;}} onblur={release} onpointerdown={e=>pointer(e,'down')} onpointerup={e=>pointer(e,'up')} onpointermove={e=>pointer(e,'move')} onpointercancel={release} onkeydown={e=>key(e,'down')} onkeyup={e=>key(e,'up')} oncontextmenu={e=>e.preventDefault()} oncompositionstart={()=>composing=true} oncompositionend={e=>{composing=false;if(enabled()&&e.data)sendText(e.data);}} onpaste={e=>{if(enabled()){e.preventDefault();sendText(e.clipboardData.getData('text/plain'));}}}>
  <canvas bind:this={canvas} class:awaiting={!hasFrame} aria-label={win.title+' streamed image'}></canvas>
 </div>
 {#if state!=='live'}<div class="stream-overlay" role="status"><span class="stream-glyph">{state==='failed'?'!':'◌'}</span><strong>{state==='failed'?'Remote app unavailable':state==='disconnected'?'Stream disconnected':state==='paused'?'Stream paused':'Opening remote page…'}</strong><p>{message||'The desktop remains local. This app runs in an isolated browser.'}</p>{#if state==='disconnected'}<small>Reconnecting automatically · no input replay</small>{/if}</div>{/if}
 <span class="stream-status" class:live={state==='live'}>{state==='live'?'●':'○'} {win.visible?state:'paused'} · image stream</span>
</div>
