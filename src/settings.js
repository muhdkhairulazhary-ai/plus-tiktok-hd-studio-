import { dimensions } from './policy.js';
export const defaults = Object.freeze({ resolution: '1080', fps: '60', quality: 'auto', bitrate: 8.5 });
export function resolveSettings(width, height, settings = {}) {
  const value = { ...defaults, ...settings };
  if (!['original', '1080', '4k'].includes(value.resolution) || !['original', '30', '60'].includes(value.fps) || !['auto', 'high', 'custom'].includes(value.quality)) throw Error('Invalid output settings.');
  const size = dimensions(width, height, value.resolution);
  const frameRate = value.fps === 'original' ? undefined : Number(value.fps);
  const base = 8500000 * size.width * size.height / (1920 * 1080) * (frameRate === 30 ? 0.7 : 1);
  const bitrate = value.quality === 'custom' ? Number(value.bitrate) * 1000000 : Math.round(Math.max(2000000, base) * (value.quality === 'high' ? 1.5 : 1));
  if (!Number.isFinite(bitrate) || bitrate < 1000000 || bitrate > 100000000) throw Error('Choose a bitrate between 1 and 100 Mbps.');
  return { ...size, frameRate, bitrate };
}
export function formatBytes(bytes) {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return 'Unavailable';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function sizeComparison(before, after) {
  const change = (after / before - 1) * 100;
  return `${Math.abs(change).toFixed(1)}% ${change <= 0 ? 'smaller' : 'larger'}`;
}
