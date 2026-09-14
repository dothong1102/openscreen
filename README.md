# OpenScreen Studio

**A local-first Chrome extension for screenshots, annotation, and screen recording.**

OpenScreen Studio is an independent, open-source Manifest V3 extension built for people who need to capture, explain, and share work without creating an account or sending media to a cloud service. It has no watermark, subscription gate, or extension-imposed recording limit.

> Version 1.0.1 · Requires Google Chrome 116 or later

## Highlights

- **Flexible screenshots** — capture the visible area, a selected region, an entire page, a desktop/window, or a delayed screenshot.
- **Practical image editor** — draw, add arrows and text, create outline-only rectangles and circles, crop, pixelate sensitive details, add numbered steps, undo/redo, zoom, copy, and export.
- **Screen and camera recording** — record a Chrome tab, window, screen, or camera; optional microphone, system audio, and floating camera.
- **Recording controls** — pause/resume, microphone and camera controls, drawing pointer, click numbering, current-frame capture, and live audio-level feedback.
- **Local video editor** — trim a recording, add text or a highlight frame, then export a processed result locally.
- **On-device library** — save selected screenshots and recordings in IndexedDB, search, rename, download, delete, and keep track of recently opened media.

## Privacy by design

OpenScreen Studio does not require an account and contains no analytics, ads, tracking code, or remote-media upload endpoint. Capture data, recordings, settings, and library metadata are processed locally in the browser. Read the full [privacy policy](PRIVACY.md).

## Install for development

1. Clone or download this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**, then select this repository directory.
5. Pin **OpenScreen Studio** from Chrome's Extensions menu.

There is no build step, dependency installation, CDN, or external runtime required.

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Capture visible area | `Alt` + `Shift` + `V` | `Control` + `Shift` + `V` |
| Capture full page | `Alt` + `Shift` + `F` | `Control` + `Shift` + `F` |
| Capture selected area | `Alt` + `Shift` + `S` | `Control` + `Shift` + `S` |

You can change shortcut assignments from `chrome://extensions/shortcuts`.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `activeTab`, `scripting` | Capture or select content only after a user initiates an action. |
| `storage` | Persist extension preferences and small metadata. |
| `clipboardWrite` | Copy a captured image only when requested. |

Camera, microphone, and screen/window access are requested by Chrome at the time the user enables or starts those features.

## Browser limitations

- Chrome blocks captures of internal pages (`chrome://`), Chrome Web Store pages, and DRM-protected content.
- System audio, camera availability, MP4 output, high resolutions, and 60 fps depend on Chrome, OS support, hardware, and the source selected by the user.
- Recordings are assembled in memory until recording stops. For very long or high-resolution recordings, available memory may limit reliability.
- The local library is browser data: uninstalling the extension or clearing its site data can remove it. Download important files as a backup.

## Development and verification

This project uses plain HTML, CSS, and JavaScript; it intentionally has no package dependencies.

```bash
npm test
```

The validation checks Manifest V3 wiring, required files, and that runtime scripts do not load remote code or invoke unsafe dynamic evaluation.

## Contributing

Bug reports, usability feedback, documentation improvements, and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

OpenScreen Studio is released under the [MIT License](LICENSE).
