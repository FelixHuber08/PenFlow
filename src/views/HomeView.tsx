import { useCallback, useState } from "react";
import { FileImage, Plug, Clock, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { MachineStatus, PenSlot, View } from "../lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentFile {
  name: string;
  path: string;
  openedAt: number;
}

interface Props {
  status: MachineStatus;
  penSlots: PenSlot[];
  onOpenSvg: (content: string, fileName: string, filePath: string) => void;
  onNavigate: (v: View) => void;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const RECENT_KEY = "penPlotter_recentFiles";

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentFile[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentFile(name: string, path: string): void {
  const existing = loadRecentFiles().filter((f) => f.path !== path);
  const updated: RecentFile[] = [{ name, path, openedAt: Date.now() }, ...existing].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.floor(h / 24)} Tagen`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeView({ status, penSlots, onOpenSvg, onNavigate }: Props) {
  const [dragging, setDragging] = useState(false);
  const [recentFiles] = useState<RecentFile[]>(loadRecentFiles);

  const importFile = useCallback(async (filePath?: string) => {
    try {
      const path = filePath ?? await open({
        filters: [{ name: "SVG", extensions: ["svg"] }],
        multiple: false,
      });
      if (!path || typeof path !== "string") return;
      const content = await readTextFile(path);
      const name = path.split("/").pop() ?? path;
      pushRecentFile(name, path);
      onOpenSvg(content, name, path);
    } catch {
      // cancelled
    }
  }, [onOpenSvg]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".svg")) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          pushRecentFile(file.name, file.name);
          onOpenSvg(reader.result, file.name, file.name);
        }
      };
      reader.readAsText(file);
    }
  }, [onOpenSvg]);

  const connected = status.connected;
  const enabledSlots = penSlots.filter((s) => s.enabled).length;
  const statusDot = connected
    ? status.state === "Alarm" ? "bg-red-500" : "bg-green-500"
    : "bg-[#d1d0ce]";

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="max-w-2xl mx-auto px-8 py-14">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <img src="/Logo.png" alt="PenFlow"
              className="w-8 h-8 rounded-lg object-contain" />
            <h1 className="text-[26px] font-semibold text-[#37352f] tracking-tight leading-none">
              PenFlow
            </h1>
          </div>
          <p className="text-[14px] text-[#9b9b98] leading-relaxed">
            Lade eine SVG-Datei, um mit dem Plotten zu beginnen.
          </p>
        </div>

        {/* ── Import zone ──────────────────────────────────────────────────── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => importFile()}
          className={`
            w-full rounded-xl border-2 border-dashed px-8 py-10
            flex flex-col items-center gap-4
            cursor-pointer transition-all duration-150 select-none mb-10
            ${dragging
              ? "border-[#37352f] bg-[#f7f7f5]"
              : "border-[#e9e9e7] bg-white hover:border-[#c9c8c5] hover:bg-[#fafafa]"
            }
          `}
        >
          <div className={`
            w-11 h-11 rounded-full flex items-center justify-center transition-colors
            ${dragging ? "bg-[#37352f]" : "bg-[#f0f0ee]"}
          `}>
            <FileImage
              size={18}
              className={dragging ? "text-white" : "text-[#787774]"}
            />
          </div>

          <div className="text-center">
            <p className="text-[14px] font-medium text-[#37352f] mb-1">
              {dragging ? "Datei loslassen …" : "SVG hierher ziehen"}
            </p>
            <p className="text-[12px] text-[#9b9b98]">
              oder klicken, um eine Datei auszuwählen
            </p>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); importFile(); }}
            className="mt-1 px-4 py-1.5 text-[13px] font-medium text-[#37352f] bg-white border border-[#e9e9e7] rounded-md hover:bg-[#f7f7f5] transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
          >
            SVG importieren
          </button>
        </div>

        {/* ── Two-column: Recent + Status ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">

          {/* Recent files */}
          <div>
            <h2 className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest mb-3">
              Zuletzt geöffnet
            </h2>

            {recentFiles.length === 0 ? (
              <div className="rounded-lg border border-[#e9e9e7] bg-[#fafaf9] px-4 py-6 text-center">
                <p className="text-[12px] text-[#c7c6c3]">Noch keine Dateien</p>
              </div>
            ) : (
              <div className="rounded-lg border border-[#e9e9e7] overflow-hidden divide-y divide-[#f0f0ee]">
                {recentFiles.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => importFile(f.path)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f7f5] transition-colors group"
                  >
                    <FileImage size={13} className="text-[#c7c6c3] flex-shrink-0" />
                    <span className="flex-1 text-[12.5px] text-[#37352f] truncate">
                      {f.name}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-[#c7c6c3] group-hover:text-[#9b9b98] transition-colors whitespace-nowrap">
                      <Clock size={9} />
                      {relativeTime(f.openedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Plotter status */}
          <div>
            <h2 className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest mb-3">
              Plotter
            </h2>

            <div className="rounded-lg border border-[#e9e9e7] overflow-hidden divide-y divide-[#f0f0ee]">

              {/* Connection row */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
                <span className="flex-1 text-[12.5px] text-[#37352f]">
                  {connected ? status.state : "Nicht verbunden"}
                </span>
                {!connected && (
                  <button
                    onClick={() => onNavigate("control")}
                    className="flex items-center gap-1 text-[11px] text-[#9b9b98] hover:text-[#37352f] transition-colors"
                  >
                    <Plug size={10} />
                    Verbinden
                  </button>
                )}
              </div>

              {/* Pen slots row */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex gap-1 flex-wrap flex-1">
                  {penSlots.filter((s) => s.enabled).slice(0, 10).map((s) => (
                    <span
                      key={s.index}
                      title={s.name}
                      style={{ background: s.color }}
                      className="w-3.5 h-3.5 rounded-full border border-black/10 flex-shrink-0"
                    />
                  ))}
                  {enabledSlots > 10 && (
                    <span className="text-[10px] text-[#9b9b98] self-center">
                      +{enabledSlots - 10}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#9b9b98] whitespace-nowrap">
                  {enabledSlots} Slots
                </span>
              </div>

              {/* Bed size row */}
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[12px] text-[#9b9b98]">Bettgröße</span>
                <span className="text-[12px] text-[#787774] font-mono">270 × 360 mm</span>
              </div>

            </div>

            {/* Settings shortcut */}
            <button
              onClick={() => onNavigate("settings")}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-[#9b9b98] hover:text-[#37352f] transition-colors px-1"
            >
              <RefreshCw size={10} />
              Konfiguration öffnen
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
