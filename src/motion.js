// Entrance effects never retain revoked content or interpolate desktop geometry.
export function reveal(node,{enabled=true,delay=0,kind='fade'}={}) {
 let animation;
 if(enabled)animation=node.animate([{opacity:0,...(kind==='slide'?{transform:'translateY(8px)'}:{})},{opacity:1,transform:'none'}],{duration:180,delay,easing:'ease-out',fill:'backwards'});
 return {update({enabled}){if(!enabled)animation?.cancel();},destroy(){animation?.cancel();}};
}

export function windowMotion(node,{enabled,visible}) {
 let animation,previous;
 function update(value){
  animation?.cancel();
  const changed=previous!==value.visible;
  const initial=previous===undefined;previous=value.visible;
  node.style.display=value.visible?'flex':'none';
  if(!value.enabled||(!changed&&!initial)||(!value.visible&&initial))return;
  if(value.visible){animation=node.animate([{opacity:0,transform:'translateY(8px) scale(.975)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'});}
  else{
   node.style.display='flex';
   const rect=node.getBoundingClientRect();
   animation=node.animate([{opacity:1,transform:'none'},{opacity:0,transform:`translateY(${Math.max(12,innerHeight-rect.bottom)}px) scale(.85)`}],{duration:150,easing:'ease-in'});
   const current=animation;animation.onfinish=()=>{if(animation===current)node.style.display='none';};
  }
 }
 update({enabled,visible});return {update,destroy(){animation?.cancel();}};
}
