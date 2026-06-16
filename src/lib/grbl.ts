import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { MachineStatus, JobProgress, SERVO_HOLD_PWM } from "./types";

export const Grbl = {
  listPorts: () => invoke<string[]>("list_ports"),
  connect: (port: string) => invoke<void>("connect", { port }),
  disconnect: () => invoke<void>("disconnect"),
  sendCommand: (cmd: string) => invoke<void>("send_command", { cmd }),
  getStatus: () => invoke<MachineStatus>("get_status"),
  startJob: (lines: string[]) => invoke<void>("start_job", { lines }),
  pauseJob: () => invoke<void>("pause_job"),
  resumeJob: () => invoke<void>("resume_job"),
  stopJob: () => invoke<void>("stop_job"),
  getJobProgress: () => invoke<JobProgress>("get_job_progress"),

  // Shorthand GRBL commands
  home: () => invoke<void>("send_command", { cmd: "$H" }),
  unlock: () => invoke<void>("send_command", { cmd: "$X\n?" }),
  motorsOn: () => invoke<void>("send_command", { cmd: "$1=255" }),
  motorsOff: () => invoke<void>("send_command", { cmd: "$1=25" }),
  reset: () => invoke<void>("send_command", { cmd: "\x18" }),
  zeroAll: () => invoke<void>("send_command", { cmd: "G10 L20 P1 X0 Y0 Z0\n?" }),
  zeroXY: () => invoke<void>("send_command", { cmd: "G10 L20 P1 X0 Y0\n?" }),
  goHome: () => invoke<void>("send_command", { cmd: "G90 G0 X0 Y0 F3000" }),
  spindleOn: (rpm: number) => invoke<void>("send_command", { cmd: `M3 S${rpm}` }),
  spindleOff: () => invoke<void>("send_command", { cmd: "M5" }),
  servoHold: (pwm = SERVO_HOLD_PWM) => invoke<void>("send_command", { cmd: `M3 S${pwm}` }),
  unlockAndServoHold: async (pwm = SERVO_HOLD_PWM) => {
    await invoke<void>("send_command", { cmd: "$X" });
    await delay(150);
    await invoke<void>("send_command", { cmd: `M3 S${pwm}` });
  },
  servoOff: () => invoke<void>("send_command", { cmd: "M5" }),
  setFeedOverride: (pct: number) => {
    // GRBL real-time feed override bytes
    const byte = feedOverrideByte(pct);
    if (byte) return invoke<void>("send_command", { cmd: byte });
  },

  jog: (axis: string, dist: number, feed: number) =>
    invoke<void>("send_command", { cmd: `$J=G91 ${axis}${dist} F${feed}` }),

  jogCancel: () => invoke<void>("send_command", { cmd: "\x85" }), // 0x85 jog cancel
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function feedOverrideByte(pct: number): string | null {
  // GRBL real-time override: 0x90=100%, 0x91=+10%, 0x92=-10%, 0x93=+1%, 0x94=-1%
  if (pct === 100) return "\x90";
  return null;
}

// Event listeners
export function onStatus(cb: (s: MachineStatus) => void): Promise<UnlistenFn> {
  return listen<MachineStatus>("grbl-status", (e) => cb(e.payload));
}

export function onLine(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("grbl-line", (e) => cb(e.payload));
}

export function onJobProgress(cb: (p: JobProgress) => void): Promise<UnlistenFn> {
  return listen<JobProgress>("grbl-job-progress", (e) => cb(e.payload));
}

export function onJobDone(cb: () => void): Promise<UnlistenFn> {
  return listen("grbl-job-done", () => cb());
}

export function onJobError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("grbl-job-error", (e) => cb(e.payload));
}

export function onJobStopped(cb: () => void): Promise<UnlistenFn> {
  return listen("grbl-job-stopped", () => cb());
}

export function onDisconnected(cb: () => void): Promise<UnlistenFn> {
  return listen("grbl-disconnected", () => cb());
}

export function onDebug(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("grbl-debug", (e) => cb(e.payload));
}
