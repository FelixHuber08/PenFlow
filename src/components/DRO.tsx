import { Fragment } from "react";
import { MachineStatus } from "../lib/types";

interface Props {
  status: MachineStatus;
}

const axes = ["X", "Y", "Z"] as const;

export default function DRO({ status }: Props) {
  const alarm = status.state === "Alarm";

  return (
    <div className="bg-white border border-[#e9e9e7] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
          Position
        </p>
        <span className="text-[10px] text-[#9b9b98] tabular-nums">mm</span>
      </div>

      {alarm && (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2">
          <p className="text-[11px] font-medium text-red-600">Alarm lock</p>
          <p className="text-[10px] text-red-500">Home failed. Jogging is blocked by GRBL.</p>
        </div>
      )}

      <div className="grid grid-cols-[16px_1fr_1fr] gap-x-2 gap-y-1.5 items-baseline">
        <span />
        <span className="text-[10px] font-medium text-[#9b9b98] uppercase tracking-wider">WCS</span>
        <span className="text-[10px] font-medium text-[#9b9b98] uppercase tracking-wider">MCS</span>
        {axes.map((ax, i) => (
          <Fragment key={ax}>
            <span className="text-[12px] font-medium text-[#787774]">{ax}</span>
            <span className="text-[20px] font-light tabular-nums text-[#37352f] tracking-tight font-mono">
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
        <div className="text-[11px] text-[#9b9b98] tabular-nums">
          F {status.feed.toFixed(0)}
        </div>
      </div>
    </div>
  );
}

function stateColor(state: string): string {
  const map: Record<string, string> = {
    Idle: "bg-green-400", Run: "bg-blue-400", Hold: "bg-amber-400",
    Alarm: "bg-red-400", Home: "bg-blue-400", Jog: "bg-blue-300",
  };
  return map[state] ?? "bg-gray-300";
}
