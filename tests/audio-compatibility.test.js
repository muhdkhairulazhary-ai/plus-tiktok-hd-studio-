import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {convert} from '../src/converter.js';
const available=spawnSync('ffmpeg',['-version']).status===0;
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
for(const rate of [32000,44100,48000])for(const channels of [1,2])test(`original / Smart Copy / experimental AAC ${rate} Hz ${channels} channel packet and decoded-audio integrity`,{skip:!available},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'studio-aac-'));
  try {
    const source=join(dir,'source.mov');
    run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=30','-itsoffset','0.15','-f','lavfi','-i',`sine=frequency=440:sample_rate=${rate}`,'-t','1','-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error','-tag:v','hvc1','-c:a','aac','-ar',String(rate),'-ac',String(channels),source]);
    const probe=path=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',path]));
    const original=probe(source),input=new Blob([readFileSync(source)]);
    const pcm=path=>run('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-f','hash','-hash','sha256','-']);
    const pcmSource=pcm(source);
    for(const mode of ['smart','compat']) {
      const result=await convert(input,()=>{},new AbortController().signal,{mode});
      assert.ok(result.videoCopied&&result.audioCopied);
      const path=join(dir,mode+'.mp4');writeFileSync(path,new Uint8Array(await result.blob.arrayBuffer()));const out=probe(path);
      assert.equal(out.streams.length,2);assert.equal(out.streams[1].sample_rate,String(rate));assert.equal(out.streams[1].channels,channels);
      for(const index of [0,1]) assert.deepEqual(out.packets.filter(p=>p.stream_index===index).map(p=>[p.data_hash,p.pts_time,p.duration_time]),original.packets.filter(p=>p.stream_index===index).map(p=>[p.data_hash,p.pts_time,p.duration_time]));
      assert.equal(pcm(path),pcmSource); // Independent decoder checks pitch/rate/channel/priming semantics, not just labels.
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
