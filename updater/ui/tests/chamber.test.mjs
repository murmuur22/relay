import test from 'node:test';
import assert from 'node:assert/strict';
import { chamberPose } from '../src/chamber-pose.js';
import * as poses from '../src/chamber-pose.js';
test('download trails spiral into the core without supplying transfer progress', () => {
  assert.equal(typeof poses.packetPose, 'function');
  const start = poses.packetPose(0, 0);
  const moving = poses.packetPose(0, 2);
  assert.notDeepEqual(start, moving);
  assert.ok(Math.hypot(moving.x, moving.z) < Math.hypot(start.x, start.z));
  assert.deepEqual(poses.packetPose(0, 8), start);
  for (let i = 0; i < 96; i++) {
    const point = poses.packetPose(i, 3);
    assert.ok(Object.values(point).every(Number.isFinite));
    assert.ok(Math.hypot(point.x, point.z) <= 3.1);
    assert.ok(Math.abs(point.y) <= 1.7);
  }
  assert.equal(chamberPose({ phase: 'downloading' }).packets, true);
  assert.equal(chamberPose({ phase: 'verifying' }).packets, false);
  assert.equal(chamberPose({ phase: 'succeeded' }).packets, false);
});
test('paired trail endpoints stay short across each packet traversal wrap', () => {
  for (let i = 0; i < 96; i++) {
    for (const cycle of [1, 2, 10]) {
      const wrap = (cycle - i / 96) * 8;
      for (const delta of [-.046, -.044, -.02, -.001, 0, .001]) {
        const seconds = wrap + delta;
        const start = poses.packetPose(i, seconds);
        const end = poses.packetPose(i, seconds, .045);
        const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
        assert.ok(length > 0 && length < .12,
          `packet ${i}, seconds ${seconds}: trail length ${length} must be between 0 and .12`);
      }
    }
  }
});
test('core fragments gather only as bytes advance; phase governs assembly independently of percent', () => {
  const start = chamberPose({ phase: 'downloading', downloadedBytes: 0, totalBytes: 100 });
  const half = chamberPose({ phase: 'downloading', downloadedBytes: 50, totalBytes: 100 });
  const end = chamberPose({ phase: 'downloading', downloadedBytes: 100, totalBytes: 100 });
  assert.ok(start.spread > half.spread && half.spread > end.spread);
  assert.equal(chamberPose({ phase: 'downloading', downloadedBytes: 999, totalBytes: null }).spread, start.spread);
  assert.equal(chamberPose({ phase: 'verifying' }).spread, 0);
  assert.ok(chamberPose({ phase: 'activating' }).spread > 0);
  assert.equal(chamberPose({ phase: 'succeeded' }).spread, 0);
  assert.equal(chamberPose({ phase: 'rollback-failed' }).motion, false);
});
