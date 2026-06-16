import { useEffect, useRef, useState, useCallback, ReactNode } from "react";
import {
  Home, Unlock, Square, MapPin, ChevronRight,
  Power, PowerOff, SlidersHorizontal,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ChevronUp, ChevronDown, Crosshair, X, Check,
} from "lucide-react";
import { MachineStatus, SERVO_HOLD_INTERVAL_MS, SERVO_HOLD_PWM, PAPER_A4, MACHINE } from "../lib/types";
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

const FEEDS = [100, 500, 1000, 2000, 3000] as const;

// Large travel distance for continuous jog; GRBL cancels cleanly on 0x85.
const CONTINUOUS_DIST_XY = 500;
const CONTINUOUS_DIST_Z = 50;

// Key → [axis, direction]
const KEY_MAP: Record<string, [string, 1 | -1]> = {
  ArrowLeft:  ["X", -1],
  ArrowRight: ["X",  1],
  ArrowUp:    ["Y",  1],
  ArrowDown:  ["Y", -1],
  PageUp:     ["Z",  1],
  PageDown:   ["Z", -1],
};

function JogPanel({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const [feed, setFeed] = useState(1000);

  const can = connected && !disabled;

  // Refs so keyboard handlers always see latest values without re-registering.
  const canRef  = useRef(can);
  const feedRef = useRef(feed);
  useEffect(() => { canRef.current  = can;  }, [can]);
  useEffect(() => { feedRef.current = feed; }, [feed]);

  const jogging = useRef<string | null>(null); // e.g. "X+1"

  const startJog = useCallback((axis: string, dir: 1 | -1) => {
    if (!canRef.current) return;
    const key = `${axis}${dir}`;
    if (jogging.current === key) return; // already jogging this direction
    jogging.current = key;
    const f    = axis === "Z" ? 200 : feedRef.current;
    const dist = axis === "Z" ? CONTINUOUS_DIST_Z : CONTINUOUS_DIST_XY;
    Grbl.jog(axis, dir * dist, f);
  }, []);

  const stopJog = useCallback(() => {
    if (!jogging.current) return;
    jogging.current = null;
    Grbl.jogCancel();
  }, []);

  // Cancel any active jog when we become disabled (e.g. disconnect).
  useEffect(() => {
    if (!can && jogging.current) stopJog();
  }, [can, stopJog]);

  // Keyboard bindings (active globally when this panel is rendered).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || !(e.key in KEY_MAP)) return;
      // Don't steal keys from input fields.
      if (document.activeElement?.tagName === "INPUT") return;
      e.preventDefault();
      const [axis, dir] = KEY_MAP[e.key];
      startJog(axis, dir);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!(e.key in KEY_MAP)) return;
      e.preventDefault();
      stopJog();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup",   onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup",   onUp);
    };
  }, [startJog, stopJog]);

  // Button that starts continuous jog on press and cancels on release.
  const ArrowBtn = ({
    axis, dir, children, title,
  }: { axis: string; dir: 1 | -1; children: ReactNode; title?: string }) => (
    <button
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startJog(axis, dir); }}
      onPointerUp={stopJog}
      onPointerCancel={stopJog}
      onPointerLeave={stopJog}
      disabled={!can}
      title={title}
      className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] active:bg-[#efefed] disabled:opacity-30 transition-colors text-[#37352f] select-none"
    >
      {children}
    </button>
  );

  return (
    <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Jog</p>
        <p className="text-[10px] text-[#9b9b98]">Halten = kontinuierlich · ↑↓←→ PgUp/Dn</p>
      </div>

      <div className="flex gap-4 items-start">
        {/* XY pad */}
        <div className="grid grid-cols-3 gap-1.5">
          <div />
          <ArrowBtn axis="Y" dir={1} title="Y+ (↑)"><ArrowUp size={13} /></ArrowBtn>
          <div />

          <ArrowBtn axis="X" dir={-1} title="X− (←)"><ArrowLeft size={13} /></ArrowBtn>
          <button
            onPointerDown={() => Grbl.goHome()}
            disabled={!can}
            title="Go to XY zero"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] active:bg-[#efefed] disabled:opacity-30 transition-colors text-[#37352f] select-none"
          >
            <Home size={11} className="text-[#787774]" />
          </button>
          <ArrowBtn axis="X" dir={1} title="X+ (→)"><ArrowRight size={13} /></ArrowBtn>

          <div />
          <ArrowBtn axis="Y" dir={-1} title="Y− (↓)"><ArrowDown size={13} /></ArrowBtn>
          <div />
        </div>

        {/* Z axis */}
        <div className="flex flex-col items-center gap-1.5">
          <ArrowBtn axis="Z" dir={1} title="Z+ (PgUp)"><ChevronUp size={13} /></ArrowBtn>
          <span className="text-[10px] text-[#9b9b98] font-medium">Z</span>
          <ArrowBtn axis="Z" dir={-1} title="Z− (PgDn)"><ChevronDown size={13} /></ArrowBtn>
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

// ─── Action Button ───────────────────────────────────────────────────────────

function Btn({
  onClick, icon: Icon, label, danger, disabled: dis, connected,
}: {
  onClick: () => void; icon: typeof Home; label: string; danger?: boolean; disabled?: boolean; connected: boolean;
}) {
  return (
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
}

// ─── Paper leveling ──────────────────────────────────────────────────────────
//
// Drives the pen to each corner of the preconfigured A4 sheet at writing height
// so the user can verify the paper sits flat and square before plotting. The A4
// origin maps to work-coordinate (0,0) — same frame the slicer generates G-code
// in — so the corners are simply (0,0) → (PAPER_A4.w, PAPER_A4.h).

const LEVEL_PEN_UP_Z = 0;            // matches slicer DEFAULT_CONFIG.penUpZ
const DEFAULT_WRITE_Z = 6.5;         // matches slicer DEFAULT_CONFIG.penDownZ
const LEVEL_TRAVEL_FEED = MACHINE.maxFeedXY;
const LEVEL_Z_FEED = MACHINE.maxFeedZ;

const A4_CORNERS: { label: string; x: number; y: number }[] = [
  { label: "Ecke 1", x: PAPER_A4.w, y: PAPER_A4.h }, // max X / max Y (far corner)
  { label: "Ecke 2", x: 0,          y: PAPER_A4.h },
  { label: "Ecke 3", x: 0,          y: 0          }, // Nullpunkt
  { label: "Ecke 4", x: PAPER_A4.w, y: 0          },
];

/** Lift pen, rapid to the corner, then lower to writing height (Z down). */
function gotoCorner(i: number, writeZ: number): Promise<void> {
  const c = A4_CORNERS[i];
  return Grbl.sendCommand(
    `G90\n` +
    `G0 Z${LEVEL_PEN_UP_Z} F${LEVEL_Z_FEED}\n` +
    `G0 X${c.x} Y${c.y} F${LEVEL_TRAVEL_FEED}\n` +
    `G1 Z${writeZ.toFixed(3)} F${LEVEL_Z_FEED}`
  );
}

function PaperLevelModal({
  step, writeZ, onNext, onCancel,
}: {
  step: number; writeZ: number; onNext: () => void; onCancel: () => void;
}) {
  const corner = A4_CORNERS[step];
  const isLast = step === A4_CORNERS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex flex-col bg-white rounded-2xl shadow-2xl w-[400px] max-w-[95vw] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9e9e7]">
          <div className="flex items-center gap-2">
            <Crosshair size={15} className="text-[#787774]" />
            <h2 className="text-[15px] font-semibold text-[#37352f]">Papier nivellieren</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#37352f] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {A4_CORNERS.map((_, i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all ${
                  i === step ? "w-6 bg-[#37352f]" : i < step ? "w-2 bg-green-500" : "w-2 bg-[#e9e9e7]"
                }`}
              />
            ))}
          </div>

          <div className="text-center space-y-1">
            <p className="text-[12px] text-[#9b9b98]">{corner.label} von {A4_CORNERS.length}</p>
            <p className="text-[20px] font-light tabular-nums text-[#37352f] font-mono">
              X{corner.x} · Y{corner.y}
            </p>
            <p className="text-[11px] text-[#9b9b98]">Schreibhöhe Z{writeZ.toFixed(2)} mm</p>
          </div>

          <p className="text-[12px] text-[#787774] text-center leading-relaxed">
            Der Stift fährt zu dieser Ecke und senkt sich auf Schreibhöhe.
            Prüfe, ob die Spitze das Papier exakt berührt — dann bestätigen.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e7] flex gap-2 p-4 bg-[#fafaf9]">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#787774] hover:bg-[#f7f7f5] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#37352f] text-white text-[12px] font-medium hover:bg-[#2c2b26] transition-colors"
          >
            <Check size={13} />
            {isLast ? "Fertig" : "Bestätigen → nächste Ecke"}
          </button>
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
  // "Jog" excluded: GRBL accepts new $J= commands while already jogging (planner queue).
  const canJog = connected && !inAlarm && !["Run", "Hold", "Home"].includes(status.state);

  const [servoPwm, setServoPwm] = useState(SERVO_HOLD_PWM);
  const [servoHolding, setServoHolding] = useState(false);

  // Paper leveling: walk the pen to each A4 corner with a confirm step between.
  const [writeZ, setWriteZ] = useState(DEFAULT_WRITE_Z);
  const [levelStep, setLevelStep] = useState<number | null>(null);

  const startLeveling = useCallback(async () => {
    setLevelStep(0);
    await gotoCorner(0, writeZ);
  }, [writeZ]);

  const levelNext = useCallback(async () => {
    if (levelStep === null) return;
    const next = levelStep + 1;
    if (next >= A4_CORNERS.length) {
      // Done — lift the pen and end the routine.
      setLevelStep(null);
      await Grbl.sendCommand(`G90\nG0 Z${LEVEL_PEN_UP_Z} F${LEVEL_Z_FEED}`);
      return;
    }
    setLevelStep(next);
    await gotoCorner(next, writeZ);
  }, [levelStep, writeZ]);

  const levelCancel = useCallback(async () => {
    setLevelStep(null);
    await Grbl.sendCommand(`G90\nG0 Z${LEVEL_PEN_UP_Z} F${LEVEL_Z_FEED}`);
  }, []);

  // Abort leveling if the connection drops.
  useEffect(() => {
    if (!connected) setLevelStep(null);
  }, [connected]);

  const [consoleHeight, setConsoleHeight] = useState(200);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: consoleHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setConsoleHeight(Math.max(80, Math.min(600, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [consoleHeight]);

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

  return (
    <div className="flex flex-col h-full w-full flex-1 overflow-hidden">

      {/* ── Top: 2×2 grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 p-4 overflow-y-auto flex-1 min-h-0">

        {/* Position */}
        <DROPanel status={status} />

        {/* Jog */}
        <JogPanel connected={connected} disabled={!canJog} />

        {/* Actions */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Aktionen</p>

          <div className="grid grid-cols-3 gap-1.5">
            <Btn onClick={() => Grbl.home()} icon={Home} label="Homing" connected={connected} />
            <Btn onClick={() => Grbl.unlock()} icon={Unlock} label="Unlock" connected={connected} />
            <Btn onClick={() => Grbl.zeroXY()} icon={MapPin} label="Zero XY" disabled={!canJog} connected={connected} />
            <Btn onClick={() => Grbl.goHome()} icon={ChevronRight} label="Go Home" disabled={!canJog} connected={connected} />
            <Btn onClick={() => Grbl.motorsOn()} icon={Power} label="Motoren an" connected={connected} />
            <Btn onClick={() => Grbl.motorsOff()} icon={PowerOff} label="Motoren aus" connected={connected} />
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

        {/* Paper leveling */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Papier nivellieren</p>
          <p className="text-[11px] text-[#9b9b98] leading-relaxed">
            Fährt nacheinander zu den vier Ecken des A4-Blatts ({PAPER_A4.w}×{PAPER_A4.h} mm)
            auf Schreibhöhe und wartet je Ecke auf Bestätigung — so prüfst du die Papierlage.
          </p>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#9b9b98] flex-shrink-0">Schreibhöhe Z</span>
            <input
              type="number"
              value={writeZ}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setWriteZ(v);
              }}
              min={0} max={50} step={0.1}
              className="flex-1 rounded-md border border-[#e9e9e7] px-2 py-1 text-right text-[12px] tabular-nums text-[#37352f] focus:outline-none focus:ring-1 focus:ring-[#37352f]"
            />
            <span className="text-[11px] text-[#9b9b98] flex-shrink-0">mm</span>
          </div>

          <button
            onClick={startLeveling}
            disabled={!canJog || levelStep !== null}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#37352f] hover:bg-[#f7f7f5] disabled:opacity-30 transition-colors"
          >
            <Crosshair size={13} />
            Nivellierung starten
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

      {/* ── Console — resizable via drag handle ──────────────────────────── */}
      <div className="flex-shrink-0 border-t border-[#e9e9e7]" style={{ height: consoleHeight }}>
        {/* drag handle */}
        <div
          onMouseDown={onDragStart}
          className="h-1.5 w-full cursor-row-resize flex items-center justify-center group select-none"
          title="Zum Größe ändern ziehen"
        >
          <div className="w-8 h-0.5 rounded-full bg-[#d3d3d0] group-hover:bg-[#9b9b98] transition-colors" />
        </div>
        <div className="h-[calc(100%-6px)]">
          <Console lines={consoleLines} onClear={onClearConsole} connected={connected} />
        </div>
      </div>

      {/* ── Paper leveling modal ─────────────────────────────────────────── */}
      {levelStep !== null && (
        <PaperLevelModal
          step={levelStep}
          writeZ={writeZ}
          onNext={levelNext}
          onCancel={levelCancel}
        />
      )}

    </div>
  );
}
