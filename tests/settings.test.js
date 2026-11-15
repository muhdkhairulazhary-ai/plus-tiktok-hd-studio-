import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettings, formatBytes, formatTime, sizeComparison } from '../src/settings.js';
test('defaults preserve the iPhone-tested 1080p60 8.5 Mbps configuration', () => {
  assert.deepEqual(resolveSettings(3840,2160),{width:1920,height:1080,frameRate:60,bitrate:8500000});
});
test('4K, original resolution, original timing and bitrate have real encode values', () => {
  assert.deepEqual(resolveSettings(1080,1920,{resolution:'4k'}),{width:2160,height:3840,frameRate:60,bitrate:34000000});
  assert.deepEqual(resolveSettings(853,480,{resolution:'original',fps:'original',quality:'custom',bitrate:6}),{width:854,height:480,frameRate:undefined,bitrate:6000000});
  assert.equal(resolveSettings(1920,1080,{fps:'30'}).frameRate,30);
  assert.ok(resolveSettings(1920,1080,{quality:'high'}).bitrate > resolveSettings(1920,1080).bitrate);
});
test('all resolution and FPS choices preserve aspect ratio and orientation', () => {
  for (const resolution of ['original','1080','4k']) for (const fps of ['original','30','60']) for (const [width,height] of [[1920,1080],[1080,1920],[1000,1000],[3840,1600]]) {
    const result = resolveSettings(width,height,{resolution,fps});
    assert.ok(Math.abs(result.width/result.height - width/height) < .003);
    assert.equal(result.width % 2,0); assert.equal(result.height % 2,0);
  }
});
test('invalid settings fail with actionable errors', () => {
  for (const settings of [{resolution:'8k'},{fps:'120'},{quality:'unknown'},{quality:'custom',bitrate:NaN},{quality:'custom',bitrate:0},{quality:'custom',bitrate:101}]) assert.throws(()=>resolveSettings(1920,1080,settings));
});
test('results formatting reports larger files honestly and handles missing timing', () => {
  assert.equal(sizeComparison(100,200),'100.0% larger');
  assert.equal(sizeComparison(200,100),'50.0% smaller');
  assert.equal(formatTime(125),'2:05'); assert.equal(formatTime(NaN),'Unavailable');
  assert.equal(formatBytes(1048576),'1.0 MB');
});
