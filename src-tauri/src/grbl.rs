use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

static TX_SEQ: AtomicU64 = AtomicU64::new(0);
static RX_SEQ: AtomicU64 = AtomicU64::new(0);

fn next_tx() -> u64 { TX_SEQ.fetch_add(1, Ordering::Relaxed) }
fn next_rx() -> u64 { RX_SEQ.fetch_add(1, Ordering::Relaxed) }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MachineStatus {
    pub state: String,
    pub wpos: [f64; 3],
    pub mpos: [f64; 3],
    pub feed: f64,
    pub spindle: f64,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub sent: usize,
    pub total: usize,
}

struct Job {
    lines: Vec<String>,
    current: usize,
    running: bool,
    paused: bool,
    /// How often to emit grbl-job-progress (every N commands). Calculated on start.
    progress_interval: usize,
}

impl Job {
    fn idle() -> Self {
        Job {
            lines: vec![],
            current: 0,
            running: false,
            paused: false,
            progress_interval: 1,
        }
    }
}

pub struct GrblState {
    pub status: Arc<Mutex<MachineStatus>>,
    wco: Arc<Mutex<[f64; 3]>>,
    write_port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    job: Arc<Mutex<Job>>,
    zero_after_home: Arc<Mutex<bool>>,
    /// True from the moment $H is written until ok or ALARM is received.
    /// Poller skips ? queries while this is set to avoid cluttering the
    /// GRBL input buffer during the homing cycle.
    homing: Arc<Mutex<bool>>,
    ring_buf: Arc<Mutex<VecDeque<String>>>,
    debug_app: Arc<Mutex<Option<AppHandle>>>,
}

// ─── Timestamp helper (HH:MM:SS.mmm UTC) ────────────────────────────────────
fn ts() -> String {
    let ms_total = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let ms = ms_total % 86_400_000;
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1_000;
    let ms_part = ms % 1_000;
    format!("{:02}:{:02}:{:02}.{:03}", h, m, s, ms_part)
}

// ─── Ring buffer (capped at 100 entries) ────────────────────────────────────
fn push_ring(ring: &Arc<Mutex<VecDeque<String>>>, msg: &str) {
    let mut r = ring.lock().unwrap();
    if r.len() >= 100 {
        r.pop_front();
    }
    r.push_back(msg.to_string());
}

// ─── Emit grbl-debug and push to ring buffer ────────────────────────────────
fn dbg_emit(ring: &Arc<Mutex<VecDeque<String>>>, app: &AppHandle, msg: &str) {
    push_ring(ring, msg);
    let _ = app.emit("grbl-debug", msg);
}

/// Real-time GRBL commands are single control bytes that bypass the 128-byte
/// line buffer, produce **no** `ok`, and are therefore the only commands safe
/// to send while a job is streaming. Everything else (`G…`, `$…`, `$J=…`) is a
/// normal line that consumes an `ok` — injecting one mid-job would advance the
/// stream past a real drawing line.
///   ?  status   !  feed-hold   ~  cycle-start   0x18 soft-reset
///   0x85 jog-cancel   0x90–0xA6 feed/rapid/spindle overrides
pub fn is_realtime_cmd(cmd: &str) -> bool {
    let bytes = cmd.as_bytes();
    if bytes.len() != 1 {
        return false;
    }
    let b = bytes[0];
    matches!(b, b'?' | b'!' | b'~' | 0x18 | 0x85) || (0x90..=0xA6).contains(&b)
}

// ─── TX label for realtime bytes (body only — caller prepends TX[seq]) ──────
fn tx_body(cmd: &str) -> String {
    match cmd {
        "!" => "FEED_HOLD (!)".to_string(),
        "~" => "CYCLE_START (~)".to_string(),
        "\x18" => "SOFT_RESET (0x18 Ctrl+X)".to_string(),
        s if s.as_bytes().first() == Some(&0x85) => "JOG_CANCEL (0x85)".to_string(),
        "?" => "STATUS_QUERY (?)".to_string(),
        s => s.to_string(),
    }
}

impl GrblState {
    pub fn new() -> Self {
        GrblState {
            status: Arc::new(Mutex::new(MachineStatus::default())),
            wco: Arc::new(Mutex::new([0.0, 0.0, 0.0])),
            write_port: Arc::new(Mutex::new(None)),
            job: Arc::new(Mutex::new(Job::idle())),
            zero_after_home: Arc::new(Mutex::new(false)),
            homing: Arc::new(Mutex::new(false)),
            ring_buf: Arc::new(Mutex::new(VecDeque::new())),
            debug_app: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.write_port.lock().unwrap().is_some()
    }

    pub fn is_job_running(&self) -> bool {
        self.job.lock().unwrap().running
    }

    // Logs the TX and writes to the serial port.
    pub fn send_raw(&self, cmd: &str) -> Result<(), String> {
        let mut guard = self.write_port.lock().unwrap();
        if let Some(port) = guard.as_mut() {
            if cmd.trim() == "$H" {
                *self.zero_after_home.lock().unwrap() = true;
                *self.homing.lock().unwrap() = true;
            }
            let msg = format!("[{}] TX[{}] {}", ts(), next_tx(), tx_body(cmd));
            if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
                dbg_emit(&self.ring_buf, app, &msg);
            } else {
                push_ring(&self.ring_buf, &msg);
            }
            let line = format!("{}\n", cmd);
            port.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            port.flush().map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Not connected".into())
        }
    }

    pub fn connect(&self, port_name: &str, app: AppHandle) -> Result<(), String> {
        let port = serialport::new(port_name, 115200)
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(|e| e.to_string())?;

        let read_port = port.try_clone().map_err(|e| e.to_string())?;

        {
            let mut guard = self.write_port.lock().unwrap();
            *guard = Some(port);
        }

        {
            let mut s = self.status.lock().unwrap();
            s.connected = true;
            s.state = "Connected".into();
        }

        // Store app handle for use in send_raw and other non-threaded paths.
        *self.debug_app.lock().unwrap() = Some(app.clone());

        let msg = format!("[{}] [debug] connect() called on {}", ts(), port_name);
        dbg_emit(&self.ring_buf, &app, &msg);

        let status_arc = Arc::clone(&self.status);
        let wco_arc = Arc::clone(&self.wco);
        let write_arc = Arc::clone(&self.write_port);
        let job_arc = Arc::clone(&self.job);
        let zero_after_home_arc = Arc::clone(&self.zero_after_home);
        let homing_arc = Arc::clone(&self.homing);
        let ring_arc = Arc::clone(&self.ring_buf);
        let app_clone = app.clone();

        // Reader thread
        std::thread::spawn(move || {
            let mut reader = BufReader::new(read_port);
            let mut line = Vec::new();

            loop {
                line.clear();
                match reader.read_until(b'\n', &mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&line);
                        handle_grbl_line(
                            text.trim(),
                            &status_arc,
                            &wco_arc,
                            &write_arc,
                            &job_arc,
                            &zero_after_home_arc,
                            &homing_arc,
                            &ring_arc,
                            &app_clone,
                        );
                    }
                    Err(e) if e.kind() == ErrorKind::TimedOut => continue,
                    Err(e) => {
                        let _ = app_clone.emit("grbl-line", format!("[serial error] {}", e));
                        break;
                    }
                }
            }
            // Port disconnected
            {
                let mut wp = write_arc.lock().unwrap();
                *wp = None;
            }
            {
                let mut s = status_arc.lock().unwrap();
                s.connected = false;
                s.state = "Disconnected".into();
            }
            let _ = app_clone.emit("grbl-disconnected", ());
        });

        // Status polling thread (sends ? every 200ms).
        // Skips the query while homing is active so $H has a clean serial line.
        let write_arc2 = Arc::clone(&self.write_port);
        let homing_arc2 = Arc::clone(&self.homing);
        let ring_arc2 = Arc::clone(&self.ring_buf);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(200));
            if *homing_arc2.lock().unwrap() {
                let skip_msg = format!("[{}] TX STATUS_QUERY (?) — skipped: homing active", ts());
                push_ring(&ring_arc2, &skip_msg);
                continue;
            }
            let mut guard = write_arc2.lock().unwrap();
            if let Some(p) = guard.as_mut() {
                let poll_msg = format!("[{}] TX[{}] STATUS_QUERY (?)", ts(), next_tx());
                push_ring(&ring_arc2, &poll_msg);
                if p.write_all(b"?").is_err() {
                    break;
                }
                let _ = p.flush();
            } else {
                break;
            }
        });

        Ok(())
    }

    pub fn disconnect(&self) {
        if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
            let msg = format!("[{}] [debug] disconnect() called", ts());
            dbg_emit(&self.ring_buf, app, &msg);
        }
        let mut guard = self.write_port.lock().unwrap();
        *guard = None;
        *self.zero_after_home.lock().unwrap() = false;
        *self.homing.lock().unwrap() = false;
        let mut s = self.status.lock().unwrap();
        s.connected = false;
        s.state = "Disconnected".into();
    }

    pub fn start_job(&self, lines: Vec<String>) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected".into());
        }
        if self.is_job_running() {
            return Err("Es läuft bereits ein Job.".into());
        }
        // Safety: only start streaming from a settled, ready state. Starting while
        // the machine is in Run/Hold/Alarm/Home/Jog would desync the ok-handshake
        // or stream G-code into a locked controller (every line → error).
        {
            let state_now = self.status.lock().unwrap().state.clone();
            if !matches!(state_now.as_str(), "Idle" | "Connected" | "Check") {
                return Err(format!(
                    "Job kann im Zustand '{}' nicht gestartet werden. Maschine erst auf 'Idle' bringen (entsperren/homen).",
                    state_now
                ));
            }
        }
        if lines.is_empty() {
            return Err("Keine G-Code-Zeilen zum Senden.".into());
        }
        let total = lines.len();
        let first = lines.first().cloned().unwrap_or_default();

        if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
            let msg = format!(
                "[{}] [debug] start_job() total={} first={:?}",
                ts(),
                total,
                first
            );
            dbg_emit(&self.ring_buf, app, &msg);
        }

        // Flush any stale bytes left in the serial RX buffer from earlier commands
        // (e.g. a late `error:3`/`ok` from homing or unlock). Otherwise the first
        // ack of the new job could be misattributed — a stray `error` aborts the
        // fresh job, a stray `ok` advances the stream past a real line.
        {
            let mut guard = self.write_port.lock().unwrap();
            if let Some(p) = guard.as_mut() {
                let _ = p.clear(serialport::ClearBuffer::Input);
            }
        }

        {
            let progress_interval = (total / 100).max(1);
            let mut job = self.job.lock().unwrap();
            *job = Job {
                lines,
                current: 0,
                running: true,
                paused: false,
                progress_interval,
            };
        }
        self.send_raw(&first)?;
        Ok(())
    }

    pub fn pause_job(&self) -> Result<(), String> {
        if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
            let msg = format!("[{}] [debug] pause_job() called", ts());
            dbg_emit(&self.ring_buf, app, &msg);
        }
        let mut job = self.job.lock().unwrap();
        job.paused = true;
        drop(job);
        self.send_raw("!")
    }

    pub fn resume_job(&self) -> Result<(), String> {
        if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
            let msg = format!("[{}] [debug] resume_job() called", ts());
            dbg_emit(&self.ring_buf, app, &msg);
        }
        let mut job = self.job.lock().unwrap();
        job.paused = false;
        drop(job);
        self.send_raw("~")
    }

    pub fn stop_job(&self) -> Result<(), String> {
        {
            let mut job = self.job.lock().unwrap();
            job.running = false;
            job.paused = false;
        }
        // Notify the frontend immediately — the soft-reset below causes the Grbl
        // banner handler to see was_running=false and skip grbl-job-error, so
        // without this emit React's jobProgress would stay non-null forever.
        if let Some(app) = self.debug_app.lock().unwrap().as_ref() {
            let msg = format!("[{}] [debug] stop_job() called", ts());
            dbg_emit(&self.ring_buf, app, &msg);
            let _ = app.emit("grbl-job-stopped", ());
        }
        // Feed hold, then soft reset
        let _ = self.send_raw("!");
        std::thread::sleep(Duration::from_millis(50));
        self.send_raw("\x18") // Ctrl+X
    }

    pub fn get_job_progress(&self) -> JobProgress {
        let job = self.job.lock().unwrap();
        JobProgress {
            sent: job.current,
            total: job.lines.len(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_grbl_line(
    line: &str,
    status_arc: &Arc<Mutex<MachineStatus>>,
    wco_arc: &Arc<Mutex<[f64; 3]>>,
    write_arc: &Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    job_arc: &Arc<Mutex<Job>>,
    zero_after_home_arc: &Arc<Mutex<bool>>,
    homing_arc: &Arc<Mutex<bool>>,
    ring_buf: &Arc<Mutex<VecDeque<String>>>,
    app: &AppHandle,
) {
    if line.is_empty() {
        return;
    }

    let trimmed = line.to_string();

    // Log every received line. Status responses (<...>) go to ring buffer only
    // to avoid flooding the grbl-debug channel every 200 ms.
    let is_status = trimmed.starts_with('<');
    let rx_idx = next_rx();
    if is_status {
        let rx_msg = format!("[{}] RX[{}] {}", ts(), rx_idx, trimmed);
        push_ring(ring_buf, &rx_msg);
    } else {
        let rx_msg = format!("[{}] RX[{}] {}", ts(), rx_idx, trimmed);
        dbg_emit(ring_buf, app, &rx_msg);
    }

    // Emit grbl-line for everything except bare "ok" during a running job —
    // those flood the console and cause React to re-render on every ack.
    let is_ok = trimmed == "ok" || trimmed.starts_with("ok ");
    let job_running = job_arc.lock().unwrap().running;
    if !(is_ok && job_running) {
        let _ = app.emit("grbl-line", &trimmed);
    }

    if trimmed.starts_with('<') {
        // Status response: <Idle|WPos:0.000,0.000,0.000|FS:0,0>
        if let Some(status) = parse_status(&trimmed, wco_arc) {
            let mut s = status_arc.lock().unwrap();
            s.state = status.state.clone();
            s.wpos = status.wpos;
            s.mpos = status.mpos;
            s.feed = status.feed;
            s.spindle = status.spindle;
            let emit_val = s.clone();
            drop(s);
            let _ = app.emit("grbl-status", emit_val);
        }
    } else if trimmed.starts_with("ALARM") {
        *zero_after_home_arc.lock().unwrap() = false;
        *homing_arc.lock().unwrap() = false;
        let emit_val = {
            let mut s = status_arc.lock().unwrap();
            s.state = "Alarm".into();
            s.clone()
        };
        let _ = app.emit("grbl-status", emit_val);
        if trimmed == "ALARM:8" {
            let _ = app.emit(
                "grbl-line",
                "[alarm] Homing failed. Check limit switches, homing direction, and travel distance.",
            );
        } else {
            let _ = app.emit("grbl-line", format!("[alarm] {}", alarm_help(&trimmed)));
        }
    } else if trimmed == "ok" || trimmed.starts_with("ok") {
        let should_zero_after_home = {
            let mut pending = zero_after_home_arc.lock().unwrap();
            let should_zero = *pending;
            *pending = false;
            should_zero
        };

        if should_zero_after_home {
            // Homing cycle completed — clear flag and resume ? polling.
            // Auto-zeroing (G10 L20 P1 X0 Y0 Z0) is intentionally disabled:
            // sending it immediately after $H was causing ALARM:8 on some runs
            // because a preceding ok (e.g. from $X) could fire this branch
            // before $H had actually finished. Zero manually via "Zero XY".
            *homing_arc.lock().unwrap() = false;
            let done_msg = format!("[{}] [home] Homing ok received — polling resumed", ts());
            push_ring(ring_buf, &done_msg);
            let _ = app.emit("grbl-line", "[home] Homing complete");
            return;
        }

        // Advance streaming job
        let mut job = job_arc.lock().unwrap();
        if job.running && !job.paused {
            job.current += 1;
            let current = job.current;
            let total = job.lines.len();
            let interval = job.progress_interval;

            // Throttle progress events: emit every N commands or on the last one.
            if current % interval == 0 || current >= total {
                let _ = app.emit("grbl-job-progress", &JobProgress { sent: current, total });
            }

            if current < total {
                let next = job.lines[current].clone();
                drop(job);
                let tx_msg = format!("[{}] TX[{}] {} (job line {}/{})", ts(), next_tx(), next, current, total);
                dbg_emit(ring_buf, app, &tx_msg);
                let mut wp = write_arc.lock().unwrap();
                if let Some(p) = wp.as_mut() {
                    let _ = p.write_all(format!("{}\n", next).as_bytes());
                    let _ = p.flush();
                }
            } else {
                job.running = false;
                drop(job);
                let _ = app.emit("grbl-job-done", ());
            }
        }
    } else if trimmed.starts_with("error") {
        // Job error: stop streaming.
        let mut job = job_arc.lock().unwrap();
        if job.running {
            job.running = false;
            let _ = app.emit("grbl-job-error", &trimmed);
        }
    } else if trimmed.starts_with("Grbl ") {
        // Controller reset mid-job (power issue, watchdog, etc.) — stop streaming
        // so queued commands don't execute after $X unlock in an unpredictable order.
        let mut job = job_arc.lock().unwrap();
        let was_running = job.running;
        let current = job.current;
        let total = job.lines.len();
        let last_cmd = if current > 0 {
            job.lines[current - 1].clone()
        } else {
            "(none — reset before first ok)".to_string()
        };
        let remaining: Vec<String> = job.lines[current..]
            .iter()
            .take(20)
            .cloned()
            .collect();
        job.running = false;
        drop(job);

        if was_running {
            // ── Diagnostic dump ───────────────────────────────────────────
            let ring_snapshot: Vec<String> =
                ring_buf.lock().unwrap().iter().cloned().collect();

            let _ = app.emit("grbl-line", "╔══════════════════════════════════════╗");
            let _ = app.emit("grbl-line", "║  CONTROLLER RESET DETECTED (Grbl 1.1h banner)  ║");
            let _ = app.emit("grbl-line", "╚══════════════════════════════════════╝");
            let _ = app.emit(
                "grbl-line",
                "[reset] Wahrscheinlich Brownout: MCU neu gestartet, USB blieb verbunden. \
                 Tritt meist direkt nach einer Z-/Servo-Bewegung auf → Stromversorgung prüfen \
                 (Servo separat speisen, Elko 470–1000 µF, gemeinsame Masse).",
            );
            let _ = app.emit(
                "grbl-line",
                format!("[reset] Job line index: {}/{}", current, total),
            );
            let _ = app.emit(
                "grbl-line",
                format!("[reset] Last TX command: {}", last_cmd),
            );
            let _ = app.emit(
                "grbl-line",
                format!(
                    "[reset] Next {} queued lines: {}",
                    remaining.len(),
                    remaining.join(" | ")
                ),
            );
            let _ = app.emit(
                "grbl-line",
                format!(
                    "── TX/RX ring buffer ({} entries, newest last) ──",
                    ring_snapshot.len()
                ),
            );
            for entry in &ring_snapshot {
                let _ = app.emit("grbl-line", entry.as_str());
            }
            let _ = app.emit("grbl-line", "── end ring buffer ──");

            let _ = app.emit("grbl-job-error", "Controller reset during job — job aborted");
        }

        // Auto-unlock: send $X after 1 s so the machine leaves ALARM state
        // and can accept $H immediately. Safe — $X never causes motion.
        let write_arc_unlock = Arc::clone(write_arc);
        let app_unlock = app.clone();
        let ring_unlock = Arc::clone(ring_buf);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1000));
            let mut wp = write_arc_unlock.lock().unwrap();
            if let Some(p) = wp.as_mut() {
                let msg = format!("[{}] TX auto-unlock ($X) after controller reset", ts());
                push_ring(&ring_unlock, &msg);
                let _ = p.write_all(b"$X\n");
                let _ = p.flush();
                let _ = app_unlock.emit(
                    "grbl-line",
                    "[reset] Automatisch entsperrt ($X) — bitte homen ($H) bevor neu gedruckt wird.",
                );
            }
        });
    }
}

fn alarm_help(alarm: &str) -> &'static str {
    match alarm {
        "ALARM:1" => "Hard limit triggered.",
        "ALARM:2" => "Soft limit triggered.",
        "ALARM:3" => "Abort during cycle.",
        "ALARM:4" => "Probe fail.",
        "ALARM:5" => "Probe fail.",
        "ALARM:6" => "Homing fail: reset during active cycle.",
        "ALARM:7" => "Homing fail: safety door opened.",
        "ALARM:8" => "Homing fail: limit switch not found or not released.",
        "ALARM:9" => "Homing fail: could not clear limit switch.",
        _ => "Machine alarm. Check GRBL status and unlock only when safe.",
    }
}

fn parse_status(s: &str, wco_arc: &Arc<Mutex<[f64; 3]>>) -> Option<MachineStatus> {
    // <Idle|WPos:0.000,0.000,0.000|FS:0,0>
    // <Run|MPos:1.000,2.000,3.000|WCO:0,0,0|FS:500,0>
    let inner = s.strip_prefix('<')?.strip_suffix('>')?;
    let mut parts = inner.split('|');
    let state = parts.next()?.to_string();

    let mut status = MachineStatus {
        state: state.split(':').next().unwrap_or("").to_string(),
        ..Default::default()
    };
    status.connected = true;
    let mut has_wpos = false;
    let mut has_mpos = false;
    let mut wco: Option<[f64; 3]> = None;

    for part in parts {
        if let Some(rest) = part.strip_prefix("WPos:") {
            let coords: Vec<f64> = rest.split(',').filter_map(|v| v.parse().ok()).collect();
            if coords.len() >= 3 {
                has_wpos = true;
                status.wpos = [coords[0], coords[1], coords[2]];
            }
        } else if let Some(rest) = part.strip_prefix("MPos:") {
            let coords: Vec<f64> = rest.split(',').filter_map(|v| v.parse().ok()).collect();
            if coords.len() >= 3 {
                has_mpos = true;
                status.mpos = [coords[0], coords[1], coords[2]];
            }
        } else if let Some(rest) = part.strip_prefix("WCO:") {
            let coords: Vec<f64> = rest.split(',').filter_map(|v| v.parse().ok()).collect();
            if coords.len() >= 3 {
                wco = Some([coords[0], coords[1], coords[2]]);
            }
        } else if let Some(rest) = part.strip_prefix("FS:") {
            let vals: Vec<f64> = rest.split(',').filter_map(|v| v.parse().ok()).collect();
            if vals.len() >= 2 {
                status.feed = vals[0];
                status.spindle = vals[1];
            }
        }
    }

    if let Some(wco) = wco {
        *wco_arc.lock().unwrap() = wco;
        if has_mpos {
            status.wpos = [
                status.mpos[0] - wco[0],
                status.mpos[1] - wco[1],
                status.mpos[2] - wco[2],
            ];
        } else if has_wpos {
            status.mpos = [
                status.wpos[0] + wco[0],
                status.wpos[1] + wco[1],
                status.wpos[2] + wco[2],
            ];
        }
    } else if has_mpos && !has_wpos {
        let wco = *wco_arc.lock().unwrap();
        status.wpos = [
            status.mpos[0] - wco[0],
            status.mpos[1] - wco[1],
            status.mpos[2] - wco[2],
        ];
    } else if has_wpos && !has_mpos {
        status.mpos = status.wpos;
    }

    Some(status)
}
