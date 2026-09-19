import { transfer, activeJob } from './state.js';
export function chamberPose(job) {
  const phase = job?.phase || 'idle';
  const ratio = transfer(job).ratio;
  const spread = phase === 'downloading' ? (1 - (ratio ?? 0)) * 1.7 : phase === 'activating' ? .85 : phase === 'restarting' ? .45 : phase === 'health-checking' ? .15 : ['failed', 'rollback-failed', 'interrupted'].includes(phase) ? 1.1 : 0;
  return { spread, motion: activeJob(job), phase, packets: phase === 'downloading' };
}

// An eight-second decorative loop, not packets counted or a throughput estimate.
// Time is supplied only by the motion-enabled renderer; byte pose is independent.
export function packetPose(index, seconds, tailSeconds = 0) {
  // Keep the tail on the head's traversal instead of wrapping it to the outer rim.
  const travel = Math.max(0, Math.min(1, ((index / 96 + seconds / 8) % 1 + 1) % 1 + tailSeconds / 8));
  const lane = index % 3;
  const radius = .8 + (1 - travel) * 2.3;
  const angle = lane * Math.PI * 2 / 3 + travel * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: (lane - 1) * 1.7 * (1 - travel), z: Math.sin(angle) * radius };
}
