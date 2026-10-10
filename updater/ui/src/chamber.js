import * as THREE from 'three';
import {chamberPose,packetPose} from './chamber-pose.js';

// A real opaque, lit 3D scene is depth-tested into one sample per fixed cell.
// The character pass uses that luminance, not a wireframe or recorded animation.
const GLYPHS='.:+*#/@';
export function createChamber(host,onFallback){
 const source=document.createElement('canvas'),context=source.getContext('webgl2',{alpha:false,antialias:false});
 if(!context)throw Error('WebGL unavailable');
 const renderer=new THREE.WebGLRenderer({canvas:source,context,antialias:false});renderer.setPixelRatio(1);renderer.setClearColor(0x000000,1);
 const canvas=document.createElement('canvas'),ink=canvas.getContext('2d',{alpha:false});if(!ink){renderer.dispose();throw Error('Character canvas unavailable');}canvas.characterSource=source;host.append(canvas);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,30);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 scene.add(new THREE.AmbientLight(0xffffff,.18));
 const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(2,4,6);scene.add(key);
 const rim=new THREE.DirectionalLight(0xffffff,1);rim.position.set(-4,-2,-3);scene.add(rim);
 const group=new THREE.Group();scene.add(group);
 const knotGeometry=new THREE.TorusKnotGeometry(1.72,.53,320,32,2,3),knotMaterial=new THREE.MeshStandardMaterial({color:0xbdbdbd,roughness:.7,metalness:.08});
 const knot=new THREE.Mesh(knotGeometry,knotMaterial);group.add(knot);
 const coreGeometry=new THREE.SphereGeometry(.35,24,16),coreMaterial=new THREE.MeshBasicMaterial({color:0xffffff});
 const core=new THREE.Mesh(coreGeometry,coreMaterial);core.position.z=1.6;scene.add(core);
 const halos=[];for(let i=0;i<4;i++){const geometry=new THREE.SphereGeometry(.43+i*.15,20,12),material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.055,depthWrite:false,blending:THREE.AdditiveBlending});const mesh=new THREE.Mesh(geometry,material);mesh.position.z=1.6;scene.add(mesh);halos.push(mesh);}
 const orbitGeometry=new THREE.BufferGeometry(),orbits=[];
 for(const radius of [3.05,3.32,3.55])for(let i=0;i<240;i++){const a=i/240*Math.PI*2;orbits.push(radius*Math.cos(a),radius*Math.sin(a),-.5);}
 orbitGeometry.setAttribute('position',new THREE.Float32BufferAttribute(orbits,3));const orbitMaterial=new THREE.PointsMaterial({color:0x777777,size:.025,sizeAttenuation:true});scene.add(new THREE.Points(orbitGeometry,orbitMaterial));
 const packetGeometry=new THREE.BufferGeometry(),positions=new Float32Array(24*3);packetGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));const packetMaterial=new THREE.PointsMaterial({color:0xdddddd,size:.055});const packets=new THREE.Points(packetGeometry,packetMaterial);scene.add(packets);
 let target,pixels,cols=0,rows=0,width=0,height=0,frame=0,disposed=false,enabled=false,visible=true,pose=chamberPose(null),tick=0,last=0,painted=0,interval=1000/30,frames=0,totalRender=0;
 host.dataset.characterPass=GLYPHS;host.dataset.geometry='shaded-torus-knot';
 function draw(){
  if(!target||disposed)return;
  const started=performance.now();
  group.rotation.set(.32+Math.sin(tick*.09)*.15,tick*.075,.2+Math.sin(tick*.07)*.1);
  // Byte-derived settle is small: the knot remains a continuous volume in every phase.
  knot.scale.setScalar(1+pose.spread*.025);
  const mode=pose.phase==='verifying'?'scan':pose.phase==='activating'?'settle':['restarting','health-checking'].includes(pose.phase)?'pulse':'calm';host.dataset.transition=mode;
  key.position.y=4+(mode==='scan'?Math.sin(tick*.9)*.7:0);
  core.scale.setScalar(1+Math.sin(tick*(mode==='pulse'?1.5:1.1))*.07);halos.forEach((mesh,i)=>mesh.scale.setScalar(1+Math.sin(tick*.8-i*.2)*.035));
  packets.visible=pose.packets;
  if(pose.packets){for(let i=0;i<24;i++){const p=packetPose(i*4,tick);positions.set([p.x,p.y,p.z],i*3);}packetGeometry.attributes.position.needsUpdate=true;}
  renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,cols,rows,pixels);renderer.setRenderTarget(null);
  ink.fillStyle='#0b0b0a';ink.fillRect(0,0,width,height);
  const cellW=width/cols,cellH=height/rows;ink.font=`${Math.max(6,cellH*.95)}px ui-monospace, SFMono-Regular, Consolas, monospace`;ink.textAlign='center';ink.textBaseline='middle';
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const offset=((rows-y-1)*cols+x)*4,luma=(pixels[offset]+pixels[offset+1]+pixels[offset+2])/765;if(luma<.018)continue;
   const intensity=Math.min(1,Math.pow(luma,.65));const glyph=GLYPHS[Math.min(6,Math.floor(intensity*7))];
   const c=Math.round(80+intensity*167);ink.fillStyle=`rgb(${c},${Math.round(c*.991)},${Math.round(c*.951)})`;ink.fillText(glyph,(x+.5)*cellW,(y+.5)*cellH);
  }
  // Coordinate ticks stay on the cell grid and are decoration, never events.
  ink.fillStyle='#74736c';for(let i=-3;i<=3;i++){if(i===0)continue;ink.fillText('+',width/2+i*width*.12,height/2);ink.fillText('+',width/2,height/2+i*height*.12);}
  const cost=performance.now()-started;frames++;totalRender+=cost;
  if(cost>24)interval=Math.min(1000/15,interval+2);else if(cost<12)interval=Math.max(1000/30,interval-.25);
  host.dataset.cells=String(cols*rows);host.dataset.frames=String(frames);host.dataset.renderMs=(totalRender/frames).toFixed(2);host.dataset.fpsLimit=(1000/interval).toFixed(1);
 }
 function animate(time){
  if(disposed)return;
  if(!enabled||!visible||document.hidden){frame=0;last=0;return;}
  if(last)tick+=Math.min(.25,(time-last)/1000);last=time;
  if(time-painted>=interval-.5){host.dataset.frameIntervals ||= '';if(painted){const samples=host.dataset.frameIntervals.split(',').filter(Boolean);samples.push((time-painted).toFixed(1));host.dataset.frameIntervals=samples.slice(-180).join(',');}draw();painted=time;}
  frame=requestAnimationFrame(animate);
 }
 function restart(){cancelAnimationFrame(frame);frame=0;last=0;painted=0;host.dataset.motion=enabled&&visible&&!document.hidden?'on':'off';draw();if(enabled&&visible&&!document.hidden)frame=requestAnimationFrame(animate);}
 function resize(){width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);canvas.width=width;canvas.height=height;canvas.style.width=width+'px';canvas.style.height=height+'px';
  cols=Math.max(24,Math.min(180,Math.floor(width/6)));rows=Math.max(20,Math.min(120,Math.floor(height/9)));camera.aspect=width/height;camera.position.z=Math.max(10,8.5/camera.aspect);camera.updateProjectionMatrix();
  target?.dispose();target=new THREE.WebGLRenderTarget(cols,rows,{depthBuffer:true});pixels=new Uint8Array(cols*rows*4);renderer.setSize(cols,rows,false);restart();
 }
 const observer=new ResizeObserver(resize);observer.observe(host);document.addEventListener('visibilitychange',restart);
 const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;restart();});intersection.observe(host);
 source.addEventListener('webglcontextlost',event=>{event.preventDefault();dispose();onFallback();},{once:true});
 function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',restart);target?.dispose();[knotGeometry,coreGeometry,orbitGeometry,packetGeometry].forEach(g=>g.dispose());[knotMaterial,coreMaterial,orbitMaterial,packetMaterial].forEach(m=>m.dispose());halos.forEach(m=>{m.geometry.dispose();m.material.dispose();});renderer.dispose();canvas.remove();}
 resize();
 return {update(job,motion){const next=chamberPose(job),changed=next.phase!==pose.phase||next.spread!==pose.spread||enabled!==motion;pose=next;enabled=motion;host.dataset.phase=pose.phase;host.dataset.spread=String(pose.spread);host.dataset.packets=pose.packets?'visible':'hidden';if(changed)restart();},dispose};
}
