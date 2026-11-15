import { EncodedPacketSink } from 'mediabunny';

// Read sample metadata only. No decoded frames, PCM buffers or whole-container copies.
export async function analyzeTrack(track, signal) {
  let bytes = 0, packets = 0, start = Infinity, end = -Infinity;
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    signal?.throwIfAborted();
    bytes += packet.byteLength; packets++;
    start = Math.min(start, packet.timestamp);
    end = Math.max(end, packet.timestamp + packet.duration);
  }
  const duration = end - start;
  return { bytes, packets, duration, bitrate: duration > 0 && Number.isFinite(duration) ? bytes * 8 / duration : null,
    fps: duration > 0 && Number.isFinite(duration) ? packets / duration : null };
}
export async function analyzeSource(file, input, video, audio, signal) {
  const v = await analyzeTrack(video, signal), a = audio ? await analyzeTrack(audio, signal) : null;
  signal?.throwIfAborted();
  return {
    fileSize: file.size, duration: await input.computeDuration(),
    width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), fps: v.fps,
    videoBitrate: v.bitrate, videoBytes: v.bytes, videoDuration: v.duration, videoPackets: v.packets,
    audioBitrate: a?.bitrate ?? null, audioBytes: a?.bytes ?? 0, audioDuration: a?.duration ?? 0, audioPackets: a?.packets ?? 0,
    audio: audio ? { codec: await audio.getCodecParameterString(), channels: await audio.getNumberOfChannels(), sampleRate: await audio.getSampleRate() } : null,
  };
}
