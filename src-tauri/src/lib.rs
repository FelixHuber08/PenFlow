mod grbl;

use grbl::{GrblState, JobProgress, MachineStatus};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub grbl: Mutex<GrblState>,
}

#[tauri::command]
fn list_ports() -> Vec<String> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.port_name)
        .collect()
}

#[tauri::command]
fn connect(port: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let grbl = state.grbl.lock().unwrap();
    grbl.connect(&port, app)
}

#[tauri::command]
fn disconnect(state: State<AppState>) {
    let grbl = state.grbl.lock().unwrap();
    grbl.disconnect();
}

#[tauri::command]
fn send_command(cmd: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    for line in cmd.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let _ = app.emit("grbl-line", format!("> {}", line));
    }
    let grbl = state.grbl.lock().unwrap();
    grbl.send_raw(&cmd)
}

#[tauri::command]
fn get_status(state: State<AppState>) -> MachineStatus {
    let grbl = state.grbl.lock().unwrap();
    let s = grbl.status.lock().unwrap().clone();
    s
}

#[tauri::command]
fn start_job(lines: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let grbl = state.grbl.lock().unwrap();
    grbl.start_job(lines)
}

#[tauri::command]
fn pause_job(state: State<AppState>) -> Result<(), String> {
    let grbl = state.grbl.lock().unwrap();
    grbl.pause_job()
}

#[tauri::command]
fn resume_job(state: State<AppState>) -> Result<(), String> {
    let grbl = state.grbl.lock().unwrap();
    grbl.resume_job()
}

#[tauri::command]
fn stop_job(state: State<AppState>) -> Result<(), String> {
    let grbl = state.grbl.lock().unwrap();
    grbl.stop_job()
}

#[tauri::command]
fn get_job_progress(state: State<AppState>) -> JobProgress {
    let grbl = state.grbl.lock().unwrap();
    grbl.get_job_progress()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            grbl: Mutex::new(GrblState::new()),
        })
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect,
            disconnect,
            send_command,
            get_status,
            start_job,
            pause_job,
            resume_job,
            stop_job,
            get_job_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
