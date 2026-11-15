import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const available=['ffmpeg','ffprobe','python3'].every(cmd=>spawnSync(cmd,[cmd==='python3'?'--version':'-version']).status===0);
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
for(const [kind,rate,channels] of [['sdr',44100,1],['hlg',48000,2],['hdr10',32000,2],['priming',48000,2],['vfr',44100,1]])test(`offline A/B/C/D + independent compatibility prototype ${kind}: payload, timing, audio and HDR audits`,{skip:!available},()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-ab-'));
  try{
    const src=join(dir,'source.mov'),out=join(dir,'variants');
    const hdr=['hlg','hdr10'].includes(kind),transfer=kind==='hlg'?'arib-std-b67':kind==='hdr10'?'smpte2084':'bt709';
    const params=`pools=1:frame-threads=1:log-level=error:colorprim=${hdr?'bt2020':'bt709'}:transfer=${transfer}:colormatrix=${hdr?'bt2020nc':'bt709'}:keyint=30`+(kind==='hdr10'?':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400':'');
    run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60000/1001','-itsoffset',kind==='priming'?'0':'0.15','-f','lavfi','-i',`sine=frequency=440:sample_rate=${rate}`,'-t',kind==='sdr'?'13':'1',...(kind==='vfr'?['-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr','-bf','0']:[]),'-c:v','libx265','-preset','ultrafast','-x265-params',params,'-pix_fmt',hdr?'yuv420p10le':'yuv420p','-color_primaries',hdr?'bt2020':'bt709','-color_trc',transfer,'-colorspace',hdr?'bt2020nc':'bt709','-tag:v','hvc1','-c:a','aac','-ac',String(channels),src]);
    // Include a real rotated track; its transformation must survive both variants.
    const rotated=join(dir,'rotated.mov');run('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',src,'-map','0','-c','copy',rotated]);
    run(process.execPath,['tools/mp4-ab.mjs',rotated,out]);
    const report=JSON.parse(readFileSync(join(out,'comparison.json'))),a=report.variants.A;
    assert.equal(a.validation.packet_hashes,'identical for video and AAC');
    for(const name of ['B','C']) {
      const b=report.variants[name];assert.equal(b.validation.decoded_pcm,'identical');
      assert.equal(b.streams.length,2);assert.equal(b.decoded_pcm,a.decoded_pcm);
      for(let i=0;i<2;i++) {
        assert.equal(b.structure.tracks[i].sample_entry_sha256,a.structure.tracks[i].sample_entry_sha256);
        assert.equal(b.structure.tracks[i].media_duration_ticks,a.structure.tracks[i].media_duration_ticks);
        assert.equal(b.structure.tracks[i].media_timescale,a.structure.tracks[i].media_timescale);
        const movieA=a.structure.movie_timescale,movieB=b.structure.movie_timescale;
        assert.equal(b.structure.tracks[i].track_duration_ticks/movieB,a.structure.tracks[i].track_duration_ticks/movieA);
        const e=a.structure.tracks[i].edits,f=b.structure.tracks[i].edits;
        assert.deepEqual(f.map(x=>[x.duration/movieB,x.media_time,x.rate]),e.map(x=>[x.duration/movieA,x.media_time,x.rate]));
      }
      assert.deepEqual(b.first_frame_hdr_metadata,a.first_frame_hdr_metadata);
    }
    const source=report.variants.source,d=report.variants.D;
    assert.equal(d.structure.movie_timescale,source.structure.movie_timescale);
    assert.equal(d.structure.movie_duration_ticks,source.structure.movie_duration_ticks);
    assert.equal(d.validation.common_offset_seconds,0);
    assert.equal(d.native_seek_matches_source,true);
    for(const kind of ['video','audio'])for(const field of ['pts','dts','duration'])assert.equal(d.source_timing_errors[kind][`max_${field}_error_seconds_exact`],'0');
    for(let i=0;i<2;i++) {
      assert.equal(d.structure.tracks[i].sample_entry_sha256,source.structure.tracks[i].sample_entry_sha256);
      assert.deepEqual(d.structure.tracks[i].edits,source.structure.tracks[i].edits);
      assert.equal(d.structure.tracks[i].media_timescale,source.structure.tracks[i].media_timescale);
      for(const table of ['stts','ctts','cslg','stss','sgpd','sbgp'])assert.deepEqual(d.structure.tracks[i].tables[table],source.structure.tracks[i].tables[table]);
    }
    for(const name of ['A','B','C','D']) {
      const v=report.variants[name];
      assert.equal(v.native_playback.decoded_video_frames,source.native_playback.decoded_video_frames);
      assert.deepEqual(v.native_playback.ordered_decoded_frame_hashes,source.native_playback.ordered_decoded_frame_hashes);
      assert.deepEqual(v.native_playback.all_frame_hdr,source.native_playback.all_frame_hdr);
      assert.equal(v.native_seeks.length,3);
    }
    if(kind==='priming') {
      const index=source.structure.tracks.findIndex(t=>t.handler==='soun');
      assert.ok(source.structure.tracks[index].edits.some(e=>e.media_time>0));
      assert.ok(source.packets.some(p=>p.codec_type==='audio' && p.side_data_list?.some(s=>s.skip_samples>0)));
    }
    const audioIndex=a.structure.tracks.findIndex(t=>t.handler==='soun');
    assert.notEqual(report.variants.B.structure.tracks[audioIndex].tables.stsc.sha256,a.structure.tracks[audioIndex].tables.stsc.sha256);
    assert.notEqual(report.variants.C.structure.movie_timescale,a.structure.movie_timescale);
    assert.notEqual(report.variants.C.interleaving.track_runs,a.interleaving.track_runs);
    if(kind==='hdr10')assert.ok(a.first_frame_hdr_metadata[0].some(s=>s.side_data_type.includes('Mastering')));
    // Guard audit rejects loss, timestamp drift and rewritten configuration instead of blessing an output.
    run('python3',['-c',`import sys,copy
sys.path.insert(0,'tools')
from mp4_ab import probe,verify
from pathlib import Path
p=Path(sys.argv[1]); a=probe(p)
for change in ['hash','pts','config','count']:
 b=copy.deepcopy(a)
 if change=='hash': b['packets'][0]['data_hash']='SHA256:bad'
 if change=='pts': b['packets'][0]['pts']+=1
 if change=='config': b['streams'][0]['extradata_hash']='bad'
 if change=='count': b['packets'].pop()
 try: verify(a,b,p,p)
 except AssertionError: pass
 else: raise AssertionError('Audit accepted '+change)
`,join(out,'A-smart.mp4')]);
    run('python3',['-c',`import sys
sys.path.insert(0,'tools')
from mp4_ab import *
source,a,d,out=map(Path,sys.argv[1:])
# A valid-looking edit rate change is unsupported and must fail before declaring D valid.
nodes=parse(source.read_bytes()); track=tracks(nodes)[1][0]; edit=child(child(track,b'edts'),b'elst'); data=bytearray(edit['payload']); data[-4:]=pack(2<<16); replace(edit,bytes(data))
bad=out/'rate-change.mov'; bad.write_bytes(b''.join(serialize(n) for n in nodes))
try: source_timing(bad,a,out/'bad-D.mp4')
except ValueError as e: assert 'rate-changing' in str(e)
else: raise AssertionError('Accepted rate-changing edit')
# Table sample counts must agree even when compressed payloads have not changed.
nodes=parse(source.read_bytes()); stts=child(tracks(nodes)[0][2],b'stts'); data=bytearray(stts['payload']); data[8:12]=pack(u32(data,8)+1); replace(stts,bytes(data)); bad.write_bytes(b''.join(serialize(n) for n in nodes))
try: source_timing(bad,a,out/'bad-D.mp4')
except ValueError as e: assert 'counts disagree' in str(e)
else: raise AssertionError('Accepted mismatched stts count')
# Changing a single AAC edit media_time tick must be detected by box-level proof.
nodes=parse(d.read_bytes()); track=tracks(nodes)[1][0]; edit=child(child(track,b'edts'),b'elst'); data=bytearray(edit['payload']); at=23 if data[0]==1 else 15; data[at]^=1; replace(edit,bytes(data)); bad.write_bytes(b''.join(serialize(n) for n in nodes))
try: assert_source_boxes(source,bad)
except AssertionError: pass
else: raise AssertionError('Accepted altered AAC edit')
`,rotated,join(out,'A-smart.mp4'),join(out,'D-source-timing.mp4'),out]);
    const protoOut=join(dir,'prototype');
    run('python3',['tools/kf-prototype.py',rotated,join(out,'A-smart.mp4'),join(out,'D-source-timing.mp4'),protoOut,'--audio-mutations']);
    const proto=JSON.parse(readFileSync(join(protoOut,'prototype.json')));
    const n=proto.variants.N;
    assert.equal(n.audio_mutated,false);assert.equal(n.decoded_pcm_matches,true);
    assert.equal(n.audio_seek_matches,true);assert.equal(n.video_seek_matches,true);
    assert.equal(n.timing.video.pts_shift_seconds_exact,'0');assert.equal(n.timing.audio.pts_shift_seconds_exact,'0');
    assert.equal(n.table_validation.mdat_boxes,1);
    assert.equal(proto.variants.O.audio_mutated,true);assert.notEqual(proto.variants.O.timing.audio.pts_shift_seconds_exact,'0');
    assert.equal(proto.variants.O.audio_seek_matches,false);
    if(kind==='priming') {
      assert.match(proto.blocked.T,/shortened/);assert.match(proto.blocked.K,/shortened/);
    }else {
      const t=proto.variants.T,k=proto.variants.K;
      assert.equal(t.audio_packets_appended,4);assert.equal(t.table_validation.mdat_boxes,2);
      assert.equal(t.original_pcm_prefix_matches,true);assert.equal(t.decoded_pcm_matches,false);
      assert.equal(t.timing.audio.pts_shift_seconds_exact,'0');assert.equal(t.audio_seek_matches,true);
      assert.equal(k.audio_mutated,true);assert.equal(k.audio_seek_matches,false);
      assert.equal(t.added_pcm_samples_per_channel,4096);
    }
    if(kind==='priming') {
      const defaultOut=join(dir,'default-prototype');
      run('python3',['tools/kf-prototype.py',rotated,join(out,'A-smart.mp4'),join(out,'D-source-timing.mp4'),defaultOut]);
      const only=JSON.parse(readFileSync(join(defaultOut,'prototype.json')));
      assert.deepEqual(Object.keys(only.variants),['N']);
      assert.equal(only.variants.N.sha256,n.sha256);
    }
    for(const variant of Object.values(proto.variants)) {
      assert.equal(variant.table_validation.tracks.length,2);
      assert.equal(variant.timing.video.pts_shift_seconds_exact,'0');
      assert.equal(variant.timing.video.original_packet_hashes_verified,true);
      assert.equal(variant.timing.audio.original_packet_hashes_verified,true);
      assert.equal(variant.video_seek_matches,true);
      assert.equal(variant.decoded_video_frames,source.native_playback.decoded_video_frames);
    }
    run('python3',['-c',`import sys
sys.path.insert(0,'tools')
import importlib.util
spec=importlib.util.spec_from_file_location('kf','tools/kf-prototype.py'); kf=importlib.util.module_from_spec(spec); spec.loader.exec_module(kf)
from mp4_ab import *
p=Path(sys.argv[1]); nodes=parse(p.read_bytes()); off=child(tracks(nodes)[0][2],b'stco'); data=bytearray(off['payload']); data[8:12]=pack(0); replace(off,bytes(data)); bad=p.parent/'bad-offset.mp4'; bad.write_bytes(b''.join(serialize(n) for n in nodes))
try:kf.inspect_tables(bad)
except (AssertionError,ValueError):pass
else:raise AssertionError('Accepted chunk outside media')
`,join(protoOut,'N-layout.mp4')]);
    assert.throws(()=>run(process.execPath,['tools/mp4-ab.mjs',src,out]),/Output directory must be empty/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
