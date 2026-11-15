# plus+ TikTok HD Studio v2.2 — Personal Edition

Production: **https://plus-tiktok-hd-studio.pages.dev/**

A free, mobile-first, local video studio for preparing MOV/MP4 footage with HEVC H.265 video and AAC audio. No login, subscription, advertising, watermarks, daily quota, analytics or video uploads. Processing runs on your device.

## Working engine checkpoint

The user confirmed physical-iPhone audio/video success for `db4a581a3ae41afd8b7cfea08029f14365be2314`. It is preserved as the remote annotated tag **`v1.3-iphone-checkpoint`** before the v2 changes.

The working v2.1 commit `38aa5db88a525283004902e7c43de6d0d1f66a74` is checkpointed as **`v2.1-checkpoint`** before this release.

V2.2 retains Mediabunny **1.66.0** and the existing HEVC/AAC conversion pipeline. It adds a separate verified encoded-packet copy path. Default for HEVC input: **Original Quality — No Re-encode / Smart Copy**. Ineligible input is blocked in that mode, not silently encoded. H.264 defaults to explicitly lossy **HEVC Conversion**. **Custom Encoding** exposes deliberate size/FPS/bitrate changes. The v2.1 Preserve Original Size bitrate mode and the previously tested 1080p60 Automatic configuration remain available in encoding modes.

## Smart Copy and actual HDR support

The implementation uses supported Mediabunny `EncodedPacketSink`, `EncodedVideoPacketSource`, `EncodedAudioPacketSource`, `InputVideoTrack.getDecoderConfig()`, `getColorSpace()`, `getTransformationMatrix()`, `Output` and `Mp4OutputFormat` APIs. Packets are fed in each track's original decode order with original presentation timestamps and durations, using writer backpressure and track interleaving. It does not merely remove `forceTranscode`: **no encoder/decoder source is constructed in the copy path**. Encoding modes retain `forceTranscode: true` intentionally.

Supported copy inputs have one **hvc1 HEVC** video sample description and one **AAC-LC** audio track in a non-fragmented MOV/MP4:

| Source | Behavior |
| --- | --- |
| SDR HEVC | Original video/AAC samples copied; SHA-256, timing, orientation and configuration verified. |
| HLG HEVC | HDR preservation claimed only with complete BT.2020 / HLG / BT.2020 nonconstant matrix / range signaling and at least 10-bit HEVC, retained codec configuration, verified output nclx and identical packets. |
| HDR10 HEVC | Same checks for BT.2020 / PQ, plus detected mastering-display SEI. Retained mastering/content-light SEI is independently checked by FFprobe in tests. |
| PQ without detected mastering metadata | Can copy the original bits if other checks pass, but shows **HDR not verified**, not full HDR10 preservation. Required HDR mode blocks this case. |
| Unknown color metadata | Shows **Unknown**. HEVC alone never implies HDR. Eligible copying preserves the samples/configuration but makes no HDR preservation claim. |
| Dolby Vision | **Unsupported / blocked**: `dvcC`, `dvvC`, `dvwC`, DV sample entries or RPU/reserved enhancement NALs are detected, but full configuration/RPU/EL semantics and playback cannot be validated. Nothing is synthesized. |
| hev1, multiple sample descriptions, fragmented input, ICC color profiles, interlaced/unknown sample-entry extensions | Blocked in Smart Copy because complete remux semantics have not been validated. |
| Separate `mdcv` / `clli` container boxes | Detected and blocked; this library does not write them. HDR10 **bitstream SEI** is supported; equivalent container-box retention is not claimed. |
| Dynamic registered-user-data HDR SEI (including possible HDR10+) | Blocked because its complete metadata semantics are not validated. |
| Non-AAC-LC audio | Smart Copy stops explicitly. **Audio-only transcoding is not implemented in Smart Copy.** Existing encoding modes can transcode supported SDR input audio to 48 kHz stereo AAC. Audio is never discarded. |

The range reader inspects structured ISO BMFF sample entries, not arbitrary text matches inside media bytes. It inspects `hvcC` profile/depth/parameter sets, `colr` nclx/nclc, relevant unsupported boxes, and HEVC SEI/RPU NALs in configuration and samples. Unspecified container color fields may be resolved from retained SPS VUI through Mediabunny's public color API; actual output nclx is then checked against that semantic source color. Unknown properties remain Unknown. Progressive `fiel` is allowed: dropping this redundant QuickTime box does not change the progressive SPS/bitstream; other field-order metadata is blocked.

**HDR re-encoding is unavailable.** Auto never silently converts detected HDR, Dolby Vision, 10-bit or unknown-depth material to SDR. HDR Preservation Required permits only supported, verified HDR Smart Copy. SDR Output is disabled because there is no validated color-managed tone mapper or complete 10-bit HDR encoding/metadata pipeline. Unknown-color 8-bit SDR-capable sources may use the existing lossy conversion path with HDR status explicitly unverified.

### What No Re-encode actually verifies

Before results are exposed, the MP4 is reopened and checked for:

- HEVC profile/codec string and **byte-identical hvcC** (including bit-depth/parameter-set information).
- Original coded/display dimensions, aspect ratio and complete transformation matrix. Supported track names, ISO language codes and dispositions are forwarded too; arbitrary MOV metadata is not a byte-for-byte container copy.
- Identical video and AAC **per-packet SHA-256**, counts, decode ordering and key/delta flags (GOP structure).
- Every packet's presentation timestamp against a common source/output offset across both tracks (100 µs tolerance), plus duration (2 ms tolerance). This verifies cadence and A/V sync, not just endpoints.
- Original AAC decoder configuration, sample rate and channels.
- Source color characteristics, required output HDR nclx fields, and retained mastering/content-light SEI sets. Full packet/configuration hashes also protect embedded HDR SEI bytes.

Different MP4 timing tables may legitimately represent reorder/timing differently. If this writer cannot retain the verified presentation durations/cadence for a particular source, **export stops** rather than weakening the claim. A VFR + B-frame fixture exposed a last-sample duration change and is explicitly tested as a rejection; VFR without that ambiguity and rotated MOVs are tested as successful copies.

Smart Copy size estimates use original compressed media bytes plus approximate MP4 overhead. Original/actual size and difference are shown. MOV metadata, free space and remux overhead can change file size without changing encoded quality; equal file size is never proof or a requirement. There is no padding, bitrate inflation or guaranteed TikTok playback/compression bypass.

## Studio workflow

1. Choose a MOV or MP4 from Photos/Files, or drop it on the desktop upload area.
2. Inspect the original preview, filename, display resolution, duration, size and audio metadata. FPS is a measured **average** from packet metadata, not an invented constant rate. Unreadable metadata is shown as unavailable.
3. Review the detected codec/HDR metadata and processing mode. Smart Copy locks size/FPS/bitrate changes. Choose HEVC Conversion or Custom Encoding for explicit lossy changes, including the existing Preserve Original Size / Automatic / High quality / Custom bitrate options. Encoder probes run only for encoding modes.
4. Watch measurable conversion progress, validation/playback stages and elapsed time. Cancel stops the conversion; uploads/settings are locked while processing.
5. Review the actual result, audio, measured FPS, processing time and honest size comparison. Save using the iOS Share Sheet or download the MP4. Process Another Video releases the old previews and output URLs.

## Encoding-mode output settings

| Setting | Behavior |
| --- | --- |
| Preserve Original Size (default quality mode) | Measures video/audio sample bytes and durations; budgets a HEVC bitrate toward the original file size after reserving AAC audio and estimated MP4 headers. Aims within ±5–10% when feasible; actual size is shown even if the target is missed. |
| Original resolution (default) | Uses orientation-adjusted display size, rounded to even pixels for HEVC. |
| 1080p HD | Fits within 1920×1080 landscape or 1080×1920 portrait. |
| 4K UHD | Fits within 3840×2160 landscape or 2160×3840 portrait. Requires an encoder that accepts the selected size/rate/bitrate. |
| Original FPS / timing (default) | Omits frame-rate resampling and retains source timing, including variable frame rate. Result FPS is labeled as an average. |
| 30 / 60 FPS | Uses the existing conversion pipeline's frame-rate resampling. Output packet cadence is validated against the selected rate. |
| Automatic bitrate | Starts from the tested 8.5 Mbps at 1080p60, scales with output pixel count, and uses 70% of that rate for 30 FPS (2 Mbps minimum). |
| High quality | Targets 1.5× automatic bitrate. Larger files are possible. |
| Custom bitrate | Passes a 1–100 Mbps video bitrate target to the HEVC encoder. Hardware may produce a different actual average. Unsupported configurations are blocked. |

Encoding modes use contain fitting to preserve aspect ratio without cropping/stretching. Upscaling adds pixels, **not genuine image detail**. Repeating frames for higher FPS does **not** create new motion detail. HEVC is the only output video codec; there is no hidden H.264 substitution or extension renaming.

## Preserve Original Size calculation (encoding modes only)

Source analysis scans **packet metadata**, counting compressed bytes and packets and measuring each track's timestamp span. It reports total file size/duration, display resolution, average FPS, and video/audio bitrates (`track bytes × 8 / track duration`). It does not infer video bitrate from the entire container or allocate decoded media for analysis. FFprobe independently checks the measured byte counts in tests.

The model uses:

```text
output audio bytes = original AAC-LC bytes, or 160000 × audio duration / 8 for transcoding
estimated MP4 overhead = 4096 + output video packet count × 20 + source audio packet count × 12
video bitrate budget = (original file size − output audio bytes − estimated overhead) × 8 / video duration
HEVC target bitrate = min(video bitrate budget, measured original video bitrate × 1.10)
estimated output size = HEVC target bitrate × video duration / 8 + output audio bytes + estimated overhead
```

The header allowance is a prediction, **not bytes written as padding**. Explicit FPS selections adjust the estimated packet count. The 110% media-rate ceiling avoids inflating bitrate solely to replace large metadata/free boxes in the original container; the interface explains when the estimate is consequently smaller. Small files with insufficient audio/header budget or unavailable bitrate metadata receive an explicit error and can use another mode. Low-bitrate media is not forced to the Custom mode's 1 Mbps minimum.

No resolution, FPS, audio quality setting or second-pass quality reduction is silently applied to meet a size target. Original timing is the default and adds no frames. Explicit 30/60 FPS options retain their documented v2.0 resampling behavior; no duplicate frames are introduced **for size matching**. Compatible AAC handling is unchanged.

The estimate cannot guarantee a ±5–10% outcome or equal perceptual quality: hardware HEVC rate control, scene complexity, AAC priming, edit lists and real mux overhead vary. The actual MP4 size and percentage difference are always shown, including an explicit outside-±10% message when needed. There is no automatic bitrate retry, padding, fake output-size reporting or guaranteed TikTok compression bypass.

## Audio and validation

The pinned, bundled Mediabunny library demuxes container samples. It never passes MOV/MP4 container bytes to `decodeAudioData()`.

- Compatible AAC-LC (`mp4a.40.2`) is copied as compressed packets whenever possible. Copied AAC payloads are now hash-verified in both Smart Copy and conversion output before original-packet labeling.
- In encoding modes, other supported audio is decoded and encoded to stereo 48 kHz AAC, requiring an available decoder and AAC encoder. Unavailable audio support stops export.
- One video track and one audio track are required. Silent and multi-track files are explicitly rejected rather than losing audio or choosing an unexpected track.
- In encoding modes, the output is reopened and verified as HEVC `hvc1` + AAC with expected dimensions, valid timestamps, nonempty tracks and preserved relative audio/video start/end timing within 120 ms (AAC priming/frame rounding).
- Fixed-FPS output is checked for packet cadence. Original timing is not forced to a constant rate.
- Browser decoder support and loading of the first output video frame must pass before saving is offered. These structural checks do not prove perceptual lip sync or complete playback on every device.

## Practical Safari limits

No fixed input file-size, duration or daily processing quota is imposed. **Unlimited file selection does not mean unlimited device resources.** The conversion pipeline retains backpressure and sample cleanup, but the compressed MP4 is buffered in RAM and copied into a Blob/File for preview/sharing. After muxing, standard fast-start finalization places moov before media using Blob slices and metadata-only offset updates; unsupported layouts retain the original MP4 with a visible notice. This improves progressive access, not guaranteed TikTok rendition quality. Timestamp metadata also uses memory. Large, long, 4K or high-bitrate clips can exhaust Safari's resources or terminate the tab. Use shorter clips/lower settings and close other tabs if necessary.

Smart Copy requires HTTPS/Web Crypto SHA-256 and supported HEVC/AAC playback, **not an HEVC encoder**. The app loads a first-frame preview after copying as a playback check; processing itself does not decode frames. Encoding modes require a working WebCodecs HEVC encoder. A browser that plays HEVC may still be unable to encode it. Capability probes use the selected configuration, while actual decoder/encoder failures remain possible during conversion. Keep Safari visible; backgrounding can pause or lose hardware codecs. Cancellation and page hiding abort active conversion; superseded metadata reads are disposed and Blob URLs are revoked when replaced.

Intended input is H.264/HEVC + AAC in MOV/MP4. Other audio codecs (including PCM MOV) depend on decoding and AAC encoding availability. ProRes, protected media and unsupported codecs are not promised. HDR support is limited to the verified copy cases above. Dolby Vision, HDR re-encoding and SDR tone mapping are blocked; use specialist native software for unsupported HDR/DV workflows.

**Save to Photos** opens the Share Sheet: the user must choose **Save Video** if iOS offers it. **Save to Files / Download MP4** uses file sharing where supported, with a direct-download fallback elsewhere or after a sharing failure. A website cannot force the Photos destination. TikTok can recompress output or change resolution/FPS/bitrate; enable HD/high-quality upload when available and review before posting.

## Native fallback

No personal video is sent to an external service. Cloudflare Pages serves static files and cannot perform native FFmpeg transcoding. When browser encoding is unavailable, the app stops explicitly; use a native editor or FFmpeg on a computer. This **lossy SDR-only** example must not be used as an HDR/Dolby Vision preservation workflow:

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

- Real SDR, HLG and HDR10 in both MOV and MP4 Smart Copy through the application entry point, independently verified by FFprobe packet/extradata hashes, profile/depth/color checks, timestamps, common A/V offsets and HDR10 mastering/content-light side data.
- VFR/rotation copying, a VFR/B-frame timing mismatch rejection, real H.264 routing, real PCM audio rejection, payload-tamper detection, repeated conversions and cancellation during copy/verification.
- Missing HDR metadata, PQ without static mastering metadata, unsupported HDR re-encoding/tone mapping, ICC/hev1/unsupported boxes, and synthetic Dolby Vision configuration/RPU rejection. **No real Dolby Vision preservation fixture was available; no DV support is claimed.**
- Original size/timing/dimensions, HEVC size budgets, AAC byte reservation, transcoded audio budgets, metadata-heavy/tiny/low-bitrate inputs, honest size misses, and alternative bitrate modes.
- Geometry, 4K/original/1080 sizing, 30/60/original timing configuration, bitrate validation, and the former tested 1080p60 configuration.
- Timeline offset/drift guards and invalid duration/container rejection.
- A real FFmpeg-generated HEVC/AAC MOV with delayed audio, demux/remux, independent FFprobe codec/FPS checks and identical compressed AAC hashes. Silent/multiple-audio sources fail explicitly.
- DOM UI tests for upload metadata, unavailable metadata, settings propagation, unsupported configurations, duplicate processing, cancellation, stale uploads, export failure, results, output cleanup and Photos/Files sharing with direct-download recovery. These tests mock browser encoding/sharing and do not emulate Safari.

CI installs FFmpeg, runs tests/build and checks the committed bundle is reproducible. The integration test skips only if FFmpeg is absent.

### Physical iPhone follow-up

The earlier engine success and v2.1 size deviation were reported by the user. V2.2 Smart Copy has not been physically tested on an iPhone. Repeat the reported 27.5 MB clip with Smart Copy, plus the former encoding settings, and check:

- Actual iPhone SDR/HLG/HDR10 MOV sample descriptions, metadata eligibility and any explicit rejection reasons. Dolby Vision clips should stop with an unsupported message.
- HDR display behavior in Photos/Safari, full-clip sync, keyframe seeking and saved-file playback.
- The new upload/settings/results layout at iPhone sizes, VoiceOver, safe areas and reduced motion.
- Preserve Original Size rate control and actual size deviation across short/long, low/high-bitrate and variable-FPS iPhone MOV files.
- Original timing (including variable-FPS MOV), 30 FPS, 4K and custom-bitrate hardware encoding.
- Orientation, full-clip audible sync, AAC preservation and non-AAC transcoding.
- Memory/temperature behavior with larger and longer inputs now that fixed caps are removed.
- Cancel, background/foreground transitions, repeat uploads and repeated conversions.
- Both Share Sheet buttons, Save Video to Photos, Save to Files and playback of saved MP4s.

The DOM tests and synthetic FFmpeg-generated media do not substitute for a browser layout check, real iPhone HDR/DV capture or actual Safari hardware encoding. No licensed/authentic Dolby Vision fixture was supplied.

## Deployment

Keep the **existing** Cloudflare Pages project and production URL. Framework preset **None**, build command empty, output directory `/`, production branch `main`. The committed bundle is deployable as-is. A push to `main` triggers the connected Pages deployment; no new project, hosting migration or account system is needed.

## KilatFrame comparison and standard MP4 finalization

See [the evidence-based investigation](docs/kilatframe-investigation-2026-11-15.md) for confirmed public implementation differences, confidence levels, official sources and the unresolved 576p/1080p report. No third-party code/assets are included. The only media-layout change is standard front-index MP4 finalization, with the full packet/HDR validation performed afterward. It adds no samples or padding, preserves exact muxed byte length and uses Blob slices rather than another full media buffer. It is not a TikTok compression bypass. Physical iPhone and controlled TikTok upload comparisons remain outstanding.

## Optional experimental MP4 compatibility

Checkpoint: remote tag **`pre-experimental-mp4-compatibility`** preserves the working version before this experiment.

**TikTok MP4 Compatibility — Experimental** is opt-in; Smart Copy remains the HEVC default. It uses the same verified HEVC/AAC packet-copy and HDR restrictions, locks encoding settings and adds no audio samples or tracks. Its independent container pass writes front-loaded indexing with standard 64-bit `co64` chunk offsets. Converting `stco` adds four actual index bytes per chunk; media payloads, timestamps, orientation and unrelated metadata remain unchanged. This is not padding or bitrate inflation. The benefit for TikTok is **unproven**; standard Smart Copy already has a front-loaded index. Unexpected layouts stop explicitly. Physical iPhone playback, sharing, resource use and TikTok rendition comparisons remain untested for this mode.

See [the actual HIDZZ archive investigation](docs/hidzz-investigation-2026-11-15.md) for file hashes, confirmed audio/container changes, an offline FFprobe comparison, private request flags and their limitations. Its duplicate audio tracks, generated AAC tails, fake request FPS and upload hooks are **not** implemented. No TikTok requests or credentials are accessed by this website. The optional mode is a validated container experiment, not a claim of bypassing compression.

Additional regression tests compare Smart Copy and experimental outputs against original SDR/HLG/HDR10 MOV/MP4 using FFprobe packet/configuration/timestamp checks. Delayed mono/stereo AAC at 32/44.1/48 kHz also has independently decoded PCM hash checks. Unit tests cover co64 addressing, exact metadata growth, cancellation and malformed layouts; UI tests cover opt-in routing and reset to Smart Copy.

## Offline A/B investigation (no production changes)

The user reports that the co64 experiment still receives 576p on TikTok. See [the follow-up comparison and measured hypotheses](docs/offline-mp4-ab-investigation.md). The desktop-only [A/B harness](tools/README.md) compares current Smart Copy, audio-table reconstruction, and alternate interleaving/common movie-clock representation. All preserve original HEVC/AAC packets and audio timeline; none adds generated audio or upload hooks. The new measurements identify small video-clock quantization in the existing muxer, without establishing a TikTok-quality cause. No further posting test or production mode is recommended yet.

The [Variant D follow-up](docs/offline-d-timing-investigation.md) preserves original source video clocks/tables and AAC edit/priming boxes exactly on eligible sample layouts. Five offline fixtures include a 13-second clip, HLG/HDR10, explicit AAC priming and VFR. D eliminates measured timing quantization; all A/B/C/D outputs still decode and seek identically in native tests. This remains research-only, with no production integration or TikTok-quality claim.
