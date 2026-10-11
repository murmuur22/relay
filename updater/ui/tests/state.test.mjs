import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/state.js';
test('artifact ratios clamp real byte bounds and reject invalid or unknown totals',()=>{
 for(const [job,ratio] of [[null,null],[{downloadedBytes:68,totalBytes:100},.68],[{downloadedBytes:150,totalBytes:100},1],[{downloadedBytes:-1,totalBytes:100},0],[{downloadedBytes:68,totalBytes:0},null],[{downloadedBytes:68,totalBytes:null},null],[{downloadedBytes:68,totalBytes:true},null],[{downloadedBytes:68,totalBytes:Infinity},null]])assert.equal(state.transfer(job).ratio,ratio);
});
test('idle snapshots never expose a retained artifact percentage',()=>{
 assert.equal(state.transfer({phase:'idle',downloadedBytes:100,totalBytes:100}).ratio,null);
});
test('engine epoch-millisecond event timestamps render as explicit UTC, invalid timestamps stay unknown', () => {
  assert.equal(typeof state.formatTime, 'function');
  assert.equal(state.formatTime(Date.parse('2026-09-19T12:00:00Z')), '2026-09-19 12:00:00 UTC');
  assert.equal(state.formatTime('2026-09-19T12:00:00Z'), '2026-09-19 12:00:00 UTC');
  assert.equal(state.formatTime(null), 'Time unavailable');
  assert.equal(state.formatTime('invalid'), 'Time unavailable');
});
