import { useCallback, useRef, useState, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2, RotateCw } from "lucide-react";
import { SvgTransform, PAPER_A4, MACHINE } from "../lib/types";
import { GcodeStroke, RasterDebug } from "../lib/svgToGcode";

interface Props {
  svgString: string | null;
  svgDims: { w: number; h: number };
  transform: SvgTransform;
  onChange: (t: SvgTransform) => void;
  readOnly?: boolean;
  gcodeStrokes?: GcodeStroke[];
  rasterDebug?: RasterDebug | null;
}

const GRID_STEPS = [1, 5, 10, 25] as const;
const snapToGrid = (v: number, g: number) => Math.round(v / g) * g;
type ResizeCorner = "tl" | "tr" | "bl" | "br";

export default function A4Canvas({ svgString, svgDims, transform, onChange, readOnly = false, gcodeStrokes, rasterDebug }: Props) {
  const dbgCanvasRef = useRef<HTMLCanvasElement>(null);

  // Paint the raster-debug bitmap onto an overlay canvas whenever it changes.
  useEffect(() => {
    const cv = dbgCanvasRef.current;
    if (!cv || !rasterDebug) return;
    cv.width = rasterDebug.canvasW;
    cv.height = rasterDebug.canvasH;
    const cx = cv.getContext("2d");
    if (!cx) return;
    const img = cx.createImageData(rasterDebug.canvasW, rasterDebug.canvasH);
    // Base: transparent. Dark mask → semi-opaque blue (what the detector saw).
    for (let i = 0; i < rasterDebug.mask.length; i++) {
      if (rasterDebug.mask[i]) {
        const j = i * 4;
        img.data[j] = 30;
        img.data[j + 1] = 100;
        img.data[j + 2] = 220;
        img.data[j + 3] = 160;
      }
    }
    // Mark each run boundary in red — these are the pen-up positions inside fills.
    // A pen-lift is suspicious if it's between two runs on the same row.
    const runsByRow = new Map<number, Array<{ start: number; end: number }>>();
    for (const r of rasterDebug.runs) {
      if (!runsByRow.has(r.y)) runsByRow.set(r.y, []);
      runsByRow.get(r.y)!.push({ start: r.start, end: r.end });
    }
    for (const [y, rs] of runsByRow) {
      rs.sort((a, b) => a.start - b.start);
      for (let k = 1; k < rs.length; k++) {
        // Paint the gap pixels (end of prev .. start of this) bright red.
        const prev = rs[k - 1];
        const cur = rs[k];
        for (let x = prev.end + 1; x < cur.start; x++) {
          const j = (y * rasterDebug.canvasW + x) * 4;
          img.data[j] = 255;
          img.data[j + 1] = 50;
          img.data[j + 2] = 50;
          img.data[j + 3] = 240;
        }
      }
    }
    cx.putImageData(img, 0, 0);
  }, [rasterDebug]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cSize, setCSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [resizeCorner, setResizeCorner] = useState<ResizeCorner | null>(null);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, tx: 0, ty: 0 });
  const [resizeStart, setResizeStart] = useState({ mx: 0, my: 0, x: 0, y: 0, scale: 0, height: 0 });
  const [gridStep, setGridStep] = useState<(typeof GRID_STEPS)[number]>(10);
  const [snap, setSnap] = useState(true);
  const [showLines, setShowLines] = useState(false);

  useEffect(() => {
    if (gcodeStrokes && gcodeStrokes.length > 0) setShowLines(true);
    else setShowLines(false);
  }, [gcodeStrokes]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCSize({ w: r.width, h: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const PADDING = 32;
  const scale = cSize.w > 0 && cSize.h > 0
    ? Math.min((cSize.w - PADDING) / PAPER_A4.w, (cSize.h - PADDING) / PAPER_A4.h)
    : 1;

  const paperW = PAPER_A4.w * scale;
  const paperH = PAPER_A4.h * scale;
  const paperX = (cSize.w - paperW) / 2;
  const paperY = (cSize.h - paperH) / 2;

  const rotated = transform.rotation === 90;
  const svgScaleW = rotated ? svgDims.h : svgDims.w;
  const svgScaleH = rotated ? svgDims.w : svgDims.h;
  const previewW = transform.scale;
  const previewH = svgScaleW > 0 ? (transform.scale / svgScaleW) * svgScaleH : transform.scale;

  // SVG box in paper-relative px
  const svgX = transform.x * scale;
  const svgY = transform.y * scale;
  const svgW = previewW * scale;
  const svgH = previewH * scale;

  // SVG box in wrapper-absolute px (for handles layer)
  const absSvgX = paperX + svgX;
  const absSvgY = paperY + svgY;

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (!svgString || readOnly) return;
    e.preventDefault();
    setDragging(true);
    setDragStart({ mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y });
  }, [svgString, transform, readOnly]);

  const onResizeMouseDown = useCallback((corner: ResizeCorner, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!svgString || readOnly) return;
    setResizeCorner(corner);
    setResizeStart({ mx: e.clientX, my: e.clientY, x: transform.x, y: transform.y, scale: transform.scale, height: previewH });
  }, [svgString, transform, previewH, readOnly]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        const dx = (e.clientX - dragStart.mx) / scale;
        const dy = (e.clientY - dragStart.my) / scale;
        const rawX = Math.max(0, Math.min(Math.max(0, PAPER_A4.w - previewW), dragStart.tx + dx));
        const rawY = Math.max(0, Math.min(Math.max(0, PAPER_A4.h - previewH), dragStart.ty + dy));
        onChange({
          ...transform,
          x: snap ? snapToGrid(rawX, gridStep) : rawX,
          y: snap ? snapToGrid(rawY, gridStep) : rawY,
        });
      }
      if (resizeCorner) {
        const dx = (e.clientX - resizeStart.mx) / scale;
        const dy = (e.clientY - resizeStart.my) / scale;
        const aspect = resizeStart.height / resizeStart.scale;
        const wFromX = resizeCorner.includes("l") ? resizeStart.scale - dx : resizeStart.scale + dx;
        const wFromY = resizeCorner.includes("t") ? resizeStart.scale - dy / aspect : resizeStart.scale + dy / aspect;
        const rawSc = Math.abs(dx) > Math.abs(dy / aspect) ? wFromX : wFromY;
        const sc = Math.max(5, Math.min(500, snap ? snapToGrid(rawSc, gridStep) : rawSc));
        const h = sc * aspect;
        const rawX = resizeCorner.includes("l") ? resizeStart.x + resizeStart.scale - sc : resizeStart.x;
        const rawY = resizeCorner.includes("t") ? resizeStart.y + resizeStart.height - h : resizeStart.y;
        onChange({
          ...transform,
          scale: sc,
          x: Math.max(0, Math.min(PAPER_A4.w - sc, snap ? snapToGrid(rawX, gridStep) : rawX)),
          y: Math.max(0, Math.min(PAPER_A4.h - h, snap ? snapToGrid(rawY, gridStep) : rawY)),
        });
      }
    };
    const onUp = () => { setDragging(false); setResizeCorner(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, resizeCorner, dragStart, resizeStart, transform, onChange, snap, gridStep, scale, previewW, previewH]);

  const fitToPage = () => {
    const srcW = rotated ? svgDims.h : svgDims.w;
    const srcH = rotated ? svgDims.w : svgDims.h;
    const sc = Math.min(PAPER_A4.w / srcW, PAPER_A4.h / srcH) * 0.95;
    onChange({ ...transform, scale: sc * srcW, x: 2, y: 2 });
  };

  const rotate = () => onChange({ ...transform, rotation: rotated ? 0 : 90 });
  const zoom = (f: number) => {
    const raw = Math.max(5, Math.min(500, transform.scale * f));
    onChange({ ...transform, scale: snap ? snapToGrid(raw, gridStep) : raw });
  };

  // Grid lines (rendered on the paper element)
  const majorEvery = Math.max(gridStep * 5, 10);
  const vLines = Array.from({ length: Math.floor(PAPER_A4.w / gridStep) }, (_, i) => {
    const x = (i + 1) * gridStep * scale;
    const major = ((i + 1) * gridStep) % majorEvery === 0;
    return <line key={`v${i}`} x1={x} y1={0} x2={x} y2={paperH} stroke={major ? "#93a3b8" : "#c8d4e4"} strokeWidth={major ? 0.5 : 0.3} />;
  });
  const hLines = Array.from({ length: Math.floor(PAPER_A4.h / gridStep) }, (_, i) => {
    const y = (i + 1) * gridStep * scale;
    const major = ((i + 1) * gridStep) % majorEvery === 0;
    return <line key={`h${i}`} x1={0} y1={y} x2={paperW} y2={y} stroke={major ? "#93a3b8" : "#c8d4e4"} strokeWidth={major ? 0.5 : 0.3} />;
  });

  // When SVG is rotated 90° CW, render the img as svgH×svgW and rotate around center
  // so it fills the svgW×svgH box correctly.
  const imgStyle: React.CSSProperties = rotated ? {
    position: "absolute",
    width: svgH,
    height: svgW,
    left: (svgW - svgH) / 2,
    top: (svgH - svgW) / 2,
    transform: "rotate(90deg)",
    transformOrigin: "center center",
    objectFit: "fill",
    pointerEvents: "none",
  } : {
    width: "100%",
    height: "100%",
    objectFit: "fill",
    pointerEvents: "none",
    display: "block",
  };

  const cornerCursors: Record<ResizeCorner, string> = {
    tl: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", br: "nwse-resize",
  };

  return (
    <div className="flex flex-col h-full gap-2">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-mono text-[#9b9b98]">
          X{transform.x.toFixed(1)} Y{transform.y.toFixed(1)} ·{" "}
          <span className="text-[#37352f]">{previewW.toFixed(1)} × {previewH.toFixed(1)} mm</span>
        </span>

        <div className="flex items-center gap-0.5 rounded-lg border border-[#e9e9e7] bg-white p-0.5">
          {GRID_STEPS.map((step) => (
            <button
              key={step}
              onClick={() => setGridStep(step)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                gridStep === step ? "bg-[#37352f] text-white" : "text-[#787774] hover:bg-[#f7f7f5]"
              }`}
            >
              {step}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSnap((v) => !v)}
          className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
            snap ? "border-[#37352f] bg-[#37352f] text-white" : "border-[#e9e9e7] bg-white text-[#787774] hover:bg-[#f7f7f5]"
          }`}
        >
          Snap
        </button>

        {gcodeStrokes && gcodeStrokes.length > 0 && (
          <div className="flex items-center gap-0.5 rounded-lg border border-[#e9e9e7] bg-white p-0.5">
            <button
              onClick={() => setShowLines(false)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                !showLines ? "bg-[#37352f] text-white" : "text-[#787774] hover:bg-[#f7f7f5]"
              }`}
            >
              SVG
            </button>
            <button
              onClick={() => setShowLines(true)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                showLines ? "bg-[#37352f] text-white" : "text-[#787774] hover:bg-[#f7f7f5]"
              }`}
            >
              Linien
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!readOnly && (
            <>
              <ToolBtn onClick={() => zoom(1 / 1.2)} title="Zoom out"><ZoomOut size={13} /></ToolBtn>
              <ToolBtn onClick={() => zoom(1.2)} title="Zoom in"><ZoomIn size={13} /></ToolBtn>
              <ToolBtn onClick={rotate} title="Rotate 90°"><RotateCw size={13} /></ToolBtn>
              <ToolBtn onClick={fitToPage} title="Fit to page" disabled={!svgString}>
                <Maximize2 size={13} />
              </ToolBtn>
            </>
          )}
        </div>
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 rounded-xl border border-[#e9e9e7] bg-[#e8e7e5] overflow-hidden relative select-none"
        style={{ cursor: dragging ? "grabbing" : "default" }}
      >
        {cSize.w > 0 && (
          <>
            {/* ── Paper ─────────────────────────────────────────────── */}
            <div
              className="absolute bg-white"
              style={{
                left: paperX,
                top: paperY,
                width: paperW,
                height: paperH,
                boxShadow: "0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.07)",
              }}
            >
              {/* Grid */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.55 }}>
                {vLines}
                {hLines}
              </svg>

              {/* SVG image (no rotation on the container — rotation handled inside) */}
              {svgString && !showLines && (
                <div
                  className="absolute overflow-hidden"
                  style={{ left: svgX, top: svgY, width: svgW, height: svgH }}
                >
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`}
                    alt="preview"
                    style={imgStyle}
                  />
                </div>
              )}

              {/* Raster debug overlay (bitmap + pen-up markers) */}
              {rasterDebug && (
                <canvas
                  ref={dbgCanvasRef}
                  className="absolute pointer-events-none"
                  style={{
                    left: rasterDebug.originX * scale,
                    top: rasterDebug.originY * scale,
                    width: rasterDebug.widthMm * scale,
                    height: rasterDebug.heightMm * scale,
                    imageRendering: "pixelated",
                  }}
                />
              )}

              {/* G-code line preview */}
              {showLines && gcodeStrokes && gcodeStrokes.length > 0 && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  style={{ width: paperW, height: paperH }}
                  viewBox={`0 0 ${PAPER_A4.w} ${PAPER_A4.h}`}
                  preserveAspectRatio="none"
                >
                  {gcodeStrokes.map((stroke, i) => (
                    <polyline
                      key={i}
                      points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke={stroke.color}
                      strokeWidth={0.3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </svg>
              )}

              {/* Origin crosshair */}
              <div className="absolute top-0 left-0 pointer-events-none">
                <div className="absolute w-2 h-px bg-red-400" style={{ top: 3, left: 0 }} />
                <div className="absolute w-px h-2 bg-green-500" style={{ top: 0, left: 3 }} />
              </div>
            </div>

            {/* ── Handles layer (wrapper coordinates, never rotated) ─── */}
            {svgString && (
              <>
                {/* Drag overlay (invisible, sits over the SVG image) */}
                {!readOnly && (
                  <div
                    onMouseDown={onDragMouseDown}
                    className="absolute"
                    style={{
                      left: absSvgX, top: absSvgY,
                      width: svgW, height: svgH,
                      cursor: dragging ? "grabbing" : "grab",
                    }}
                  />
                )}

                {/* Selection border + tint */}
                <div
                  className="absolute pointer-events-none rounded-sm"
                  style={{
                    left: absSvgX, top: absSvgY,
                    width: svgW, height: svgH,
                    border: "1.5px dashed #3b82f6",
                    background: "rgba(59,130,246,0.04)",
                  }}
                />

                {!readOnly && (
                  <>
                    {/* Rotation stem */}
                    <div
                      className="absolute pointer-events-none bg-[#ef4444]"
                      style={{
                        left: absSvgX + svgW / 2 - 0.5,
                        top: absSvgY - 22,
                        width: 1,
                        height: 22,
                      }}
                    />

                    {/* Rotation button (always at visual top-center) */}
                    <button
                      onClick={rotate}
                      className="absolute flex items-center justify-center w-6 h-6 rounded-full bg-[#ef4444] border-2 border-white text-white shadow-md hover:bg-red-600 transition-colors"
                      style={{ left: absSvgX + svgW / 2 - 12, top: absSvgY - 22 - 12 }}
                      title="Rotate 90°"
                    >
                      <RotateCw size={10} strokeWidth={2.5} />
                    </button>

                    {/* Corner resize handles */}
                    {(["tl", "tr", "bl", "br"] as ResizeCorner[]).map((c) => (
                      <div
                        key={c}
                        onMouseDown={(e) => onResizeMouseDown(c, e)}
                        className="absolute w-3 h-3 rounded-full bg-white border-2 border-blue-500 shadow"
                        style={{
                          left: (c.includes("r") ? absSvgX + svgW : absSvgX) - 6,
                          top: (c.includes("b") ? absSvgY + svgH : absSvgY) - 6,
                          cursor: cornerCursors[c],
                        }}
                      />
                    ))}

                    {/* Size badge (always horizontal) */}
                    <div
                      className="absolute pointer-events-none bg-white/95 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[#37352f] shadow-sm border border-[#e9e9e7]"
                      style={{ left: absSvgX + 2, top: absSvgY + svgH + 5 }}
                    >
                      {previewW.toFixed(0)} × {previewH.toFixed(0)} mm
                    </div>
                  </>
                )}
              </>
            )}

            {/* Paper label */}
            <div
              className="absolute pointer-events-none text-[10px] text-[#a8a8a5] font-medium"
              style={{ left: paperX + 4, top: paperY - 18 }}
            >
              A4 · {PAPER_A4.w} × {PAPER_A4.h} mm
            </div>

            {/* Bed size hint */}
            <div className="absolute bottom-2 right-3 pointer-events-none text-[10px] text-[#b0afad]">
              Bett {MACHINE.bedX} × {MACHINE.bedY} mm
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  onClick, title, disabled, children,
}: {
  onClick: () => void; title?: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] disabled:opacity-30 transition-colors text-[#787774]"
    >
      {children}
    </button>
  );
}
