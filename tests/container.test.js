import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } from 'mediabunny';
import { timeline, convert } from '../src/converter.js';
import { checkTimeline } from '../src/policy.js';
import { inspect } from '../src/metadata.js';
const available = spawnSync('ffmpeg', ['-version']).status === 0;
test('real MOV HEVC/AAC demux, audio packet preservation and MP4 mux verified by ffprobe', { skip: !available }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'));
  let input, check;
  try {
    const source = join(dir, 'source.mov');
    execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60','-itsoffset','0.15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error','-tag:v','hvc1','-c:a','aac',source], {stdio:'pipe'});
    const file = new Blob([readFileSync(source)]);
    const metadata = await inspect(file);
    assert.equal(metadata.width,128); assert.equal(metadata.height,72);
    assert.ok(Math.abs(metadata.fps-60)<0.1); assert.equal(metadata.audio.codec,'mp4a.40.2');
    input = new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
    assert.equal(await audio.getCodecParameterString(), 'mp4a.40.2');
    const before = {video:await timeline(video),audio:await timeline(audio)};
    assert.ok(before.audio.start - before.video.start > 0.1);
    const silent = join(dir, 'silent.mov');
    execFileSync('ffmpeg', ['-v','error','-i',source,'-map','0:v:0','-c','copy',silent]);
    await assert.rejects(convert(new Blob([readFileSync(silent)]),()=>{},new AbortController().signal), /satu track video dan satu track audio/);
    const multiple = join(dir, 'multiple.mov');
    execFileSync('ffmpeg', ['-v','error','-i',source,'-map','0:v:0','-map','0:a:0','-map','0:a:0','-c','copy',multiple]);
    await assert.rejects(convert(new Blob([readFileSync(multiple)]),()=>{},new AbortController().signal), /satu track video dan satu track audio/);
    const target = new BufferTarget();
    const output = new Output({target,format:new Mp4OutputFormat({fastStart:false})});
    const conversion = await Conversion.init({input,output,video:{codec:'hevc'},audio:{codec:'aac'}});
    assert.ok(conversion.isValid);
    assert.equal(conversion.discardedTracks.length,0);
    await conversion.execute();
    check = new Input({source:new BlobSource(new Blob([target.buffer])),formats:ALL_FORMATS});
    const ov = await check.getPrimaryVideoTrack(), oa = await check.getPrimaryAudioTrack();
    assert.match(await ov.getCodecParameterString(), /^hvc1\./);
    checkTimeline(before,{video:await timeline(ov,60),audio:await timeline(oa)});
    await assert.rejects(timeline(ov,30), /cadence/);
    const dest = join(dir,'output.mp4'); writeFileSync(dest,new Uint8Array(target.buffer));
    const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',dest],{encoding:'utf8'}));
    assert.equal(probe.streams[0].codec_name,'hevc');
    assert.equal(probe.streams[0].r_frame_rate,'60/1');
    assert.equal(probe.streams[1].codec_name,'aac');
    // Hash compressed audio packets independently of container headers.
    const hash = path => execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'});
    assert.equal(hash(source),hash(dest));
  } finally { input?.dispose(); check?.dispose(); rmSync(dir,{recursive:true,force:true}); }
});
test('corrupt container fails without an output', async () => {
  await assert.rejects(convert(new Blob(['bad']),()=>{},new AbortController().signal));
});
