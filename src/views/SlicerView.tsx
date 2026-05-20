import { useState, useCallback, useEffect } from "react";
import {
  Upload, Play, FileCode, Clock, Layers, RefreshCw, ArrowLeft, Printer
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  DEFAULT_PEN_CHANGE,
  DEFAULT_PEN_SLOTS,
  PenChangeConfig,
  PenSlot,
  PlotConfig,
  RasterConfig,
  SERVO_HOLD_JOB_EVERY_LINES,
  SERVO_HOLD_PWM,
  SvgTransform,
} from "../lib/types";
import {
  ColoredPath,
  generateGcode,
  generateMultiPenGcode,
  generateRasterGcode,
  getSvgDimensions,
  parseSvgPaths,
  quantizeToSlots,
  estimateTime,
} from "../lib/svgToGcode";
import { Grbl } from "../lib/grbl";
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

const DEFAULT_CONFIG: PlotConfig = {
  penUpZ: 5,
  penDownZ: 0,
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
};

type SliceMode = "auto" | "vector" | "raster";
type ScreenMode = "edit" | "print";

export default function SlicerView({ connected, jobProgress, onMessage, penSlots: propSlots, penChange: propChange, initialSvg, onInitialSvgConsumed }: Props) {
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
  const [estTime, setEstTime] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [screenMode, setScreenMode] = useState<ScreenMode>("edit");

  useEffect(() => {
    if (!initialSvg) return;
    const dims = getSvgDimensions(initialSvg.content);
    setSvgString(initialSvg.content);
    setSvgDims(dims);
    setFileName(initialSvg.name);
    setGcode(null);
    setEstTime(null);
    setScreenMode("edit");
    const autoScale = (190 / (dims.w || 100)) * dims.w;
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

      // Auto-fit scale: fit SVG width to 190mm, leaving 10mm margins.
      const autoScale = (190 / (dims.w || 100)) * dims.w;
      setTransform({ ...DEFAULT_TRANSFORM, scale: autoScale });
      onMessage(`Loaded ${path.split("/").pop() ?? path}`);
    } catch (e) {
      onMessage(`SVG import failed: ${String(e)}`);
    }
  };

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
      if (useRaster) {
        gc = await generateRasterGcode(svgString, svgDims, transform, config, rasterConfig);
      } else if (multiColor) {
        const groups = quantizeToSlots(paths, penSlots);
        setColorGroups(groups);
        gc = generateMultiPenGcode(paths, svgDims, transform, config, penSlots, penChange);
        const colorCount = groups.size;
        onMessage(`Generated ${countCommands(gc)} commands, ${colorCount} pen color${colorCount !== 1 ? "s" : ""}`);
      } else {
        gc = generateGcode(paths, svgDims, transform, config);
      }

      setGcode(gc);
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

  const sendToPlotter = async () => {
    if (!gcode || !connected) return;
    setSending(true);
    try {
      const lines = gcode.split("\n").filter((l) => {
        const t = l.trim();
        return t && !t.startsWith(";");
      });
      const jobLines = withServoHold(lines);
      await Grbl.startJob(jobLines);
      onMessage(`Started plot job with ${jobLines.length} commands`);
    } catch (e) {
      onMessage(`Plot start failed: ${String(e)}`);
    } finally {
      setSending(false);
    }
  };

  const NumInput = ({
    label, value, onChange, min, max, step, unit,
  }: {
    label: string; value: number; onChange: (v: number) => void;
    min?: number; max?: number; step?: number; unit?: string;
  }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-[#787774] flex-1">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          min={min} max={max} step={step ?? 0.1}
          className="w-16 text-right text-[12px] border border-[#e9e9e7] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#37352f] bg-white text-[#37352f]"
        />
        {unit && <span className="text-[11px] text-[#9b9b98] w-7">{unit}</span>}
      </div>
    </div>
  );

  if (screenMode === "print" && svgString && gcode) {
    const commands = countCommands(gcode);
    const progressPct = jobProgress && jobProgress.total > 0
      ? Math.min(100, (jobProgress.sent / jobProgress.total) * 100)
      : 0;

    return (
      <div className="flex h-full overflow-hidden">
        <div className="w-[280px] flex-shrink-0 border-r border-[#e9e9e7] overflow-y-auto p-4 space-y-4">
          <button
            onClick={() => setScreenMode("edit")}
            disabled={Boolean(jobProgress)}
            className="flex items-center gap-2 rounded-lg border border-[#e9e9e7] bg-white px-3 py-2 text-[12px] text-[#37352f] hover:bg-[#f7f7f5] disabled:opacity-40"
          >
            <ArrowLeft size={13} />
            Back to slicing
          </button>

          <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
            <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
              Print Preview
            </p>
            <div className="space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-[#787774]">File</span>
                <span className="max-w-[150px] truncate text-[#37352f]" title={fileName}>{fileName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#787774]">Commands</span>
                <span className="tabular-nums text-[#37352f]">{commands}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#787774]">Est. time</span>
                <span className="tabular-nums text-[#37352f]">{estTime !== null ? formatTime(estTime) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#787774]">Size</span>
                <span className="tabular-nums text-[#37352f]">{transform.scale.toFixed(1)} mm</span>
              </div>
            </div>
          </div>

          {jobProgress && (
            <div className="bg-white border border-[#e9e9e7] rounded-xl p-4">
              <div className="mb-2 flex justify-between text-[12px] text-[#787774]">
                <span>Printing</span>
                <span className="tabular-nums">{jobProgress.sent}/{jobProgress.total}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#f0f0ee]">
                <div
                  className="h-full rounded-full bg-green-600 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-2 text-right text-[11px] tabular-nums text-[#787774]">
                {Math.round(progressPct)}%
              </div>
            </div>
          )}

          <button
            onClick={sendToPlotter}
            disabled={!connected || sending || Boolean(jobProgress)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-[13px] font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-40"
          >
            <Printer size={14} />
            {sending ? "Starting…" : jobProgress ? "Printing…" : "Print"}
          </button>
        </div>

        <div className="flex-1 p-4 overflow-hidden">
          <A4Canvas
            svgString={svgString}
            svgDims={svgDims}
            transform={transform}
            onChange={setTransform}
            readOnly
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-[260px] flex-shrink-0 border-r border-[#e9e9e7] overflow-y-auto p-4 space-y-4">

        {/* Import */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-3">
            SVG File
          </p>
          <button
            onClick={importSvg}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-[#e9e9e7] rounded-lg text-[12px] text-[#787774] hover:border-[#c7c6c4] hover:text-[#37352f] hover:bg-[#fafaf8] transition-colors"
          >
            <Upload size={14} />
            {fileName ? "Change file" : "Open SVG…"}
          </button>
          {fileName && (
            <p className="text-[11px] text-[#37352f] mt-2 truncate" title={fileName}>
              {fileName}
            </p>
          )}
          {svgString && (
            <p className="text-[11px] text-[#9b9b98] mt-1">
              {svgDims.w.toFixed(0)} × {svgDims.h.toFixed(0)} units
            </p>
          )}
        </div>

        {/* Transform */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
            Position on Paper
          </p>
          <NumInput label="X offset" value={transform.x} unit="mm" min={0} max={200}
            onChange={(v) => setTransform((t) => ({ ...t, x: v }))} />
          <NumInput label="Y offset" value={transform.y} unit="mm" min={0} max={280}
            onChange={(v) => setTransform((t) => ({ ...t, y: v }))} />
          <NumInput label="Width" value={transform.scale} unit="mm" min={5} max={200} step={1}
            onChange={(v) => setTransform((t) => ({ ...t, scale: v }))} />
        </div>

        {/* Pen config */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
            Pen Settings
          </p>
          <NumInput label="Pen up Z" value={config.penUpZ} unit="mm"
            onChange={(v) => setConfig((c) => ({ ...c, penUpZ: v }))} />
          <NumInput label="Pen down Z" value={config.penDownZ} unit="mm"
            onChange={(v) => setConfig((c) => ({ ...c, penDownZ: v }))} />
          <NumInput label="Travel feed" value={config.travelFeed} unit="mm/m" step={100}
            onChange={(v) => setConfig((c) => ({ ...c, travelFeed: v }))} />
          <NumInput label="Draw feed" value={config.drawFeed} unit="mm/m" step={100}
            onChange={(v) => setConfig((c) => ({ ...c, drawFeed: v }))} />
          <NumInput label="Z feed" value={config.zFeed} unit="mm/m" step={50}
            onChange={(v) => setConfig((c) => ({ ...c, zFeed: v }))} />
          <NumInput label="Pen dwell" value={config.dwell} unit="ms" step={10}
            onChange={(v) => setConfig((c) => ({ ...c, dwell: v }))} />
        </div>

        {/* Slice mode */}
        <div className="bg-white border border-[#e9e9e7] rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">
            Slicing
          </p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#f7f7f5] p-1">
            {(["auto", "vector", "raster"] as SliceMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSliceMode(mode)}
                className={`py-1.5 rounded-md text-[11px] capitalize transition-colors ${
                  sliceMode === mode
                    ? "bg-white text-[#37352f] shadow-sm"
                    : "text-[#787774] hover:text-[#37352f]"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {sliceMode !== "raster" && (
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={multiColor}
                onChange={(e) => setMultiColor(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[#37352f]"
              />
              <span className="text-[12px] text-[#37352f]">Multi-color (12 Stifte)</span>
            </label>
          )}
          {(sliceMode === "auto" || sliceMode === "raster") && (
            <div className="space-y-3 pt-1">
              <NumInput label="Line step" value={rasterConfig.lineStep} unit="mm" min={0.2} max={5} step={0.1}
                onChange={(v) => setRasterConfig((r) => ({ ...r, lineStep: v }))} />
              <NumInput label="Threshold" value={rasterConfig.threshold} min={0} max={255} step={5}
                onChange={(v) => setRasterConfig((r) => ({ ...r, threshold: v }))} />
              <NumInput label="Min line" value={rasterConfig.minRun} unit="mm" min={0.1} max={10} step={0.1}
                onChange={(v) => setRasterConfig((r) => ({ ...r, minRun: v }))} />
            </div>
          )}
        </div>

        {/* Generate + Send */}
        <div className="space-y-2">
          <button
            onClick={slice}
            disabled={!svgString || parsing}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#37352f] text-white rounded-xl text-[13px] font-medium hover:bg-[#2c2b26] disabled:opacity-40 transition-colors"
          >
            {parsing ? <RefreshCw size={13} className="animate-spin" /> : <Layers size={13} />}
            {parsing ? "Slicing…" : "Generate GCode"}
          </button>

          {gcode && (
            <>
              {/* Stats */}
              <div className="bg-[#f7f7f5] rounded-lg px-3 py-2 space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#787774] flex items-center gap-1">
                    <FileCode size={11} /> Lines
                  </span>
                  <span className="tabular-nums text-[#37352f]">
                    {gcode.split("\n").length}
                  </span>
                </div>
                {estTime !== null && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#787774] flex items-center gap-1">
                      <Clock size={11} /> Est. time
                    </span>
                    <span className="tabular-nums text-[#37352f]">
                      {formatTime(estTime)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#787774] flex items-center gap-1">
                    <Layers size={11} /> Paths
                  </span>
                  <span className="tabular-nums text-[#37352f]">{svgPaths.length}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#787774]">Commands</span>
                  <span className="tabular-nums text-[#37352f]">{countCommands(gcode)}</span>
                </div>
                {colorGroups && colorGroups.size > 0 && (
                  <div className="pt-2 space-y-1 border-t border-[#f0f0ee]">
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
              </div>

              <button
                onClick={() => setScreenMode("print")}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white rounded-xl text-[13px] font-medium hover:bg-green-700 transition-colors"
              >
                <Play size={13} />
                Switch to print screen
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 overflow-hidden">
        {svgString ? (
          <A4Canvas
            svgString={svgString}
            svgDims={svgDims}
            transform={transform}
            onChange={setTransform}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#9b9b98] gap-3">
            <Upload size={32} className="opacity-30" />
            <p className="text-[13px]">Import an SVG file to get started</p>
            <p className="text-[11px] opacity-60">
              The preview shows your drawing on A4 paper
            </p>
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

function withServoHold(lines: string[]): string[] {
  const hold = `M3 S${SERVO_HOLD_PWM}`;
  const out: string[] = [hold];

  lines.forEach((line, index) => {
    if (index > 0 && index % SERVO_HOLD_JOB_EVERY_LINES === 0) {
      out.push(hold);
    }
    out.push(line);
  });

  return out;
}
