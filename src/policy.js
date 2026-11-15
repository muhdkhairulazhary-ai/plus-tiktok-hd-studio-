export function dimensions(width, height) {
  if (!(width > 0 && height > 0)) throw Error('Dimensi video tidak sah.');
  const scale = Math.min(1080 / Math.min(width, height), 1920 / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) };
}
export function checkDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw Error('Video mesti berdurasi lebih 0 hingga 60 saat.');
}
export function checkTimeline(before, after) {
  if (Math.abs((before.audio.start - before.video.start) - (after.audio.start - after.video.start)) > 0.12 ||
      Math.abs((before.audio.end - before.video.end) - (after.audio.end - after.video.end)) > 0.12 ||
      Math.abs((before.video.end - before.video.start) - (after.video.end - after.video.start)) > 0.12) {
    throw Error('Pengesahan masa/audio sync gagal. Fail tidak dieksport.');
  }
}
