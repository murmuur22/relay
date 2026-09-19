import * as THREE from 'three';

export function createVortex(host) {
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(40,1,.1,100); camera.position.z=9;
  let renderer;
  try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); }
  catch { document.querySelector('#fallback').hidden=false; return {setState(){},setMotion(){},setTheme(){}}; }
  host.append(renderer.domElement);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const funnel=new THREE.Group(); scene.add(funnel);
  const lines=[];
  for(let i=0;i<26;i++) {
    const depth=i/25, radius=.25+depth*2.45;
    const points=[];
    for(let j=0;j<=160;j++) {
      const angle=j/160*Math.PI*2;
      points.push(new THREE.Vector3(Math.cos(angle)*radius,Math.sin(angle)*radius*.66,-Math.pow(1-depth,1.5)*3));
    }
    const material=new THREE.LineBasicMaterial({color:i%4===0?0xc8e6a0:0x6e8751,transparent:true,opacity:.22+depth*.33});
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material);
    line.rotation.z=depth*.7; lines.push(line); funnel.add(line);
  }
  const particles=[];
  const paperGeo=new THREE.PlaneGeometry(.25,.34);
  for(let i=0;i<10;i++) {
    const paper=new THREE.Mesh(paperGeo,new THREE.MeshBasicMaterial({color:i%3===0?0xc8e6a0:0xe8e5de,side:THREE.DoubleSide,transparent:true}));
    paper.visible=false; particles.push(paper); scene.add(paper);
  }
  const specks=new Float32Array(160*3);
  for(let i=0;i<160;i++){specks[i*3]=Math.sin(i*137.5)*4.5;specks[i*3+1]=Math.cos(i*23.1)*2.6;specks[i*3+2]=-2;}
  const stars=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(specks,3)),new THREE.PointsMaterial({color:0xa4b78d,size:.018,transparent:true,opacity:.5}));scene.add(stars);
  let state='idle',motion=!matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now();
  function render(t){
    const time=(t-start)/1000;
    funnel.rotation.z=motion?Math.sin(time*.22)*.12:0;
    funnel.rotation.y=motion?Math.sin(time*.16)*.12:0;
    lines.forEach((l,i)=>{l.material.opacity=(state==='done'?.1:.22)+(i/25)*(state==='done'?.1:.33);if(motion&&state==='packing') l.rotation.z=time*.35+i*.025;});
    particles.forEach((p,i)=>{
      p.visible=state==='packing'&&motion;
      const phase=(time*.42+i/10)%1,r=3.6*(1-phase),angle=phase*Math.PI*5+i*2.4;
      p.position.set(Math.cos(angle)*r,Math.sin(angle)*r*.64,-phase*2);
      p.rotation.set(phase*2,phase*4,angle);p.scale.setScalar(1-phase*.8);p.material.opacity=1-phase;
    });
    renderer.render(scene,camera);
  }
  function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render(performance.now());}
  new ResizeObserver(resize).observe(host); resize();
  renderer.setAnimationLoop(t=>{if(!document.hidden)render(t);});
  return {setState(value){state=value;start=performance.now();render(start);},setMotion(value){motion=value;render(performance.now());},setTheme(accent,mode){
    const color=new THREE.Color(accent),paper=new THREE.Color(mode==='light'?0x30342c:0xe8e5de);
    lines.forEach(l=>l.material.color.copy(color));
    particles.forEach((p,i)=>p.material.color.copy(i%3===0?color:paper));
    stars.material.color.copy(color);render(performance.now());
  }};
}
