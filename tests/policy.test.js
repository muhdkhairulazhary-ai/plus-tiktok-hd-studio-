import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensions, checkDuration, checkTimeline } from '../src/policy.js';
test('portrait, landscape, square and ultrawide keep aspect within pixel rounding', () => {
  for (const [w, h] of [[1920,1080],[1080,1920],[1000,1000],[3840,1600],[853,480]]) {
    const result = dimensions(w, h);
    assert.ok(result.width % 2 === 0 && result.height % 2 === 0);
    assert.ok(result.width <= 1920 && result.height <= 1920);
    assert.ok(Math.abs(result.width / result.height - w / h) < 0.003);
  }
  assert.deepEqual(dimensions(720,1280), { width:1080, height:1920 });
});
test('invalid dimensions and durations fail closed', () => {
  assert.throws(() => dimensions(0,100));
  for (const duration of [0,-1,Infinity,NaN,60.01]) assert.throws(() => checkDuration(duration));
  checkDuration(60); checkDuration(0.2);
});
test('common timestamp shift preserves sync; audio drift or dropped tail fails', () => {
  const before = { video:{start:2,end:12}, audio:{start:2.05,end:12.05} };
  checkTimeline(before, {video:{start:0,end:10},audio:{start:.05,end:10.05}});
  assert.throws(() => checkTimeline(before, {video:{start:0,end:10},audio:{start:.4,end:10.05}}));
  assert.throws(() => checkTimeline(before, {video:{start:0,end:10},audio:{start:.05,end:9}}));
});
