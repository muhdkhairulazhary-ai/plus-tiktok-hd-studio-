import { Input, BlobSource, ALL_FORMATS, canEncodeVideo } from 'mediabunny';
import { resolveSettings } from './settings.js';
export async function inspect(file, signal) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const videos = await input.getVideoTracks(), audios = await input.getAudioTracks();
    if (!videos.length) throw Error('No readable video track was found. Choose a MOV or MP4 video.');
    const video = videos[0], audio = audios[0];
    const stats = await video.computePacketStats();
    return {
      width: await video.getDisplayWidth(), height: await video.getDisplayHeight(),
      duration: await input.computeDuration(), fps: Number.isFinite(stats.averagePacketRate) ? stats.averagePacketRate : null,
      audio: audio ? { codec: await audio.getCodecParameterString(), channels: await audio.getNumberOfChannels(), sampleRate: await audio.getSampleRate() } : null,
      videoTracks: videos.length, audioTracks: audios.length,
    };
  } finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}
export async function checkSupport(metadata, settings) {
  const config = resolveSettings(metadata.width, metadata.height, settings);
  if (metadata.videoTracks !== 1 || metadata.audioTracks !== 1) return { supported: false, config, reason: 'Choose a video with one video track and one audio track. Silent and multi-track exports are not supported.' };
  if (!await canEncodeVideo('hevc', { width: config.width, height: config.height, bitrate: config.bitrate, ...(config.frameRate ? { frameRate: config.frameRate } : {}) })) return { supported: false, config, reason: 'This browser cannot encode HEVC with these settings. Try a lower resolution or frame rate, or use a native editor.' };
  return { supported: true, config, reason: 'HEVC encoder available for these settings. Source decoding and audio support are checked when processing starts.' };
}
