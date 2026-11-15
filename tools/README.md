# Offline MP4 A/B investigation

This desktop-only harness is intentionally separate from the website. Nothing in `src/`, `index.html` or the production bundle imports it. No network or TikTok request is made. Requires Node 24+, Python 3.10+, FFmpeg and FFprobe with HEVC/AAC decoding. Run from the repository root:

```sh
npm ci
node tools/mp4-ab.mjs /path/to/input.mov /tmp/studio-ab-new-empty-directory
```

The directory must be empty; existing evidence is not overwritten. An unsuccessful run exits nonzero and prints **validation FAILED**. Partial files are forensic artifacts, not validated exports. A successful run emits:

- `A-smart.mp4`: current production Smart Copy, including its existing safeguards. No co64 experiment.
- `B-audio-tables.mp4`: A with audio stts/stsz/stsc/stco rebuilt, one original AAC sample per chunk. Raw sample descriptions, edit lists, roll groups, all media bytes and video tables are retained (offsets adjusted for metadata growth).
- `C-interleave-clock.mp4`: one-sample chunks for both tracks, physical media sorted by decode timestamp; exact integer common movie timescale based on the least common multiple of the old movie/video/audio clocks. mvhd/tkhd/elst durations are rescaled without rounding. mdhd clocks, edit media_time, PTS/DTS and media durations stay intact. This combines two variables and is a screening variant, not a single-variable causal test.
- `comparison.json`: complete FFprobe stream/packet hashes and exact rational timing inputs, AAC decoded PCM hashes, edit lists, raw sample-entry hashes, table hashes/short table bytes, physical track runs and HDR metadata for the first decoded video frame.
- `comparison.md`: human-readable sizes, movie clocks, chunk counts and physical track runs.

A is checked against source with up to 100 µs timestamp tolerance (same common shift for audio/video); B/C are checked against A with **zero rational timestamp tolerance**. Packet counts, SHA-256 payloads, flags, codec/extradata, color/profile/depth, rotation, sample rate/channels, decoded PCM/priming, and first-frame mastering/content-light metadata must match. B/C additionally require unchanged raw sample descriptions and ctts/cslg/stss/sgpd/sbgp. No extra audio samples/tracks, timestamp inflation, synthetic FPS or private request fields are introduced. A matching absent HDR field does not establish HDR support. Full packet hashes protect embedded HDR bitstream bytes; the independent frame check is limited to initial metadata. Dolby Vision remains blocked by production eligibility.

Scope is deliberately narrow: the ordinary self-contained, one-video/one-AAC-track, single-description, stco-based MP4 produced by A. Multiple mdat, co64, fragments, encryption or unknown sample tables are not generalized by this tool. Invalid/overflowing layouts fail. It is not a generic repair utility. ffprobe itself must successfully parse the file.

This is an **offline desktop** investigation implementation: it reads complete files/metadata/packet reports into RAM and synchronously runs native tools. It is not suitable for direct inclusion in Safari. These local outputs contain the user's media; keep them outside the repository. This harness establishes structural/payload equivalence, not actual Safari playback, complete HDR perceptual fidelity or TikTok rendition choice. No TikTok upload is recommended solely because these tests pass.

Regression coverage: `node --test tests/offline-ab.test.js` (also part of `npm test`). Three rotated MOV cases use 60000/1001 HEVC, delayed audio, mono/stereo and 32/44.1/48 kHz AAC, including SDR, HLG and HDR10. Auditing guards reject payload substitution, individual timestamp drift, configuration changes and dropped packets. The test requires the native tools; CI already installs FFmpeg and has Python.
