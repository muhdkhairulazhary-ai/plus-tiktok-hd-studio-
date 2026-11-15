# plus+ TikTok HD Studio

Mobile-first, client-side TikTok video processing prototype.

## Status: beta / not production-ready

- Target: 1080p portrait/landscape, 60 FPS, HEVC H.265.
- Uses browser WebCodecs VideoEncoder and mp4-muxer loaded from CDN.
- **Audio is not included in exported files yet.** Do not use for final TikTok posting if sound is required.
- HEVC encode depends on Safari hardware/browser support; unsupported devices receive an error.
- Video limited to 60 seconds to reduce memory pressure. 4K output is not yet implemented.
- Encoding is local; no video upload server.
- TikTok may recompress output regardless of these settings.
- Browser compatibility, muxer CDN availability, actual MP4 playback and iPhone exports need end-to-end testing.

## Cloudflare Pages

Connect this GitHub repository to Cloudflare Pages. Framework preset: None. Build command: leave empty. Output directory: `/` (repository root). Deploy from `main`.

## Next work

Add audio preservation/muxing and iOS Safari integration tests before labeling the tool production-ready.
