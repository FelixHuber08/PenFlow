import { Crosshair, Scissors, Settings, Activity } from "lucide-react";
import { View } from "../lib/types";

interface Props {
  active: View;
  onChange: (v: View) => void;
  connected: boolean;
  machineState: string;
}

const items: { id: View; label: string; Icon: typeof Crosshair }[] = [
  { id: "control", label: "Control", Icon: Crosshair },
  { id: "slicer",  label: "Slicer",  Icon: Scissors },
  { id: "settings",label: "Settings",Icon: Settings },
];

const stateColor: Record<string, string> = {
  Idle:  "bg-green-500",
  Run:   "bg-blue-500",
  Hold:  "bg-amber-400",
  Alarm: "bg-red-500",
  Home:  "bg-blue-500",
  Jog:   "bg-blue-400",
  Disconnected: "bg-gray-300",
  Connected: "bg-green-500",
};

export default function Sidebar({ active, onChange, connected, machineState }: Props) {
  const dotColor = stateColor[machineState] ?? "bg-gray-300";

  return (
    <aside className="w-52 flex-shrink-0 border-r border-[#e9e9e7] flex flex-col bg-[#f7f7f5]">
      {/* macOS traffic light spacer */}
      <div className="h-10 drag-region" />

      {/* Logo / title */}
      <div className="px-4 pb-4 no-drag">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-[#37352f]" />
          <span className="text-[13px] font-semibold text-[#37352f] tracking-tight">
            Pen Plotter
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-0.5 no-drag">
        {items.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors text-left ${
              active === id
                ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-[#37352f] font-medium"
                : "text-[#787774] hover:bg-white/60 hover:text-[#37352f]"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {/* Status footer */}
      <div className="px-4 py-4 border-t border-[#e9e9e7] no-drag">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
          <span className="text-[12px] text-[#787774] truncate">
            {connected ? machineState : "Disconnected"}
          </span>
        </div>
      </div>
    </aside>
  );
}
