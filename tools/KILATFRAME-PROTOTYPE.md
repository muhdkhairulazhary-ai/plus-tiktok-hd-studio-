# Independent container-compatibility prototype (offline)

This is original code implementing ordinary ISO BMFF structures and isolated experiments derived from the documented observations. It does not load, execute or redistribute KilatFrame/HIDZZ code, packets or assets. It is not a KilatFrame clone or a TikTok uploader. Nothing in the website imports this tool.

Requires the existing offline harness dependencies (Node 24+, Python 3.10+, native FFmpeg/FFprobe with AAC/HEVC). First create A and D using the existing harness:

```sh
node tools/mp4-ab.mjs input.mov /tmp/studio-ab-new
python3 tools/kf-prototype.py input.mov /tmp/studio-ab-new/A-smart.mp4 /tmp/studio-ab-new/D-source-timing.mp4 /tmp/studio-prototype-new
```

The default emits **N only**, with no new media or changed audio timing. The output directory must be empty. The source and D must pass exact box/packet/configuration/timeline checks; A is independently checked against source with its existing 100 µs tolerance. The tool does not generalize sources rejected by A/D.

To deliberately run the separate **audio-mutating diagnostics** locally:

```sh
python3 tools/kf-prototype.py input.mov /tmp/studio-ab-new/A-smart.mp4 /tmp/studio-ab-new/D-source-timing.mp4 /tmp/studio-prototype-diagnostics-new --audio-mutations
```

Outputs and their contracts:

| Label | File | Behavior |
| --- | --- | --- |
| N | N-layout.mp4 | D clocks/edits/video entry retained; merge by relative per-track DTS, coalesce adjacent samples into chunks; canonical single AAC-LC mp4a/esds with original ASC. One video + one audio track. All packet/timing/PCM/seek checks must match D. |
| O | O-AUDIO-ORIGIN-CHANGED.mp4 | N plus one audio edit starting at raw media time zero, removing empty-delay/priming edits. **Intentionally changes synchronization and possibly decoded audio. Never a lossless export.** |
| T | T-FOUR-AAC-TAILS.mp4 | N plus four locally encoded AAC silence-source packets in a separate mdat, extending audio tables/durations/recovery mapping. Original AAC prefix/PTS/decoded PCM prefix must match. **Adds media and changes full audio/duration.** |
| K | K-ORIGIN-AND-TAILS.mp4 | Combines O and T to approximate the confirmed HQ1 construction behavior. **Audio-mutating diagnostic, not upload-ready.** |

T/K require all original AAC sample durations to be 1024 ticks at the matching sample-rate clock. Shortened final samples are blocked because a decoder join could overlap/misrepresent the original end. The native AAC encoder's AudioSpecificConfig must exactly match source. Only four interior full-duration packets from that locally encoded stream are used; its priming is not concatenated as a new edit. Mono/stereo AAC-LC with ordinary table sample rates and 1024-sample frame length is supported. Incompatible configurations are rejected, not relabeled. `prototype.json` records explicit block reasons.

The standalone silence source does **not** guarantee silence after concatenation: AAC overlap state can produce a residual in the extension. The report measures extension peak, sample count and prefix equality. Original HEVC and AAC packets always remain unchanged, but T/K add packets and O/K change presentation. These variants must never be described as full-file lossless or audio intact without qualification.

`prototype.json` contains raw structural hashes/short table bytes, sample-description counts, per-packet hash aggregates and timing shifts, durations, full-video/HDR decode checks, PCM/prefix hashes, and three paired native seek results. A second independent table inspector expands stsc/stsz/stco and checks each sample pointer/hash against FFprobe, rejects overlap/extra tracks/descriptions, and verifies stts/mdhd durations. A failed run exits nonzero; partial files are not validated exports.

The prototype deliberately omits reference padding/free-box sizing, branding/author metadata, unknown durations, unrelated legacy tracks, synthetic PCE configuration, duplicate audio, private TikTok fields and forged FPS. It retains D's existing MP4 brands. T's encoded packets are not the reference's fixed 15-byte packet template. N retains source roll-group semantics rather than inventing recovery metadata. These are explicit divergences, not undocumented equivalence claims.

For the five reproducible synthetic fixtures:

```sh
python3 tools/make-ab-fixtures.py /tmp/studio-prototype-fixtures-new
```

Then run the prototype command against each of `sdr`, `hlg`, `hdr10`, `priming`, `vfr` using that study's `NAME-rotated.mov`, `NAME/A-smart.mp4` and `NAME/D-source-timing.mp4`. This reproduces the measurements in [the report](../docs/kilatframe-compatibility-prototype.md). The tests automatically exercise all five cases; native audio-changing experiments are enabled explicitly by the test.

No TikTok request, credential access or upload occurs. Native FFmpeg playback and small synthetic fixtures do not establish iPhone Safari/Photos support. Whole-file buffers/native encoding make this a desktop research prototype, not a browser feature. Research pushes retain `[CF-Pages-Skip]` so CI runs without deployment.
