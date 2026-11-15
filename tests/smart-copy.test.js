import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {convert} from '../src/converter.js';
import {smartCopy,verifyTrack} from '../src/smart-copy.js';
import {Input,BlobSource,ALL_FORMATS} from 'mediabunny';
import {inspect} from '../src/metadata.js';
import {listBoxes} from '../src/hdr.js';
import {processingPlan} from '../src/modes.js';
const available=spawnSync('ffmpeg',['-version']).status===0;
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
function fixture(path,kind,extra=[]) {
  const hdr=kind!=='sdr';
  const params='pools=1:frame-threads=1:log-level=error:colorprim='+(hdr?'bt2020':'bt709')+':transfer='+(kind==='hlg'?'arib-std-b67':['hdr10','pq'].includes(kind)?'smpte2084':'bt709')+':colormatrix='+(hdr?'bt2020nc':'bt709')+(kind==='hdr10'?':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400':'');
  run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60','-itsoffset','0.15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1',...extra,
    '-c:v','libx265','-preset','ultrafast','-x265-params',params,'-pix_fmt',hdr?'yuv420p10le':'yuv420p','-color_primaries',hdr?'bt2020':'bt709','-color_trc',kind==='hlg'?'arib-std-b67':['hdr10','pq'].includes(kind)?'smpte2084':'bt709','-colorspace',hdr?'bt2020nc':'bt709','-tag:v','hvc1','-movflags','write_colr','-c:a','aac',path]);
}
for(const [kind,extension] of [['sdr','mov'],['sdr','mp4'],['hlg','mov'],['hlg','mp4'],['hdr10','mov'],['hdr10','mp4']]) test(`real ${kind} ${extension} HEVC + AAC Smart Copy, SHA-256, timing, config and independent FFprobe`,{skip:!available},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-copy-'));
  try {
    // MOV nclc may use retained SPS VUI to resolve range/unspecified fields; output nclx is checked.
    const src=join(dir,`input.${extension}`),dest=join(dir,'output.mp4');fixture(src,kind);
    const blob=new Blob([readFileSync(src)]),meta=await inspect(blob);
    

    assert.equal(meta.hdr.label,kind==='sdr'?'SDR':kind==='hlg'?'HLG HDR':'HDR10');
    assert.equal(processingPlan(meta,{}).mode,'smart');
    const result=await convert(blob,()=>{},new AbortController().signal);
    assert.ok(result.videoCopied);assert.ok(result.audioCopied);assert.ok(result.fastStart);
    const layout=await listBoxes(result.blob,0,result.blob.size);assert.ok(layout.find(b=>b.type==='moov').start<layout.find(b=>b.type==='mdat').start);
    writeFileSync(dest,new Uint8Array(await result.blob.arrayBuffer()));
    const probe=path=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',path]));
    const a=probe(src),b=probe(dest);
    assert.equal(b.streams[0].profile,a.streams[0].profile);assert.ok(a.streams[0].extradata_hash);assert.equal(b.streams[0].extradata_hash,a.streams[0].extradata_hash);
    assert.equal(b.streams[0].codec_name,'hevc');assert.equal(b.streams[0].color_transfer,a.streams[0].color_transfer);assert.equal(b.streams[0].color_primaries,a.streams[0].color_primaries);assert.equal(b.streams[0].color_space,a.streams[0].color_space);assert.equal(b.streams[0].pix_fmt,a.streams[0].pix_fmt);
    let commonOffset;
    for(const type of ['video','audio']) {
      const p=a.packets.filter(p=>p.codec_type===type),q=b.packets.filter(p=>p.codec_type===type);
      assert.equal(p.length,q.length);assert.deepEqual(p.map(p=>p.data_hash),q.map(p=>p.data_hash));
      const offset=Number(q[0].pts_time)-Number(p[0].pts_time);
      commonOffset??=offset;assert.ok(Math.abs(offset-commonOffset)<.0001);
      for(let i=0;i<p.length;i++) {assert.ok(Math.abs(Number(q[i].pts_time)-Number(p[i].pts_time)-offset)<.0001);assert.equal(q[i].flags,p[i].flags);}
    }
    if(kind==='hdr10') {
      const frames=path=>JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-of','json',path])).frames;
      const side=frames(src)[0].side_data_list.filter(s=>/Mastering|Content light/.test(s.side_data_type));assert.ok(side.length>=2);
      assert.deepEqual(frames(dest)[0].side_data_list.filter(s=>/Mastering|Content light/.test(s.side_data_type)),side);
      assert.match(result.hdrStatus,/HDR10 preserved/);
    }
    const second=await smartCopy(blob,()=>{},new AbortController().signal);assert.ok(second.videoCopied);
    for(const phase of [1,76,78,88]) {const cancel=new AbortController();await assert.rejects(smartCopy(blob,p=>{if(p>=phase)cancel.abort();},cancel.signal),{name:'AbortError'});}
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('VFR MOV rotation, real H.264 routing, corrupted output hashes and unsupported metadata',{skip:!available},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-vfr-'));let sourceInput,tamperedInput;
  try {
    const raw=join(dir,'vfr.mov'),rotated=join(dir,'rotated.mov');
    fixture(raw,'sdr',['-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr','-bf','0']);
    run('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',raw,'-map','0','-c','copy',rotated]);
    const source=new Blob([readFileSync(rotated)]),meta=await inspect(source);
    assert.equal(meta.width,72);assert.equal(meta.height,128);
    const result=await convert(source,()=>{},new AbortController().signal);assert.equal(result.width,72);assert.equal(result.height,128);
    const outPath=join(dir,'out.mp4');const outBytes=new Uint8Array(await result.blob.arrayBuffer());writeFileSync(outPath,outBytes);
    const packets=path=>JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-of','json',path])).packets;
    const p=packets(rotated),q=packets(outPath);
    assert.deepEqual(q.map(p=>p.data_hash),p.map(p=>p.data_hash));
    assert.ok(new Set(p.slice(1).map((v,i)=>(Number(v.pts_time)-Number(p[i].pts_time)).toFixed(5))).size>1);
    for(let i=0;i<p.length;i++)assert.ok(Math.abs(Number(p[i].pts_time)-Number(q[i].pts_time))<.0001);
    // Corrupt one encoded byte without touching MP4 tables: validation must fail, not label No Re-encode.
    outBytes[Number(q[0].pos)+Number(q[0].size)-1]^=1;
    sourceInput=new Input({source:new BlobSource(source),formats:ALL_FORMATS});
    tamperedInput=new Input({source:new BlobSource(new Blob([outBytes])),formats:ALL_FORMATS});
    await assert.rejects(verifyTrack(await sourceInput.getPrimaryVideoTrack(),await tamperedInput.getPrimaryVideoTrack(),new AbortController().signal),/SHA-256 mismatch/);
    const pcm=join(dir,'pcm.mov');run('ffmpeg',['-v','error','-i',raw,'-map','0','-c:v','copy','-c:a','pcm_s16le',pcm]);
    const pcmBlob=new Blob([readFileSync(pcm)]);
    await assert.rejects(smartCopy(pcmBlob,()=>{},new AbortController().signal),/Audio-only transcoding is not implemented/);
    const avc=join(dir,'avc.mp4');run('ffmpeg',['-v','error','-i',raw,'-map','0','-c:v','libx264','-pix_fmt','yuv420p','-c:a','copy',avc]);
    const avcMeta=await inspect(new Blob([readFileSync(avc)]));assert.equal(avcMeta.videoCodec,'avc');assert.equal(processingPlan(avcMeta).mode,'convert');
    await assert.rejects(smartCopy(new Blob([readFileSync(avc)]),()=>{},new AbortController().signal),/HEVC Conversion/);
    const ambiguous=join(dir,'vfr-bframes.mov');fixture(ambiguous,'sdr',['-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr']);
    await assert.rejects(smartCopy(new Blob([readFileSync(ambiguous)]),()=>{},new AbortController().signal),/timing, duration/);
    // Synthetic unsupported box fixtures test rejection only; these are not real Dolby Vision media.
    const original=new Uint8Array(readFileSync(raw));let index=-1;
    for(let i=4;i<original.length-4;i++)if(String.fromCharCode(...original.subarray(i,i+4))==='fiel' && new DataView(original.buffer).getUint32(i-4)===10 && original[i+4]===1 && original[i+5]===0){index=i;break;}
    assert.ok(index>0);
    for(const type of ['dvcC','mdcv']) {
      const bytes=original.slice();for(let i=0;i<4;i++)bytes[index+i]=type.charCodeAt(i);
      await assert.rejects(smartCopy(new Blob([bytes]),()=>{},new AbortController().signal),type==='dvcC'?/Dolby Vision/:/retain/);
    }
  } finally {sourceInput?.dispose();tamperedInput?.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('real PQ HEVC without static mastering metadata never claims full HDR10 preservation',{skip:!available},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-pq-'));
  try {
    const src=join(dir,'pq.mp4');fixture(src,'pq');const blob=new Blob([readFileSync(src)]);
    const meta=await inspect(blob);assert.match(meta.hdr.label,/Unknown.*PQ/);
    const result=await smartCopy(blob,()=>{},new AbortController().signal);assert.ok(result.videoCopied);assert.match(result.hdrStatus,/HDR not verified/);
    await assert.rejects(smartCopy(blob,()=>{},new AbortController().signal,{hdr:'required'}),/HDR Preservation Required/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
