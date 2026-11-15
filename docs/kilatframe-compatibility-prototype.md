# KilatFrame compatibility prototype: independent offline experiments

Date: 2026-11-15. Starting research commit: `baf245a7765d2dcc9b63c9e5a2d2df8f3c880d0b`. Production remains `b8ba19af9478e4149f0f86a0088f3779eca6f895`.

## Decision

**Not ready to recommend a controlled TikTok upload yet.** The sample-preserving layout prototype N passes offline validation, but Safari/Photos playback is untested. The closer origin-plus-tail diagnostic K changes A/V synchronization on every tested case; it cannot be recommended as a faithful export. No TikTok request/upload was made, and no 1080p result or compression bypass is claimed. No additional uploads are requested from the user.

A meaningful hypothesis is now testable without imitating reference defects: whether relative-DTS chunking and a conventional single AAC description affect interoperability while preserving every sample and presentation timestamp. Those properties are independently implemented and verified in N. There is no evidence yet that they affect TikTok's rendition ladder.

## Reviewed evidence and confirmed differences

Reviewed the [KilatFrame report](kilatframe-investigation-2026-11-15.md), [actual HIDZZ ZIP report](hidzz-investigation-2026-11-15.md), [A/B/C comparison](offline-mp4-ab-investigation.md) and [Variant D results](offline-d-timing-investigation.md), plus the previously retained relevant HQ1 table/edit/interleave branches. This describes the previously hashed public build, not a newly observed reference deployment or an authenticated end-to-end run. No proprietary implementation/assets are copied.

| Feature | Confirmed inspected KilatFrame HQ1 | plus+ A / D | Prototype experiment |
| --- | --- | --- | --- |
| HEVC | Original samples and video entry forwarded | A verifies packet/hvcC hashes; D also restores exact source timing/entries | All variants use D's exact HEVC samples, timing, video entry, dimensions, orientation and HDR |
| Interleaving | Merge by DTS relative to each track's first DTS, coalesce adjacent same-track samples | A library chunk grouping; D retains A physical layout | N reconstructs relative-DTS merge/chunk tables independently |
| AAC sample description | One mp4a/esds reconstructed from parsed original ASC | A library description; D original raw entry | N writes conventional v0 mp4a/esds with original ASC, rate/channels; independently verifies decoder-config hash |
| AAC edit | HQ1 replaces parsed edit origin with first raw audio DTS and writes one media edit | A reconstructs presentation; D restores original complete edits/priming | O resets media_time=0 and removes leading empty edits; its actual shift is measured |
| AAC tail | Four generated 15-byte samples, new audio mdat, added roll metadata | No added samples | T uses four **independently encoded** matching AAC packets in another mdat; original prefix remains unchanged |
| Tracks | HQ1 one video + one audio | One video + one audio | Always one video + one audio; one description per track |
| Other branches | Legacy HQ/decoy branches differ | No decoys | Not reproduced; HIDZZ's two audio tracks/18+ tails are not HQ1 behavior |
| Duration / metadata | HQ1 normal 1000 Hz movie durations, original track clocks, free boxes and specific brands | A uses 57600 video clock on fixtures; D original clock/movie header | D clocks retained; O/T/K recompute affected durations honestly. No padding, author metadata, unknown duration, brand tricks or FPS spoofing |

Structural confidence is **high for the inspected code and reproduced local behavior**. Causal confidence for TikTok resolution is **unknown**. Code existence alone never establishes what the historical user's reference export contained or what TikTok accepted.

## Independent implementation

New offline tool: [usage and contracts](../tools/KILATFRAME-PROTOTYPE.md), `tools/kf-prototype.py`. The website/engine/bundle are unchanged. Existing A/D eligibility still applies; unsupported HDR/Dolby Vision is not enabled.

| Variant | Isolated changes | Audio claim |
| --- | --- | --- |
| N (default) | Relative-DTS coalesced chunks + canonical single AAC description, retaining D edits/packets | Sample/presentation/decoded-audio preserving |
| O (explicit diagnostic) | N + reset audio edit origin | Original AAC packets retained, but presentation/priming changed |
| T (explicit diagnostic) | N + four valid AAC tail packets + separate mdat, extended sample/recovery tables/durations | Original AAC packets/PTS/PCM prefix retained; complete audio is extended |
| K (explicit diagnostic) | N + origin reset + tails | Reproduces the class of HQ1 behavior; audio-mutating, not lossless |

Only N runs by default. O/T/K require `--audio-mutations`. They are prominently named with their changes, never selectable in the production UI. Real AAC is generated from a local silence source by native FFmpeg with matching source AudioSpecificConfig. A shorter final source sample or mismatched configuration blocks T/K. The tail sample duration is the real 1024/sample-rate period, not a copied arbitrary last-sample duration.

This is a behavioral prototype, not byte-for-byte equivalence. Its tail packets are 4 bytes (tested mono) or 6 bytes (tested stereo), not the reference's fixed 15 bytes. It uses original AAC recovery semantics, minimal ISO descriptor lengths, valid 64-bit edit entries when rebuilding edits, existing D brands and no arbitrary free-space padding. It does not synthesize the reference's proprietary packet template, PCE or HDR metadata. These divergences prevent pretending that the exact reference output has been reproduced.

## Local measurements

Five retained synthetic rotated HEVC fixtures from the D study: approximately 13-second SDR, HLG, HDR10, explicit AAC priming and VFR. Coded dimensions 128×72; source CFR is 60000/1001 before VFR selection. Audio rates/channels: 44.1 kHz mono, 48 kHz stereo, 32 kHz stereo, 48 kHz stereo and 44.1 kHz mono respectively. Full evidence: [measured JSON](kilatframe-prototype-measurements.json). No personal footage or third-party media is committed.

All variants retain **byte-identical original HEVC packets**, exact D/source video PTS/DTS/durations, resolution, frame count, GOP flags, orientation, hvcC and supported HDR. Full decoded video/HDR and native video seeking match D/source. Original AAC packet sequences also match: T/K explicitly contain four additional packets, not an identical complete audio sequence.

### Layout-only N versus A and D

| Fixture | A bytes | D bytes | N bytes | D physical track runs | N runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| SDR | 363,208 | 363,576 | 372,896 | 52 | 1,111 |
| HLG | 34,420 | 34,533 | 34,973 | 5 | 83 |
| HDR10 | 40,114 | 40,227 | 40,371 | 5 | 57 |
| Priming | 37,512 | 37,625 | 38,153 | 4 | 96 |
| VFR | 33,410 | 33,499 | 33,899 | 4 | 57 |

Metadata growth follows real chunk/description tables, not media padding or a target size. N differs from C's earlier absolute-DTS, one-sample-chunk experiment: it merges **relative** DTS and coalesces adjacent samples into chunks, closer to the inspected HQ1 policy.

N matches D exactly in audio PTS/DTS/duration, packet count, decoded float PCM, AAC priming/flags and native audio seek windows on all fixtures. N and D retain original 1/60000 video timebase; A retains its previously measured 1/57600 conversion and up to 10.416667 µs PTS error. This difference is unrelated to adding media or changing FPS.

### Origin-reset O: synchronization changes confirmed

Audio PTS shift relative to D/source is uniform across the original AAC sequence, while video stays unchanged:

| Fixture | O and K audio PTS shift | Decoded sample effect / observed seek result |
| --- | --- | --- |
| SDR | -5557/44100 s = **-126.009070 ms** | Same untimed PCM, earlier audio presentation; audio seek windows differ |
| HLG | -16/125 s = **-128 ms** | Same untimed PCM, earlier audio presentation; audio seek windows differ |
| HDR10 | -59/500 s = **-118 ms** | Same untimed PCM, earlier audio presentation; audio seek windows differ |
| VFR | -5557/44100 s = **-126.009070 ms** | Same untimed PCM, earlier audio presentation; audio seek windows differ |
| Priming (O only) | 8/375 s = **+21.333333 ms** | Original 1024-sample priming trim removed; 1024 additional decoded samples/channel; audio seek windows differ |

This independently demonstrates why matching audio packet hashes or untimed PCM alone is insufficient to prove A/V integrity. The reset can discard an intended leading delay or reintroduce encoder pre-roll. The exact effect on the user's original clip remains unknown, but the diagnostic fails source-fidelity requirements on these inputs. O/K are **not recommended exports**.

### Four-tail T: original prefix intact, full audio changed

T/K were allowed on SDR/HLG/HDR10/VFR, whose original AAC samples have full 1024-tick durations. They were **blocked on the explicit priming fixture**, whose final sample duration is shortened. The tool refuses to invent a valid decoder join for it.

| Fixture | Added decoded samples/channel | Added raw media time | T format duration | Measured peak in decoded extension (normalized float) |
| --- | ---: | ---: | ---: | ---: |
| SDR | 4,096 | 4096/44100 s = 92.879819 ms | 13.105964 s | 0.056075189 |
| HLG | 4,096 | 4096/48000 s = 85.333333 ms | 1.088000 s | 0.003887899 |
| HDR10 | 4,096 | 4096/32000 s = 128 ms | 1.142000 s | 0.012193875 |
| VFR | 4,096 | 4096/44100 s = 92.879819 ms | 1.101247 s | 0.005803778 |

Original decoded PCM prefixes and three interior audio seek windows match D for T; complete PCM hashes differ as expected. The nonzero extension peak is measured after concatenating packets into the original decoder stream: AAC overlap state means a silence-source encoder does not guarantee an immediately silent join. Audibility was not subjectively tested. The tail is not treated as harmless padding or proof of compatibility. T can extend audio past the last original video frame; any player-specific final-frame hold or end display is untested in Safari.

K combines these tails with the measured origin reset. It does not restore source synchronization; for example HLG K moves audio 128 ms earlier and reports format duration 1.001000 s rather than T's 1.088000 s. For SDR, K's audio ends around 12.979955 s, before the original video end 12.996317 s, despite appending audio samples. There is no universal duration/alignment benefit.

## Validation

- Original video/AAC ordered SHA-256 prefix hashes, decoder configuration, profile/depth/color, dimensions, rotation and exact original video timing are checked for every prototype.
- An independent box-table inspector expands stsc/stsz/stco, verifies every pointer/size/hash against FFprobe, checks stts sample count and mdhd duration, exactly one video/audio track and one sample description each, and rejects overlapping/duplicate sample references. T/K's separate mdat is validated.
- Full native video decoding/pixel order/HDR metadata and video seeking match source. HLG/HDR10 static metadata remains unchanged. Dolby Vision remains blocked.
- Full float PCM equality/prefix/extension sample counts and three paired native video/audio seeks are measured separately. Expected O/K synchronization differences are recorded, **not hidden as a passed source-fidelity check**.
- Tests cover all five fixtures, AAC configuration rejection, unsafe shortened-tail blocking, malformed chunk offsets, original packet protection and the N-only default.
- Native codec availability here does not imply Safari can encode AAC. This is a native offline diagnostic; no browser pipeline was added.

**Local verification: 64/64 regression tests passed, none skipped; production build passed and reproduced the committed bundle unchanged.** GitHub CI results are reported with delivery. The production bundle must remain byte-for-byte unchanged. Research commits use `[CF-Pages-Skip]` to prevent preview and production deployment.

## Recommendation and remaining unknowns

**Keep the prototype on the research branch.** N is a validated sample-preserving container candidate; O/K intentionally change synchronization and T changes full audio. None has demonstrated a TikTok-quality advantage. No benefit from the reference's synthetic tails, edit-origin replacement or specific sample-description bytes is established.

Before proposing one controlled TikTok test, split N's chunking from its AAC-description normalization, then check the successful nonmutating candidate in Safari/Photos with local generated fixtures: full playback, seeking, audio sync, HDR appearance and saved-file playback. That browser/device compatibility gate is still missing. No further user upload is requested now. If eventually cleared, any test should evaluate a specifically named nonmutating variant against a recorded baseline and inspect available renditions after processing; it must not be presented as a bypass test.

Limits: previously inspected reference build only, no exact historical user export pair, no actual TikTok ingestion evidence, no physical iPhone/native Photos validation, no authentic Dolby Vision support, small coded-resolution synthetic fixtures, and desktop whole-file buffering/native processes. More faithful structure and successful native parsing are not evidence that TikTok will offer 1080p.
