import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hdrFromEntry,hdrLabel,assertCopyHDR,inspectNal,inspectContainer} from '../src/hdr.js';
import {processingPlan} from '../src/modes.js';
function entry(transfer=18) {
  const h=new Uint8Array(23);h[0]=1;h[1]=2;h[17]=h[18]=0xfa;h[21]=3;
  return {type:'hvc1',records:{hvcC:[h],colr:[new Uint8Array([110,99,108,120,0,9,0,transfer,0,9,0])]}};
}
const source={width:1920,height:1080,videoCodec:'hevc',videoBitrate:8000000,videoBytes:10000000,audioBytes:200000,videoPackets:300,audioPackets:470,audio:{codec:'mp4a.40.2'},hdr:{label:'HLG HDR',bitDepth:10,hasHDRSignal:true},copyReason:''};
test('HEVC does not imply HDR: missing metadata is Unknown and required preservation fails',()=>{
  const e=entry();delete e.records.colr;const h=hdrFromEntry(e);
  assert.equal(hdrLabel(h),'Unknown');assert.throws(()=>assertCopyHDR(h,true),/HDR/);
  const pq=hdrFromEntry(entry(16));assert.match(hdrLabel(pq),/Unknown.*PQ/);assert.throws(()=>assertCopyHDR(pq,true),/complete/);
});
test('HLG and HDR10 classification require actual signaling, depth and static metadata',()=>{
  const h=hdrFromEntry(entry());assert.equal(hdrLabel(h),'HLG HDR');assert.doesNotThrow(()=>assertCopyHDR(h,true));
  const pq=hdrFromEntry(entry(16));pq.state.staticMetadata.add('137:'+ '00'.repeat(24));assert.equal(hdrLabel(pq),'HDR10');
  h.bitDepth=8;assert.equal(hdrLabel(h),'Unknown');assert.throws(()=>assertCopyHDR(h),/10-bit/);
});
test('Dolby Vision config boxes and RPU NALs block copying rather than imply retention',()=>{
  for(const type of ['dvcC','dvvC','dvwC']) {
    const e=entry();e.records[type]=[new Uint8Array([1,0])];const h=hdrFromEntry(e);
    assert.match(hdrLabel(h),/Dolby Vision/);assert.throws(()=>assertCopyHDR(h),/Dolby Vision/);
  }
  const h=hdrFromEntry(entry());inspectNal(new Uint8Array([62<<1,1,0]),h.state);assert.throws(()=>assertCopyHDR(h),/Dolby Vision/);
});
test('static container metadata, duplicate descriptions and hev1 are rejected without dropping metadata',()=>{
  for(const type of ['mdcv','clli','clap','unknown']) {const e=entry();e.records[type]=[new Uint8Array(24)];assert.throws(()=>assertCopyHDR(hdrFromEntry(e)),/retain/);}
  const icc=entry();icc.records.colr=[new Uint8Array([112,114,111,102,0,0,0,0])];assert.throws(()=>assertCopyHDR(hdrFromEntry(icc)),/ICC/);
  const e=entry();e.records.colr.push(e.records.colr[0]);assert.throws(()=>assertCopyHDR(hdrFromEntry(e)),/duplicate/);
  e.type='hev1';assert.throws(()=>assertCopyHDR(hdrFromEntry(e)),/hev1/);
});
test('HDR encoding, SDR tone mapping and incompatible audio are explicit unavailable paths',()=>{
  assert.equal(processingPlan(source).mode,'smart');
  assert.throws(()=>processingPlan(source,{mode:'convert'}),/HDR/);
  assert.throws(()=>processingPlan(source,{mode:'custom',hdr:'required'}),/HDR re-encoding/);
  assert.throws(()=>processingPlan(source,{hdr:'sdr'}),/tone mapper/);
  assert.throws(()=>processingPlan({...source,audio:{codec:'lpcm'}}),/Audio-only transcoding is unavailable/);
  assert.throws(()=>processingPlan(source,{resolution:'1080'}),/Custom Encoding/);
});
test('H.264 selects HEVC Conversion and supported SDR preserves v2.1 size mode',()=>{
  const avc={...source,videoCodec:'avc',copyReason:'H.264 requires conversion',hdr:{label:'SDR',bitDepth:8},fileSize:11000000,videoDuration:10,audioDuration:10};
  const plan=processingPlan(avc);assert.equal(plan.mode,'convert');assert.equal(plan.config.targetSize,avc.fileSize);
  assert.throws(()=>processingPlan(avc,{mode:'smart'}),/requires conversion/);
});
test('malformed ISO BMFF metadata is rejected',async()=>{
  await assert.rejects(inspectContainer(new Blob([new Uint8Array([0,0,0,255,109,111,111,118])])),/box size/);
});
