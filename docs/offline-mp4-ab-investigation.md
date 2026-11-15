# Offline MP4 A/B investigation after the unsuccessful co64 test

2026-11-15. Production baseline: `b8ba19af9478e4149f0f86a0088f3779eca6f895`.

## Conclusion

The user reports that the optional co64 compatibility export still receives a TikTok 576p rendition, whereas a prior KilatFrame export from the same source offered 1080p. This is negative evidence against **that tested container change being sufficient**. It does not isolate the cause of the discrepancy. Front-loading/co64 is not repeated as a proposed solution.

We built three **offline** variants and independently verified their encoded payloads, configuration, timing, audio decoding and metadata. No production code or UI is changed. No videos are uploaded. No further user files or TikTok posting tests are requested at this stage.

The strongest remaining structural difference in the reviewed reference is **audio edit/priming and tail handling**, followed by physical interleaving. A newly measured plus+ difference is **video-clock quantization**. Neither is demonstrated to control TikTok's rendition ladder. The recommended next experiment is an offline, exact-source-clock and edit-list comparison, not another speculative production mode.

## Evidence reviewed

- [KilatFrame report](kilatframe-investigation-2026-11-15.md): public resource hashes, selected HQ1 versus alternative branches, media/configuration and audio construction.
- [HIDZZ report](hidzz-investigation-2026-11-15.md): actual ZIP hashes, active patcher, two audio tracks/generated tails, request mutations and one-second offline patcher test.
- Retained, previously inspected public KilatFrame resource and supplied HIDZZ scripts in the temporary research workspace. We re-read the relevant table/edit/interleave branches. No new public build is asserted and no third-party code is incorporated.
- Current plus+ `src/smart-copy.js`: Mediabunny 1.66.0 rebuild from encoded packets, source/output hashing and timing checks, full transformation matrix and codec configuration checks.
- [Measured synthetic-fixture evidence](offline-ab-measurements.json), produced by the new [harness](../tools/README.md). This contains configuration/ordered packet-hash aggregates, track-table hashes and short bytes, edits, movie/track durations, physical track runs and PCM hashes. Full local per-packet reports are in `/tmp/studio-ab-study/{sdr,hlg,hdr10}/comparison.json` in this execution workspace; personal/source video bytes are not committed.

No exact user source/reference export pair or TikTok response is available locally. The fixture results establish local behavior, not what a historical KilatFrame build or TikTok server did to the user's file. Confidence below distinguishes observed structure from an unproven server effect.

## Actual construction strategies

| Property | KilatFrame inspected HQ1 | HIDZZ active patcher | plus+ Smart Copy (A) |
| --- | --- | --- | --- |
| Video | Original samples and raw video sample entry forwarded; no encode on this path | Original mdat video bytes, original sample entry/tables retained | Encoded packets remuxed through Mediabunny; raw hvcC and packet SHA-256 must match |
| HEVC/HDR | Raw entry may retain additional metadata; full DV semantics not independently verified | Copies video entry, possible heuristic amve addition; no general HDR/DV proof | hvc1 and supported HLG/HDR10 validated; unknown HDR remains unknown; unsupported metadata/DV blocked |
| AAC | Original samples plus **four** generated 15-byte tail samples in another mdat | Original samples plus **at least eighteen** generated samples, two tracks sharing offsets | Exactly one original AAC-LC track, no additional packets |
| AAC description | Rebuilds mp4a/esds from parsed AAC configuration; HQ1 has one description | Retains supported ASC/rate/channels; stereo first track may switch its last eight samples to PCE-based ASC | Config/rate/channels retained and verified; output sample description written by library |
| Audio edit origin | HQ1 sets mediaTime to first audio DTS, superseding parsed nonnegative edit mediaTime; writer emits one edit, rather than preserving an initial empty edit sequence | Uses parsed nonnegative edit mediaTime as priming; constant 1024-sample stts, rewritten edit/movie timing | Represents demuxed packet timeline and relative track delay; edit tables reconstructed by writer |
| Movie/track duration | Movie clock 1000 Hz in HQ1; durations recomputed/rounded; tail can extend audio end | Movie clock 1000 Hz, regenerated durations; synthetic fixture extended 1 s to 1.439002 s | Writer chooses clock and regenerates durations; fixtures use movie/video clock 57600 |
| Interleaving | HQ1 merges by **DTS relative to each track's first DTS**, joining adjacent same-track samples into chunks; synthetic tail is separate | Keeps original mdat layout, appends AAC bytes and rebuilds shared offsets | Packet feeding merges by PTS while preserving each track's decode order; writer groups samples into chunks |
| Timing tables | Rebuilds stts/ctts/stss/stsc/stsz/offsets from parsed samples | Retains video timing tables, reconstructs audio sample tables | Reconstructs from packet timestamps/durations; small quantization is permitted by explicit validation tolerances |
| Extra behavior | Other branches differ; do not conflate duplicate/decoy routes with HQ1 | Private upload flags, reported 144 FPS and caption/mention hooks | No upload hooks, private fields, fake FPS, padding or decoy tracks |

These structural observations have **high confidence for the inspected implementations**. Any responsibility for 576p/1080p has **low/unknown causal confidence**.

KilatFrame's HQ1 audio edit-origin replacement is particularly relevant to delayed audio and encoder priming. An AAC edit can remove encoder pre-roll, preserve a leading delay or trim the end. Replacing it with a different edit may cause audible onset/timeline changes even when original compressed packets survive. It must not be imitated merely because a reference output is labeled HQ. Added tail samples also change media, not just container compatibility; there is no evidence here that TikTok requires them.

## Implemented offline variants

| Variable | A — current Smart Copy | B — audio table reconstruction | C — alternate interleave/common clock |
| --- | --- | --- | --- |
| Base | Current production path, not experimental co64 | A | A |
| Video/AAC samples | Original, verified | Identical to A | Identical to A |
| Audio chunks | Library-selected grouping | One AAC sample per chunk | One AAC sample per chunk |
| Audio tables | Library output | Rebuild stts (lossless run-length form), explicit stsz, stsc and stco | Same reconstruction |
| Video chunks | Library output | Retained, offset relocation only | One video sample per chunk |
| Physical media ordering | Library output | Original mdat payload/order unchanged | Sorted by rational DTS, keeping each track's decode order |
| Movie clock | Library output | Unchanged | LCM of original movie and track clocks, with exact integer mvhd/tkhd/elst rescaling |
| Track clocks / PTS / DTS | Library output | Unchanged | Unchanged; common **movie** clock does not undo A's track-clock quantization |
| Edits / priming / roll groups | Library output | Retained | Same edit semantics; media_time and track clocks unchanged; edit segment durations scaled exactly |
| Sample descriptions/HDR/rotation | Validated original hvcC plus writer metadata | Raw sample entries unchanged from A | Raw sample entries unchanged from A; matrix retained |
| Added media / tracks | None | None | None |

All use ordinary stco addressing. Any existing front index is incidental baseline behavior, not the experimental variable. C combines two variables as a screening experiment; it cannot attribute a result to interleaving versus the movie clock. A later causal test must split them.

The tool rejects unsupported layouts and offset/duration overflow. It is a deliberately narrow offline builder, not a general remuxer or browser feature. It uses native FFmpeg/FFprobe and whole-file desktop memory; it is not suitable for iPhone Safari deployment. Failure produces no passing comparison report; partial files must not be treated as validated outputs.

## Measurements

Three generated rotated MOVs: 128×72 coded dimensions, 60000/1001 HEVC, approximately one second, B-frame reordering, 150 ms input audio offset. SDR uses 44.1 kHz mono; HLG uses 48 kHz stereo; HDR10 uses 32 kHz stereo. HLG/HDR10 are 10-bit. These test container semantics and are not full-resolution iPhone captures.

| Fixture / variant | Bytes | Movie ticks/s | Video chunks | Audio chunks | Physical track runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| SDR source | 28,224 | 1,000 | 37 | 37 | 74 |
| SDR A | 27,415 | 57,600 | 3 | 2 | 5 |
| SDR B | 27,547 | 57,600 | 3 | 38 | 5 |
| SDR C | 27,743 | 2,822,400 | 60 | 38 | 74 |
| HLG source | 33,673 | 1,000 | 40 | 40 | 80 |
| HLG A | 32,912 | 57,600 | 3 | 2 | 5 |
| HLG B | 33,056 | 57,600 | 3 | 41 | 5 |
| HLG C | 33,252 | 288,000 | 60 | 41 | 80 |
| HDR10 source | 36,494 | 1,000 | 28 | 28 | 56 |
| HDR10 A | 36,057 | 57,600 | 3 | 2 | 5 |
| HDR10 B | 36,149 | 57,600 | 3 | 28 | 5 |
| HDR10 C | 36,345 | 288,000 | 60 | 28 | 56 |

A physical track run means consecutive video-only or audio-only samples in file-offset order, independent of declared chunk boundaries. B therefore changes table grouping while keeping the same physical ordering. C restores much tighter physical interleaving on these fixtures. Metadata growth is real sample-table data, not padding; no file-size target is applied.

Every variant has **60 original video samples**; AAC sample counts remain **38 / 41 / 28** respectively. All ordered video and AAC SHA-256 sequences match source. hvcC/configuration, dimensions, profile/depth, color, keyframe flags and rotation match. B/C raw sample descriptions and composition/keyframe/roll tables also match A. Independently decoded AAC PCM hashes match; packet timestamp checks separately protect delay/sync (a raw PCM hash alone does not describe leading presentation gaps). Initial HDR10 mastering/content-light metadata matches; full packet hashes protect embedded bitstream SEI. No Dolby Vision preservation is claimed.

### Timing difference found in A

For all three fixtures, source video timebase is 1/60000 with stts `(60 samples, 1001 ticks each)`. A changes the video timebase to 1/57600 and stts to:

```text
(12, 961), (1, 960), (24, 961), (1, 960), (22, 961)
```

The largest measured absolute source-to-A differences are **10.417 µs PTS**, **9.722 µs DTS**, and **16.667 µs FFprobe-reported packet duration**. FFprobe may infer packet duration from a rate rather than expose each stts delta; the table values above are measured directly. Source video duration 1.001000 s becomes 1.001006944 s. `r_frame_rate` remains 60000/1001; `avg_frame_rate` changes from 60000/1001 to 1728000/28829. The media is not decoded/re-encoded and no frames are added or dropped. AAC PTS/DTS/duration differences are zero on these fixtures.

This is a **confirmed small timing representation change**, not proof of harmful drift or TikTok classification. Existing production checks allow small timing differences; it would be inaccurate to describe them as bit-exact timestamp-table preservation. KilatFrame's raw source-duration reconstruction can avoid this particular clock conversion, although its audio edits/tails introduce other changes. A 59.98 FPS user capture is not necessarily the 60000/1001 rate used here.

B/C preserve A's per-packet rational PTS/DTS/duration with **zero tolerance**. Movie-clock changes preserve duration in seconds exactly; for example HLG movie duration remains 1.002673611 s when its clock changes 57600 → 288000. An increased movie clock is not genuine added timing precision and does not repair A's already rounded video clock.

## Hypotheses and next experiment

| Hypothesis | Evidence / plausible mechanism | Confidence and action |
| --- | --- | --- |
| Audio edit/priming interpretation sends an input through a different ingest path | Confirmed source-delay/edit differences between writers; parsers can differ in handling edits/roll recovery | Medium general parser concern; unknown TikTok cause. Next: offline compare alternate **semantically equivalent** edit representations and independently decode timestamped audio, including negative priming, empty edits and short tails. Reject changed audible onset/end. |
| Video timescale rounding affects cadence classification | Confirmed source 60000 → 57600 conversion with irregular stts; reference can retain source durations | High structural confidence, low causal. **Recommended first next offline test:** retain original source video timebase/stts/ctts/keyframes and equivalent edit origin, keeping A's HEVC configuration and AAC presentation. Require exact rational source timing and payloads, then compare declared/derived cadence over longer CFR/VFR fixtures. |
| Physical interleaving affects parser buffering or seeking | A has 5 physical runs versus 56–80 in sources/C for these fixtures | Medium general compatibility concern, low causal. C is a verified screening candidate; split C into interleave-only and clock-only before any attribution. Native/physical playback still needed. |
| AAC tails trigger a quality decision | Confirmed presence in reference/HIDZZ; no documented causal rule or controlled result | Unsupported as a fix. Do not add tails, change duration, duplicate tracks or conceal audio changes. |
| Different HEVC configuration/HDR signaling causes classification | Original sample-entry retention differs from a library rebuild | Plausible missing-data concern. B/C preserve raw A entries and original hvcC; no configuration defect found in these fixtures. Unsupported metadata remains blocked; no speculative relabeling. |
| Private flags, spoofed FPS, matching file size or metadata guarantees 1080p | No verified server acceptance or rule | Unsupported; not implemented. |

**Decision:** no production change is justified by these results. Complete exact-source timing/edit experiments and independent full playback/seek/sync checks first. A/C/B are local artifacts for inspection, not a request for another round of TikTok uploads. Only after a reproducible, meaningful difference has been isolated and validated should a controlled post-upload experiment be proposed. The reported negative co64 result stays part of the evidence and is not ignored or explained away.

## Verification and limits

- **61/61 tests passed**, none skipped, including three new real-media A/B/C cases and all existing HDR/audio/UI/cancellation/share tests.
- Production build passed and reproduced `app.js` **without changes**. No production JS, HTML, CSS or pipeline file changed.
- New audit rejection tests cover packet substitution, missing packets, individual timestamp drift and changed decoder configuration. Existing output directories are refused to avoid overwriting evidence.
- No browser encoding run, physical iPhone test, actual Apple camera fixture, authentic Dolby Vision preservation test or TikTok ingestion/rendition inspection was performed. No 1080p claim follows from these tests.
- The offline harness does not establish a standards-conformance certification or full decoder compatibility; FFprobe parsing, native AAC decoding and initial video metadata decoding are independent checks, not substitutes for complete Safari playback.
