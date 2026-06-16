import { useState } from "react";
import { Cpu, Palette, Wrench, Info, Check } from "lucide-react";
import {
  MACHINE,
  PenChangeConfig,
  PenSlot,
  SERVO_HOLD_INTERVAL_MS,
  SERVO_HOLD_PWM,
} from "../lib/types";

interface Props {
  penSlots: PenSlot[];
  penChange: PenChangeConfig;
  onPenSlotsChange: (slots: PenSlot[]) => void;
  onPenChangeChange: (config: PenChangeConfig) => void;
}

type Section = "machine" | "pens" | "changer" | "about";

const NAV: { id: Section; label: string; icon: typeof Cpu; desc: string }[] = [
  { id: "machine", label: "Maschine", icon: Cpu, desc: "Profil & Verbindung" },
  { id: "pens", label: "Stifte", icon: Palette, desc: "12 Farbslots" },
  { id: "changer", label: "Stiftwechsler", icon: Wrench, desc: "Rack & G-Code" },
  { id: "about", label: "Info", icon: Info, desc: "Version" },
];

function InfoRow({ label, value, unit, mono = true }: { label: string; value: string | number; unit?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#f0f0ee] last:border-0">
      <span className="text-[13px] text-[#787774]">{label}</span>
      <span className={`text-[13px] text-[#37352f] ${mono ? "font-mono tabular-nums" : "font-medium"}`}>
        {value}
        {unit && <span className="text-[11px] text-[#9b9b98] ml-1.5">{unit}</span>}
      </span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-0.5">{title}</p>
      <div className="bg-white border border-[#e9e9e7] rounded-xl px-4">{children}</div>
    </div>
  );
}

export default function SettingsView({ penSlots, penChange, onPenSlotsChange, onPenChangeChange }: Props) {
  const [section, setSection] = useState<Section>("machine");

  function updateSlot(index: number, patch: Partial<PenSlot>) {
    onPenSlotsChange(penSlots.map((s) => (s.index === index ? { ...s, ...patch } : s)));
  }

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── Nav sidebar ──────────────────────────────────────────────────── */}
      <div className="w-[200px] flex-shrink-0 border-r border-[#e9e9e7] bg-[#fafaf9] p-3 space-y-1">
        <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-2 pb-2">
          Einstellungen
        </p>
        {NAV.map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
              section === id
                ? "bg-white border border-[#e9e9e7] shadow-sm"
                : "hover:bg-white/60"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
              section === id ? "bg-[#37352f] text-white" : "bg-[#f0f0ee] text-[#787774]"
            }`}>
              <Icon size={13} />
            </div>
            <div>
              <p className={`text-[12px] font-medium leading-tight ${section === id ? "text-[#37352f]" : "text-[#787774]"}`}>
                {label}
              </p>
              <p className="text-[10px] text-[#9b9b98] leading-tight">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl space-y-6">

          {/* ── Machine ────────────────────────────────────────────────── */}
          {section === "machine" && (
            <>
              <div>
                <h1 className="text-[18px] font-semibold text-[#37352f]">Maschine</h1>
                <p className="text-[13px] text-[#9b9b98] mt-0.5">Maschinenprofil und Verbindungsparameter</p>
              </div>

              <SectionCard title="Maschinenprofil">
                <InfoRow label="Bett X" value={MACHINE.bedX} unit="mm" />
                <InfoRow label="Bett Y" value={MACHINE.bedY} unit="mm" />
                <InfoRow label="Steps/mm XY" value={MACHINE.stepsPerMmXY} />
                <InfoRow label="Steps/mm Z" value={MACHINE.stepsPerMmZ} />
                <InfoRow label="Max Feed XY" value={MACHINE.maxFeedXY} unit="mm/min" />
                <InfoRow label="Max Feed Z" value={MACHINE.maxFeedZ} unit="mm/min" />
              </SectionCard>

              <SectionCard title="Verbindung">
                <InfoRow label="Baud rate" value="115200" />
                <InfoRow label="Protokoll" value="GRBL 1.1h" mono={false} />
                <InfoRow label="Status poll" value="200" unit="ms" />
              </SectionCard>

              <SectionCard title="Servo Hold">
                <InfoRow label="Signal pin" value="D11 / Spindle PWM" mono={false} />
                <InfoRow label="Hold command" value={`M3 S${SERVO_HOLD_PWM}`} />
                <InfoRow label="Manuelles Intervall" value={SERVO_HOLD_INTERVAL_MS} unit="ms" />
              </SectionCard>

              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-[12px] font-medium text-amber-700">Schreibgeschützt</p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  Diese Werte sind in <code className="font-mono bg-amber-100 px-1 rounded">src/lib/types.ts</code> definiert und erfordern einen Neustart.
                </p>
              </div>
            </>
          )}

          {/* ── Pens ───────────────────────────────────────────────────── */}
          {section === "pens" && (
            <>
              <div>
                <h1 className="text-[18px] font-semibold text-[#37352f]">Stifte</h1>
                <p className="text-[13px] text-[#9b9b98] mt-0.5">Farbe und Name für jeden der 12 Stiftslots</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {penSlots.map((slot) => (
                  <div
                    key={slot.index}
                    className={`bg-white border rounded-xl p-3 transition-all ${
                      slot.enabled ? "border-[#e9e9e7]" : "border-[#f0f0ee] opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2.5">
                      {/* Color swatch + picker */}
                      <label className="relative cursor-pointer flex-shrink-0">
                        <div
                          className="w-8 h-8 rounded-lg border-2 border-white shadow-sm ring-1 ring-[#e9e9e7] transition-transform hover:scale-105"
                          style={{ background: slot.color }}
                        />
                        <input
                          type="color"
                          value={slot.color}
                          onChange={(e) => updateSlot(slot.index, { color: e.target.value })}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </label>

                      {/* Slot number */}
                      <span className="text-[10px] font-semibold text-[#9b9b98] bg-[#f7f7f5] rounded-md px-1.5 py-0.5">
                        #{slot.index + 1}
                      </span>

                      {/* Enable toggle */}
                      <label className="ml-auto cursor-pointer flex-shrink-0">
                        <div className={`w-8 h-4.5 rounded-full transition-colors relative ${slot.enabled ? "bg-[#37352f]" : "bg-[#e9e9e7]"}`}
                             style={{ height: "18px", width: "32px" }}>
                          <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${slot.enabled ? "translate-x-[14px]" : "translate-x-0.5"}`} />
                        </div>
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => updateSlot(slot.index, { enabled: e.target.checked })}
                          className="sr-only"
                        />
                      </label>
                    </div>

                    {/* Name input */}
                    <input
                      type="text"
                      value={slot.name}
                      onChange={(e) => updateSlot(slot.index, { name: e.target.value })}
                      placeholder="Stiftname…"
                      className="w-full text-[12px] bg-[#f7f7f5] border-0 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] text-[#37352f] placeholder-[#c0c0be]"
                    />
                  </div>
                ))}
              </div>

              {/* Quick actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => onPenSlotsChange(penSlots.map((s) => ({ ...s, enabled: true })))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                >
                  <Check size={12} />
                  Alle aktivieren
                </button>
                <button
                  onClick={() => onPenSlotsChange(penSlots.map((s) => ({ ...s, enabled: false })))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] text-[#787774] hover:bg-[#f7f7f5] transition-colors"
                >
                  Alle deaktivieren
                </button>
              </div>
            </>
          )}

          {/* ── Pen changer ────────────────────────────────────────────── */}
          {section === "changer" && (
            <>
              <div>
                <h1 className="text-[18px] font-semibold text-[#37352f]">Stiftwechsler</h1>
                <p className="text-[13px] text-[#9b9b98] mt-0.5">Rackposition und Wechsel-G-Code</p>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-0.5">Rackposition</p>
                <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 grid grid-cols-2 gap-4">
                  {([
                    ["Rack X", "rackX", "mm"],
                    ["Rack Y", "rackY", "mm"],
                    ["Abstand X", "slotSpacingX", "mm"],
                    ["Abstand Y", "slotSpacingY", "mm"],
                  ] as [string, keyof PenChangeConfig, string][]).map(([label, key, unit]) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-[11px] font-medium text-[#787774]">{label}</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={penChange[key] as number}
                          onChange={(e) => onPenChangeChange({ ...penChange, [key]: parseFloat(e.target.value) || 0 })}
                          className="flex-1 text-[13px] border border-[#e9e9e7] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f] tabular-nums"
                        />
                        <span className="text-[11px] text-[#9b9b98] w-6 flex-shrink-0">{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-0.5">G-Code Sequenzen</p>
                <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-[#37352f]">Stift aufnehmen</label>
                    <p className="text-[11px] text-[#9b9b98]">Wird ausgeführt wenn die Maschine einen Stift greift</p>
                    <textarea
                      value={penChange.pickGcode}
                      onChange={(e) => onPenChangeChange({ ...penChange, pickGcode: e.target.value })}
                      rows={4}
                      className="w-full text-[12px] font-mono border border-[#e9e9e7] rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-[#fafaf9] text-[#37352f] leading-relaxed"
                      placeholder="; G-Code zum Stift greifen…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-[#37352f]">Stift ablegen</label>
                    <p className="text-[11px] text-[#9b9b98]">Wird ausgeführt wenn die Maschine einen Stift zurücklegt</p>
                    <textarea
                      value={penChange.dropGcode}
                      onChange={(e) => onPenChangeChange({ ...penChange, dropGcode: e.target.value })}
                      rows={4}
                      className="w-full text-[12px] font-mono border border-[#e9e9e7] rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-[#fafaf9] text-[#37352f] leading-relaxed"
                      placeholder="; G-Code zum Stift ablegen…"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── About ──────────────────────────────────────────────────── */}
          {section === "about" && (
            <>
              <div>
                <h1 className="text-[18px] font-semibold text-[#37352f]">Info</h1>
                <p className="text-[13px] text-[#9b9b98] mt-0.5">Über PenFlow</p>
              </div>

              <div className="bg-white border border-[#e9e9e7] rounded-xl p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#37352f] flex items-center justify-center flex-shrink-0">
                  <Palette size={22} className="text-white" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-[#37352f]">PenFlow</p>
                  <p className="text-[12px] text-[#9b9b98]">CNC Pen Plotter Software</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[12px] font-mono text-[#37352f]">v1.0.0</p>
                  <p className="text-[11px] text-[#9b9b98]">Schulprojekt</p>
                </div>
              </div>

              <SectionCard title="Stack">
                <InfoRow label="Framework" value="Tauri 2" mono={false} />
                <InfoRow label="Frontend" value="React + TypeScript" mono={false} />
                <InfoRow label="Backend" value="Rust" mono={false} />
                <InfoRow label="Styling" value="Tailwind CSS" mono={false} />
                <InfoRow label="Protokoll" value="GRBL 1.1h" mono={false} />
              </SectionCard>

              <SectionCard title="Hardware">
                <InfoRow label="Controller" value="Arduino Uno / Nano" mono={false} />
                <InfoRow label="Firmware" value="GRBL 1.1h" mono={false} />
                <InfoRow label="Servo" value="Pin D11 (Spindle PWM)" mono={false} />
              </SectionCard>

              <SectionCard title="Developers">
                <InfoRow label="Developed by" value="Felix Huber & Bennet Unger" mono={false} />
              </SectionCard>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
