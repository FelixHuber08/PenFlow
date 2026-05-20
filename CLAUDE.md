# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev environment (Vite + Tauri hot-reload)
source ~/.cargo/env && npm run tauri dev

# TypeScript-only build check
npm run build

# Rust-only compile check
source ~/.cargo/env && cargo build --manifest-path src-tauri/Cargo.toml

# Install npm deps
npm install

# Add a Rust crate
source ~/.cargo/env && cargo add --manifest-path src-tauri/Cargo.toml <crate>
```

## Architecture

**Two-process model:** Tauri spawns a Rust process (backend) that owns the serial port and a WebView process (frontend) that renders the React UI. They communicate via Tauri commands (frontend → backend) and Tauri events (backend → frontend).

### Rust backend (`src-tauri/src/`)

- **`lib.rs`** — registers all `#[tauri::command]` functions and configures plugins (`dialog`, `fs`, `opener`). The `AppState` struct holds a `Mutex<GrblState>`.
- **`grbl.rs`** — `GrblState` owns the serial port and spawns two threads on `connect()`:
  - *Reader thread*: reads GRBL lines, emits `grbl-line` / `grbl-status` events, advances the streaming job on every `ok`.
  - *Poller thread*: sends `?` every 200 ms for status updates.
  - Job streaming uses simple ok-wait: next line is sent inside the reader thread when it receives `ok`, sharing the write handle via `Arc<Mutex<Box<dyn SerialPort>>>`.

### React frontend (`src/`)

- **`App.tsx`** — top-level layout; subscribes to all Tauri events on mount and holds global state (`MachineStatus`, console lines, job progress).
- **`lib/grbl.ts`** — thin wrappers around `invoke()` and `listen()` — the only place that touches `@tauri-apps/api`.
- **`lib/svgToGcode.ts`** — SVG parsing uses the browser's native `SVGGeometryElement.getTotalLength/getPointAtLength` (no external parser). Nodes are imported via `document.importNode` (not `innerHTML`) to avoid XSS.
- **`lib/types.ts`** — shared TypeScript types and the `MACHINE` constant (bed 270×360 mm, 80 steps/mm XY).

### Data flow

```
User clicks "Plot Now"
  → SlicerView calls parseSvgPaths() + generateGcode()  [frontend, browser SVG APIs]
  → Grbl.startJob(lines)                                 [invoke → Rust]
  → GrblState.start_job()  sends first line via serial
  → Arduino responds "ok"
  → reader thread sends next line  →  repeats until done
  → emits grbl-job-done  →  App.tsx updates UI
```

### Key constraints

- All serial writes go through `Arc<Mutex<Box<dyn SerialPort + Send>>>` — never write to the port from two places simultaneously.
- Tauri events are the only way to push data from Rust to React; use `app.emit("event-name", payload)` in Rust and `listen("event-name", cb)` in TypeScript.
- macOS `titleBarStyle: Overlay` is active — the top ~40 px of the window is the drag region (class `drag-region`). Interactive elements in that area need class `no-drag`.
- Machine profile (steps/mm, bed size, max feeds) lives in `src/lib/types.ts` as `MACHINE` — update there for hardware changes.
