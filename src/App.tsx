import { useEffect, useState, useCallback } from "react";
import {
  DEFAULT_PEN_CHANGE,
  DEFAULT_PEN_SLOTS,
  MachineStatus,
  PenChangeConfig,
  PenSlot,
  View,
} from "./lib/types";
import { onStatus, onLine, onJobProgress, onJobDone, onJobError, onDisconnected } from "./lib/grbl";
import Sidebar from "./components/Sidebar";
import ConnectionBar from "./components/ConnectionBar";
import ControlView from "./views/ControlView";
import SlicerView from "./views/SlicerView";
import SettingsView from "./views/SettingsView";

const DEFAULT_STATUS: MachineStatus = {
  state: "Disconnected",
  wpos: [0, 0, 0],
  mpos: [0, 0, 0],
  feed: 0,
  spindle: 0,
  connected: false,
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [view, setView] = useState<View>("control");
  const [status, setStatus] = useState<MachineStatus>(DEFAULT_STATUS);
  const [consoleLines, setConsoleLines] = useState<string[]>([
    "Pen Plotter ready. Connect to start.",
  ]);
  const [jobProgress, setJobProgress] = useState<{ sent: number; total: number } | null>(null);
  const [penSlots, setPenSlots] = useState<PenSlot[]>(() =>
    loadFromStorage("penPlotter_penSlots", DEFAULT_PEN_SLOTS)
  );
  const [penChange, setPenChange] = useState<PenChangeConfig>(() =>
    loadFromStorage("penPlotter_penChange", DEFAULT_PEN_CHANGE)
  );

  const updatePenSlots = useCallback((slots: PenSlot[]) => {
    setPenSlots(slots);
    localStorage.setItem("penPlotter_penSlots", JSON.stringify(slots));
  }, []);

  const updatePenChange = useCallback((config: PenChangeConfig) => {
    setPenChange(config);
    localStorage.setItem("penPlotter_penChange", JSON.stringify(config));
  }, []);

  const addLine = useCallback((line: string) => {
    setConsoleLines((prev) => [...prev.slice(-499), line]);
  }, []);

  useEffect(() => {
    const unsubs: Promise<() => void>[] = [
      onStatus((s) => setStatus({ ...s, connected: true })),
      onLine((l) => {
        if (!l.startsWith("<")) addLine(l);
      }),
      onJobProgress((p) => setJobProgress(p)),
      onJobDone(() => {
        addLine("✓ Job complete");
        setJobProgress(null);
      }),
      onJobError((msg) => {
        addLine(`✗ Job error: ${msg}`);
        setJobProgress(null);
      }),
      onDisconnected(() => {
        setStatus(DEFAULT_STATUS);
        addLine("Disconnected from machine");
        setJobProgress(null);
      }),
    ];
    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, [addLine]);

  const handleConnect = () => {
    setStatus((s) => ({ ...s, connected: true, state: "Connected" }));
    addLine("Connected to machine");
  };

  const handleDisconnect = () => {
    setStatus(DEFAULT_STATUS);
    addLine("Disconnected");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        active={view}
        onChange={setView}
        connected={status.connected}
        machineState={status.state}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ConnectionBar
          connected={status.connected}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onError={(message) => addLine(`[connection] ${message}`)}
        />

        <main className="flex-1 overflow-hidden">
          {view === "control" && (
            <ControlView
              status={status}
              consoleLines={consoleLines}
              onClearConsole={() => setConsoleLines([])}
              jobProgress={jobProgress}
            />
          )}
          {view === "slicer" && (
            <SlicerView
              connected={status.connected}
              jobProgress={jobProgress}
              onMessage={(message) => addLine(`[slicer] ${message}`)}
              penSlots={penSlots}
              penChange={penChange}
            />
          )}
          {view === "settings" && (
            <SettingsView
              penSlots={penSlots}
              penChange={penChange}
              onPenSlotsChange={updatePenSlots}
              onPenChangeChange={updatePenChange}
            />
          )}
        </main>
      </div>
    </div>
  );
}
