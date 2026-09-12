# Changelog

## [1.0.0] — 2026-09-13

Fresh public baseline containing the complete current OpenScreen Studio experience:

- Local-first screenshots: visible area, selected area, full page and screen/window capture.
- Image editor with copy, annotations, numbered steps, pixelation, crop and exports.
- Screen and camera recording with microphone, system audio, floating camera, live drawing and audio meters.
- Video editor and a local media library.
- Vietnamese and English interface selection.
- No account, watermark, analytics or artificial feature limits.

### Reliability fixes included

- Chrome Tab and Window capture reads the display track directly, with a guarded video fallback.
- Selected-area capture waits until the temporary dimmed overlay is removed and painted before taking the screenshot.
