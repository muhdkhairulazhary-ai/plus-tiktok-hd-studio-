import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, resolveSettings, formatBytes, formatTime, sizeComparison, sizeOutcome } from '../src/settings.js';
const source = {fileSize:10000000, videoDuration:10, videoBitrate:7800000, videoBytes:9750000, videoPackets:300, audioBytes:200000, audioDuration:10, audioPackets:470, audioBitrate:160000, audio:{codec:'mp4a.40.2'}};
const config = (settings={},metadata=source) => resolveSettings(1920,1080,settings,metadata);
test('v2.1 defaults preserve original dimensions and timing with a measured size budget', () => {
  assert.equal(defaults.quality,'preserve'); assert.equal(defaults.resolution,'original'); assert.equal(defaults.fps,'original');
  const result=resolveSettings(3840,2160,{},source);
  assert.equal(result.width,3840);assert.equal(result.height,2160);assert.equal(result.frameRate,undefined);
  assert.equal(result.targetSize,source.fileSize);
  assert.ok(Math.abs(result.estimatedSize/source.fileSize-1)<.05);
});
test('video target subtracts original AAC bytes and header allowance rather than total container bitrate',()=>{
  const c=config();
  const overhead=4096+source.videoPackets*20+source.audioPackets*12;
  assert.equal(c.bitrate,Math.round((source.fileSize-source.audioBytes-overhead)*8/source.videoDuration));
  const louder=config({}, {...source,audioBytes:400000});
  assert.ok(louder.bitrate<c.bitrate);
});
test('transcoded audio reserves the existing 160 kbps AAC budget',()=>{
  const c=config({}, {...source,audioBytes:2000000,audio:{codec:'lpcm'}});
  assert.equal(c.bitrate,config().bitrate); // 10 seconds at 160 kbps = 200000 bytes.
});
test('metadata-heavy containers are reported honestly instead of inflating video bitrate',()=>{
  const c=config({}, {...source,fileSize:100000000});
  assert.equal(c.bitrate,source.videoBitrate*1.1);assert.ok(c.estimatedSize<90000000);
  assert.match(c.sizeNote,/overhead/);
});
test('missing metadata and impossible budgets fail explicitly; alternative modes remain usable',()=>{
  assert.throws(()=>config({},null),/metadata/);
  assert.throws(()=>config({}, {...source,videoDuration:0}),/metadata/);
  assert.throws(()=>config({}, {...source,fileSize:100}),/too small/);
  assert.equal(config({quality:'auto'},null).estimatedSize,null);
  assert.ok(config({quality:'custom',bitrate:6},null).bitrate===6000000);
});
test('low bitrate sources are not forced to a fake 1 Mbps minimum',()=>{
  const c=config({}, {...source,fileSize:150000,videoBitrate:100000,audioBytes:20000});
  assert.ok(c.bitrate>0 && c.bitrate<1000000);
});
test('the former iPhone-tested 1080p60 automatic configuration remains available',()=>{
  const c=resolveSettings(3840,2160,{resolution:'1080',fps:'60',quality:'auto'});
  assert.equal(c.width,1920);assert.equal(c.height,1080);assert.equal(c.frameRate,60);assert.equal(c.bitrate,8500000);
});
test('4K, explicit FPS and custom bitrate retain functional encode values', () => {
  const c=resolveSettings(1080,1920,{resolution:'4k',fps:'60',quality:'auto'});
  assert.equal(c.width,2160);assert.equal(c.height,3840);assert.equal(c.bitrate,34000000);
  assert.equal(config({fps:'30'}).frameRate,30);
  assert.equal(config({quality:'custom',bitrate:6}).bitrate,6000000);
  assert.ok(config({quality:'high'}).bitrate>config({quality:'auto'}).bitrate);
});
test('all resolution and FPS choices preserve aspect ratio and orientation', () => {
  for (const resolution of ['original','1080','4k']) for (const fps of ['original','30','60']) for (const [width,height] of [[1920,1080],[1080,1920],[1000,1000],[3840,1600]]) {
    const result = resolveSettings(width,height,{resolution,fps},source);
    assert.ok(Math.abs(result.width/result.height - width/height) < .003);
    assert.equal(result.width % 2,0); assert.equal(result.height % 2,0);
  }
});
test('invalid settings fail with actionable errors', () => {
  for (const settings of [{resolution:'8k'},{fps:'120'},{quality:'unknown'},{quality:'custom',bitrate:NaN},{quality:'custom',bitrate:0},{quality:'custom',bitrate:101}]) assert.throws(()=>config(settings));
});
test('size outcomes and result formatting report deviations without claiming a guarantee', () => {
  assert.match(sizeOutcome(100,110),/within 10%/);assert.match(sizeOutcome(100,90),/within 10%/);
  assert.match(sizeOutcome(100,80),/outside/);assert.match(sizeOutcome(100,120),/outside/);
  assert.equal(sizeComparison(100,200),'100.0% larger');assert.equal(sizeComparison(200,100),'50.0% smaller');
  assert.equal(formatTime(125),'2:05');assert.equal(formatTime(NaN),'Unavailable');
  assert.equal(formatBytes(1048576),'1.0 MB');assert.equal(formatBytes(null),'Unavailable');
});
