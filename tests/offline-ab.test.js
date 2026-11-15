import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const available=['ffmpeg','ffprobe','python3'].every(cmd=>spawnSync(cmd,[cmd==='python3'?'--version':'-version']).status===0);
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
for(const [kind,rate,channels] of [['sdr',44100,1],['hlg',48000,2],['hdr10',32000,2]])test(`offline A/B/C ${kind}: unchanged HEVC/AAC, PCM, edits, HDR and real alternate structure`,{skip:!available},()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-ab-'));
  try{
    const src=join(dir,'source.mov'),out=join(dir,'variants');
    const hdr=kind!=='sdr',transfer=kind==='hlg'?'arib-std-b67':kind==='hdr10'?'smpte2084':'bt709';
    const params=`pools=1:frame-threads=1:log-level=error:colorprim=${hdr?'bt2020':'bt709'}:transfer=${transfer}:colormatrix=${hdr?'bt2020nc':'bt709'}`+(kind==='hdr10'?':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400':'');
    run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60000/1001','-itsoffset','0.15','-f','lavfi','-i',`sine=frequency=440:sample_rate=${rate}`,'-t','1','-c:v','libx265','-preset','ultrafast','-x265-params',params,'-pix_fmt',hdr?'yuv420p10le':'yuv420p','-color_primaries',hdr?'bt2020':'bt709','-color_trc',transfer,'-colorspace',hdr?'bt2020nc':'bt709','-tag:v','hvc1','-c:a','aac','-ac',String(channels),src]);
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
    assert.throws(()=>run(process.execPath,['tools/mp4-ab.mjs',src,out]),/Output directory must be empty/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
