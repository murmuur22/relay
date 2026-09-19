import * as THREE from 'three';
import { chamberPose, packetPose } from './chamber-pose.js';

// Decorative geometry never supplies a percentage or drives the lifecycle.
export function createChamber(host, onFallback) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!context) throw new Error('WebGL unavailable');
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x111110, 0);
  host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 60);
  camera.position.set(5.6, 4, 7.5); camera.lookAt(0, 0, 0);
  const assembly = new THREE.Group(); scene.add(assembly);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xcac6b9, transparent: true, opacity: .68 });
  const coreMaterial = new THREE.LineBasicMaterial({ color: 0xf0eee4, transparent: true, opacity: .9 });
  const coreGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.38, 1.38, 1.38));
  const core = new THREE.LineSegments(coreGeometry, coreMaterial); assembly.add(core);
  const fragmentGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(.59, .59, .59));
  const fragments = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (x === 0 && y === 0 && z === 0) continue;
    const fragment = new THREE.LineSegments(fragmentGeometry, lineMaterial);
    fragment.userData.home = new THREE.Vector3(x * .64, y * .64, z * .64);
    assembly.add(fragment); fragments.push(fragment);
  }
  const ringMaterial = new THREE.LineBasicMaterial({ color: 0x78766c, transparent: true, opacity: .45 });
  const rings = [];
  for (const radius of [2.4, 2.6]) {
    const points = Array.from({ length: 129 }, (_, i) => { const angle = i / 128 * Math.PI * 2; return new THREE.Vector3(Math.cos(angle) * radius, -1.85, Math.sin(angle) * radius); });
    const geometry = new THREE.BufferGeometry().setFromPoints(points); rings.push(geometry);
    scene.add(new THREE.Line(geometry, ringMaterial));
  }
  const packetGeometry = new THREE.BufferGeometry();
  const packetPositions = new Float32Array(96 * 2 * 3);
  packetGeometry.setAttribute('position', new THREE.BufferAttribute(packetPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const packetMaterial = new THREE.LineBasicMaterial({ color: 0xe7e5df, transparent: true, opacity: .55 });
  const packets = new THREE.LineSegments(packetGeometry, packetMaterial);
  packets.frustumCulled = false; packets.visible = false; scene.add(packets);
  let frame = 0, disposed = false, enabled = false, pose = chamberPose(null), tick = 0, last = 0;
  function placePackets() {
    for (let i = 0; i < 96; i++) {
      for (let end = 0; end < 2; end++) {
        const point = packetPose(i, tick, end * .045);
        const offset = (i * 2 + end) * 3;
        packetPositions[offset] = point.x; packetPositions[offset + 1] = point.y; packetPositions[offset + 2] = point.z;
      }
    }
    packetGeometry.attributes.position.needsUpdate = true;
  }
  function paint(time = 0) {
    if (disposed) return;
    if (enabled && pose.motion && !document.hidden) {
      tick += Math.min(32, time - last || 0) * .001;
      assembly.rotation.y = tick * .06;
    }
    if (pose.packets) placePackets();
    last = time;
    renderer.render(scene, camera);
    if (enabled && pose.motion && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function restart() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    host.dataset.motion = enabled && pose.motion && !document.hidden ? 'on' : 'off';
    paint();
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.position.normalize().multiplyScalar(Math.max(11.8, 10.2 / camera.aspect));
    camera.updateProjectionMatrix(); renderer.setSize(width, height); restart();
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  document.addEventListener('visibilitychange', restart);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); dispose(); onFallback(); }, { once: true });
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', restart);
    coreGeometry.dispose(); fragmentGeometry.dispose(); rings.forEach(geometry => geometry.dispose());
    lineMaterial.dispose(); coreMaterial.dispose(); ringMaterial.dispose(); packetGeometry.dispose(); packetMaterial.dispose(); renderer.dispose(); canvas.remove();
  }
  resize();
  return {
    update(job, motion) {
      pose = chamberPose(job); enabled = motion;
      for (const fragment of fragments) {
        const home = fragment.userData.home;
        fragment.position.copy(home).addScaledVector(home.clone().normalize(), pose.spread);
        fragment.rotation.set(pose.spread * home.y * .3, pose.spread * home.z * .3, 0);
      }
      // Phase and byte poses change immediately, including with motion disabled.
      host.dataset.phase = pose.phase;
      host.dataset.spread = String(pose.spread);
      packets.visible = pose.packets;
      host.dataset.packets = pose.packets ? 'visible' : 'hidden';
      restart();
    }, dispose,
  };
}
