# HIDZZ archive investigation and optional MP4 experiment

Date: 2026-11-15. Scope: supplied `HIDZZ_UPLOADER_V.1.4.1_fix_64bit.zip`; static review and local synthetic-media execution of its reviewed MP4 patcher. No TikTok account, credentials, upload endpoint or private API was exercised. No third-party implementation or assets are included in this repository.

Archive SHA-256: `bf528c83ecf2399f771f5fe2c2ebb7e5e4440a8bec50a5e4bbd07617981cffeb`.

## Evidence and confidence

The actual JavaScript is the authority for these findings. README version notes include older behavior and a 1.4.2 heading despite the manifest reporting 1.4.1. Claims of upload quality or preserved sound in that README are not independent evidence.

| Reviewed file | SHA-256 |
| --- | --- |
| patcher.js | 7897db7ee995b5eb8f202e20c8d6cfbf3c0cd7739fa95e9f9a06c409d60144da |
| soundsafe-hook.js | 4b859606fbcf1af6813c6b99263ca33b2980ed1135a2bb7b84d43c2f06b27c76 |
| page-hook.js | 509f351420b0bde4a613eb3a5c0ca9dc36f030f84e549379dee407787536f77c |
| upload-card.js | 503e77fec50b1deaa01f7bc98ad98fa9cf0fcf642c0071a3ed64643bbef3759e |
| manifest.json | c8f708fa5163ce7413b0fc254d9ff39b27b96e180c93a5a9448bab77ac331389 |
| README.txt | c8079f17981a4ff4c05d7b9dbfd865f6a6e90952097c84dba11c1ff49877a29e |

### MP4 reconstruction: confirmed, high confidence

The active `processAndReport` path is a JavaScript container rebuild, not a WebCodecs/FFmpeg encoder. An FFmpeg argument builder exists but is not called by this path. That unused preset includes H.264, yuv420p, AAC and color tags; its presence does not establish HEVC/HDR encoding support.

The patcher accepts a narrow nonfragmented layout with one moov and one mdat, rejects approximately 4 GB and larger inputs, reads extended box sizes and both stco/co64 input offsets, but writes stco output offsets. The archive's “64bit” name does not imply arbitrary large-file output support. It places moov before media, reconstructs sample/chunk tables, retains the original mdat payload and appends generated AAC bytes. Video stsd/hvcC and the video timing/keyframe/sample tables are retained while chunk offsets are rebuilt. The tkhd transformation matrix is retained; track IDs, flags and durations are rewritten. Movie/edit durations are converted to a 1000 Hz movie timescale.

It may append amve metadata based on an original box or a byte-pattern heuristic in hvcC. This is not a validated general HDR/Dolby Vision retention strategy. The ftyp advertises isom/iso2/avc1/mp41 even for copied HEVC; no demonstrated advantage follows from these brands. Artist metadata carries an author signature. Its self-check expects three tracks and shared audio offsets; it does not prove identical media, HDR playback or TikTok acceptance.

### Audio: confirmed modification, no demonstrated compatibility benefit

The patcher parses AAC configuration from esds (including wave/esds), retaining supported AAC-LC source sample rate, channels and AudioSpecificConfig. It supports mono/stereo and table sample rates up to 48 kHz; edit-list media time is used as priming information. These guards are materially better than simply relabeling AAC samples, but do not justify its other audio changes.

It constructs **two audio tracks referencing the same samples**. It adds at least 18 generated AAC tail packets, or more to cover video plus about 0.4 seconds; silent input can receive a generated audio track. Audio stts uses 1024-sample durations and roll groups are added. For stereo, the first audio track has two sample descriptions and switches its last eight samples to a PCE-based configuration; the second has one description. These are substantive changes to track structure and duration, not a lossless copy of the complete original audio timeline. They are not adopted here.

A bounded offline run of the reviewed patcher against a generated one-second HEVC/AAC MOV produced:

| FFprobe observation | Original | HIDZZ output |
| --- | --- | --- |
| File bytes | 27,613 | 28,643 |
| HEVC packets | 30 | 30 |
| AAC tracks | 1 | 2 |
| AAC packets per track | 45 | 63 |
| AAC format | 44,100 Hz mono | 44,100 Hz mono |
| Format duration | 1.000 s | 1.439002 s |

All 30 encoded video packet hashes matched. The original 45 AAC packet hashes matched the first 45 packets of the first output audio track; 18 additional packets followed. This proves those changes for this fixture only. It does not prove complete PCM equivalence, lip sync on real iPhone media, a benefit from duplicate audio tracks, or improved TikTok renditions.

### Upload interception and request mutation: confirmed code, server effect unknown

The MV3 manifest uses TikTok host permissions, storage and declarativeNetRequest. MAIN-world page/soundsafe hooks run at document_start in all frames. The upload card intercepts file selection, reads the full file into RAM, patches it, replaces input.files through DataTransfer and redispatches events. The current error path clears the selection rather than silently passing the original, contrary to some older README wording.

The obfuscated page-hook was decoded for static review using only its string-table helpers; its page execution/network code was not run. It wraps fetch/XHR publish bodies, inserts signature caption/mention markup and can resolve a mention through TikTok's user search using the existing browser session. Its own normalization switch is false. Quality mutations are separately active in soundsafe-hook, whose activation function always returns true.

The soundsafe hook wraps JSON.stringify and selected fetch/XHR publish bodies. Target matching includes `tiktok/web/project/post/v1/`, project/post, publish, aweme/v1/create and item/create paths, with exclusions for sound/music requests. Observed mutations:

| Location | Fields |
| --- | --- |
| Root | cloud_edit_is_use_video_canvas=false; psg_vsp_aud=true; is_high_quality=true; high_quality_video=1; disable_auto_bitrate=true; removes draft/canvas_config/vedit_segment_info |
| post_common_info | post_type=3; enter_post_page_from=1; psg_vsp_aud=true; is_high_quality=true |
| single_post_req | psg_vsp_aud=true |
| feature_info | cloud_edit_is_use_video_canvas=false; has_original_audio=1; psg_vsp_aud=true; video_quality_score=1.0; is_high_quality=true; is_high_quality_video=1; upload_high_quality=true; disable_auto_bitrate=true; video_fps=144; source_fps=144; removes vedit_segment_info |

The 144 values spoof request metadata; they do not change encoded frame cadence. Music-related changes remove tiktok_snap_shot_lite_params, change an existing application field to 1 and copy an existing id to music_id_string. Cover/thumbnail/poster fields are snapshotted/restored around mutation. Neither that mechanism nor “sound safe” naming proves TikTok's eventual behavior. Desktop helpers also alter user agent/client hints, navigator properties and viewport; these do not change encoded video quality.

There is **no evidence here that TikTok accepts these private fields, honors them, avoids transcoding, or produces 1080p because of them**. Behavior may depend on server experiments, account, upload path, processing delay or playback rendition selection. No controlled post-upload comparison was performed.

## Implemented independent experiment

**Smart Copy remains the default.** The optional **TikTok MP4 Compatibility — Experimental** mode uses the same HEVC/AAC eligibility and HDR safeguards, packet copy and full post-export validation. It does not reproduce HIDZZ's code, audio modifications, captions, identity changes or request hooks.

Existing Smart Copy already places moov before mdat. The experiment independently rebuilds its ordinary MP4's chunk offsets as standard **co64** entries, also retaining a front-loaded index. Relative to stco, this adds exactly four genuine metadata bytes per chunk entry, not media padding. Existing co64 tables remain co64. All unrelated box bytes and compressed media are retained via Blob slices. It changes no codec, sample payload, track count, duration, cadence, orientation or color metadata. It rejects unexpected layouts and unsafe offsets rather than guessing. Metadata reading/rebuilding is bounded to 64 MiB; cancellation is checked throughout. The muxer still buffers compressed output, so this does not eliminate Safari's existing memory limits.

**Rationale and limit:** co64 is a standards-defined alternate representation that can be independently validated. This provides one explicit, reversible container variable for an opt-in comparison. HIDZZ itself writes stco; this is not presented as its secret technique or a proven fix. There is no evidence that co64 improves small-file TikTok ingestion, and some consumers may be less compatible with it. Default output is therefore unchanged. Equal size is neither a goal nor proof of identical encoded quality.

Reference: [Apple chunk offset atom documentation](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom). Standard indexing is not a compression bypass.

## Validation and remaining tests

Automated tests compare original input, existing Smart Copy and experimental output with independent FFprobe hashes, codec/extradata, profile/depth/color, packet counts, per-track PTS/DTS/duration/keyframe flags and A/V timing. Cases include SDR, HLG and HDR10 HEVC in MOV/MP4. HDR10 mastering/content-light side data is checked independently. Mono/stereo AAC at 32/44.1/48 kHz with delayed audio is checked for unchanged compressed packets **and decoded PCM hashes**. Changed global interleaving is permitted; comparisons follow each track's original packet order. Container tests check front moov, correct co64 addressing, exact metadata growth, idempotence, malformed offsets, cancellation and absence of whole-file reads. UI tests check opt-in selection, locked encode settings, routing, result labels and return to default on another upload.

Dolby Vision remains blocked: full DV configuration/RPU/enhancement-layer retention is not validated. HDR re-encoding and SDR tone mapping remain unavailable. No new HDR claim follows from co64. Unsupported metadata/layouts continue to fail explicitly rather than losing audio or HDR.

Physical iPhone Safari tests remain necessary: playback and seeking, Photos HDR rendering, audible full-clip sync, rotation, memory behavior, cancellation/repeats/backgrounding, and both Share Sheet destinations. Large files and actual Apple camera sample-description variations need device testing. Browser DOM tests and synthetic FFmpeg fixtures cannot establish those outcomes. A controlled TikTok comparison must use actual posts and inspect settled renditions over time; no 1080p success is reported.

## Separate extension architecture, not implemented

A converter on a different origin cannot inject these TikTok hooks. No TikTok requests, cookies, account tokens, credentials or private upload flags are added to this application. A separate opt-in extension would require narrow TikTok host permissions, explicit activation and transparent review of any request changes. It should avoid fake FPS/captions, credential storage and unverified private-field promises. Its behavior and server acceptance would need separate testing.

Chrome MV3 ZIPs cannot simply be installed into iPhone Safari. A Safari web extension requires Safari packaging/distribution and user-enabled permissions; an iOS app wrapper is a separate product. HIDZZ's Orion claims were not tested. See [Chrome content script contexts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) and [Apple Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions). No extension is required for this free, local website.
