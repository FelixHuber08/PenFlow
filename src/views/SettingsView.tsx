import {
  MACHINE,
  PenChangeConfig,
  PenSlot,
  SERVO_HOLD_INTERVAL_MS,
  SERVO_HOLD_JOB_EVERY_LINES,
  SERVO_HOLD_PWM,
} from "../lib/types";

interface Props {
  penSlots: PenSlot[];
  penChange: PenChangeConfig;
  onPenSlotsChange: (slots: PenSlot[]) => void;
  onPenChangeChange: (config: PenChangeConfig) => void;
}

export default function SettingsView({ penSlots, penChange, onPenSlotsChange, onPenChangeChange }: Props) {
  function updateSlot(index: number, patch: Partial<PenSlot>) {
    onPenSlotsChange(penSlots.map((s) => (s.index === index ? { ...s, ...patch } : s)));
  }
  const Row = ({ label, value, unit }: { label: string; value: string | number; unit?: string }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-[#f0f0ee] last:border-0">
      <span className="text-[13px] text-[#787774]">{label}</span>
      <span className="text-[13px] text-[#37352f] font-mono tabular-nums">
        {value}{unit && <span className="text-[#9b9b98] ml-1">{unit}</span>}
      </span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-8 max-w-xl">
      <h1 className="text-[20px] font-semibold text-[#37352f] mb-1">Settings</h1>
      <p className="text-[13px] text-[#787774] mb-8">Machine profile and configuration</p>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          Machine Profile
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4">
          <Row label="Bed X" value={MACHINE.bedX} unit="mm" />
          <Row label="Bed Y" value={MACHINE.bedY} unit="mm" />
          <Row label="Steps/mm XY" value={MACHINE.stepsPerMmXY} />
          <Row label="Steps/mm Z" value={MACHINE.stepsPerMmZ} />
          <Row label="Max feed XY" value={MACHINE.maxFeedXY} unit="mm/min" />
          <Row label="Max feed Z" value={MACHINE.maxFeedZ} unit="mm/min" />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          Connection
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4">
          <Row label="Baud rate" value="115200" />
          <Row label="Protocol" value="GRBL 1.1h" />
          <Row label="Status poll" value="200" unit="ms" />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          Servo Hold
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4">
          <Row label="Signal pin" value="D11 / Spindle PWM" />
          <Row label="Hold command" value={`M3 S${SERVO_HOLD_PWM}`} />
          <Row label="Manual refresh" value={SERVO_HOLD_INTERVAL_MS} unit="ms" />
          <Row label="Print refresh" value={`Every ${SERVO_HOLD_JOB_EVERY_LINES} lines`} />
          <Row label="Pen lift" value="Z axis" />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          Pen Slots (12 Farben)
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4 py-3 space-y-2">
          {penSlots.map((slot) => (
            <div key={slot.index} className="flex items-center gap-2">
              <span className="text-[11px] text-[#9b9b98] w-4 tabular-nums">{slot.index + 1}</span>
              <input
                type="color"
                value={slot.color}
                onChange={(e) => updateSlot(slot.index, { color: e.target.value })}
                className="w-7 h-7 rounded-md cursor-pointer border border-[#e9e9e7] p-0.5 bg-white flex-shrink-0"
                title={slot.color}
              />
              <input
                type="text"
                value={slot.name}
                onChange={(e) => updateSlot(slot.index, { name: e.target.value })}
                className="flex-1 text-[12px] border border-[#e9e9e7] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f]"
              />
              <label className="flex items-center gap-1 cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(e) => updateSlot(slot.index, { enabled: e.target.checked })}
                  className="w-3.5 h-3.5 accent-[#37352f]"
                />
                <span className="text-[11px] text-[#787774]">aktiv</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          Stiftwechsler
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["Rack X", "rackX", "mm"],
                ["Rack Y", "rackY", "mm"],
                ["Abstand X", "slotSpacingX", "mm"],
                ["Abstand Y", "slotSpacingY", "mm"],
              ] as [string, keyof PenChangeConfig, string][]
            ).map(([label, key, unit]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-[11px] text-[#787774]">{label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={penChange[key] as number}
                    onChange={(e) => onPenChangeChange({ ...penChange, [key]: parseFloat(e.target.value) || 0 })}
                    className="w-full text-[12px] border border-[#e9e9e7] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f]"
                  />
                  <span className="text-[11px] text-[#9b9b98] w-6">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-[#787774]">Stift aufnehmen (GCode)</span>
            <textarea
              value={penChange.pickGcode}
              onChange={(e) => onPenChangeChange({ ...penChange, pickGcode: e.target.value })}
              rows={3}
              className="w-full text-[11px] font-mono border border-[#e9e9e7] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f]"
              placeholder="; GCode zum Stift greifen..."
            />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] text-[#787774]">Stift ablegen (GCode)</span>
            <textarea
              value={penChange.dropGcode}
              onChange={(e) => onPenChangeChange({ ...penChange, dropGcode: e.target.value })}
              rows={3}
              className="w-full text-[11px] font-mono border border-[#e9e9e7] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f]"
              placeholder="; GCode zum Stift ablegen..."
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
          About
        </h2>
        <div className="bg-white border border-[#e9e9e7] rounded-xl px-4">
          <Row label="Version" value="1.0.0" />
          <Row label="Built with" value="Tauri + React" />
        </div>
      </section>
    </div>
  );
}
