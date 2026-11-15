import { convert } from './converter.js';
import { inspect, checkSupport } from './metadata.js';
import { formatBytes, formatTime, sizeComparison } from './settings.js';

export function createStudio(doc, dependencies = {}) {
  const win = doc.defaultView;
  const deps = { convert, inspect, checkSupport, checkPlayback: (blob, signal) => checkPlayback(blob, doc, signal), ...dependencies };
  const $ = id => doc.getElementById(id);
  let file = null, metadata = null, src = null, out = null, outputFile = null;
  let metadataController = null;
  let controller = null, generation = 0, supportGeneration = 0, supported = false, timer = null, started = 0, shareFailed = false, sharing = false;
  const settings = () => ({ resolution: $('resolution').value, fps: $('fps').value, quality: $('quality').value, bitrate: $('bitrate').value });
  const message = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
  const resetPlayer = player => { player.pause(); player.removeAttribute('src'); player.load(); };
  function clearOutput() {
    resetPlayer($('result-preview'));
    if (out) win.URL.revokeObjectURL(out);
    out = outputFile = null; shareFailed = false;
    $('download').removeAttribute('href'); $('download').textContent = 'Save to Files / Download MP4 ↓';
    $('results').hidden = true;
  }
  function lock(active) {
    $('file').disabled = $('choose').disabled = $('change').disabled = $('settings-fields').disabled = $('another').disabled = active;
    $('go').disabled = active || !supported || !file;
    $('go').textContent = active ? 'Processing your video…' : '✦  Process video  →';
    $('go').setAttribute('aria-busy', String(active));
  }
  async function refreshSupport() {
    const version = ++supportGeneration;
    supported = false; $('go').disabled = true;
    $('custom-field').hidden = $('quality').value !== 'custom';
    if (!metadata) return;
    $('support').textContent = 'Checking your selected HEVC configuration…';
    $('support').classList.remove('unsupported');
    try {
      const support = await deps.checkSupport(metadata, settings());
      if (version !== supportGeneration) return;
      supported = support.supported;
      const c = support.config;
      $('output-summary').textContent = `${c.width} × ${c.height} · ${c.frameRate ? c.frameRate + ' FPS' : 'Original timing'} · ${(c.bitrate / 1000000).toFixed(1)} Mbps · HEVC + AAC`;
      $('support').textContent = support.reason;
      $('support').classList.toggle('unsupported', !supported);
    } catch (error) {
      if (version !== supportGeneration) return;
      $('support').textContent = error.message; $('support').classList.add('unsupported');
    }
    if (!controller) lock(false);
  }
  async function loadFile(next) {
    if (controller || !next) return;
    const version = ++generation; ++supportGeneration;
    metadataController?.abort(); metadataController = new AbortController();
    const metadataSignal = metadataController.signal;
    file = next; metadata = null; supported = false;
    clearOutput(); resetPlayer($('preview'));
    if (src) win.URL.revokeObjectURL(src);
    src = null;
    $('processing').hidden = true; $('go').disabled = true; $('bar').value = 0;
    $('dropzone').hidden = true; $('source-content').hidden = false;
    $('filename').textContent = file.name;
    $('source-size').textContent = formatBytes(file.size);
    for (const id of ['source-resolution', 'source-fps', 'source-duration', 'source-audio']) $(id).textContent = 'Reading…';
    $('support').textContent = 'Reading metadata before checking HEVC support…';
    $('support').classList.remove('unsupported');
    $('output-summary').textContent = 'Waiting for video metadata…';
    message('Reading video metadata. Your file stays on this device.');
    try {
      if (!/\.(mp4|mov)$/i.test(next.name)) throw Error('Choose a MOV or MP4 file.');
      src = win.URL.createObjectURL(next); $('preview').src = src;
      const result = await deps.inspect(next, metadataSignal);
      if (version !== generation) return;
      metadata = result;
      $('source-resolution').textContent = `${result.width} × ${result.height}`;
      $('source-fps').textContent = result.fps ? `${result.fps.toFixed(2)} FPS average` : 'Unavailable';
      $('source-duration').textContent = formatTime(result.duration);
      $('source-audio').textContent = result.audio ? `${result.audio.codec || 'Unknown codec'} · ${result.audio.channels} ch · ${(result.audio.sampleRate / 1000).toFixed(1)} kHz${result.audioTracks > 1 ? ` · ${result.audioTracks} tracks` : ''}` : 'No audio track';
      message('Video ready. Choose your finish below.');
      await refreshSupport();
    } catch (error) {
      if (version !== generation) return;
      for (const id of ['source-resolution', 'source-fps', 'source-duration', 'source-audio']) $(id).textContent = 'Unavailable';
      message(`Could not read this video: ${error.message}`, true);
      $('support').textContent = 'Choose another MOV or MP4 video.';
    }
  }
  const choose = () => { if (!controller) $('file').click(); };
  $('choose').onclick = $('change').onclick = choose;
  $('file').onchange = () => { const next = $('file').files[0]; $('file').value = ''; void loadFile(next); };
  $('dropzone').ondragover = event => { event.preventDefault(); if (!controller) $('dropzone').classList.add('dragover'); };
  $('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
  $('dropzone').ondrop = event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); if (!controller) void loadFile(event.dataTransfer?.files[0]); };
  $('settings').onsubmit = event => event.preventDefault();
  for (const id of ['resolution', 'fps', 'quality', 'bitrate']) $(id).onchange = () => { if (!controller) void refreshSupport(); };
  $('go').onclick = async () => {
    if (controller || !file || !metadata || !supported) return;
    const selectedFile = file, selectedSettings = settings();
    controller = new AbortController();
    const signal = controller.signal;
    clearOutput(); resetPlayer($('result-preview')); $('preview').pause();
    lock(true); $('processing').hidden = false; $('cancel').disabled = false;
    $('bar').value = 0; $('percent').textContent = '0%';
    $('stage').textContent = 'Checking source video and audio…';
    message('Processing locally. Keep this tab visible.');
    started = win.performance.now();
    const clock = () => $('elapsed').textContent = `${formatTime((win.performance.now() - started) / 1000)} elapsed`;
    clock(); timer = win.setInterval(clock, 500);
    try {
      const result = await deps.convert(selectedFile, (percent, stage) => {
        $('bar').value = percent; $('percent').textContent = `${percent}%`; if ($('stage').textContent !== stage) $('stage').textContent = stage;
      }, signal, selectedSettings);
      signal.throwIfAborted();
      $('stage').textContent = 'Checking MP4 playback…'; $('bar').value = 98; $('percent').textContent = '98%';
      await deps.checkPlayback(result.blob, signal);
      signal.throwIfAborted();
      const seconds = (win.performance.now() - started) / 1000;
      outputFile = new win.File([result.blob], `plus-hd-${result.width}x${result.height}-hevc-aac.mp4`, { type: 'video/mp4' });
      out = win.URL.createObjectURL(outputFile);
      $('result-preview').src = out; $('download').href = out; $('download').download = outputFile.name;
      $('result-resolution').textContent = `${result.width} × ${result.height}`;
      $('result-fps').textContent = Number.isFinite(result.fps) ? `${result.fps.toFixed(2)} FPS${selectedSettings.fps === 'original' ? ' average' : ''}` : 'Unavailable';
      $('result-codec').textContent = 'HEVC H.265 (hvc1)';
      $('result-audio').textContent = `AAC${result.audioCopied ? ' · original packets' : ' · transcoded'}`;
      $('result-size').textContent = formatBytes(outputFile.size);
      $('result-time').textContent = formatTime(seconds);
      $('compare-before').textContent = formatBytes(selectedFile.size); $('compare-after').textContent = formatBytes(outputFile.size);
      $('compare-change').textContent = sizeComparison(selectedFile.size, outputFile.size);
      $('results').hidden = false; $('bar').value = 100; $('percent').textContent = '100%';
      $('stage').textContent = 'Export complete. MP4, audio and timing verified.';
      message('Ready to save. Play the result and check sound and sync before posting.');
      $('results-title').focus({ preventScroll: true }); $('results').scrollIntoView({ block: 'start' });
    } catch (error) {
      clearOutput();
      $('stage').textContent = signal.aborted ? 'Processing cancelled.' : 'Processing stopped.';
      message(signal.aborted ? 'Cancelled. Your original video is unchanged.' : `Could not export: ${error.message}`, !signal.aborted);
    } finally {
      win.clearInterval(timer); timer = null; controller = null; lock(false); $('cancel').disabled = true;
    }
  };
  $('cancel').onclick = () => { $('cancel').disabled = true; $('stage').textContent = 'Cancelling…'; controller?.abort(); };
  $('another').onclick = () => {
    if (controller) return;
    ++generation; ++supportGeneration; clearOutput(); resetPlayer($('preview'));
    if (src) win.URL.revokeObjectURL(src);
    src = file = metadata = null; supported = false;
    $('source-content').hidden = true; $('dropzone').hidden = false; $('processing').hidden = true;
    $('support').textContent = 'Choose a video to check device compatibility.';
    $('support').classList.remove('unsupported');
    $('output-summary').textContent = 'Choose a video to preview your output settings.';
    message(''); lock(false); $('choose').focus({ preventScroll: true }); $('studio').scrollIntoView({ block: 'start' });
  };
  async function shareFile() {
    if (!outputFile || sharing) return;
    const nav = win.navigator;
    try {
      if (!nav.canShare?.({ files: [outputFile] })) { message('File sharing is unavailable. Use Save to Files / Download MP4, then share from Files.'); return; }
      sharing = true; $('share').disabled = true;
      await nav.share({ files: [outputFile] });
    } catch (error) {
      if (error.name !== 'AbortError') { shareFailed = true; $('download').textContent = 'Download MP4 directly ↓'; message(`Share was unavailable: ${error.message}. Use Download MP4 directly.`, true); }
    } finally { sharing = false; $('share').disabled = false; }
  }
  $('share').onclick = shareFile;
  $('download').onclick = event => {
    if (outputFile && !shareFailed && win.navigator.canShare?.({ files: [outputFile] })) { event.preventDefault(); void shareFile(); }
  };
  const pagehide = () => { controller?.abort(); metadataController?.abort(); };
  win.addEventListener('pagehide', pagehide);
  return {
    loadFile, refreshSupport,
    getState: () => ({ busy: !!controller, supported, hasOutput: !!outputFile }),
    destroy() { ++generation; ++supportGeneration; metadataController?.abort(); controller?.abort(); win.clearInterval(timer); resetPlayer($('preview')); clearOutput(); if (src) win.URL.revokeObjectURL(src); win.removeEventListener('pagehide', pagehide); },
  };
}
export async function checkPlayback(blob, doc, signal) {
  const win = doc.defaultView, player = doc.createElement('video'), url = win.URL.createObjectURL(blob);
  player.muted = true; player.playsInline = true; player.preload = 'auto';
  try {
    await new Promise((resolve, reject) => {
      const abort = () => finish(signal.reason);
      const finish = error => { win.clearTimeout(timer); signal?.removeEventListener('abort', abort); player.onloadeddata = player.onerror = null; error ? reject(error) : resolve(); };
      const timer = win.setTimeout(() => finish(Error('Playback check timed out. Try a shorter video.')), 20000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      player.onloadeddata = () => finish();
      player.onerror = () => finish(Error('Safari could not load the exported MP4.'));
      player.src = url; player.load();
    });
  } finally { player.pause(); player.removeAttribute('src'); player.load(); win.URL.revokeObjectURL(url); }
}
if (typeof document !== 'undefined') createStudio(document);
