import { dimensions } from './policy.js';
export const defaults = Object.freeze({ resolution: 'original', fps: 'original', quality: 'preserve', bitrate: 8.5 });
export function resolveSettings(width, height, settings = {}, source = null) {
  const value = { ...defaults, ...settings };
  if (!['original', '1080', '4k'].includes(value.resolution) || !['original', '30', '60'].includes(value.fps) || !['preserve', 'auto', 'high', 'custom'].includes(value.quality)) throw Error('Invalid output settings.');
  const size = dimensions(width, height, value.resolution);
  const frameRate = value.fps === 'original' ? undefined : Number(value.fps);
  const base = 8500000 * size.width * size.height / (1920 * 1080) * (frameRate === 30 ? 0.7 : 1);
  let bitrate = value.quality === 'custom' ? Number(value.bitrate) * 1000000 : Math.round(Math.max(2000000, base) * (value.quality === 'high' ? 1.5 : 1));
  let estimatedSize = null, targetSize = null, sizeNote = '';
  const measurable = source && Number.isFinite(source.fileSize) && source.fileSize > 0 && Number.isFinite(source.videoDuration) && source.videoDuration > 0;
  if (value.quality === 'preserve' && (!measurable || !Number.isFinite(source.videoBitrate) || source.videoBitrate <= 0 || !Number.isFinite(source.audioBytes) || !Number.isFinite(source.audioDuration))) throw Error('Source bitrate metadata is unavailable. Choose Automatic, High quality or Custom bitrate.');
  if (measurable) {
    const copyAudio = source.audio?.codec === 'mp4a.40.2';
    const audioBytes = copyAudio ? source.audioBytes : source.audioDuration * 160000 / 8;
    const videoPackets = frameRate ? Math.ceil(source.videoDuration * frameRate) : source.videoPackets;
    // A transparent MP4 table/header allowance, not bytes added to the output.
    const overhead = 4096 + videoPackets * 20 + source.audioPackets * 12;
    if (value.quality === 'preserve') {
      targetSize = source.fileSize;
      const budget = (targetSize - audioBytes - overhead) * 8 / source.videoDuration;
      if (!(budget > 0)) throw Error('This file is too small for a reliable size target with its audio and MP4 headers. Choose another bitrate mode.');
      // Do not inflate a legitimate media target to replace large source metadata/free boxes.
      bitrate = Math.round(Math.min(budget, source.videoBitrate * 1.1));
      sizeNote = 'Aiming within ±5–10% of the original. Hardware rate control can produce a smaller or larger file; no padding or size-driven resolution changes.';
      if (budget > source.videoBitrate * 1.1) sizeNote += ' Source container overhead exceeds the media budget; the estimate may be smaller than the original.';
    }
    estimatedSize = Math.round(bitrate * source.videoDuration / 8 + audioBytes + overhead);
  }
  if (value.quality === 'custom' && (!Number.isFinite(bitrate) || bitrate < 1000000 || bitrate > 100000000)) throw Error('Choose a bitrate between 1 and 100 Mbps.');
  if (!Number.isFinite(bitrate) || bitrate <= 0) throw Error('A valid positive video bitrate is required.');
  return { ...size, frameRate, bitrate, estimatedSize, targetSize, sizeNote };
}
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function formatBitrate(bits) {
  if (!Number.isFinite(bits) || bits <= 0) return 'Unavailable';
  return bits >= 1000000 ? `${(bits / 1000000).toFixed(2)} Mbps` : `${(bits / 1000).toFixed(1)} kbps`;
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return 'Unavailable';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function sizeComparison(before, after) {
  const change = (after / before - 1) * 100;
  return `${Math.abs(change).toFixed(1)}% ${change <= 0 ? 'smaller' : 'larger'}`;
}
export function sizeOutcome(target, actual) {
  if (!(Number.isFinite(target) && target > 0)) return 'Size is an estimate, not a guarantee.';
  const difference = Math.abs(actual / target - 1);
  return difference <= .1 + Number.EPSILON ? 'Actual size is within 10% of the original.' : 'Actual size is outside the ±10% target. Hardware rate control varies; this is the real file size, with no padding or resolution fallback.';
}
