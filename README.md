# plus+ TikTok HD Studio v2.0 — Personal Edition

Production: **https://plus-tiktok-hd-studio.pages.dev/**

A free, mobile-first, local video studio for preparing MOV/MP4 footage with HEVC H.265 video and AAC audio. No login, subscription, advertising, watermarks, daily quota, analytics or video uploads. Processing runs on your device.

## Working engine checkpoint

The user confirmed physical-iPhone audio/video success for `db4a581a3ae41afd8b7cfea08029f14365be2314`. It is preserved as the remote annotated tag **`v1.3-iphone-checkpoint`** before the v2 changes.

V2 retains Mediabunny 1.66.0, Blob range reads, demuxing, the existing AAC copy/transcode decision, HEVC WebCodecs encoding, contain fitting, baked orientation, MP4 muxing, timestamp validation, decoder checks, cancellation and Share Sheet/download behavior. Changes to the engine are limited to passing selected output settings, adapting cadence validation, removing fixed input caps, and returning measured output metadata. The default remains **1080p / 60 FPS / 8.5 Mbps**, matching the working version.

## Studio workflow

1. Choose a MOV or MP4 from Photos/Files, or drop it on the desktop upload area.
2. Inspect the original preview, filename, display resolution, duration, size and audio metadata. FPS is a measured **average** from packet metadata, not an invented constant rate. Unreadable metadata is shown as unavailable.
3. Set resolution, frame timing and bitrate. The selected HEVC encoder configuration is probed before Process is enabled. Source decoder and audio support are rechecked during processing.
4. Watch measurable conversion progress, validation/playback stages and elapsed time. Cancel stops the conversion; uploads/settings are locked while processing.
5. Review the actual result, audio, measured FPS, processing time and honest size comparison. Save using the iOS Share Sheet or download the MP4. Process Another Video releases the old previews and output URLs.

## Implemented output settings

| Setting | Behavior |
| --- | --- |
| Original resolution | Uses orientation-adjusted display size, rounded to even pixels for HEVC. |
| 1080p HD | Fits within 1920×1080 landscape or 1080×1920 portrait. |
| 4K UHD | Fits within 3840×2160 landscape or 2160×3840 portrait. Requires an encoder that accepts the selected size/rate/bitrate. |
| Original FPS / timing | Omits frame-rate resampling and retains source timing, including variable frame rate. Result FPS is labeled as an average. |
| 30 / 60 FPS | Uses the existing conversion pipeline's frame-rate resampling. Output packet cadence is validated against the selected rate. |
| Automatic bitrate | Starts from the tested 8.5 Mbps at 1080p60, scales with output pixel count, and uses 70% of that rate for 30 FPS (2 Mbps minimum). |
| High quality | Targets 1.5× automatic bitrate. Larger files are possible. |
| Custom bitrate | Passes a 1–100 Mbps video bitrate target to the HEVC encoder. Hardware may produce a different actual average. Unsupported configurations are blocked. |

All sizes use contain fitting to preserve aspect ratio without cropping/stretching. Upscaling adds pixels, **not genuine image detail**. Repeating frames for higher FPS does **not** create new motion detail. HEVC is the only output video codec; there is no hidden H.264 substitution or extension renaming.

## Audio and validation

The pinned, bundled Mediabunny library demuxes container samples. It never passes MOV/MP4 container bytes to `decodeAudioData()`.

- Compatible AAC-LC (`mp4a.40.2`) is copied as compressed packets whenever possible, preserving sound without unnecessary re-encoding or an AAC encoder requirement.
- Other supported audio is decoded and encoded to stereo 48 kHz AAC, requiring an available decoder and AAC encoder. Unavailable audio support stops export.
- One video track and one audio track are required. Silent and multi-track files are explicitly rejected rather than losing audio or choosing an unexpected track.
- The output is reopened and verified as HEVC `hvc1` + AAC with expected dimensions, valid timestamps, nonempty tracks and preserved relative audio/video start/end timing within 120 ms (AAC priming/frame rounding).
- Fixed-FPS output is checked for packet cadence. Original timing is not forced to a constant rate.
- Browser decoder support and loading of the first output video frame must pass before saving is offered. These structural checks do not prove perceptual lip sync or complete playback on every device.

## Practical Safari limits

No fixed input file-size, duration or daily processing quota is imposed. **Unlimited file selection does not mean unlimited device resources.** The conversion pipeline retains backpressure and sample cleanup, but the compressed MP4 is buffered in RAM and copied into a Blob/File for preview/sharing. Timestamp metadata also uses memory. Large, long, 4K or high-bitrate clips can exhaust Safari's resources or terminate the tab. Use shorter clips/lower settings and close other tabs if necessary.

HTTPS and a working WebCodecs HEVC encoder are required. A browser that plays HEVC may still be unable to encode it. Capability probes use the selected configuration, while actual decoder/encoder failures remain possible during conversion. Keep Safari visible; backgrounding can pause or lose hardware codecs. Cancellation and page hiding abort active conversion; superseded metadata reads are disposed and Blob URLs are revoked when replaced.

Intended input is H.264/HEVC + AAC in MOV/MP4. Other audio codecs (including PCM MOV) depend on decoding and AAC encoding availability. ProRes, protected media and unsupported codecs are not promised. HDR/Dolby Vision preservation and faithful HDR-to-SDR tone mapping are not guaranteed; use native software for color-critical HDR work.

**Save to Photos** opens the Share Sheet: the user must choose **Save Video** if iOS offers it. **Save to Files / Download MP4** uses file sharing where supported, with a direct-download fallback elsewhere or after a sharing failure. A website cannot force the Photos destination. TikTok can recompress output or change resolution/FPS/bitrate; enable HD/high-quality upload when available and review before posting.

## Native fallback

No personal video is sent to an external service. Cloudflare Pages serves static files and cannot perform native FFmpeg transcoding. When browser encoding is unavailable, the app stops explicitly; use a native editor or FFmpeg on a computer:

```sh
ffmpeg -i input.MOV -map 0:v:0 -map 0:a:0 \
  -vf "scale=w='if(gte(iw,ih),1920,1080)':h='if(gte(iw,ih),1080,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=60" \
  -c:v libx265 -crf 23 -tag:v hvc1 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart output.mp4
```

The command requires an audio track. It is a manual alternative, not an automatic backend.

## Development and QA

```sh
npm ci
npm test
npm run build
```

The committed `app.js` bundles production dependencies locally; no CDN, external fonts, images, analytics or runtime API is required. `styles.css` contains the responsive dark interface, touch targets, safe-area padding and reduced-motion rules. The library license is in `vendor/mediabunny-LICENSE`.

Tests cover:

- Geometry, 4K/original/1080 sizing, 30/60/original timing configuration, bitrate validation, and the tested default configuration.
- Timeline offset/drift guards and invalid duration/container rejection.
- A real FFmpeg-generated HEVC/AAC MOV with delayed audio, demux/remux, independent FFprobe codec/FPS checks and identical compressed AAC hashes. Silent/multiple-audio sources fail explicitly.
- DOM UI tests for upload metadata, unavailable metadata, settings propagation, unsupported configurations, duplicate processing, cancellation, stale uploads, export failure, results, output cleanup and Photos/Files sharing with direct-download recovery. These tests mock browser encoding/sharing and do not emulate Safari.

CI installs FFmpeg, runs tests/build and checks the committed bundle is reproducible. The integration test skips only if FFmpeg is absent.

### Physical iPhone follow-up

The earlier engine success was reported by the user. This redesign has not been physically tested on an iPhone. Repeat the known working MOV at the default settings, then check:

- The new upload/settings/results layout at iPhone sizes, VoiceOver, safe areas and reduced motion.
- Original timing (including variable-FPS MOV), 30 FPS, 4K and custom-bitrate hardware encoding.
- Orientation, full-clip audible sync, AAC preservation and non-AAC transcoding.
- Memory/temperature behavior with larger and longer inputs now that fixed caps are removed.
- Cancel, background/foreground transitions, repeat uploads and repeated conversions.
- Both Share Sheet buttons, Save Video to Photos, Save to Files and playback of saved MP4s.

The DOM tests and FFmpeg remux checks do not substitute for a browser layout check or actual Safari hardware encoding.

## Deployment

Keep the **existing** Cloudflare Pages project and production URL. Framework preset **None**, build command empty, output directory `/`, production branch `main`. The committed bundle is deployable as-is. A push to `main` triggers the connected Pages deployment; no new project, hosting migration or account system is needed.
