# KilatFrame / plus+ Studio investigation — 15 November 2026

## Finding and scope

**A meaningful container difference is confirmed. Its responsibility for the reported TikTok 576p versus 1080p outcome is not confirmed.** KilatFrame's currently served default HQ HEVC-copy route rebuilds MP4 tables and appends generated AAC samples. The plus+ v2.2 Smart Copy route preserves and verifies every original video/AAC packet and does not append media. The original v2.2 file also had a trailing movie index, whereas the reference's current HQ path places its index first.

The user reports both exports display 1080×1920, approximately 59.98 FPS, HEVC, 28.9 MB and 13 seconds in Photos. They confirmed the same upload route/account/privacy controls after being asked about Files selection. They report plus+ offers 576p while KilatFrame offers 1080p. Comparison delay, exact playback environment, upload responses and rendition manifests remain unavailable. These are **user observations, not independently captured TikTok responses**. A visible 1080p rendition does not establish that TikTok retained the uploaded bitstream without recompression.

No original video, exact pair of exported files, TikTok post URLs, upload request trace, or served renditions were supplied. Consequently this investigation cannot hash the user's pair, establish which historical KilatFrame build/preset made it, or determine TikTok's actual ingest/rendition decision. Matching Photos summaries cannot resolve those questions.

Inspection was limited to publicly served HTML, explicitly referenced scripts, an explicitly linked public demo, our repository and public primary documentation. No login, account/PRO checks, quota-consuming processing call, authentication bypass, payment flow or TikTok post was performed. No third-party source, proprietary algorithm, media, branding or assets are included in this repository. No live browser/network session was available: HTTP resource responses and statically identifiable request sites were examined, not a complete execution trace.

Confidence: **High** = directly read code/resource or reproducible local test; **Medium** = sound compatibility inference with missing case-specific evidence; **Low/unknown** = proposed explanation without a controlled TikTok experiment.

## Evidence inventory

Accessed on 2026-11-15 UTC. Digests identify the inspected version; public resources can change. Third-party material was retained only in the temporary research workspace for inspection, not redistributed here.

| Resource | Evidence |
| --- | --- |
| [KilatFrame page](https://kilatframe.pages.dev/) | HTTP 200; HTML SHA-256 `cb60e59a479b05270fea988c3601aac6c1d233de4c89b962a8411644c0d01536`. Two inline script blocks; principal inline script SHA-256 `c6c4ffa0eebbfeaa8a8eb06468f4f095768780f18db3ae06ef154a6f72e85afb`. |
| [Explicit CDN dependency](https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js) | HTTP 200; SHA-256 `bba88082053511b898c921e71a865478821a674d779ba0c7028c78c921fecaf6`. |
| [Public after-comparison video](https://kilatframe.pages.dev/banding/1-kilat.mp4) | 2,740,039 bytes; SHA-256 `0a4cc691cf791af264a43dffd7bed37c0cc85fd5eea9148088eb1c52756bc6a2`. FFprobe: 720×900 H.264 High / avc1, 8-bit BT.709 limited range, 30 FPS, 9 seconds, no audio. Top-level boxes: ftyp, moov, free, mdat. **A marketing demo, not proof of current HQ processing or the user's file.** |
| [plus+ production bundle](https://plus-tiktok-hd-studio.pages.dev/app.js) before this patch | SHA-256 `3424ffa2cccef60df318dbfb3674298cfd50ff9b0ccafeb704806c9ac3156a63`, exactly matching `app.js` at baseline `a657283703c12c65b423dc0487d733f63168f81d`. Response was `public, max-age=0, must-revalidate`. No current server-side stale-bundle mismatch observed; the user's earlier client cache state is unknown. |
| plus+ baseline source | `src/smart-copy.js`, `src/converter.js`, `src/hdr.js`, `src/video-metadata.js`, `src/modes.js`; Mediabunny 1.66.0. |

## Confirmed reference behavior and comparison

The following describe the inspected public client code, not an authorized end-to-end run behind its account/quota checks. In particular, code existence does not prove a legacy branch is currently reachable in the visible UI or was used for the user's export.

| Area | KilatFrame public implementation | plus+ v2.2 baseline | Confidence |
| --- | --- | --- | --- |
| Libraries | Custom JS ISO BMFF parser/remuxer; WebCodecs conversion; mp4-muxer 5.1.3 for the initial encoding output. No FFmpeg WASM loader, wasm binary request, or Mediabunny dependency was found in the inspected resources. A literal FFmpeg service-name string in its transport-stream writer is not evidence of FFmpeg execution. | Mediabunny 1.66.0 for parsing, encoded packet sources, muxing and conversion. | High for inspected code; absence claims bounded to those resources. |
| HEVC selection | Initial configuration selects HQ. HEVC/HDR copy routing preserves original size and timing rather than entering the encoder. A plain remux option also exists. | Smart Copy for HEVC; unsupported variants blocked instead of silently re-encoding. H.264 uses explicit HEVC conversion. | High |
| Video payload | HQ/plain remux assembles Blob slices at original sample offsets; no video encode is invoked on that path. No sample hash-comparison validation was found there. | Source/output packet SHA-256, count, ordering, key flags, timestamps, duration and hvcC are verified before No Re-encode labeling. | High |
| Sample entry / hvcC | Custom copy muxer forwards the original video sample-entry bytes, including hvc1/hev1 type and nested boxes. Its parser derives codec/profile from hvcC. | hvc1 only for validated Smart Copy; byte-identical hvcC required; hev1 rejected. | High |
| HDR / Dolby Vision | Reads colr, with an SPS VUI fallback. Forwarding the entire video entry can retain boxes our writer does not support. This is not independent validation of full Dolby Vision retention, RPU/EL semantics or playback. | Supported HLG/HDR10 copy metadata is checked; unsupported boxes, DV, dynamic HDR user data and incomplete required-HDR cases stop. | High implementation difference; DV preservation unproven. |
| HQ audio | With audio present, current HQ1 branch retains original AAC media, extends the audio tables by **four generated samples**, appends 60 bytes of sample data in another mdat, and emits roll sample-group metadata. It is not an exact copy of the complete original audio sample sequence. The visible one-audio-track description can still be true. | Exactly one AAC-LC track with original sample count, hashes and timing. No generated tail samples or synthetic roll groups. | High static-code observation; user's exact output unknown. |
| Other audio/layout branches | Writer also contains a different HQ variant with a second audio description/tail selection and a duplicated audio track; other branches construct decoy samples/tracks. These must not be conflated with the currently selected HQ1 route. | No decoy tracks, duplicated audio descriptions or synthetic samples. | High existence; current reachability/use unknown. |
| Box placement / brands | Current HQ1 builds a front moov, free boxes, media data and a small additional audio mdat; normal movie duration. Plain uses a conventional front-index remux. Some legacy alternatives use unknown duration or QuickTime branding/tail index. | Original factory output uses `fastStart:false`: index follows media. Normal MP4 branding/duration; no intentional unknown-duration patch. | High |
| MP4 tables / timing | Reads/rebuilds stts, ctts, stss, stsc, stsz and stco/co64; copies original durations and composition offsets, with edit-list logic. HQ1 adds audio-tail timing. Some alternative presets rewrite movie duration to unknown. | Mediabunny reconstructs tables from packet timing; strict shared-offset/cadence/duration validation rejects mismatches, including a known VFR/B-frame tail-duration case. | High |
| Rotation / aspect | Reads track matrix/rotation, retains raw matrix and original video sample entry in remux path. Encoding uses canvas/rotation logic. | Preserves full transformation matrix and display geometry in copy; encoding uses baked orientation and contain fit. | High |
| Keyframes | Remux reads sync-sample flags and writes sync tables without forcing new video keyframes. Conversion branches choose different GOP intervals, including 30-frame and 29-frame options. | Smart Copy hashes unchanged GOP samples/flags. Encoding uses the existing two-second keyframe interval. | High |
| Conversion presets | Public code contains resolution/FPS/bitrate, HEVC/H.264, 10-bit and 8-bit HLG, full-range and color-rewrite paths. Some branches fall back from HDR to SDR. Some transport-stream branches return MPEG-TS data with MP4 naming/MIME. They are not all the default HEVC copy path. | Explicit HEVC conversion/custom settings. No unvalidated HDR-to-SDR fallback, extension masquerading or HDR encoding claim. | High code existence; device execution untested. |
| Requests / processing | Public HTML references CDN muxer/fonts/analytics; JS includes maintenance, reviews, account and usage APIs. Media processing in inspected copy/encode paths uses local Blob reads and WebCodecs, not an observed TikTok upload API. A full runtime trace was not captured. | Local processing, no video upload server or analytics. User performs TikTok upload separately. | High bounded observation |
| TikTok-specific evidence | Names, routing, UI claims and container modifications explicitly target TikTok. No TikTok-signed quality entitlement, documented 1080p override or evidence that a filename grants playback quality was found. | No TikTok ingest integration or quality override. | High about inspected resources; actual ingest effect unknown. |

KilatFrame's marketing/preset-description text and actual selected writer branch are not always equivalent. Findings above follow the branch selected by current HQ configuration, rather than assuming every description represents that route. Its served implementation today may also differ from the build used in the reported upload.

## What public TikTok documentation establishes

1. The [Content Posting API Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) lists MP4 as recommended, H.264 as recommended and H.265 as supported; video rates 23–60 FPS and dimensions 360–4096 pixels. The reported 1080×1920 / 59.98 FPS / 13-second HEVC file does not obviously violate these listed geometry/rate limits. **These are API ingest rules, not proof of Safari Web uploader behavior or an output-resolution guarantee.**
2. TikTok's [2021 HD uploading announcement](https://newsroom.tiktok.com/new-editing-tools?lang=en) describes a selectable up-to-1080p feature in certain countries. It does not document a container trick, universal Safari behavior, bitrate threshold, or exemption from transcoding. Its age and rollout scope matter.
3. The current [TikTok Studio help URL](https://support.tiktok.com/en/using-tiktok/creating-videos/tiktok-studio) did not provide readable text through the available fetch tool. Unverified consumer-web limits from third-party summaries are deliberately not treated as official findings.
4. [W3C media application guidance](https://www.w3.org/2023/06/webmediaguidelines.html) explains rendition sets and adaptive delivery generally. [Cloudflare's ABR explanation](https://www.cloudflare.com/learning/video-streaming/what-is-adaptive-bitrate-streaming/) describes selection according to playback conditions. Neither reveals TikTok's internal ingest/rendition policy for these posts.

No reviewed primary source documents a rule that four AAC samples, an unusual AudioSpecificConfig, unknown movie duration, a free box, 28.9 MB, HEVC, HDR, or a particular filename guarantees a 1080p TikTok rendition. Acceptance and playback quality are different measurements. A 1080p display option also does not prove identical video packets reached viewers.

## Ranked possible causes

| Candidate | Why plausible / evidence | Confidence in explaining this incident |
| --- | --- | --- |
| Different audio/sample-table/container layout influences an ingest/parser path | Confirmed HQ1 vs plus+ structural difference, invisible in the reported Photos summary. Exact exported pair and TikTok ingest traces needed to connect it to the result. | **Low/unknown causal; high structural** |
| Front vs trailing moov affects early metadata access | Confirmed difference. Front indexing is standard for progressive access; TikTok may instead receive/process the whole file, making it irrelevant to rendition choice. | **Medium general compatibility; low causal** |
| Files delivered to TikTok differ from saved exports | Apple documents format conversion in sharing options; selecting Files consistently reduces this confound. The user reports the same route, but no hashes of actual submitted bytes were captured. | **Lower priority after user clarification; untested** |
| HDR/profile/sample-entry/range differences not shown by Photos | Same HEVC label and resolution do not reveal hvcC, DV configuration, HDR color/range, edit lists or actual packet equivalence. | **Medium as a missing-data concern; unknown causal** |
| Different selected pipeline/build or an unnoticed re-encode | Current production matches v2.2. Historical browser state and each actual output mode are unknown. Exact packet/config hashes would resolve this. | **Low/unknown** |
| Processing age / available rendition set / playback selection | Comparing a selected rendition versus all available renditions, or at different times, can conflate separate outcomes. Exact player/time/manifests were not supplied. | **Plausible, untested; not asserted as TikTok policy** |
| Different account/privacy | User says these were kept the same. | **Reduced by reported control** |
| File size / bitrate alone controls 1080p | No primary evidence; same reported size already fails as a discriminator. | **Unsupported** |

There is currently **no defensible single-cause diagnosis**. Specifically, this report does not replace uncertainty with a claim about account size/popularity, a fixed bitrate threshold, HDR superiority, browser-brand preference or a compression bypass.

## Safely implemented improvement

**Standard front-loaded MP4 movie index, followed by full existing validation.** [FFmpeg's official format documentation](https://ffmpeg.org/ffmpeg-formats.html#MOV_002fMPEG_002d4_002fISOMBFF-muxers) documents moving the index forward for better playback. [Apple's file-format documentation](https://developer.apple.com/documentation/quicktime-file-format/quicktime_movie_files) describes the movie/media atom model. This justifies a conventional compatibility improvement independently of KilatFrame's code; it does not justify promising a TikTok quality change.

The new original implementation in `src/fast-start.js` runs after normal Mediabunny finalization in both copy and encoding modes. It relocates the existing moov using Blob slices and updates standard stco/co64 offsets, including multiple mdat boxes. Only metadata is materialized; no second full media-sized byte array is allocated. No samples, duration changes, brands, color tags, media bytes or padding are added, and the byte length is exactly unchanged by relocation. Existing packet/HDR/timestamp validation runs on the **final relocated file**, before downloads are offered.

Unsupported layouts, metadata-budget excess or 32-bit offset overflow keep the original MP4 with an explicit layout notice; malformed tables fail rather than producing damaged output. No forced co64 conversion, fragmented MP4, unknown-duration patch, extra AAC samples, dual audio descriptions, fake HDR, decoy tracks or mislabeled TS is implemented. Cancellation remains active during finalization. A visible result field reports the actual layout outcome, and the picker/guide gives cautious Files/Current advice based on [Apple's sharing documentation](https://support.apple.com/guide/iphone/share-photos-and-videos-iphf28f17237/27/ios/27), without claiming Photos always compresses everything.

This patch **has not demonstrated a 1080p TikTok result**. It is a standards-based improvement and a useful independent A/B variable, not a recreation of HQ1's synthetic tail or proof that moov placement caused the incident.

## Verification and reproducible next experiment

Local checks: all original 42 tests plus six fast-start tests pass (**48 total**). Real SDR/HLG/HDR10 MOV and MP4 outputs are still independently checked with FFprobe for packet/configuration hashes, profile, bit depth, color, static HDR metadata, keyframe flags and common A/V timing. New tests cover 32/64-bit chunk tables, multiple media boxes, exact byte-count/media preservation, unsupported-layout fallback, malformed offsets, idempotence and cancellation. Production build passes. CI is run on the candidate before main promotion; deployment is checked through the existing Pages integration.

Remaining limitations: the exact iPhone files, iPhone physical playback/share behavior and actual TikTok uploads are not tested in this environment. Real Dolby Vision retention remains unsupported. A >4 GB physical iPhone export was not exercised.

Next investigation, without posting anything automatically:

1. Keep original, exact KilatFrame output and exact plus+ output in Files. Record selected modes/builds and sizes in bytes, not rounded Photos summaries.
2. Capture local FFprobe reports (`-show_format -show_streams -show_packets -show_data_hash sha256`) and structural box listings. Compare ordered video/AAC hashes, extradata, PTS/DTS/duration, keyframe flags, edit lists, color/DV records, actual container and audio descriptions/counts. Additional generated audio samples would be directly detectable even if Photos rounds duration/size identically.
3. Compare baseline v2.2 output with the standard front-index output from this patch. Do not modify media, add music or edit inside TikTok. Keep Files selection, account, privacy and browser mode fixed; alternate upload order across repeated trials. Posting remains the user's choice.
4. Record completion times, post URLs, elapsed time before inspection and available rendition lists. Distinguish selected playback resolution from the full available rendition set. Repeat in the same player/network/device and later on another device.
5. Where lawfully exposed for the user's own posts, capture actual upload media properties and served video URLs/resolution/codec/bitrate. Compare served packet or decoded-frame hashes before claiming retained original video. Redact authentication/session tokens and signed URLs before sharing traces.

Only this controlled evidence can establish whether the standard layout change helps this account, or whether another container or TikTok-serving difference is responsible.
