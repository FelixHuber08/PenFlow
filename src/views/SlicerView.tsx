import { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload, FileCode, Clock, Layers, RefreshCw, ArrowLeft, Printer,
  Move, Settings2, Sliders, ChevronRight, X, CheckCircle2, Code, Copy, Check,
  Square, Circle, Plus, Grid3X3, Minus, Type, Sigma,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readFile } from "@tauri-apps/plugin-fs";
import {
  DEFAULT_PEN_CHANGE,
  DEFAULT_PEN_SLOTS,
  FillPattern,
  MACHINE,
  PenChangeConfig,
  PenSlot,
  PlotConfig,
  RasterConfig,
  SvgTransform,
} from "../lib/types";
import {
  ColoredPath,
  GcodeStroke,
  RasterDebug,
  analyzeGcode,
  generateGcode,
  generateMultiPenGcode,
  generateRasterDebug,
  generateRasterGcode,
  getSvgDimensions,
  parseSvgPaths,
  parseGcodeStrokes,
  quantizeToSlots,
  estimateTime,
} from "../lib/svgToGcode";
import { Grbl } from "../lib/grbl";
import { textToStrokeSvg, FontStyle } from "../lib/strokeFont";
import { parseFontBuffer, fontTextToSvg, LoadedFont } from "../lib/fontText";
import { mathToSvg } from "../lib/mathText";
import A4Canvas from "../components/A4Canvas";

interface Props {
  connected: boolean;
  jobProgress: { sent: number; total: number } | null;
  onMessage: (message: string) => void;
  penSlots?: PenSlot[];
  penChange?: PenChangeConfig;
  initialSvg?: { content: string; name: string } | null;
  onInitialSvgConsumed?: () => void;
}

/** Fit SVG to ~190mm wide while ensuring height stays under ~270mm. */
function calcAutoScale(w: number, h: number): number {
  const aspect = (h || w) / (w || 1);
  return Math.min(190, 270 / (aspect || 1));
}

const DEFAULT_CONFIG: PlotConfig = {
  penUpZ: 0,
  penDownZ: 6.5,
  travelFeed: 3000,
  drawFeed: 1500,
  zFeed: 500,
  dwell: 50,
};

const DEFAULT_TRANSFORM: SvgTransform = {
  x: 5, y: 5, scale: 200, rotation: 0
};

const DEFAULT_RASTER: RasterConfig = {
  lineStep: 1,
  threshold: 180,
  minRun: 0.8,
  gapBridge: 1,
  pattern: "horizontal",
};

const FILL_PATTERNS: { id: FillPattern; label: string }[] = [
  { id: "horizontal", label: "Horizontal" },
  { id: "vertical", label: "Vertikal" },
  { id: "diagonal", label: "Diagonal" },
  { id: "crosshatch", label: "Kreuz" },
  { id: "dots", label: "Punkte" },
];

type SliceMode = "auto" | "vector" | "raster";
type ScreenMode = "edit" | "print";
type Tab = "layout" | "pen" | "mode";

interface PresetFont {
  id: string;
  name: string;
  url: string;
}

const PRESET_FONTS: PresetFont[] = [
  { id: "inter",        name: "Inter",           url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff" },
  { id: "roboto",       name: "Roboto",          url: "https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-400-normal.woff" },
  { id: "opensans",     name: "Open Sans",       url: "https://cdn.jsdelivr.net/npm/@fontsource/open-sans/files/open-sans-latin-400-normal.woff" },
  { id: "montserrat",   name: "Montserrat",      url: "https://cdn.jsdelivr.net/npm/@fontsource/montserrat/files/montserrat-latin-400-normal.woff" },
  { id: "lato",         name: "Lato",            url: "https://cdn.jsdelivr.net/npm/@fontsource/lato/files/lato-latin-400-normal.woff" },
  { id: "oswald",       name: "Oswald",          url: "https://cdn.jsdelivr.net/npm/@fontsource/oswald/files/oswald-latin-400-normal.woff" },
  { id: "playfair",     name: "Playfair Display",url: "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff" },
  { id: "merriweather", name: "Merriweather",    url: "https://cdn.jsdelivr.net/npm/@fontsource/merriweather/files/merriweather-latin-400-normal.woff" },
  { id: "raleway",      name: "Raleway",         url: "https://cdn.jsdelivr.net/npm/@fontsource/raleway/files/raleway-latin-400-normal.woff" },
  { id: "nunito",       name: "Nunito",          url: "https://cdn.jsdelivr.net/npm/@fontsource/nunito/files/nunito-latin-400-normal.woff" },
];

function NumInput({
  label, value, onChange, min, max, step, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-[#787774] flex-1 min-w-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            // Keep the last valid value when the field is cleared / mid-edit so
            // NaN never propagates into config and then into the G-code.
            onChange(Number.isFinite(v) ? v : value);
          }}
          min={min} max={max} step={step ?? 0.1}
          className="w-[72px] text-right text-[12px] border border-[#e9e9e7] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f] tabular-nums"
        />
        {unit && <span className="text-[11px] text-[#9b9b98] w-8 text-left">{unit}</span>}
      </div>
    </div>
  );
}

export default function SlicerView({
  connected, jobProgress, onMessage,
  penSlots: propSlots, penChange: propChange,
  initialSvg, onInitialSvgConsumed,
}: Props) {
  const penSlots = propSlots ?? DEFAULT_PEN_SLOTS;
  const penChange = propChange ?? DEFAULT_PEN_CHANGE;

  const [svgString, setSvgString] = useState<string | null>(null);
  const [svgDims, setSvgDims] = useState({ w: 100, h: 100 });
  const [svgPaths, setSvgPaths] = useState<ColoredPath[]>([]);
  const [colorGroups, setColorGroups] = useState<Map<number, ColoredPath[]> | null>(null);
  const [transform, setTransform] = useState<SvgTransform>(DEFAULT_TRANSFORM);
  const [config, setConfig] = useState<PlotConfig>(DEFAULT_CONFIG);
  const [rasterConfig, setRasterConfig] = useState<RasterConfig>(DEFAULT_RASTER);
  const [sliceMode, setSliceMode] = useState<SliceMode>("auto");
  const [multiColor, setMultiColor] = useState(false);
  const [gcode, setGcode] = useState<string | null>(null);
  const [gcodeStrokes, setGcodeStrokes] = useState<GcodeStroke[]>([]);
  const [estTime, setEstTime] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [screenMode, setScreenMode] = useState<ScreenMode>("edit");
  const [activeTab, setActiveTab] = useState<Tab>("layout");
  const [showGcodeModal, setShowGcodeModal] = useState(false);
  const [rasterDebug, setRasterDebug] = useState<RasterDebug | null>(null);
  const [showRasterDebug, setShowRasterDebug] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showMathInput, setShowMathInput] = useState(false);
  const [latexInput, setLatexInput] = useState("");
  const [fontStyle, setFontStyle] = useState<FontStyle>("sans");
  // "stroke" = hand-crafted stroke font, "ttf" = real loaded TTF/OTF
  const [textMode, setTextMode] = useState<"stroke" | "ttf">("stroke");
  const [loadedFont, setLoadedFont] = useState<LoadedFont | null>(null);
  const [selectedPresetFont, setSelectedPresetFont] = useState<string | null>(null);
  const [loadingFontId, setLoadingFontId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSvg) return;
    const dims = getSvgDimensions(initialSvg.content);
    setSvgString(initialSvg.content);
    setSvgDims(dims);
    setFileName(initialSvg.name);
    setGcode(null);
    setEstTime(null);
    setScreenMode("edit");
    const autoScale = calcAutoScale(dims.w, dims.h);
    setTransform({ ...DEFAULT_TRANSFORM, scale: autoScale });
    onMessage(`Loaded ${initialSvg.name}`);
    onInitialSvgConsumed?.();
  }, [initialSvg]);

  const importSvg = async () => {
    try {
      const path = await open({
        filters: [{ name: "SVG", extensions: ["svg"] }],
        multiple: false,
      });
      if (!path || typeof path !== "string") return;
      const content = await readTextFile(path);
      const dims = getSvgDimensions(content);
      setSvgString(content);
      setSvgDims(dims);
      setFileName(path.split("/").pop() ?? path);
      setGcode(null);
      setEstTime(null);
      setScreenMode("edit");
      const autoScale = calcAutoScale(dims.w, dims.h);
      setTransform({ ...DEFAULT_TRANSFORM, scale: autoScale });
      onMessage(`Loaded ${path.split("/").pop() ?? path}`);
    } catch (e) {
      onMessage(`SVG import failed: ${String(e)}`);
    }
  };

  const clearFile = () => {
    setSvgString(null);
    setFileName("");
    setGcode(null);
    setGcodeStrokes([]);
    setEstTime(null);
    setSvgPaths([]);
    setColorGroups(null);
    setRasterDebug(null);
  };

  const loadTestShape = useCallback((shape: TestShape) => {
    const gc = generateTestGcode(shape, config, transform);
    const svgSrc = testShapeSvg(shape);
    setSvgString(svgSrc);
    setSvgDims({ w: 100, h: 100 });
    setSvgPaths([]);
    setColorGroups(null);
    setFileName(`Testform: ${shape.label}`);
    setGcode(gc);
    setGcodeStrokes(parseGcodeStrokes(gc));
    setEstTime(estimateTime(gc, config));
    setScreenMode("edit");
    onMessage(`Testform „${shape.label}" geladen (${countCommands(gc)} Befehle)`);
  }, [config, transform, onMessage]);

  const loadFontFile = useCallback(async () => {
    try {
      const path = await open({
        filters: [{ name: "Schriftart", extensions: ["ttf", "otf"] }],
        multiple: false,
      });
      if (!path || typeof path !== "string") return;
      const bytes = await readFile(path);
      const buf = bytes.buffer as ArrayBuffer;
      const name = path.split("/").pop()?.replace(/\.(ttf|otf)$/i, "") ?? path;
      const loaded = parseFontBuffer(buf, name);
      setLoadedFont(loaded);
      setSelectedPresetFont(null);
      setTextMode("ttf");
      onMessage(`Schriftart geladen: ${loaded.name}`);
    } catch (e) {
      onMessage(`Schriftart-Laden fehlgeschlagen: ${String(e)}`);
    }
  }, [onMessage]);

  const loadPresetFont = useCallback(async (fontId: string) => {
    const preset = PRESET_FONTS.find((f) => f.id === fontId);
    if (!preset) {
      onMessage(`Schriftart nicht gefunden: ${fontId}`);
      return;
    }
    try {
      setLoadingFontId(fontId);
      const response = await fetch(preset.url);
      if (!response.ok) throw new Error(`Fehler ${response.status}: ${response.statusText}`);
      const buf = await response.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("Leere Datei heruntergeladen");
      const loaded = parseFontBuffer(buf, preset.name);
      setLoadedFont(loaded);
      setSelectedPresetFont(fontId);
      setTextMode("ttf");
      onMessage(`✓ Schriftart geladen: ${loaded.name}`);
    } catch (e) {
      onMessage(`✗ ${preset.name} konnte nicht geladen werden: ${String(e)}`);
      setSelectedPresetFont(null);
    } finally {
      setLoadingFontId(null);
    }
  }, [onMessage]);

  const loadTextAsSvg = useCallback(() => {
    const trimmed = textInput.replace(/\s+$/g, "");
    if (!trimmed.trim()) return;

    let svg: string, w: number, h: number;

    try {
      if (textMode === "ttf" && loadedFont) {
        // Real TTF/OTF font via opentype.js (like OpenBuilds-CAM)
        ({ svg, w, h } = fontTextToSvg(loadedFont, trimmed));
      } else {
        // Hand-crafted single-stroke font
        ({ svg, w, h } = textToStrokeSvg(trimmed, fontStyle));
      }
    } catch (e) {
      onMessage(`Text konnte nicht erstellt werden: ${String(e)}`);
      return;
    }

    setSvgString(svg);
    setSvgDims({ w, h });
    setFileName(`Text: "${trimmed.slice(0, 24)}${trimmed.length > 24 ? "…" : ""}"`);
    setGcode(null);
    setGcodeStrokes([]);
    setEstTime(null);
    setSvgPaths([]);
    setColorGroups(null);
    setRasterDebug(null);
    setMultiColor(false);
    setSliceMode("vector");
    const autoScale = calcAutoScale(w, h);
    setTransform({ ...DEFAULT_TRANSFORM, scale: autoScale });
    setScreenMode("edit");
    onMessage(`Text geladen (${trimmed.length} Zeichen) – Vektor-Modus aktiv`);
  }, [textInput, fontStyle, textMode, loadedFont, onMessage]);

  const loadMathAsSvg = useCallback(async () => {
    const src = latexInput.trim();
    if (!src) return;
    try {
      const { svg, w, h } = await mathToSvg(src);
      setSvgString(svg);
      setSvgDims({ w, h });
      setFileName(`Formel: "${src.slice(0, 24)}${src.length > 24 ? "…" : ""}"`);
      setGcode(null);
      setGcodeStrokes([]);
      setEstTime(null);
      setSvgPaths([]);
      setColorGroups(null);
      setRasterDebug(null);
      setMultiColor(false);
      setSliceMode("vector");
      setTransform({ ...DEFAULT_TRANSFORM, scale: calcAutoScale(w, h) });
      setScreenMode("edit");
      setShowMathInput(false);
      onMessage("Formel geladen – Vektor-Modus aktiv");
    } catch (e) {
      onMessage(`Formel-Fehler: ${String(e)}`);
    }
  }, [latexInput, onMessage]);

  const slice = useCallback(async () => {
    if (!svgString) return;
    setParsing(true);
    try {
      const paths = parseSvgPaths(svgString);
      setSvgPaths(paths);
      setColorGroups(null);
      const useRaster = sliceMode === "raster" || (sliceMode === "auto" && paths.length === 0);
      if (sliceMode === "vector" && paths.length === 0) {
        setGcode(null);
        setEstTime(null);
        onMessage("Vector mode found 0 paths. Use Raster or Auto for this SVG.");
        return;
      }
      let gc: string;
      // Raster/dot fills return the exact toolpath they drew so the preview is
      // built from the same segments as the G-code (the two can't drift apart).
      let strokes: GcodeStroke[] | null = null;
      if (useRaster) {
        const res = await generateRasterGcode(svgString, svgDims, transform, config, rasterConfig);
        gc = res.gcode;
        strokes = res.strokes;
        const dbg = await generateRasterDebug(svgString, svgDims, transform, rasterConfig);
        setRasterDebug(dbg);
      } else if (multiColor) {
        setRasterDebug(null);
        const groups = quantizeToSlots(paths, penSlots);
        setColorGroups(groups);
        gc = generateMultiPenGcode(paths, svgDims, transform, config, penSlots, penChange);
        const colorCount = groups.size;
        onMessage(`Generated ${countCommands(gc)} commands, ${colorCount} pen color${colorCount !== 1 ? "s" : ""}`);
      } else {
        setRasterDebug(null);
        gc = generateGcode(paths, svgDims, transform, config);
      }
      setGcode(gc);
      setGcodeStrokes(strokes ?? parseGcodeStrokes(gc));
      setEstTime(estimateTime(gc, config));
      if (!multiColor || useRaster) {
        onMessage(`Generated ${countCommands(gc)} commands using ${useRaster ? "raster" : "vector"} mode`);
      }
    } catch (e) {
      onMessage(`G-code generation failed: ${String(e)}`);
    } finally {
      setParsing(false);
    }
  }, [svgString, svgDims, transform, config, rasterConfig, sliceMode, multiColor, penSlots, penChange, onMessage]);

  const sendToPlotter = async (): Promise<boolean> => {
    if (!gcode || !connected) return false;

    // ── Pre-flight safety checks ────────────────────────────────────────────
    const a = analyzeGcode(gcode);
    if (a.hasInvalid) {
      onMessage("Abbruch: G-Code enthält ungültige Zahlenformate (z. B. NaN, 1e-5 oder doppelte Punkte) – GRBL würde error:2 melden. Prüfe/korrigiere die betroffenen Zeilen.");
      return false;
    }
    if (a.moves === 0) {
      onMessage("Abbruch: G-Code enthält keine Bewegungen.");
      return false;
    }
    const m = 0.5; // tolerance in mm
    if (a.minX < -m || a.minY < -m) {
      onMessage(
        `Abbruch: Negative Koordinaten (X ${a.minX.toFixed(1)}, Y ${a.minY.toFixed(1)} mm) – Zeichnung liegt vor dem Nullpunkt. Position anpassen.`
      );
      return false;
    }
    // The multi-pen rack legitimately sits at/beyond the bed edge, so the upper
    // bound is only enforced for normal (single-pen / raster) jobs.
    if (!multiColor && (a.maxX > MACHINE.bedX + m || a.maxY > MACHINE.bedY + m)) {
      onMessage(
        `Abbruch: Zeichnung außerhalb des Maschinenbereichs (max X ${a.maxX.toFixed(1)}/${MACHINE.bedX}, ` +
        `Y ${a.maxY.toFixed(1)}/${MACHINE.bedY} mm). Skalierung oder Position verkleinern.`
      );
      return false;
    }

    setSending(true);
    try {
      const lines = gcode.split("\n").filter((l) => {
        const t = l.trim();
        return t && !t.startsWith(";");
      });
      await Grbl.startJob(lines);
      onMessage(`Started plot job with ${lines.length} commands`);
      return true;
    } catch (e) {
      onMessage(`Plot start failed: ${String(e)}`);
      return false;
    } finally {
      setSending(false);
    }
  };

  // Live-edit hook for the G-code editor: keep the gcode string, the on-paper
  // line preview and the time estimate in sync as the user types or pastes.
  const editGcode = useCallback((value: string) => {
    setGcode(value);
    setGcodeStrokes(parseGcodeStrokes(value));
    setEstTime(value.trim() ? estimateTime(value, config) : null);
  }, [config]);

  // Run straight from the editor, then jump to the print screen for progress.
  const runGcode = async () => {
    const ok = await sendToPlotter();
    if (ok) {
      setShowGcodeModal(false);
      if (svgString) setScreenMode("print");
    }
  };

  // ── Print screen ────────────────────────────────────────────────────────────
  if (screenMode === "print" && svgString && gcode) {
    const commands = countCommands(gcode);
    const progressPct = jobProgress && jobProgress.total > 0
      ? Math.min(100, (jobProgress.sent / jobProgress.total) * 100)
      : 0;
    const isRunning = Boolean(jobProgress);

    return (
      <div className="flex h-full w-full overflow-hidden">
        {/* Left panel */}
        <div className="w-[300px] flex-shrink-0 border-r border-[#e9e9e7] flex flex-col bg-[#fafaf9]">
          <div className="p-4 border-b border-[#e9e9e7]">
            <button
              onClick={() => setScreenMode("edit")}
              disabled={isRunning}
              className="flex items-center gap-1.5 text-[12px] text-[#787774] hover:text-[#37352f] disabled:opacity-40 transition-colors"
            >
              <ArrowLeft size={13} />
              Back to slicer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* File info */}
            <div className="rounded-xl border border-[#e9e9e7] bg-white p-4 space-y-3">
              <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest">
                Ready to print
              </p>
              <p className="text-[13px] font-medium text-[#37352f] truncate" title={fileName}>
                {fileName}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Commands", value: commands.toLocaleString() },
                  { label: "Est. time", value: estTime !== null ? formatTime(estTime) : "—" },
                  { label: "Width", value: `${transform.scale.toFixed(1)} mm` },
                  { label: "Paths", value: svgPaths.length.toString() },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[#f7f7f5] rounded-lg px-3 py-2">
                    <p className="text-[10px] text-[#9b9b98] mb-0.5">{label}</p>
                    <p className="text-[13px] font-medium tabular-nums text-[#37352f]">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress */}
            {isRunning && (
              <div className="rounded-xl border border-[#e9e9e7] bg-white p-4 space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#787774]">Printing…</span>
                  <span className="tabular-nums font-medium text-[#37352f]">
                    {Math.round(progressPct)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#f0f0ee]">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-[#9b9b98] tabular-nums">
                  <span>{jobProgress!.sent} sent</span>
                  <span>{jobProgress!.total} total</span>
                </div>
              </div>
            )}

            {/* Connection warning */}
            {!connected && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-[12px] text-amber-700 font-medium">Not connected</p>
                <p className="text-[11px] text-amber-600">Connect to the machine first</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="p-4 border-t border-[#e9e9e7] space-y-2">
            {isRunning ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => Grbl.pauseJob()}
                  className="py-2.5 text-[12px] font-medium border border-[#e9e9e7] rounded-xl hover:bg-[#f7f7f5] text-[#37352f] transition-colors"
                >
                  Pause
                </button>
                <button
                  onClick={() => Grbl.stopJob()}
                  className="py-2.5 text-[12px] font-medium border border-red-200 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                onClick={sendToPlotter}
                disabled={!connected || sending}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#37352f] py-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2c2b26] disabled:opacity-40"
              >
                <Printer size={14} />
                {sending ? "Starting…" : "Start Print"}
              </button>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 p-6 overflow-hidden bg-[#f7f7f5]">
          <A4Canvas
            svgString={svgString}
            svgDims={svgDims}
            transform={transform}
            onChange={setTransform}
            readOnly
            gcodeStrokes={gcodeStrokes}
            rasterDebug={showRasterDebug ? rasterDebug : null}
          />
        </div>
      </div>
    );
  }

  // ── Edit screen ─────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: typeof Move }[] = [
    { id: "layout", label: "Layout", icon: Move },
    { id: "pen", label: "Pen", icon: Settings2 },
    { id: "mode", label: "Mode", icon: Sliders },
  ];

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── Left panel ───────────────────────────────────────────────────── */}
      <div className="w-[300px] flex-shrink-0 border-r border-[#e9e9e7] flex flex-col bg-[#fafaf9]">

        {/* File import */}
        <div className="p-4 border-b border-[#e9e9e7]">
          {svgString ? (
            <div className="flex items-center gap-2 bg-white border border-[#e9e9e7] rounded-xl px-3 py-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#f7f7f5] flex items-center justify-center flex-shrink-0">
                <FileCode size={13} className="text-[#787774]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[#37352f] truncate">{fileName}</p>
                <p className="text-[10px] text-[#9b9b98]">
                  {svgDims.w.toFixed(0)} × {svgDims.h.toFixed(0)} units
                </p>
              </div>
              <button
                onClick={clearFile}
                className="flex-shrink-0 p-1 rounded-md hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#37352f] transition-colors"
                title="Remove file"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={importSvg}
              className="w-full group flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed border-[#e9e9e7] rounded-xl text-[#9b9b98] hover:border-[#c7c6c4] hover:text-[#37352f] hover:bg-white transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-[#f7f7f5] group-hover:bg-[#efefed] flex items-center justify-center transition-colors">
                <Upload size={16} />
              </div>
              <span className="text-[12px] font-medium">Open SVG file</span>
            </button>
          )}
        </div>

        {/* Test shapes */}
        <div className="px-4 py-3 border-b border-[#e9e9e7]">
          <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest mb-2">
            Testformen
          </p>
          <div className="grid grid-cols-5 gap-1">
            {TEST_SHAPES.map((shape) => {
              const Icon = shape.icon;
              return (
                <button
                  key={shape.id}
                  onClick={() => loadTestShape(shape)}
                  title={shape.label}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] hover:border-[#c7c6c4] transition-colors text-[#787774] hover:text-[#37352f]"
                >
                  <Icon size={13} />
                  <span className="text-[9px] font-medium">{shape.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Text / formula input buttons */}
        <div className="px-4 py-3 border-b border-[#e9e9e7] grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowTextInput(true)}
            className="flex items-center justify-center gap-2 py-2 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
          >
            <Type size={12} />
            Text
          </button>
          <button
            onClick={() => setShowMathInput(true)}
            className="flex items-center justify-center gap-2 py-2 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
          >
            <Sigma size={12} />
            Formel
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e9e9e7] px-3 pt-2 gap-0.5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                activeTab === id
                  ? "text-[#37352f] border-[#37352f] bg-white"
                  : "text-[#9b9b98] border-transparent hover:text-[#787774]"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {activeTab === "layout" && (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-1 mb-2">
                  Position
                </p>
                <div className="bg-white border border-[#e9e9e7] rounded-xl p-3 space-y-2.5">
                  <NumInput label="X offset" value={transform.x} unit="mm" min={0} max={200}
                    onChange={(v) => setTransform((t) => ({ ...t, x: v }))} />
                  <NumInput label="Y offset" value={transform.y} unit="mm" min={0} max={280}
                    onChange={(v) => setTransform((t) => ({ ...t, y: v }))} />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-1 mb-2">
                  Scale
                </p>
                <div className="bg-white border border-[#e9e9e7] rounded-xl p-3">
                  <NumInput label="Width" value={transform.scale} unit="mm" min={5} max={200} step={1}
                    onChange={(v) => setTransform((t) => ({ ...t, scale: v }))} />
                </div>
              </div>
            </>
          )}

          {activeTab === "pen" && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-1 mb-2">
                Servo / Z
              </p>
              <div className="bg-white border border-[#e9e9e7] rounded-xl p-3 space-y-2.5">
                <NumInput label="Pen up Z" value={config.penUpZ} unit="mm"
                  onChange={(v) => setConfig((c) => ({ ...c, penUpZ: v }))} />
                <NumInput label="Pen down Z" value={config.penDownZ} unit="mm"
                  onChange={(v) => setConfig((c) => ({ ...c, penDownZ: v }))} />
                <div className="border-t border-[#f0f0ee] pt-2.5 space-y-2.5">
                  <NumInput label="Travel feed" value={config.travelFeed} unit="mm/m" step={100}
                    onChange={(v) => setConfig((c) => ({ ...c, travelFeed: v }))} />
                  <NumInput label="Draw feed" value={config.drawFeed} unit="mm/m" step={100}
                    onChange={(v) => setConfig((c) => ({ ...c, drawFeed: v }))} />
                  <NumInput label="Z feed" value={config.zFeed} unit="mm/m" step={50}
                    onChange={(v) => setConfig((c) => ({ ...c, zFeed: v }))} />
                </div>
                <div className="border-t border-[#f0f0ee] pt-2.5">
                  <NumInput label="Pen dwell" value={config.dwell} unit="ms" step={10}
                    onChange={(v) => setConfig((c) => ({ ...c, dwell: v }))} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "mode" && (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-1 mb-2">
                  Slicing mode
                </p>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f0f0ee] p-1">
                  {(["auto", "vector", "raster"] as SliceMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSliceMode(mode)}
                      className={`py-2 rounded-lg text-[12px] capitalize font-medium transition-all ${
                        sliceMode === mode
                          ? "bg-white text-[#37352f] shadow-sm"
                          : "text-[#9b9b98] hover:text-[#787774]"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {sliceMode !== "raster" && (
                <div className="bg-white border border-[#e9e9e7] rounded-xl p-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                      multiColor ? "bg-[#37352f]" : "bg-[#e9e9e7]"
                    }`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        multiColor ? "translate-x-4" : "translate-x-0.5"
                      }`} />
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[#37352f]">Multi-color</p>
                      <p className="text-[11px] text-[#9b9b98]">{penSlots.length} pen slots</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={multiColor}
                      onChange={(e) => setMultiColor(e.target.checked)}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}

              {(sliceMode === "auto" || sliceMode === "raster") && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-[#9b9b98] uppercase tracking-widest px-1 mb-2">
                    Raster settings
                  </p>
                  <div className="bg-white border border-[#e9e9e7] rounded-xl p-3 space-y-2.5">
                    <div className="space-y-1.5">
                      <span className="text-[12px] text-[#787774]">Muster</span>
                      <div className="grid grid-cols-3 gap-1">
                        {FILL_PATTERNS.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setRasterConfig((r) => ({ ...r, pattern: p.id }))}
                            className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                              rasterConfig.pattern === p.id
                                ? "bg-[#37352f] text-white border-[#37352f]"
                                : "bg-white text-[#787774] border-[#e9e9e7] hover:bg-[#f7f7f5]"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <NumInput label={rasterConfig.pattern === "dots" ? "Punktabstand" : "Linienabstand"}
                      value={rasterConfig.lineStep} unit="mm" min={0.2} max={5} step={0.1}
                      onChange={(v) => setRasterConfig((r) => ({ ...r, lineStep: v }))} />
                    <NumInput label="Threshold" value={rasterConfig.threshold} min={0} max={255} step={5}
                      onChange={(v) => setRasterConfig((r) => ({ ...r, threshold: v }))} />
                    <NumInput label="Min line" value={rasterConfig.minRun} unit="mm" min={0.1} max={10} step={0.1}
                      onChange={(v) => setRasterConfig((r) => ({ ...r, minRun: v }))} />
                    <NumInput label="Gap bridge" value={rasterConfig.gapBridge} unit="mm" min={0} max={10} step={0.1}
                      onChange={(v) => setRasterConfig((r) => ({ ...r, gapBridge: Math.max(0, v) }))} />
                    <label className="flex items-center justify-between gap-3 text-[12px] text-[#787774] pt-1">
                      <span>Show raster debug overlay</span>
                      <input
                        type="checkbox"
                        checked={showRasterDebug}
                        onChange={(e) => setShowRasterDebug(e.target.checked)}
                      />
                    </label>
                    {rasterDebug && (
                      <p className="text-[10px] text-[#9b9b98] tabular-nums">
                        {rasterDebug.canvasW}×{rasterDebug.canvasH} px ·{" "}
                        {rasterDebug.runs.length} runs · {rasterDebug.dropped} dropped
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action bar — pinned bottom */}
        <div className="border-t border-[#e9e9e7] p-4 space-y-3 bg-white">

          {/* Stats row (after generation) */}
          {gcode && (
            <div className="flex items-center justify-between text-[11px] px-1">
              <span className="flex items-center gap-1 text-[#9b9b98]">
                <CheckCircle2 size={11} className="text-green-500" />
                {countCommands(gcode).toLocaleString()} cmds
              </span>
              {estTime !== null && (
                <span className="flex items-center gap-1 text-[#9b9b98]">
                  <Clock size={11} />
                  {formatTime(estTime)}
                </span>
              )}
              <span className="flex items-center gap-1 text-[#9b9b98]">
                <Layers size={11} />
                {svgPaths.length} paths
              </span>
            </div>
          )}

          {/* Color groups */}
          {colorGroups && colorGroups.size > 0 && (
            <div className="rounded-lg bg-[#f7f7f5] px-3 py-2 space-y-1.5">
              {[...colorGroups.entries()].map(([slotIdx, cpaths]) => {
                const slot = penSlots.find((s) => s.index === slotIdx);
                if (!slot) return null;
                return (
                  <div key={slotIdx} className="flex items-center gap-2 text-[11px]">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-[#e9e9e7]"
                      style={{ background: slot.color }}
                    />
                    <span className="text-[#787774] flex-1">{slot.name}</span>
                    <span className="tabular-nums text-[#37352f]">{cpaths.length}</span>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={slice}
            disabled={!svgString || parsing}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#37352f] text-white rounded-xl text-[12px] font-medium hover:bg-[#2c2b26] disabled:opacity-40 transition-colors"
          >
            {parsing ? <RefreshCw size={13} className="animate-spin" /> : <Layers size={13} />}
            {parsing ? "Slicing…" : gcode ? "Regenerate" : "Generate GCode"}
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => setShowGcodeModal(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f] transition-colors"
            >
              <Code size={13} />
              GCode Editor
            </button>
            {gcode && (
              <button
                onClick={() => setScreenMode("print")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
              >
                <ChevronRight size={13} />
                Print
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Add Text Modal ───────────────────────────────────────────────── */}
      {showTextInput && (
        <AddTextModal
          onClose={() => setShowTextInput(false)}
          onConfirm={() => { loadTextAsSvg(); setShowTextInput(false); }}
          textInput={textInput}
          onTextChange={setTextInput}
          fontStyle={fontStyle}
          onFontStyleChange={setFontStyle}
          textMode={textMode}
          onTextModeChange={setTextMode}
          loadedFont={loadedFont}
          onLoadFontFile={loadFontFile}
          selectedPresetFont={selectedPresetFont}
          loadingFontId={loadingFontId}
          onLoadPresetFont={loadPresetFont}
        />
      )}

      {/* ── Add Formula (LaTeX) Modal ────────────────────────────────────── */}
      {showMathInput && (
        <AddMathModal
          latex={latexInput}
          onChange={setLatexInput}
          onClose={() => setShowMathInput(false)}
          onConfirm={loadMathAsSvg}
        />
      )}

      {/* ── GCode Editor Modal ───────────────────────────────────────────── */}
      {showGcodeModal && (
        <GcodeEditorModal
          gcode={gcode ?? ""}
          onChange={editGcode}
          onClose={() => setShowGcodeModal(false)}
          onRun={runGcode}
          connected={connected}
          sending={sending}
        />
      )}

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-[#f7f7f5]">
        {svgString ? (
          <div className="h-full p-6">
            <A4Canvas
              svgString={svgString}
              svgDims={svgDims}
              transform={transform}
              onChange={setTransform}
              gcodeStrokes={gcodeStrokes}
              rasterDebug={showRasterDebug ? rasterDebug : null}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <button
              onClick={importSvg}
              className="group flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-[#e9e9e7] hover:border-[#c7c6c4] hover:bg-white transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-[#f0f0ee] group-hover:bg-[#efefed] flex items-center justify-center transition-colors">
                <Upload size={20} className="text-[#9b9b98]" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-medium text-[#787774]">Open an SVG file</p>
                <p className="text-[11px] text-[#9b9b98] mt-0.5">Preview shows your drawing on A4 paper</p>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function countCommands(gcode: string): number {
  return gcode.split("\n").filter((line) => {
    const t = line.trim();
    return t && !t.startsWith(";");
  }).length;
}

// ─── Test shapes ─────────────────────────────────────────────────────────────

interface TestShape {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  moves: (x: number, y: number, w: number, h: number) => Array<{ x: number; y: number; pen: boolean }>;
  svg: (w: number, h: number) => string;
}

const TEST_SHAPES: TestShape[] = [
  {
    id: "square",
    label: "Quadrat",
    icon: Square,
    moves: (x, y, w, h) => [
      { x, y, pen: false },
      { x: x + w, y, pen: true },
      { x: x + w, y: y + h, pen: true },
      { x, y: y + h, pen: true },
      { x, y, pen: true },
    ],
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="1" y="1" width="98" height="98" fill="none" stroke="black" stroke-width="2"/></svg>`,
  },
  {
    id: "circle",
    label: "Kreis",
    icon: Circle,
    moves: (x, y, w, h) => {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      const pts = Array.from({ length: 73 }, (_, i) => {
        const a = (i / 72) * 2 * Math.PI;
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, pen: i > 0 };
      });
      pts[0].pen = false;
      return pts;
    },
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="none" stroke="black" stroke-width="2"/></svg>`,
  },
  {
    id: "cross",
    label: "Kreuz",
    icon: Plus,
    moves: (x, y, w, h) => [
      { x: x + w / 2, y, pen: false },
      { x: x + w / 2, y: y + h, pen: true },
      { x, y: y + h / 2, pen: false },
      { x: x + w, y: y + h / 2, pen: true },
    ],
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="50" y1="0" x2="50" y2="100" stroke="black" stroke-width="2"/><line x1="0" y1="50" x2="100" y2="50" stroke="black" stroke-width="2"/></svg>`,
  },
  {
    id: "line",
    label: "Linie",
    icon: Minus,
    moves: (x, y, w, h) => [
      { x, y: y + h / 2, pen: false },
      { x: x + w, y: y + h / 2, pen: true },
    ],
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="0" y1="50" x2="100" y2="50" stroke="black" stroke-width="2"/></svg>`,
  },
  {
    id: "grid",
    label: "Raster",
    icon: Grid3X3,
    moves: (x, y, w, h) => {
      const moves: Array<{ x: number; y: number; pen: boolean }> = [];
      for (let i = 0; i <= 4; i++) {
        const px = x + (w / 4) * i;
        moves.push({ x: px, y, pen: false }, { x: px, y: y + h, pen: true });
      }
      for (let i = 0; i <= 4; i++) {
        const py = y + (h / 4) * i;
        moves.push({ x, y: py, pen: false }, { x: x + w, y: py, pen: true });
      }
      return moves;
    },
    svg: () => {
      const lines: string[] = [];
      for (let i = 0; i <= 4; i++) {
        const p = (100 / 4) * i;
        lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="100" stroke="black" stroke-width="1.5"/>`);
        lines.push(`<line x1="0" y1="${p}" x2="100" y2="${p}" stroke="black" stroke-width="1.5"/>`);
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${lines.join("")}</svg>`;
    },
  },
];

function generateTestGcode(shape: TestShape, config: PlotConfig, transform: SvgTransform): string {
  const { penUpZ, penDownZ, travelFeed, drawFeed, zFeed, dwell } = config;
  const x = transform.x;
  const y = transform.y;
  const w = transform.scale;
  const h = transform.scale; // square aspect ratio for test shapes
  const fmtF = (n: number) => Math.round(n).toString();

  const moves = shape.moves(x, y, w, h);
  const lines: string[] = ["G21 G90", `G0 Z${penUpZ.toFixed(3)} F${fmtF(zFeed)}`];
  let penIsUp = true;

  for (const move of moves) {
    if (move.pen && penIsUp) {
      lines.push(`G1 Z${penDownZ.toFixed(3)} F${fmtF(zFeed)}`);
      if (dwell > 0) lines.push(`G4 P${(dwell / 1000).toFixed(2)}`);
      penIsUp = false;
    } else if (!move.pen && !penIsUp) {
      lines.push(`G0 Z${penUpZ.toFixed(3)} F${fmtF(zFeed)}`);
      penIsUp = true;
    }
    const cmd = penIsUp ? "G0" : "G1";
    const f = fmtF(penIsUp ? travelFeed : drawFeed);
    lines.push(`${cmd} X${move.x.toFixed(3)} Y${move.y.toFixed(3)} F${f}`);
  }

  if (!penIsUp) lines.push(`G0 Z${penUpZ.toFixed(3)} F${fmtF(zFeed)}`);
  lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${fmtF(travelFeed)}`);
  return lines.join("\n");
}

function testShapeSvg(shape: TestShape): string {
  return shape.svg(100, 100);
}

function FontDropdown({
  selectedId,
  loadingId,
  onSelect,
}: {
  selectedId: string | null;
  loadingId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = PRESET_FONTS.find((f) => f.id === selectedId);

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border border-[#e9e9e7] rounded-lg bg-white hover:bg-[#f7f7f5] transition-colors text-left"
      >
        {selected ? (
          <span
            className="text-[15px] text-[#37352f]"
            style={{ fontFamily: `"${selected.name}", sans-serif` }}
          >
            {selected.name}
          </span>
        ) : (
          <span className="text-[13px] text-[#9b9b98]">Schriftart wählen…</span>
        )}
        <svg width="10" height="6" viewBox="0 0 10 6" className={`flex-shrink-0 text-[#9b9b98] transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-[#e9e9e7] rounded-lg shadow-lg overflow-hidden max-h-[240px] overflow-y-auto">
          {PRESET_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => { onSelect(font.id); setOpen(false); }}
              disabled={loadingId !== null && loadingId !== font.id}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                selectedId === font.id
                  ? "bg-[#37352f] text-white"
                  : "hover:bg-[#f7f7f5] text-[#37352f]"
              }`}
            >
              <span
                className="text-[15px]"
                style={{ fontFamily: `"${font.name}", sans-serif` }}
              >
                {loadingId === font.id ? `${font.name} …` : font.name}
              </span>
              {selectedId === font.id && (
                <svg width="14" height="14" viewBox="0 0 14 14" className="flex-shrink-0">
                  <path d="M2.5 7l3.5 3.5 5.5-6" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddTextModal({
  onClose,
  onConfirm,
  textInput,
  onTextChange,
  fontStyle,
  onFontStyleChange,
  textMode,
  onTextModeChange,
  loadedFont,
  onLoadFontFile,
  selectedPresetFont,
  loadingFontId,
  onLoadPresetFont,
}: {
  onClose: () => void;
  onConfirm: () => void;
  textInput: string;
  onTextChange: (t: string) => void;
  fontStyle: FontStyle;
  onFontStyleChange: (f: FontStyle) => void;
  textMode: "stroke" | "ttf";
  onTextModeChange: (m: "stroke" | "ttf") => void;
  loadedFont: LoadedFont | null;
  onLoadFontFile: () => void;
  selectedPresetFont: string | null;
  loadingFontId: string | null;
  onLoadPresetFont: (fontId: string) => void;
}) {
  // Inject @font-face rules so the dropdown can show each font in its own style
  // using the same WOFF files that opentype.js will fetch (cached after first load)
  useEffect(() => {
    const id = "preset-font-faces";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = PRESET_FONTS.map(
      (f) => `@font-face { font-family: "${f.name}"; src: url("${f.url}") format("woff"); font-weight: normal; font-style: normal; }`
    ).join("\n");
    document.head.appendChild(style);
  }, []);

  const canConfirm = textInput.trim().length > 0 && (textMode === "stroke" || loadedFont !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-white rounded-2xl shadow-2xl w-[480px] max-w-[95vw] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9e9e7]">
          <h2 className="text-[16px] font-semibold text-[#37352f]">Text hinzufügen</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#37352f] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2 bg-[#f0f0ee] p-1 rounded-lg">
            <button
              type="button"
              onClick={() => onTextModeChange("stroke")}
              className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-all ${
                textMode === "stroke"
                  ? "bg-white text-[#37352f] shadow-sm"
                  : "text-[#787774] hover:text-[#37352f]"
              }`}
            >
              Strich-Schrift
            </button>
            <button
              type="button"
              onClick={() => onTextModeChange("ttf")}
              className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-all ${
                textMode === "ttf"
                  ? "bg-white text-[#37352f] shadow-sm"
                  : "text-[#787774] hover:text-[#37352f]"
              }`}
            >
              TTF / Eigene Schrift
            </button>
          </div>

          {/* Stroke font style */}
          {textMode === "stroke" && (
            <div className="grid grid-cols-3 gap-2">
              {(["sans", "round", "script"] as FontStyle[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFontStyleChange(f)}
                  className={`py-2.5 rounded-lg border text-[12px] font-medium transition-colors ${
                    fontStyle === f
                      ? "bg-[#37352f] text-white border-[#37352f]"
                      : "bg-white text-[#787774] border-[#e9e9e7] hover:bg-[#f7f7f5]"
                  }`}
                >
                  {f === "sans" ? "Technisch" : f === "round" ? "Rund" : "Kursiv"}
                </button>
              ))}
            </div>
          )}

          {/* TTF: preset dropdown + own file */}
          {textMode === "ttf" && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest">
                Schriftart
              </p>
              <FontDropdown
                selectedId={selectedPresetFont}
                loadingId={loadingFontId}
                onSelect={onLoadPresetFont}
              />
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-[#e9e9e7]" />
                <span className="text-[11px] text-[#9b9b98]">oder</span>
                <div className="flex-1 h-px bg-[#e9e9e7]" />
              </div>
              <button
                type="button"
                onClick={onLoadFontFile}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
              >
                <Upload size={13} className="text-[#787774]" />
                {loadedFont && !selectedPresetFont
                  ? <span className="truncate font-medium">{loadedFont.name}</span>
                  : <span className="text-[#9b9b98]">Eigene TTF / OTF laden…</span>
                }
              </button>
            </div>
          )}

          {/* Text input */}
          <div>
            <p className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest mb-2">
              Text
            </p>
            <textarea
              value={textInput}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Text eingeben…"
              rows={3}
              autoFocus
              className="w-full text-[13px] border border-[#e9e9e7] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f] resize-none placeholder:text-[#c7c6c4]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e7] flex gap-2 p-4 bg-[#fafaf9]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#787774] hover:bg-[#f7f7f5] transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-lg bg-green-600 text-white text-[12px] font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            Erstellen
          </button>
        </div>
      </div>
    </div>
  );
}

const MATH_SNIPPETS: { label: string; insert: string }[] = [
  { label: "x²",   insert: "^{2}" },
  { label: "xₙ",   insert: "_{n}" },
  { label: "¹⁄₂",  insert: "\\frac{a}{b}" },
  { label: "√",    insert: "\\sqrt{x}" },
  { label: "∑",    insert: "\\sum_{i=1}^{n}" },
  { label: "∫",    insert: "\\int_{a}^{b}" },
  { label: "lim",  insert: "\\lim_{x \\to 0}" },
  { label: "π",    insert: "\\pi" },
  { label: "α",    insert: "\\alpha" },
  { label: "θ",    insert: "\\theta" },
  { label: "·",    insert: "\\cdot" },
  { label: "≤",    insert: "\\leq" },
];

const MATH_EXAMPLES: string[] = [
  "x^2 + y^2 = r^2",
  "\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  "e^{i\\pi} + 1 = 0",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
];

function AddMathModal({
  latex, onChange, onClose, onConfirm,
}: {
  latex: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live, debounced preview — also warms up the MathJax CDN load.
  useEffect(() => {
    const src = latex.trim();
    if (!src) { setPreview(null); setError(null); setRendering(false); return; }
    let cancelled = false;
    setRendering(true);
    const id = window.setTimeout(async () => {
      try {
        const { svg } = await mathToSvg(src);
        if (!cancelled) { setPreview(svg); setError(null); }
      } catch (e) {
        if (!cancelled) { setPreview(null); setError(String(e)); }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [latex]);

  const canConfirm = preview !== null && !submitting;

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-white rounded-2xl shadow-2xl w-[480px] max-w-[95vw] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9e9e7]">
          <div className="flex items-center gap-2">
            <Sigma size={15} className="text-[#787774]" />
            <h2 className="text-[16px] font-semibold text-[#37352f]">Formel hinzufügen</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#37352f] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Live preview */}
          <div className="rounded-xl border border-[#e9e9e7] bg-[#fafaf9] min-h-[88px] flex items-center justify-center p-4 overflow-auto">
            {preview ? (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
                alt="Formel-Vorschau"
                style={{ maxHeight: 120, maxWidth: "100%" }}
              />
            ) : error ? (
              <span className="text-[12px] text-red-500 text-center">{error}</span>
            ) : rendering ? (
              <RefreshCw size={16} className="animate-spin text-[#9b9b98]" />
            ) : (
              <span className="text-[12px] text-[#9b9b98]">Vorschau erscheint hier</span>
            )}
          </div>

          {/* LaTeX input */}
          <div>
            <p className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest mb-2">
              LaTeX
            </p>
            <textarea
              value={latex}
              onChange={(e) => onChange(e.target.value)}
              placeholder="z. B. \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
              rows={3}
              autoFocus
              spellCheck={false}
              className="w-full text-[13px] font-mono border border-[#e9e9e7] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f] resize-none placeholder:text-[#c7c6c4]"
            />
          </div>

          {/* Quick-insert snippets */}
          <div className="flex flex-wrap gap-1.5">
            {MATH_SNIPPETS.map((s) => (
              <button
                key={s.insert}
                type="button"
                onClick={() => onChange(latex + s.insert)}
                title={s.insert}
                className="px-2.5 py-1.5 rounded-lg border border-[#e9e9e7] bg-white text-[13px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Examples */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-[#9b9b98] uppercase tracking-widest">Beispiele</p>
            <div className="flex flex-col gap-1">
              {MATH_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => onChange(ex)}
                  className="text-left text-[11px] font-mono text-[#787774] hover:text-[#37352f] truncate"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e7] flex gap-2 p-4 bg-[#fafaf9]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#787774] hover:bg-[#f7f7f5] transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-lg bg-green-600 text-white text-[12px] font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Erstelle…" : "Erstellen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GcodeEditorModal({
  gcode, onChange, onClose, onRun, connected, sending,
}: {
  gcode: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onRun: () => void;
  connected: boolean;
  sending: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = gcode.length === 0 ? 1 : gcode.split("\n").length;
  const canRun = connected && !sending && gcode.trim().length > 0;

  const copy = async () => {
    await navigator.clipboard.writeText(gcode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Keep the line-number gutter aligned with the textarea while scrolling.
  const syncScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-white rounded-2xl shadow-2xl w-[680px] max-w-[90vw] h-[75vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e9e9e7] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Code size={14} className="text-[#787774]" />
            <span className="text-[13px] font-semibold text-[#37352f]">GCode Editor</span>
            <span className="text-[11px] text-[#9b9b98] tabular-nums ml-1">{lineCount} Zeilen</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e9e9e7] text-[11px] font-medium text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f] transition-colors"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? "Kopiert!" : "Kopieren"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#f0f0ee] text-[#9b9b98] hover:text-[#37352f] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Editor: line-number gutter + editable textarea */}
        <div className="flex-1 flex overflow-hidden bg-[#fafaf9] font-mono text-[12px] leading-[18px]">
          <div
            ref={gutterRef}
            className="overflow-hidden text-right text-[#c7c6c4] select-none py-3 pl-3 pr-2 border-r border-[#e9e9e7] tabular-nums"
            aria-hidden
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={taRef}
            value={gcode}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            spellCheck={false}
            placeholder="; GCode hier einfügen oder bearbeiten…"
            className="flex-1 resize-none outline-none bg-transparent text-[#37352f] py-3 px-3 whitespace-pre overflow-auto font-mono text-[12px] leading-[18px] placeholder:text-[#c7c6c4]"
          />
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e7] flex items-center gap-2 p-4 bg-white flex-shrink-0">
          <p className="text-[11px] text-[#9b9b98] flex-1">
            Änderungen aktualisieren Vorschau & Zeit sofort.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#e9e9e7] bg-white text-[12px] font-medium text-[#787774] hover:bg-[#f7f7f5] transition-colors"
          >
            Schließen
          </button>
          <button
            onClick={onRun}
            disabled={!canRun}
            title={!connected ? "Nicht verbunden" : undefined}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#37352f] text-white text-[12px] font-medium hover:bg-[#2c2b26] disabled:opacity-40 transition-colors"
          >
            <Printer size={13} />
            {sending ? "Startet…" : "Ausführen"}
          </button>
        </div>
      </div>
    </div>
  );
}

