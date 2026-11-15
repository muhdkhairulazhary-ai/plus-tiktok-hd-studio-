import { Input, BlobSource, ALL_FORMATS, canEncodeVideo } from 'mediabunny';
import { processingPlan } from './modes.js';
import { videoMetadata } from './video-metadata.js';
import { analyzeSource } from './analysis.js';
export async function inspect(file, signal) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const videos = await input.getVideoTracks(), audios = await input.getAudioTracks();
    if (!videos.length) throw Error('No readable video track was found. Choose a MOV or MP4 video.');
    const video = videos[0], audio = audios[0];
    const meta=await videoMetadata(file,video,signal);
    return { ...await analyzeSource(file, input, video, audio, signal), videoTracks: videos.length, audioTracks: audios.length, videoCodec:meta.codec, videoCodecString:meta.codecString, hdr:meta.summary, copyReason:meta.copyReason };
  } finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}
export async function checkSupport(metadata, settings) {
  const {mode,config} = processingPlan(metadata,settings);
  if (metadata.videoTracks !== 1 || metadata.audioTracks !== 1) return { supported: false, config, reason: 'Choose a video with one video track and one audio track. Silent and multi-track exports are not supported.' };
  if(mode==='smart'||mode==='compat') return {supported:true,config,reason:'Smart Copy uses no video/audio encoder. Packet, timing and HDR retention must pass output verification before saving.'};
  if (!await canEncodeVideo('hevc', { width: config.width, height: config.height, bitrate: config.bitrate, ...(config.frameRate ? { frameRate: config.frameRate } : {}) })) return { supported: false, config, reason: 'This browser cannot encode HEVC with these settings. Try a lower resolution or frame rate, or use a native editor.' };
  return { supported: true, config, reason: 'Lossy HEVC re-encoding selected. Quality and file size can change. HEVC encoder available for these settings. Source decoding and audio support are checked when processing starts.' };
}
