import { useEffect, useState } from "react";
import {
  Home, Unlock, Square, MapPin, ChevronRight,
  Power, PowerOff, SlidersHorizontal,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ChevronUp, ChevronDown,
} from "lucide-react";
import { MachineStatus, SERVO_HOLD_INTERVAL_MS, SERVO_HOLD_PWM } from "../lib/types";
import { Grbl } from "../lib/grbl";
import Console from "../components/Console";
import { Fragment } from "react";

// ─── DRO (Position) ──────────────────────────────────────────────────────────

function stateColor(state: string): string {
  const map: Record<string, string> = {
    Idle: "bg-green-400", Run: "bg-blue-400", Hold: "bg-amber-400",
    Alarm: "bg-red-400", Home: "bg-blue-400", Jog: "bg-blue-300",
  };
  return map[state] ?? "bg-gray-300";
}

function DROPanel({ status }: { status: MachineStatus }) {
  const alarm = status.state === "Alarm";
  const axes = ["X", "Y", "Z"] as const;

  return (
    <div className="bg-white border border-[#e9e9e7] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Position</p>
        <span className="text-[10px] text-[#9b9b98]">mm</span>
      </div>

      {alarm && (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2">
          <p className="text-[11px] font-medium text-red-600">Alarm lock</p>
          <p className="text-[10px] text-red-500">Jogging blockiert. Erst entsperren.</p>
        </div>
      )}

      <div className="grid grid-cols-[16px_1fr_1fr] gap-x-2 gap-y-2 items-baseline">
        <span />
        <span className="text-[10px] font-medium text-[#9b9b98] uppercase tracking-wider">WCS</span>
        <span className="text-[10px] font-medium text-[#9b9b98] uppercase tracking-wider">MCS</span>
        {axes.map((ax, i) => (
          <Fragment key={ax}>
            <span className="text-[12px] font-medium text-[#787774]">{ax}</span>
            <span className="text-[20px] font-light tabular-nums text-[#37352f] tracking-tight font-mono leading-none">
              {status.wpos[i].toFixed(3)}
            </span>
            <span className="text-[12px] tabular-nums text-[#9b9b98] tracking-tight font-mono">
              {status.mpos[i].toFixed(3)}
            </span>
          </Fragment>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-[#e9e9e7] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${stateColor(status.state)}`} />
          <span className="text-[11px] text-[#787774]">{status.state || "—"}</span>
        </div>
        <div className="text-[11px] text-[#9b9b98] tabular-nums font-mono">
          F {status.feed.toFixed(0)} mm/min
        </div>
      </div>
    </div>
  );
}

// ─── Jog Panel ───────────────────────────────────────────────────────────────

const STEPS = [0.1, 1, 5, 10, 50] as const;
const FEEDS = [100, 500, 1000, 2000, 3000] as const;

function JogPanel({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState(1000);

  const can = connected && !disabled;
  const jog = (axis: string, dir: 1 | -1) => {
    if (!can) return;
    const f = axis === "Z" ? 200 : feed;
    Grbl.jog(axis, dir * step, f);
  };

  const ArrowBtn = ({
    onClick, children, title,
  }: { onClick: () => void; children: React.ReactNode; title?: string }) => (
    <button
      onClick={onClick}
      disabled={!can}
      title={title}
      className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] active:bg-[#efefed] disabled:opacity-30 transition-colors text-[#37352f]"
    >
      {children}
    </button>
  );

  return (
    <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-4">
      <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Jog</p>

      <div className="flex gap-4 items-start">
        {/* XY pad */}
        <div className="grid grid-cols-3 gap-1.5">
          <div />
          <ArrowBtn onClick={() => jog("Y", 1)}><ArrowUp size={13} /></ArrowBtn>
          <div />

          <ArrowBtn onClick={() => jog("X", -1)}><ArrowLeft size={13} /></ArrowBtn>
          <ArrowBtn onClick={() => Grbl.goHome()} title="Go to XY zero">
            <Home size={11} className="text-[#787774]" />
          </ArrowBtn>
          <ArrowBtn onClick={() => jog("X", 1)}><ArrowRight size={13} /></ArrowBtn>

          <div />
          <ArrowBtn onClick={() => jog("Y", -1)}><ArrowDown size={13} /></ArrowBtn>
          <div />
        </div>

        {/* Z axis */}
        <div className="flex flex-col items-center gap-1.5">
          <ArrowBtn onClick={() => jog("Z", 1)} title="Z +"><ChevronUp size={13} /></ArrowBtn>
          <span className="text-[10px] text-[#9b9b98] font-medium">Z</span>
          <ArrowBtn onClick={() => jog("Z", -1)} title="Z −"><ChevronDown size={13} /></ArrowBtn>
        </div>
      </div>

      {/* Step size */}
      <div>
        <p className="text-[10px] text-[#9b9b98] mb-1.5 uppercase tracking-wider">Schritt (mm)</p>
        <div className="flex gap-1">
          {STEPS.map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
                step === s
                  ? "bg-[#37352f] text-white"
                  : "bg-[#f7f7f5] text-[#787774] hover:bg-[#efefed]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Feed rate */}
      <div>
        <p className="text-[10px] text-[#9b9b98] mb-1.5 uppercase tracking-wider">Feed XY (mm/min)</p>
        <div className="flex gap-1">
          {FEEDS.map((f) => (
            <button
              key={f}
              onClick={() => setFeed(f)}
              className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
                feed === f
                  ? "bg-[#37352f] text-white"
                  : "bg-[#f7f7f5] text-[#787774] hover:bg-[#efefed]"
              }`}
            >
              {f >= 1000 ? `${f / 1000}k` : f}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  status: MachineStatus;
  consoleLines: string[];
  onClearConsole: () => void;
  jobProgress: { sent: number; total: number } | null;
}

// ─── ControlView ─────────────────────────────────────────────────────────────

export default function ControlView({ status, consoleLines, onClearConsole, jobProgress }: Props) {
  const connected = status.connected;
  const inAlarm = status.state === "Alarm";
  const busy = ["Run", "Hold", "Home", "Jog"].includes(status.state);
  const canJog = connected && !inAlarm && !busy;

  const [servoPwm, setServoPwm] = useState(SERVO_HOLD_PWM);
  const [servoHolding, setServoHolding] = useState(false);

  useEffect(() => {
    if (!connected) setServoHolding(false);
  }, [connected]);

  useEffect(() => {
    if (!connected || !servoHolding || jobProgress) return;
    const id = window.setInterval(() => Grbl.servoHold(servoPwm), SERVO_HOLD_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connected, jobProgress, servoHolding, servoPwm]);

  const penDown = async () => {
    if (!connected) return;
    await Grbl.unlockAndServoHold(servoPwm);
    setServoHolding(true);
  };

  const penUp = async () => {
    setServoHolding(false);
    await Grbl.servoOff();
  };

  // shared button style
  const Btn = ({
    onClick, icon: Icon, label, danger, disabled: dis,
  }: {
    onClick: () => void; icon: typeof Home; label: string; danger?: boolean; disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={dis || !connected}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-30 ${
        danger
          ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
          : "border-[#e9e9e7] bg-white text-[#37352f] hover:bg-[#f7f7f5]"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Top: 2×2 grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 p-4 overflow-y-auto flex-shrink-0">

        {/* Position */}
        <DROPanel status={status} />

        {/* Jog */}
        <JogPanel connected={connected} disabled={!canJog} />

        {/* Actions */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Aktionen</p>

          <div className="grid grid-cols-3 gap-1.5">
            <Btn onClick={() => Grbl.home()} icon={Home} label="Homing" />
            <Btn onClick={() => Grbl.unlock()} icon={Unlock} label="Unlock" />
            <Btn onClick={() => Grbl.zeroXY()} icon={MapPin} label="Zero XY" disabled={!canJog} />
            <Btn onClick={() => Grbl.goHome()} icon={ChevronRight} label="Go Home" disabled={!canJog} />
            <Btn onClick={() => Grbl.motorsOn()} icon={Power} label="Motoren an" />
            <Btn onClick={() => Grbl.motorsOff()} icon={PowerOff} label="Motoren aus" />
          </div>

          <div className="pt-2 border-t border-[#e9e9e7]">
            <button
              onClick={() => Grbl.stopJob()}
              disabled={!connected}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 text-[12px] font-semibold hover:bg-red-100 disabled:opacity-30 transition-colors"
            >
              <Square size={12} fill="currentColor" />
              STOP
            </button>
          </div>
        </div>

        {/* Pen / Servo */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Stift / Servo D11</p>

          {/* Pen Up / Down — primary actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={penUp}
              disabled={!connected}
              className="flex flex-col items-center gap-1.5 py-3 rounded-lg border border-[#e9e9e7] bg-[#f7f7f5] text-[12px] font-medium text-[#37352f] hover:bg-[#efefed] disabled:opacity-30 transition-colors"
            >
              <ChevronUp size={16} strokeWidth={2.5} />
              Pen Up
            </button>
            <button
              onClick={penDown}
              disabled={!connected}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-30 ${
                servoHolding
                  ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-[#e9e9e7] bg-white text-[#37352f] hover:bg-[#f7f7f5]"
              }`}
            >
              <ChevronDown size={16} strokeWidth={2.5} />
              {servoHolding ? "Holding" : "Pen Down"}
            </button>
          </div>

          {/* PWM value */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={12} className="text-[#9b9b98] flex-shrink-0" />
            <span className="text-[11px] text-[#9b9b98] flex-shrink-0">PWM</span>
            <input
              type="number"
              value={servoPwm}
              onChange={(e) => setServoPwm(Number(e.target.value))}
              min={0} max={1000} step={10}
              className="flex-1 rounded-md border border-[#e9e9e7] px-2 py-1 text-right text-[12px] tabular-nums text-[#37352f] focus:outline-none focus:ring-1 focus:ring-[#37352f]"
            />
          </div>

          {/* Off button */}
          <button
            onClick={penUp}
            disabled={!connected}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-[#e9e9e7] text-[11px] text-[#787774] hover:bg-[#f7f7f5] disabled:opacity-30 transition-colors"
          >
            Servo aus (M5)
          </button>
        </div>

      </div>

      {/* ── Job progress ─────────────────────────────────────────────────── */}
      {jobProgress && jobProgress.total > 0 && (
        <div className="flex-shrink-0 mx-4 mb-2 bg-white border border-[#e9e9e7] rounded-xl p-3">
          <div className="flex justify-between text-[11px] text-[#787774] mb-2">
            <span>Job läuft</span>
            <span className="tabular-nums font-mono">
              {jobProgress.sent} / {jobProgress.total} Zeilen
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-[#37352f] rounded-full transition-all duration-300"
              style={{ width: `${(jobProgress.sent / jobProgress.total) * 100}%` }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => Grbl.pauseJob()}
              className="flex-1 py-1.5 text-[11px] font-medium border border-[#e9e9e7] rounded-md hover:bg-[#f7f7f5] text-[#37352f] transition-colors"
            >
              Pause
            </button>
            <button
              onClick={() => Grbl.resumeJob()}
              className="flex-1 py-1.5 text-[11px] font-medium border border-[#e9e9e7] rounded-md hover:bg-[#f7f7f5] text-[#37352f] transition-colors"
            >
              Weiter
            </button>
            <button
              onClick={() => Grbl.stopJob()}
              className="flex-1 py-1.5 text-[11px] font-medium border border-red-200 rounded-md bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ── Console — volle Breite, nimmt restliche Höhe ─────────────────── */}
      <div className="flex-1 min-h-0 border-t border-[#e9e9e7]">
        <Console lines={consoleLines} onClear={onClearConsole} connected={connected} />
      </div>

    </div>
  );
}
