export function dimensions(width, height, resolution = '1080') {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw Error('Dimensi video tidak sah.');
  if (!['original', '1080', '4k'].includes(resolution)) throw Error('Invalid resolution.');
  const short = resolution === '4k' ? 2160 : 1080;
  const long = resolution === '4k' ? 3840 : 1920;
  const scale = resolution === 'original' ? 1 : Math.min(short / Math.min(width, height), long / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) };
}
export function checkDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw Error('Video duration must be finite and greater than zero.');
}
export function checkTimeline(before, after) {
  if (Math.abs((before.audio.start - before.video.start) - (after.audio.start - after.video.start)) > 0.12 ||
      Math.abs((before.audio.end - before.video.end) - (after.audio.end - after.video.end)) > 0.12 ||
      Math.abs((before.video.end - before.video.start) - (after.video.end - after.video.start)) > 0.12) {
    throw Error('Pengesahan masa/audio sync gagal. Fail tidak dieksport.');
  }
}
