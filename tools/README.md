# Offline MP4 A/B/C/D investigation

This desktop-only harness is intentionally separate from the website. Nothing in `src/`, `index.html` or the production bundle imports it. No network or TikTok request is made. Requires Node 24+, Python 3.10+, FFmpeg and FFprobe with HEVC/AAC decoding. Run from the repository root:

```sh
npm ci
node tools/mp4-ab.mjs /path/to/input.mov /tmp/studio-ab-new-empty-directory
```

The directory must be empty; existing evidence is not overwritten. An unsuccessful run exits nonzero and prints **validation FAILED**. Partial files are forensic artifacts, not validated exports. A successful run emits:

- `A-smart.mp4`: current production Smart Copy, including its existing safeguards. No co64 experiment.
- `B-audio-tables.mp4`: A with audio stts/stsz/stsc/stco rebuilt, one original AAC sample per chunk. Raw sample descriptions, edit lists, roll groups, all media bytes and video tables are retained (offsets adjusted for metadata growth).
- `C-interleave-clock.mp4`: one-sample chunks for both tracks, physical media sorted by decode timestamp; exact integer common movie timescale based on the least common multiple of the old movie/video/audio clocks. mvhd/tkhd/elst durations are rescaled without rounding. mdhd clocks, edit media_time, PTS/DTS and media durations stay intact. This combines two variables and is a screening variant, not a single-variable causal test.
- `D-source-timing.mp4`: original mvhd/tkhd/mdhd, edit lists, video/audio timing and recovery tables and raw sample descriptions transplanted onto A's unchanged media/chunk layout. Original source clocks, composition offsets, AAC priming and empty-edit delays are retained byte-for-byte. Exact ordered one-to-one samples are required; unsupported edits fail.
- `comparison.json`: complete FFprobe stream/packet hashes and exact rational timing inputs, AAC decoded PCM hashes, edit lists, raw sample-entry hashes, table hashes/short table bytes, physical track runs and HDR metadata for the first decoded video frame.
- `comparison.md`: human-readable sizes, movie clocks, chunk counts and physical track runs.

A is checked against source with up to 100 µs timestamp tolerance (same common shift for audio/video); B/C are checked against A with **zero rational timestamp tolerance**. Packet counts, SHA-256 payloads, flags, codec/extradata, color/profile/depth, rotation, sample rate/channels, decoded PCM/priming, and first-frame mastering/content-light metadata must match. B/C additionally require unchanged raw sample descriptions and ctts/cslg/stss/sgpd/sbgp. D additionally requires zero source timestamp offset/error, byte-identical source timing/edit/configuration boxes, unchanged full decoded video/audio and matching native seeks. Full-clip video decode checks compare every decoded frame hash and HDR color/static metadata. Native seeks compare a decoded video frame and 100 ms audio window at 20%, 50% and 80% of source video duration. These run through FFmpeg, not Safari. No extra audio samples/tracks, timestamp inflation, synthetic FPS or private request fields are introduced. A matching absent HDR field does not establish HDR support. Full packet hashes protect embedded HDR bitstream bytes; the independent checks include metadata from all decoded video frames; they do not establish native Photos HDR appearance. Dolby Vision remains blocked by production eligibility.

Scope is deliberately narrow: the ordinary self-contained, one-video/one-AAC-track, single-description, stco-based MP4 produced by A. Multiple mdat, co64, fragments, encryption or unknown sample tables are not generalized by this tool. Invalid/overflowing layouts fail. It is not a generic repair utility. ffprobe itself must successfully parse the file.

This is an **offline desktop** investigation implementation: it reads complete files/metadata/packet reports into RAM and synchronously runs native tools. It is not suitable for direct inclusion in Safari. These local outputs contain the user's media; keep them outside the repository. This harness establishes structural/payload equivalence, not actual Safari playback, complete HDR perceptual fidelity or TikTok rendition choice. No TikTok upload is recommended solely because these tests pass.

Regression coverage: `node --test tests/offline-ab.test.js` (also part of `npm test`). Five rotated MOV cases use 60000/1001 HEVC, delayed audio, mono/stereo and 32/44.1/48 kHz AAC, including 13-second SDR with multiple keyframes, HLG, HDR10, zero-offset AAC encoder priming and VFR without B-frames. Auditing guards reject payload substitution, individual timestamp drift, configuration changes and dropped packets. The test requires the native tools; CI already installs FFmpeg and has Python.


### D scope and reproduction

D retains the source movie clock, track headers/durations, mdhd clocks, complete edts, stsd, stts, ctts/cslg, stss, sgpd/sbgp and sdtp where present. Source sample sizes/order must correspond exactly to A. Only A's chunk offsets change for the new metadata size; mdat bytes and physical track interleaving stay unchanged. D also restores source sample-entry representation (for example MOV nclc versus A nclx), so it is not exclusively a timebase variable. Original hvcC/AAC configuration and decoded color are checked independently.

Source edits are limited to one continuous media edit, optionally preceded by one empty edit, at normal playback rate. Multiple/repeated/rate-changing edits, multiple descriptions and unrepresented media samples are rejected. Existing production eligibility gates still run before A; thus a source rejected by Smart Copy cannot reach D through this harness, even if a future standalone remuxer might support it. This is not a general source-container copier.

Recreate all synthetic fixtures and full A/B/C/D reports (without overwriting existing evidence):

```sh
python3 tools/make-ab-fixtures.py /tmp/studio-d-new-study
```

The resulting `measurements.json` is a compact evidence summary; `comparison.json` in each fixture directory retains packet-level evidence. To rebuild only the compact summary from retained reports:

```sh
python3 tools/make-ab-fixtures.py /tmp/studio-d-new-study --summarize
```

Research pushes use the `[CF-Pages-Skip]` commit prefix so GitHub Actions runs without triggering Cloudflare preview/production deployment, per [Cloudflare's GitHub integration documentation](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message). Main remains unchanged. This prefix must not be carried into any future explicitly authorized deployment commit.

### Independent reference-container prototype

The separate [compatibility prototype](KILATFRAME-PROTOTYPE.md) builds N (sample-preserving layout) and explicitly enabled O/T/K diagnostics for audio-origin reset and four real AAC tail packets. It compares against A and D without changing either harness contract or production behavior. Audio-changing diagnostics are never labeled lossless; native measurements demonstrate synchronization changes and nonzero decoder overlap residuals. See [findings and readiness recommendation](../docs/kilatframe-compatibility-prototype.md).
