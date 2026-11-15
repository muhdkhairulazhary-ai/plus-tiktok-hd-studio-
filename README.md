# plus+ TikTok HD Studio

Local MOV/MP4 conversion targeting HEVC H.265 + AAC in a real MP4 container, 60 FPS, within 1080×1920 portrait or 1920×1080 landscape. Other aspect ratios are preserved (even pixel rounding, contain fit). Lower resolution sources are upscaled; 30 FPS sources repeat frames rather than generating motion detail.

## How conversion works

The bundled, pinned Mediabunny library demuxes MOV/MP4 using range reads from the selected File. It honors container timing/edit lists, rotation and pixel aspect metadata. Video samples are decoded, resized, resampled to 60 FPS and encoded with WebCodecs HEVC. Its conversion pipeline applies backpressure and closes media samples rather than queuing an entire decoded movie.

AAC-LC (`mp4a.40.2`) audio is copied as compressed packets whenever possible: no unnecessary decode, quality loss or dependence on an AAC encoder. Other audio is demuxed, decoded by a supported decoder, then encoded to stereo 48 kHz AAC. This requires actual AAC encoding support. Container bytes are never passed to `decodeAudioData()`.

One video track and one audio track are required. Silent files and multiple audio/video tracks are explicitly rejected, rather than silently dropping sound or choosing an unexpected track. Unsupported source codecs, unavailable HEVC/AAC encoders, discarded tracks, invalid timestamps and failed output checks stop export. HEVC is never substituted with H.264 or a renamed extension.

After muxing, output is reopened and checked for HEVC `hvc1`, AAC, expected display dimensions, 60 FPS packet cadence, nonempty tracks, and preserved relative audio/video start/end timing within 120 ms (AAC priming/frame rounding). Safari must report codec decoding support and load the first video frame before download is enabled. These checks detect structural failures; they do **not** prove perceptual lip sync or complete playback on every device.

## Safari limits and supported input

- Requires HTTPS, WebCodecs HEVC encoding at the selected dimensions/frame rate, and a decoder for the input video. Feature availability varies with Safari/iOS version and hardware. Playback of HEVC alone does not imply encoding support. Capability probes run on every conversion, and real encoder failures are reported.
- Intended input: single-track H.264 or HEVC video with AAC-LC audio in MOV/MP4. Other demuxable formats/codecs work only when their decoders and the required AAC encoder are available. PCM MOV audio depends on library/browser decoding and AAC encoding. Protected media, ProRes and other unsupported inputs are not promised.
- Limits: 60 seconds, 150 MiB compressed input, source resolution at most 4096×2160 pixels. These reduce memory risk, but iOS can still terminate a tab under pressure. Try shorter clips and close other tabs if needed.
- Encoded MP4 is buffered in RAM and copied into a Blob/File for sharing. This is not constant memory or an unlimited-length converter. No whole-file PCM allocation is made. MP4 metadata is written at the end to avoid a second in-memory fast-start media buffer; downloaded local MP4 remains seekable.
- Keep Safari visible while processing; background tabs may pause or lose hardware codecs. Cancel releases conversion resources. New uploads revoke old Blob URLs, clear old downloads, and cannot replace a source during conversion.
- HDR/Dolby Vision metadata preservation and faithful HDR-to-SDR tone mapping are not guaranteed. Use native software for color-critical/HDR work.
- Save to Photos and Save to Files open the iOS Share Sheet when file sharing is supported. Select **Save Video** or **Save to Files**. Safari controls available actions; a website cannot force a Photos destination. Download remains the fallback where file sharing is unavailable.
- TikTok may recompress or change frame rate independently.

## When browser encoding is unavailable

There is no automatic server fallback: Cloudflare Pages serves static files and cannot run native FFmpeg transcoding. The app stops with an actionable error and never exports a silent or mislabeled substitute. Use a native editor or FFmpeg on a computer, for example:

```sh
ffmpeg -i input.MOV -map 0:v:0 -map 0:a:0 \
  -vf "scale=w='if(gte(iw,ih),1920,1080)':h='if(gte(iw,ih),1080,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=60" \
  -c:v libx265 -crf 23 -tag:v hvc1 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart output.mp4
```

This fallback deliberately requires an audio track. An automatic backend would require a separately provisioned media service, upload consent, storage and credentials; none are configured here.

## Development and verification

```sh
npm ci
npm test
npm run build
```

Serve the repository over HTTP locally or HTTPS on Pages. `app.js` is a committed self-contained browser bundle, so production needs no CDN or build step. Keep it updated with `npm run build`; third-party license is in `vendor/mediabunny-LICENSE`.

Tests cover geometry, duration limits, timestamp offset/drift guards, malformed/oversized input, and a real FFmpeg-generated HEVC/AAC MOV demux/remux. FFprobe independently verifies MP4 codecs and 60 FPS, and compressed audio hashes verify unchanged AAC packets. FFmpeg integration tests skip only if FFmpeg is absent. CI installs FFmpeg and checks bundle reproducibility.

**Still requires physical iPhone testing:** the reported 23.6 MB MOV (not supplied here), full HEVC hardware encode, non-AAC-to-AAC encode, visible portrait orientation, audible sync throughout the clip, peak RAM/thermal behavior, cancellation/background transitions, and Share Sheet saving to Photos/Files. Automated remux tests are not a substitute for testing Safari's encoder.

## Cloudflare Pages

Keep the existing GitHub integration, framework preset **None**, build command empty, output directory `/`, production branch `main`. The committed bundle is deployable as-is. A push to `main` triggers deployment when that integration is configured; deployment success must be checked in Cloudflare.
