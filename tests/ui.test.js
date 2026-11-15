import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createStudio } from '../src/app.js';
import { resolveSettings } from '../src/settings.js';
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
const info = {fileSize:10000000,videoDuration:12,videoBitrate:6400000,audioBitrate:160000,audioBytes:240000,audioDuration:12,videoPackets:360,audioPackets:563,width:1920,height:1080,fps:29.97,duration:12,audio:{codec:'mp4a.40.2',channels:2,sampleRate:48000},videoTracks:1,audioTracks:1};
function setup(overrides = {}) {
  const dom = new JSDOM(html,{url:'https://studio.test'}), win = dom.window, $ = id => win.document.getElementById(id);
  win.HTMLMediaElement.prototype.pause = () => {};
  win.HTMLMediaElement.prototype.load = () => {};
  win.HTMLElement.prototype.scrollIntoView = () => {};
  let urls = 0; const revoked = [];
  win.URL.createObjectURL = () => `blob:test-${++urls}`;
  win.URL.revokeObjectURL = url => revoked.push(url);
  const calls = [];
  const app = createStudio(win.document,{
    inspect:async()=>info,
    checkSupport:async(meta,settings)=>({supported:true,config:resolveSettings(meta.width,meta.height,settings,meta),reason:'Supported'}),
    checkPlayback:async()=>{},
    convert:async(file,progress,signal,settings)=>{calls.push(settings);progress(50,'Encoding');return {blob:new win.Blob(['mp4']),width:1920,height:1080,fps:60,audioCopied:true};},
    ...overrides,
  });
  return {win,$,app,calls,revoked,file:new win.File(['source'],'video.MOV',{type:'video/quicktime'}),close:()=>{app.destroy();win.close();}};
}
test('upload displays measured metadata; settings reach the converter and results are real',async()=>{
  const s = setup();
  try {
    assert.ok(s.$('go').disabled); await s.app.loadFile(s.file);
    assert.equal(s.$('source-fps').textContent,'29.97 FPS average'); assert.ok(!s.$('go').disabled);
    s.$('quality').value='custom'; s.$('bitrate').value='12'; s.$('resolution').value='4k';
    await s.app.refreshSupport(); assert.equal(s.$('custom-field').hidden,false);
    assert.match(s.$('output-summary').textContent,/3840 × 2160/);
    await s.$('go').onclick();
    assert.equal(s.calls[0].bitrate,'12'); assert.equal(s.calls[0].resolution,'4k');
    assert.equal(s.$('results').hidden,false); assert.equal(s.$('percent').textContent,'100%');
    assert.equal(s.$('result-resolution').textContent,'1920 × 1080'); // Actual result, not requested 4K.
    assert.match(s.$('result-audio').textContent,/original packets/);
    assert.ok(s.$('download').href.startsWith('blob:'));
    s.$('another').click(); assert.ok(s.$('results').hidden); assert.ok(s.$('go').disabled); assert.ok(s.revoked.length>=2);
  } finally {s.close();}
});
test('unsupported configuration blocks processing with explanation',async()=>{
  const s=setup({checkSupport:async()=>({supported:false,config:resolveSettings(1920,1080,{quality:'auto'}),reason:'HEVC unavailable'})});
  try {await s.app.loadFile(s.file); assert.ok(s.$('go').disabled); assert.match(s.$('support').textContent,/HEVC unavailable/); await s.$('go').onclick(); assert.equal(s.calls.length,0);}finally{s.close();}
});
test('duplicate processing and source replacement are blocked; cancel restores controls',async()=>{
  let count=0;
  const s=setup({convert:async(file,progress,signal)=>{count++; await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  try {
    await s.app.loadFile(s.file); const running=s.$('go').onclick();
    assert.ok(s.$('settings-fields').disabled); assert.ok(s.$('change').disabled);
    await s.$('go').onclick(); await s.app.loadFile(new s.win.File(['x'],'other.mp4'));
    assert.equal(s.$('filename').textContent,'video.MOV'); assert.equal(count,1);
    s.$('cancel').click(); await running;
    assert.ok(!s.$('settings-fields').disabled); assert.ok(s.$('results').hidden);
    assert.match(s.$('status').textContent,/Cancelled/);
  }finally{s.close();}
});
test('stale metadata cannot overwrite a newer upload; unknown FPS is never invented',async()=>{
  let firstResolve;
  const s=setup({inspect:file=>file.name==='video.MOV'?new Promise(resolve=>firstResolve=resolve):Promise.resolve({...info,fps:null})});
  try {
    const first=s.app.loadFile(s.file);
    await s.app.loadFile(new s.win.File(['x'],'second.mp4'));
    firstResolve(info); await first;
    assert.equal(s.$('filename').textContent,'second.mp4'); assert.equal(s.$('source-fps').textContent,'Unavailable');
  }finally{s.close();}
});
test('failed export clears downloads and exposes the error',async()=>{
  const s=setup({convert:async()=>{throw Error('Audio cannot be encoded');}});
  try {await s.app.loadFile(s.file); await s.$('go').onclick(); assert.ok(s.$('results').hidden); assert.ok(!s.$('download').hasAttribute('href')); assert.match(s.$('status').textContent,/Audio cannot be encoded/); assert.ok(s.$('status').classList.contains('error'));}finally{s.close();}
});
test('Photos and Files use the iOS file share API; failed sharing retains direct download',async()=>{
  const s=setup(); let shared=0;
  try {
    s.win.navigator.canShare=()=>true; s.win.navigator.share=async({files})=>{shared++;assert.equal(files[0].type,'video/mp4');};
    await s.app.loadFile(s.file); await s.$('go').onclick(); await s.$('share').onclick(); assert.equal(shared,1);
    const click = new s.win.MouseEvent('click',{cancelable:true}); s.$('download').onclick(click); assert.ok(click.defaultPrevented); await Promise.resolve(); assert.equal(shared,2);
    s.win.navigator.share=async()=>{throw Error('Unavailable');}; await s.$('share').onclick();
    assert.match(s.$('download').textContent,/directly/);
    const direct=new s.win.MouseEvent('click',{cancelable:true});s.$('download').onclick(direct);assert.ok(!direct.defaultPrevented);
  }finally{s.close();}
});
test('invalid upload and invalid custom bitrate do not enable processing',async()=>{
  const s=setup();
  try {await s.app.loadFile(new s.win.File(['x'],'bad.txt'));assert.ok(s.$('go').disabled);assert.match(s.$('status').textContent,/MOV or MP4/);
    await s.app.loadFile(s.file);s.$('quality').value='custom';s.$('bitrate').value='0';await s.app.refreshSupport();assert.ok(s.$('go').disabled);assert.match(s.$('support').textContent,/1 and 100/);
  }finally{s.close();}
});
test('cancellation during playback validation never publishes a result',async()=>{
  let playbackStarted;
  const ready=new Promise(resolve=>playbackStarted=resolve);
  const s=setup({checkPlayback:async(blob,signal)=>{playbackStarted();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  try {
    await s.app.loadFile(s.file); const running=s.$('go').onclick(); await ready;
    assert.equal(s.$('percent').textContent,'98%');s.$('cancel').click();await running;
    assert.ok(s.$('results').hidden);assert.ok(!s.$('download').hasAttribute('href'));assert.ok(!s.app.getState().busy);
  }finally{s.close();}
});
test('an older capability probe cannot enable a newer unsupported configuration',async()=>{
  let resolveOld, count=0;
  const s=setup({checkSupport:async(meta,settings)=>{
    count++;
    if(count===1) return new Promise(resolve=>resolveOld=resolve);
    return {supported:false,config:resolveSettings(meta.width,meta.height,settings,meta),reason:'4K encoder unavailable'};
  }});
  try {
    const loading=s.app.loadFile(s.file);await Promise.resolve();await Promise.resolve();
    s.$('resolution').value='4k';await s.app.refreshSupport();
    resolveOld({supported:true,config:resolveSettings(1920,1080,{quality:'auto'}),reason:'Supported'});await loading;
    assert.ok(s.$('go').disabled);assert.match(s.$('support').textContent,/4K encoder unavailable/);
  }finally{s.close();}
});
test('new default shows source bitrates, original settings, estimates and honest size misses',async()=>{
  const s=setup();
  try {
    assert.equal(s.$('quality').value,'preserve');assert.equal(s.$('resolution').value,'original');assert.equal(s.$('fps').value,'original');
    await s.app.loadFile(s.file);
    assert.equal(s.$('source-video-bitrate').textContent,'6.40 Mbps');assert.equal(s.$('source-audio-bitrate').textContent,'160.0 kbps');
    assert.notEqual(s.$('estimate-output').textContent,'Unavailable');assert.match(s.$('size-note').textContent,/not|Hardware/);
    await s.$('go').onclick();
    assert.equal(s.calls[0].quality,'preserve');assert.equal(s.calls[0].fps,'original');
    assert.notEqual(s.$('compare-estimate').textContent,'Unavailable');assert.match(s.$('size-outcome').textContent,/outside/);
    assert.ok(s.$('download').href.startsWith('blob:')); // Missing a target never blocks a valid export.
  }finally{s.close();}
});
test('eligible HEVC defaults to Smart Copy, locks encoding settings, and labels only verified results',async()=>{
  const s=setup({inspect:async()=>({...info,videoCodec:'hevc',videoCodecString:'hvc1.2.4.L120.B0',hdr:{label:'HLG HDR',bitDepth:10,primaries:9,transfer:18,matrix:9,profile:2,staticMetadata:[]}}),convert:async()=>({blob:new Blob(['mp4']),width:1920,height:1080,fps:60,videoCopied:true,audioCopied:true,processingMode:'Smart Copy',containerNote:'MP4 index precedes media; encoded samples and file size are unchanged.',hdrStatus:'HLG HDR preserved — verified configuration, color and packets'})});
  try {
    await s.app.loadFile(s.file);assert.equal(s.$('mode').value,'smart');assert.ok(s.$('encoding-fields').disabled);
    assert.match(s.$('source-hdr').textContent,/HLG HDR/);assert.match(s.$('source-color').textContent,/BT.2020/);
    await s.$('go').onclick();assert.match(s.$('result-mode').textContent,/No Re-encode.*verified/);assert.match(s.$('result-hdr').textContent,/HLG HDR preserved/);assert.match(s.$('result-container').textContent,/index precedes media/);
    assert.match(s.$('size-outcome').textContent,/equal file size/);
    s.$('mode').value='custom';s.$('mode').onchange();await Promise.resolve();assert.ok(!s.$('encoding-fields').disabled);
  }finally{s.close();}
});
test('experimental mode is optional, locks encode controls, reaches the engine and resets on a new upload',async()=>{
  let chosen;
  const s=setup({inspect:async()=>({...info,videoCodec:'hevc',hdr:{label:'SDR',bitDepth:8}}),convert:async(file,progress,signal,settings)=>{chosen=settings.mode;return {blob:new Blob(['mp4']),width:1920,height:1080,fps:29.97,videoCopied:true,audioCopied:true,processingMode:'TikTok MP4 Compatibility — Experimental',containerNote:'Experimental co64; upload benefit is unproven.'};}});
  try {
    await s.app.loadFile(s.file);assert.equal(s.$('mode').value,'smart');
    s.$('mode').value='compat';s.$('mode').onchange();await Promise.resolve();await s.app.refreshSupport();
    assert.ok(s.$('encoding-fields').disabled);assert.match(s.$('mode-help').textContent,/benefit is unproven/);
    await s.$('go').onclick();assert.equal(chosen,'compat');assert.match(s.$('result-mode').textContent,/Compatibility.*Experimental/);assert.match(s.$('result-container').textContent,/co64/);
    await s.app.loadFile(s.file);assert.equal(s.$('mode').value,'smart');
  }finally{s.close();}
});
