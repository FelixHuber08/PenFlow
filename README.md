# PenFlow

Desktop app for controlling GRBL-based pen plotters. Import SVG files, slice to vector or raster G-code, preview placement on A4 canvas, and plot with automatic 12-pen color separation.

Built with [Tauri 2](https://tauri.app), React 19, and Rust.

---

## Features

- **SVG import** — drag-and-drop or file picker
- **Vector slicing** — traces paths using browser-native SVG geometry APIs (no external parser)
- **Raster slicing** — renders SVG to canvas, generates horizontal scan-line G-code
- **A4 canvas preview** — drag to reposition, scale, rotate 90°
- **Multi-color mode** — detects stroke/fill colors per path and assigns each to one of 12 configurable pen slots; generates automatic pick/drop G-code for the pen changer
- **Live machine control** — jog, home, set WCO, console
- **Job streaming** — simple ok-wait streaming over serial (GRBL 1.1h)
- **Time estimate** — feed-aware duration calculation before plotting

## Requirements

| Runtime | Version |
|---------|---------|
| GRBL firmware | 1.1h |
| Machine axes | X · Y · Z (pen lift) |
| Pen slots | up to 12 (configurable) |

## Downloads

Pre-built installers are attached to every [GitHub Release](../../releases):

| Platform | File |
|----------|------|
| macOS (Universal) | `PenFlow_*_universal.dmg` |
| Windows 64-bit | `PenFlow_*_x64-setup.exe` |
| Linux AppImage | `PenFlow_*_amd64.AppImage` |
| Linux Debian | `PenFlow_*_amd64.deb` |

## Build from source

**Prerequisites:** Node.js ≥ 18, Rust (stable), Tauri CLI v2

```bash
# Install frontend deps
npm install

# Dev mode (hot-reload)
npm run tauri dev

# Production build
npm run tauri build
```

Linux also needs:
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libudev-dev
```

## Releasing

Push a tag — GitHub Actions builds installers for all platforms automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow creates a draft release with all three platform installers attached. Publish the draft when ready.

## Architecture

Two-process Tauri model:

- **Rust backend** (`src-tauri/src/`) — owns the serial port, streams G-code, emits status events
- **React frontend** (`src/`) — renders UI, slices SVG to G-code, sends commands via Tauri IPC

See the source code for detailed architecture notes.

## Developers

- Felix Huber
- Bennet Unger

## License

MIT
