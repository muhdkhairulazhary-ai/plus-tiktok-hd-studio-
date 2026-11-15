import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion, canEncodeVideo, canEncodeAudio, EncodedPacketSink } from 'mediabunny';
import { dimensions, checkDuration, checkTimeline } from './policy.js';

export async function timeline(track, frames = false) {
  const times = [];
  let start = Infinity, end = -Infinity;
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    if (!Number.isFinite(packet.timestamp) || !Number.isFinite(packet.duration) || packet.duration < 0) throw Error('Timestamp tidak sah.');
    start = Math.min(start, packet.timestamp);
    end = Math.max(end, packet.timestamp + packet.duration);
    if (frames) times.push(packet.timestamp);
  }
  if (!Number.isFinite(start) || end <= start) throw Error('Track kosong atau rosak.');
  if (frames) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(times[i] - times[i - 1] - 1 / 60) > 0.002) throw Error('Pengesahan 60 FPS gagal.');
    }
  }
  return { start, end };
}

export async function convert(file, progress, signal) {
  // BlobSource reads ranges; never decode an entire container via decodeAudioData.
  if (file.size > 150 * 1048576) throw Error('Had fail 150 MB untuk mengurangkan penggunaan memori iPhone.');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let conversion, output, verified, completed = false;
  const abort = () => { void conversion?.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort);
  try {
    const videos = await input.getVideoTracks(), audios = await input.getAudioTracks();
    if (videos.length !== 1 || audios.length !== 1) throw Error('Perlu satu track video dan satu track audio. Fail senyap/multi-track tidak disokong; audio tidak akan dibuang.');
    const video = videos[0], audio = audios[0];
    if (await video.getCodedWidth() * await video.getCodedHeight() > 4096 * 2160) throw Error('Resolusi sumber melebihi had 4K untuk memori iPhone.');
    const duration = await input.computeDuration();
    checkDuration(duration);
    const size = dimensions(await video.getDisplayWidth(), await video.getDisplayHeight());
    if (!await video.canDecode()) throw Error('Codec video asal tidak boleh didekod oleh Safari ini. Gunakan fail H.264/HEVC yang disokong.');
    if (!await canEncodeVideo('hevc', { ...size, bitrate: 8500000, frameRate: 60 })) throw Error('Safari/peranti ini tidak boleh encode HEVC 1080p60. Gunakan aplikasi native atau FFmpeg; tiada eksport codec gantian.');
    const copyAudio = await audio.getCodecParameterString() === 'mp4a.40.2';
    if (!copyAudio && (!await audio.canDecode() || !await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }))) throw Error('Audio asal memerlukan decoder dan encoder AAC yang tidak tersedia. Tukar audio ke AAC-LC menggunakan aplikasi native/FFmpeg.');
    const before = { video: await timeline(video), audio: await timeline(audio) };
    const target = new BufferTarget();
    output = new Output({ target, format: new Mp4OutputFormat({ fastStart: false }) });
    conversion = await Conversion.init({ input, output, tracks: 'all',
      video: { ...size, fit: 'contain', codec: 'hevc', bitrate: 8500000, frameRate: 60, forceTranscode: true, allowTransformationMetadata: false, keyFrameInterval: 2 },
      audio: copyAudio ? { codec: 'aac' } : { codec: 'aac', forceTranscode: true, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 },
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length) throw Error('Codec/track tidak disokong. Eksport dihentikan supaya audio tidak hilang.');
    conversion.onProgress = value => progress(Math.min(94, Math.floor(value * 94)), 'Encoding HEVC + AAC…');
    signal.throwIfAborted();
    await conversion.execute();
    signal.throwIfAborted();
    progress(95, 'Mengesahkan MP4, codec dan timestamp…');
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    target.buffer = null;
    verified = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const ov = await verified.getPrimaryVideoTrack(), oa = await verified.getPrimaryAudioTrack();
    if (!ov || !oa || await ov.getCodec() !== 'hevc' || await oa.getCodec() !== 'aac' ||
        !/^hvc1\./.test(await ov.getCodecParameterString()) ||
        await ov.getDisplayWidth() !== size.width || await ov.getDisplayHeight() !== size.height) throw Error('Pengesahan codec/container MP4 gagal.');
    checkTimeline(before, { video: await timeline(ov, true), audio: await timeline(oa) });
    if (!await ov.canDecode() || !await oa.canDecode()) throw Error('Safari ini tidak boleh memainkan codec output. Fail tidak dieksport.');
    completed = true;
    return { blob, ...size };
  } finally {
    signal.removeEventListener('abort', abort);
    if (!completed) {
      if (conversion) await conversion.cancel().catch(() => {});
      else if (output) await output.cancel().catch(() => {});
    }
    verified?.dispose();
    input.dispose();
  }
}
