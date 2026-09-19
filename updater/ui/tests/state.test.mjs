import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/state.js';
test('engine epoch-millisecond event timestamps render as explicit UTC, invalid timestamps stay unknown', () => {
  assert.equal(typeof state.formatTime, 'function');
  assert.equal(state.formatTime(Date.parse('2026-09-19T12:00:00Z')), '2026-09-19 12:00:00 UTC');
  assert.equal(state.formatTime('2026-09-19T12:00:00Z'), '2026-09-19 12:00:00 UTC');
  assert.equal(state.formatTime(null), 'Time unavailable');
  assert.equal(state.formatTime('invalid'), 'Time unavailable');
});
