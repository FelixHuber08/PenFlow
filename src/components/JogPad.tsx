import { useState } from "react";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ChevronUp, ChevronDown, Home,
} from "lucide-react";
import { Grbl } from "../lib/grbl";

const STEPS = [0.1, 1, 5, 10, 50] as const;
const FEEDS = [100, 500, 1000, 2000, 3000] as const;

interface Props {
  connected: boolean;
  disabled?: boolean;
}

export default function JogPad({ connected, disabled = false }: Props) {
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState(1000);
  const [zFeed] = useState(200);

  const jog = (axis: string, dir: 1 | -1) => {
    if (!connected || disabled) return;
    const f = axis === "Z" ? zFeed : feed;
    Grbl.jog(axis, dir * step, f);
  };

  const canJog = connected && !disabled;
  const BtnBase = "flex items-center justify-center w-10 h-10 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] active:bg-[#efefed] disabled:opacity-30 transition-colors text-[#37352f]";

  return (
    <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-4">
      <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">Jog</p>

      {/* XY Pad */}
      <div className="grid grid-cols-3 gap-1.5 w-fit mx-auto">
        <div />
        <button disabled={!canJog} onClick={() => jog("Y", 1)} className={BtnBase}>
          <ArrowUp size={14} />
        </button>
        <div />

        <button disabled={!canJog} onClick={() => jog("X", -1)} className={BtnBase}>
          <ArrowLeft size={14} />
        </button>
        {/* Center: home XY */}
        <button
          disabled={!canJog}
          onClick={() => Grbl.goHome()}
          className={`${BtnBase} text-[#787774]`}
          title="Go to XY zero"
        >
          <Home size={12} />
        </button>
        <button disabled={!canJog} onClick={() => jog("X", 1)} className={BtnBase}>
          <ArrowRight size={14} />
        </button>

        <div />
        <button disabled={!canJog} onClick={() => jog("Y", -1)} className={BtnBase}>
          <ArrowDown size={14} />
        </button>
        <div />
      </div>

      {/* Z axis */}
      <div className="flex items-center justify-center gap-1.5">
        <button disabled={!canJog} onClick={() => jog("Z", 1)} className={BtnBase}>
          <ChevronUp size={14} />
        </button>
        <span className="text-[11px] text-[#9b9b98] px-2">Z</span>
        <button disabled={!canJog} onClick={() => jog("Z", -1)} className={BtnBase}>
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Step size */}
      <div>
        <p className="text-[11px] text-[#9b9b98] mb-1.5">Step (mm)</p>
        <div className="flex gap-1">
          {STEPS.map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`flex-1 py-1 rounded text-[11px] transition-colors ${
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
        <p className="text-[11px] text-[#9b9b98] mb-1.5">Feed XY (mm/min)</p>
        <div className="flex gap-1">
          {FEEDS.map((f) => (
            <button
              key={f}
              onClick={() => setFeed(f)}
              className={`flex-1 py-1 rounded text-[11px] transition-colors ${
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
