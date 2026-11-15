import { convert } from './converter.js';
const $ = s => document.querySelector(s);
const inp = $('#file'), preview = $('#preview'), go = $('#go'), download = $('#download'), status = $('#status'), bar = $('#bar'), details = $('#details'), share = $('#share'), help = $('#saveHelp');
let src, out, outputFile, controller;
const message = text => status.textContent = text;
function clearOutput() {
  if (out) URL.revokeObjectURL(out);
  out = null; outputFile = null;
  download.hidden = share.hidden = help.hidden = true;
  download.removeAttribute('href');
}
inp.onchange = () => {
  clearOutput();
  preview.pause(); preview.removeAttribute('src'); preview.load();
  if (src) URL.revokeObjectURL(src);
  src = null; go.disabled = true; bar.value = 0;
  const file = inp.files[0];
  preview.hidden = !file;
  if (!file) return;
  src = URL.createObjectURL(file); preview.src = src;
  details.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  go.disabled = false; message('Video sedia diproses.');
};
go.onclick = async () => {
  if (controller || !inp.files[0]) return;
  const file = inp.files[0];
  controller = new AbortController();
  inp.disabled = go.disabled = true;
  $('#cancel').hidden = false;
  clearOutput(); preview.pause(); bar.value = 0;
  message('Membaca track MOV/MP4 dan menyemak codec…');
  try {
    const result = await convert(file, (percent, text) => { bar.value = percent; message(`${text} ${percent}%`); }, controller.signal);
    message('Menguji playback MP4…');
    await checkPlayback(result.blob);
    controller.signal.throwIfAborted();
    outputFile = new File([result.blob], 'plus-tiktok-1080p60-hevc-aac.mp4', { type: 'video/mp4' });
    out = URL.createObjectURL(outputFile);
    download.href = out; download.download = outputFile.name;
    download.hidden = share.hidden = help.hidden = false;
    details.textContent = `${result.width}×${result.height} · 60 FPS · ${(result.blob.size / 1048576).toFixed(1)} MB`;
    bar.value = 100; message('Selesai — HEVC + AAC disahkan. Semak suara dan sync sebelum upload.');
  } catch (error) {
    clearOutput();
    message(error.name === 'AbortError' ? 'Proses dibatalkan.' : `Ralat: ${error.message}`);
  } finally {
    controller = null; inp.disabled = go.disabled = false; $('#cancel').hidden = true;
  }
};
$('#cancel').onclick = () => { message('Membatalkan…'); controller?.abort(); };
async function checkPlayback(blob) {
  const player = document.createElement('video'), url = URL.createObjectURL(blob);
  player.muted = true; player.playsInline = true; player.preload = 'auto';
  try {
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); player.onloadeddata = player.onerror = null; error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(Error('Ujian playback tamat masa. Cuba video lebih pendek.')), 20000);
      player.onloadeddata = () => finish();
      player.onerror = () => finish(Error('Safari tidak boleh memuatkan MP4 output.'));
      player.src = url; player.load();
    });
  } finally {
    player.pause(); player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url);
  }
}
async function shareFile() {
  if (!outputFile) return;
  if (navigator.canShare?.({ files: [outputFile] })) {
    try { await navigator.share({ files: [outputFile] }); }
    catch (error) { if (error.name !== 'AbortError') message(`Share gagal: ${error.message}. Gunakan pautan Download MP4.`); }
  } else message('Perkongsian fail tidak tersedia. Gunakan Download MP4 dan Share dari aplikasi Files.');
}
share.onclick = shareFile;
download.onclick = event => {
  if (outputFile && navigator.canShare?.({ files: [outputFile] })) { event.preventDefault(); void shareFile(); }
};
window.addEventListener('pagehide', () => { controller?.abort(); });
