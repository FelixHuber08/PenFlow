use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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
}

impl Job {
    fn idle() -> Self {
        Job {
            lines: vec![],
            current: 0,
            running: false,
            paused: false,
        }
    }
}

pub struct GrblState {
    pub status: Arc<Mutex<MachineStatus>>,
    wco: Arc<Mutex<[f64; 3]>>,
    write_port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    job: Arc<Mutex<Job>>,
    zero_after_home: Arc<Mutex<bool>>,
}

impl GrblState {
    pub fn new() -> Self {
        GrblState {
            status: Arc::new(Mutex::new(MachineStatus::default())),
            wco: Arc::new(Mutex::new([0.0, 0.0, 0.0])),
            write_port: Arc::new(Mutex::new(None)),
            job: Arc::new(Mutex::new(Job::idle())),
            zero_after_home: Arc::new(Mutex::new(false)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.write_port.lock().unwrap().is_some()
    }

    pub fn send_raw(&self, cmd: &str) -> Result<(), String> {
        let mut guard = self.write_port.lock().unwrap();
        if let Some(port) = guard.as_mut() {
            if cmd.trim() == "$H" {
                *self.zero_after_home.lock().unwrap() = true;
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

        let status_arc = Arc::clone(&self.status);
        let wco_arc = Arc::clone(&self.wco);
        let write_arc = Arc::clone(&self.write_port);
        let job_arc = Arc::clone(&self.job);
        let zero_after_home_arc = Arc::clone(&self.zero_after_home);
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

        // Status polling thread (sends ? every 200ms)
        let write_arc2 = Arc::clone(&self.write_port);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(200));
            let mut guard = write_arc2.lock().unwrap();
            if let Some(p) = guard.as_mut() {
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
        let mut guard = self.write_port.lock().unwrap();
        *guard = None;
        *self.zero_after_home.lock().unwrap() = false;
        let mut s = self.status.lock().unwrap();
        s.connected = false;
        s.state = "Disconnected".into();
    }

    pub fn start_job(&self, lines: Vec<String>) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected".into());
        }
        let first = lines.first().cloned().unwrap_or_default();
        {
            let mut job = self.job.lock().unwrap();
            *job = Job {
                lines,
                current: 0,
                running: true,
                paused: false,
            };
        }
        self.send_raw(&first)?;
        Ok(())
    }

    pub fn pause_job(&self) -> Result<(), String> {
        let mut job = self.job.lock().unwrap();
        job.paused = true;
        drop(job);
        self.send_raw("!")
    }

    pub fn resume_job(&self) -> Result<(), String> {
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

fn handle_grbl_line(
    line: &str,
    status_arc: &Arc<Mutex<MachineStatus>>,
    wco_arc: &Arc<Mutex<[f64; 3]>>,
    write_arc: &Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    job_arc: &Arc<Mutex<Job>>,
    zero_after_home_arc: &Arc<Mutex<bool>>,
    app: &AppHandle,
) {
    if line.is_empty() {
        return;
    }

    let trimmed = line.to_string();
    let _ = app.emit("grbl-line", &trimmed);

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
            let mut wp = write_arc.lock().unwrap();
            if let Some(p) = wp.as_mut() {
                let _ = app.emit("grbl-line", "> G10 L20 P1 X0 Y0 Z0");
                let _ = app.emit("grbl-line", "> ?");
                let _ = p.write_all(b"G10 L20 P1 X0 Y0 Z0\n?");
                let _ = p.flush();
                let _ = app.emit("grbl-line", "[home] Work position zeroed");
            }
            return;
        }

        // Advance streaming job
        let mut job = job_arc.lock().unwrap();
        if job.running && !job.paused {
            job.current += 1;
            let progress = JobProgress {
                sent: job.current,
                total: job.lines.len(),
            };
            let _ = app.emit("grbl-job-progress", &progress);

            if job.current < job.lines.len() {
                let next = job.lines[job.current].clone();
                drop(job);
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
