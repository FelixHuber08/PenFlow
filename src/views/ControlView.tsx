import { useEffect, useState } from "react";
import { Home, Unlock, Square, MapPin, ChevronRight, Power, PowerOff, SlidersHorizontal } from "lucide-react";
import { MachineStatus, SERVO_HOLD_INTERVAL_MS, SERVO_HOLD_PWM } from "../lib/types";
import { Grbl } from "../lib/grbl";
import DRO from "../components/DRO";
import JogPad from "../components/JogPad";
import Console from "../components/Console";

interface Props {
  status: MachineStatus;
  consoleLines: string[];
  onClearConsole: () => void;
  jobProgress: { sent: number; total: number } | null;
  onStartJob?: (lines: string[]) => void;
}

export default function ControlView({
  status,
  consoleLines,
  onClearConsole,
  jobProgress,
}: Props) {
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

    const id = window.setInterval(() => {
      Grbl.servoHold(servoPwm);
    }, SERVO_HOLD_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [connected, jobProgress, servoHolding, servoPwm]);

  const toggleServoHold = async () => {
    if (!connected) return;
    if (servoHolding) {
      setServoHolding(false);
      await Grbl.servoOff();
      return;
    }

    await Grbl.unlockAndServoHold(servoPwm);
    setServoHolding(true);
  };

  const ActionBtn = ({
    onClick,
    icon: Icon,
    label,
    danger,
    disabled,
  }: {
    onClick: () => void;
    icon: typeof Home;
    label: string;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || !connected}
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
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-[260px] flex-shrink-0 border-r border-[#e9e9e7] overflow-y-auto p-4 space-y-4">
        {/* DRO */}
        <DRO status={status} />

        {/* Quick actions */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Actions</p>
          <div className="grid grid-cols-2 gap-1.5">
            <ActionBtn onClick={() => Grbl.home()} icon={Home} label="Home" />
            <ActionBtn onClick={() => Grbl.unlock()} icon={Unlock} label="Unlock" />
            <ActionBtn onClick={() => Grbl.zeroXY()} icon={MapPin} label="Zero XY" disabled={!canJog} />
            <ActionBtn onClick={() => Grbl.goHome()} icon={ChevronRight} label="Go Home" disabled={!canJog} />
            <ActionBtn onClick={() => Grbl.motorsOn()} icon={Power} label="Motor On" />
            <ActionBtn onClick={() => Grbl.motorsOff()} icon={PowerOff} label="Motor Off" />
          </div>

          <div className="pt-1 border-t border-[#e9e9e7]">
            <ActionBtn
              onClick={() => Grbl.stopJob()}
              icon={Square}
              label="STOP"
              danger
            />
          </div>
        </div>

        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
            Servo D11
          </p>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-[#787774]" />
            <input
              type="number"
              value={servoPwm}
              onChange={(e) => setServoPwm(Number(e.target.value))}
              min={0}
              max={1000}
              step={10}
              className="w-full rounded-md border border-[#e9e9e7] px-2 py-1 text-right text-[12px] tabular-nums text-[#37352f] focus:outline-none focus:ring-1 focus:ring-[#37352f]"
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={toggleServoHold}
              disabled={!connected}
              className={`rounded-lg border px-3 py-2 text-[12px] font-medium disabled:opacity-30 ${
                servoHolding
                  ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-[#e9e9e7] bg-white text-[#37352f] hover:bg-[#f7f7f5]"
              }`}
            >
              {servoHolding ? "Holding" : "Unlock + Hold"}
            </button>
            <button
              onClick={() => {
                setServoHolding(false);
                Grbl.servoOff();
              }}
              disabled={!connected}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-30"
            >
              Off
            </button>
          </div>
        </div>

        {/* Jog pad */}
        <JogPad connected={connected} disabled={!canJog} />

        {/* Job progress */}
        {jobProgress && jobProgress.total > 0 && (
          <div className="bg-white border border-[#e9e9e7] rounded-xl p-4">
            <div className="flex justify-between text-[12px] text-[#787774] mb-2">
              <span>Job progress</span>
              <span className="tabular-nums">
                {jobProgress.sent}/{jobProgress.total}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#37352f] rounded-full transition-all"
                style={{ width: `${(jobProgress.sent / jobProgress.total) * 100}%` }}
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => Grbl.pauseJob()}
                className="flex-1 py-1.5 text-[11px] border border-[#e9e9e7] rounded-md hover:bg-[#f7f7f5] text-[#37352f]"
              >
                Pause
              </button>
              <button
                onClick={() => Grbl.resumeJob()}
                className="flex-1 py-1.5 text-[11px] border border-[#e9e9e7] rounded-md hover:bg-[#f7f7f5] text-[#37352f]"
              >
                Resume
              </button>
              <button
                onClick={() => Grbl.stopJob()}
                className="flex-1 py-1.5 text-[11px] border border-red-200 rounded-md bg-red-50 hover:bg-red-100 text-red-600"
              >
                Stop
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Console */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Console lines={consoleLines} onClear={onClearConsole} connected={connected} />
      </div>
    </div>
  );
}
