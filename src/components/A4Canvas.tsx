import { useCallback, useRef, useState, useEffect } from "react";
import { ZoomIn, ZoomOut, Maximize2, RotateCw } from "lucide-react";
import { SvgTransform, PAPER_A4, MACHINE } from "../lib/types";

interface Props {
  svgString: string | null;
  svgDims: { w: number; h: number };
  transform: SvgTransform;
  onChange: (t: SvgTransform) => void;
  readOnly?: boolean;
}

// Canvas size in px: show machine bed at ~1.8px/mm
const PX_PER_MM = 1.8;
const CANVAS_W = Math.round(MACHINE.bedX * PX_PER_MM);
const CANVAS_H = Math.round(MACHINE.bedY * PX_PER_MM);
const PAPER_PX_W = Math.round(PAPER_A4.w * PX_PER_MM);
const PAPER_PX_H = Math.round(PAPER_A4.h * PX_PER_MM);
const GRID_STEPS = [1, 5, 10, 25] as const;

const snapToGrid = (value: number, grid: number) => Math.round(value / grid) * grid;
type ResizeCorner = "tl" | "tr" | "bl" | "br";

export default function A4Canvas({ svgString, svgDims, transform, onChange, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizeCorner, setResizeCorner] = useState<ResizeCorner | null>(null);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, tx: 0, ty: 0 });
  const [resizeStart, setResizeStart] = useState({
    mx: 0,
    my: 0,
    x: 0,
    y: 0,
    scale: 0,
    height: 0,
  });
  const [gridStep, setGridStep] = useState<(typeof GRID_STEPS)[number]>(10);
  const [snap, setSnap] = useState(true);

  const svgScaleW = transform.rotation === 90 ? svgDims.h : svgDims.w;
  const svgScaleH = transform.rotation === 90 ? svgDims.w : svgDims.h;
  const previewW = transform.scale;
  const previewH = (transform.scale / svgScaleW) * svgScaleH;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!svgString) return;
    if (readOnly) return;
    e.preventDefault();
    setDragging(true);
    setDragStart({ mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y });
  }, [svgString, transform, readOnly]);

  const onResizeMouseDown = useCallback((corner: ResizeCorner, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!svgString) return;
    if (readOnly) return;
    setResizeCorner(corner);
    setResizeStart({
      mx: e.clientX,
      my: e.clientY,
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      height: previewH,
    });
  }, [svgString, transform.x, transform.y, transform.scale, previewH, readOnly]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        const dx = (e.clientX - dragStart.mx) / PX_PER_MM;
        const dy = (e.clientY - dragStart.my) / PX_PER_MM;
        const rawX = Math.max(0, Math.min(Math.max(0, PAPER_A4.w - previewW), dragStart.tx + dx));
        const rawY = Math.max(0, Math.min(Math.max(0, PAPER_A4.h - previewH), dragStart.ty + dy));
        onChange({
          ...transform,
          x: snap ? snapToGrid(rawX, gridStep) : rawX,
          y: snap ? snapToGrid(rawY, gridStep) : rawY,
        });
      }

      if (resizeCorner) {
        const dx = (e.clientX - resizeStart.mx) / PX_PER_MM;
        const dy = (e.clientY - resizeStart.my) / PX_PER_MM;
        const aspect = resizeStart.height / resizeStart.scale;
        const widthFromX = resizeCorner.includes("l")
          ? resizeStart.scale - dx
          : resizeStart.scale + dx;
        const widthFromY = resizeCorner.includes("t")
          ? resizeStart.scale - dy / aspect
          : resizeStart.scale + dy / aspect;
        const rawScale = Math.abs(dx) > Math.abs(dy / aspect) ? widthFromX : widthFromY;
        const scale = Math.max(5, Math.min(500, snap ? snapToGrid(rawScale, gridStep) : rawScale));
        const height = scale * aspect;
        const rawX = resizeCorner.includes("l")
          ? resizeStart.x + resizeStart.scale - scale
          : resizeStart.x;
        const rawY = resizeCorner.includes("t")
          ? resizeStart.y + resizeStart.height - height
          : resizeStart.y;
        onChange({
          ...transform,
          x: Math.max(0, Math.min(PAPER_A4.w - scale, snap ? snapToGrid(rawX, gridStep) : rawX)),
          y: Math.max(0, Math.min(PAPER_A4.h - height, snap ? snapToGrid(rawY, gridStep) : rawY)),
          scale,
        });
      }
    };
    const onUp = () => {
      setDragging(false);
      setResizeCorner(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, resizeCorner, dragStart, resizeStart, transform, onChange, snap, gridStep, previewW, previewH]);

  const fitToPage = () => {
    const srcW = transform.rotation === 90 ? svgDims.h : svgDims.w;
    const srcH = transform.rotation === 90 ? svgDims.w : svgDims.h;
    const scaleX = PAPER_A4.w / srcW;
    const scaleY = PAPER_A4.h / srcH;
    const scale = Math.min(scaleX, scaleY) * 0.95;
    onChange({ ...transform, scale: scale * srcW, x: 2, y: 2 });
  };

  const rotate = () => {
    onChange({ ...transform, rotation: transform.rotation === 0 ? 90 : 0 });
  };

  const zoom = (factor: number) => {
    const rawScale = Math.max(5, Math.min(500, transform.scale * factor));
    onChange({ ...transform, scale: snap ? snapToGrid(rawScale, gridStep) : rawScale });
  };

  const paperLeft = 0;
  const paperTop = 0;

  const svgW = previewW * PX_PER_MM;
  const svgH = previewH * PX_PER_MM;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-[#787774] mr-1">
          X{transform.x.toFixed(1)} Y{transform.y.toFixed(1)} mm ·
          {previewW.toFixed(1)} × {previewH.toFixed(1)} mm
        </span>
        <div className="flex items-center gap-1 rounded-md border border-[#e9e9e7] bg-white p-0.5">
          {GRID_STEPS.map((step) => (
            <button
              key={step}
              onClick={() => setGridStep(step)}
              className={`px-2 py-1 rounded text-[11px] transition-colors ${
                gridStep === step
                  ? "bg-[#37352f] text-white"
                  : "text-[#787774] hover:bg-[#f7f7f5]"
              }`}
              title={`${step} mm raster`}
            >
              {step}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSnap((v) => !v)}
          className={`px-2 py-1.5 rounded-md border text-[11px] transition-colors ${
            snap
              ? "border-[#37352f] bg-[#37352f] text-white"
              : "border-[#e9e9e7] bg-white text-[#787774] hover:bg-[#f7f7f5]"
          }`}
        >
          Snap
        </button>
        <div className="ml-auto flex items-center gap-1">
          {!readOnly && (
            <>
              <CanvasBtn onClick={() => zoom(0.9)} title="Zoom out"><ZoomOut size={13} /></CanvasBtn>
              <CanvasBtn onClick={() => zoom(1.1)} title="Zoom in"><ZoomIn size={13} /></CanvasBtn>
              <CanvasBtn onClick={rotate} title="Rotate 90°"><RotateCw size={13} /></CanvasBtn>
              <CanvasBtn onClick={fitToPage} title="Fit to page" disabled={!svgString}>
                <Maximize2 size={13} />
              </CanvasBtn>
            </>
          )}
        </div>
      </div>

      {/* Canvas wrapper */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto rounded-xl border border-[#e9e9e7] bg-[#f0f0ee]"
      >
        <div className="p-6 flex items-start justify-start min-h-full">
          {/* Machine bed */}
          <div
            className="relative flex-shrink-0 rounded shadow-sm"
            style={{ width: CANVAS_W, height: CANVAS_H, background: "#e8e8e6" }}
          >
            {/* Bed label */}
            <span className="absolute -top-5 left-0 text-[10px] text-[#9b9b98]">
              {MACHINE.bedX} × {MACHINE.bedY} mm (bed)
            </span>

            {/* A4 Paper */}
            <div
              className="absolute bg-white shadow-md border border-[#ddd]"
              style={{
                left: paperLeft,
                top: paperTop,
                width: PAPER_PX_W,
                height: PAPER_PX_H,
              }}
            >
              {/* Paper label */}
              <span className="absolute -top-4 left-0 text-[9px] text-[#9b9b98]">A4</span>

              {/* Raster lines */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ opacity: 0.18 }}
              >
                {Array.from({ length: Math.floor(PAPER_A4.w / gridStep) }, (_, i) => {
                  const x = (i + 1) * gridStep * PX_PER_MM;
                  const major = ((i + 1) * gridStep) % 10 === 0;
                  return (
                    <line
                      key={`vg${i}`}
                      x1={x} y1={0}
                      x2={x} y2={PAPER_PX_H}
                      stroke={major ? "#60605d" : "#b7b5b2"}
                      strokeWidth={major ? "0.7" : "0.4"}
                    />
                  );
                })}
                {Array.from({ length: Math.floor(PAPER_A4.h / gridStep) }, (_, i) => {
                  const y = (i + 1) * gridStep * PX_PER_MM;
                  const major = ((i + 1) * gridStep) % 10 === 0;
                  return (
                    <line
                      key={`hg${i}`}
                      x1={0} y1={y}
                      x2={PAPER_PX_W} y2={y}
                      stroke={major ? "#60605d" : "#b7b5b2"}
                      strokeWidth={major ? "0.7" : "0.4"}
                    />
                  );
                })}
              </svg>

              {/* SVG preview */}
              {svgString && (
                <div
                  onMouseDown={onMouseDown}
                  className={`absolute border border-blue-500 border-dashed bg-blue-500/5 ${readOnly ? "" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
                  style={{
                    left: transform.x * PX_PER_MM,
                    top: transform.y * PX_PER_MM,
                    width: svgW,
                    height: svgH,
                    transform: transform.rotation ? `rotate(${transform.rotation}deg)` : undefined,
                    transformOrigin: "top left",
                    overflow: "visible",
                  }}
                >
                  <div className="h-full w-full overflow-hidden">
                    <img
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`}
                      style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }}
                      alt="SVG preview"
                    />
                  </div>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          rotate();
                        }}
                        className="absolute left-1/2 -top-8 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-red-600 bg-red-500 p-0 text-white shadow hover:bg-red-600"
                        title="Rotate 90 degrees"
                      >
                        <RotateCw size={11} />
                      </button>
                      <div className="absolute left-1/2 -top-3 h-3 w-px -translate-x-1/2 bg-red-500" />
                      <ResizeHandle corner="tl" onMouseDown={onResizeMouseDown} />
                      <ResizeHandle corner="tr" onMouseDown={onResizeMouseDown} />
                      <ResizeHandle corner="bl" onMouseDown={onResizeMouseDown} />
                      <ResizeHandle corner="br" onMouseDown={onResizeMouseDown} />
                    </>
                  )}
                  <span className="absolute left-1 bottom-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] text-[#37352f] shadow-sm pointer-events-none">
                    {transform.scale.toFixed(0)} mm
                  </span>
                </div>
              )}

              {/* Origin marker */}
              <div className="absolute top-0 left-0 w-2 h-2">
                <div className="w-1.5 h-px bg-red-400 absolute top-0.5 left-0" />
                <div className="h-1.5 w-px bg-green-500 absolute top-0 left-0.5" />
              </div>
            </div>

            {/* Machine origin */}
            <div className="absolute bottom-1 left-1 text-[9px] text-[#9b9b98]">0,0</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResizeHandle({
  corner,
  onMouseDown,
}: {
  corner: ResizeCorner;
  onMouseDown: (corner: ResizeCorner, e: React.MouseEvent) => void;
}) {
  const position: Record<ResizeCorner, string> = {
    tl: "-left-2 -top-2 cursor-nwse-resize",
    tr: "-right-2 -top-2 cursor-nesw-resize",
    bl: "-bottom-2 -left-2 cursor-nesw-resize",
    br: "-bottom-2 -right-2 cursor-nwse-resize",
  };

  return (
    <div
      onMouseDown={(e) => onMouseDown(corner, e)}
      className={`absolute h-4 w-4 rounded-full border border-blue-600 bg-white shadow ${position[corner]}`}
      title="Scale"
    />
  );
}

function CanvasBtn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-md border border-[#e9e9e7] bg-white hover:bg-[#f7f7f5] disabled:opacity-30 transition-colors text-[#787774]"
    >
      {children}
    </button>
  );
}
