import { PlotConfig, PenChangeConfig, PenSlot, RasterConfig, SvgTransform } from "./types";

interface Point { x: number; y: number; }

export interface ColoredPath {
  points: Point[];
  color: string; // normalized hex "#rrggbb"
}

// Lazy canvas for color normalization
let _normCanvas: HTMLCanvasElement | null = null;
let _normCtx: CanvasRenderingContext2D | null = null;

function normCtx(): CanvasRenderingContext2D | null {
  if (!_normCtx) {
    _normCanvas = document.createElement("canvas");
    _normCanvas.width = _normCanvas.height = 1;
    _normCtx = _normCanvas.getContext("2d");
  }
  return _normCtx;
}

const _colorCache = new Map<string, string | null>();

function normalizeColor(cssColor: string): string | null {
  if (!cssColor || cssColor === "none" || cssColor === "transparent") return null;
  if (_colorCache.has(cssColor)) return _colorCache.get(cssColor)!;

  const ctx = normCtx();
  if (!ctx) return null;
  ctx.fillStyle = "#010101"; // sentinel so invalid colors don't silently become black
  ctx.fillStyle = cssColor;
  const s = ctx.fillStyle;

  let result: string | null = null;
  if (s.startsWith("#")) {
    result = s;
  } else {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0.05)) {
      result = "#" + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, "0")).join("");
    }
  }

  _colorCache.set(cssColor, result);
  return result;
}

function getElementColor(el: SVGGeometryElement): string {
  const cs = getComputedStyle(el);

  const computedStroke = cs.stroke;
  if (computedStroke && computedStroke !== "none") {
    const c = normalizeColor(computedStroke);
    if (c) return c;
  }

  const attrStroke = el.getAttribute("stroke");
  if (attrStroke && attrStroke !== "none") {
    const c = normalizeColor(attrStroke);
    if (c) return c;
  }

  const computedFill = cs.fill;
  if (computedFill && computedFill !== "none") {
    const c = normalizeColor(computedFill);
    if (c) return c;
  }

  const attrFill = el.getAttribute("fill");
  if (attrFill && attrFill !== "none") {
    const c = normalizeColor(attrFill);
    if (c) return c;
  }

  return "#000000";
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorDist(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export function quantizeToSlots(paths: ColoredPath[], slots: PenSlot[]): Map<number, ColoredPath[]> {
  const active = slots.filter((s) => s.enabled);
  const fallback = slots[0];
  const result = new Map<number, ColoredPath[]>();

  for (const path of paths) {
    const pool = active.length > 0 ? active : [fallback];
    let best = pool[0];
    let bestDist = Infinity;
    for (const slot of pool) {
      const d = colorDist(path.color, slot.color);
      if (d < bestDist) { bestDist = d; best = slot; }
    }
    const idx = best.index;
    if (!result.has(idx)) result.set(idx, []);
    result.get(idx)!.push(path);
  }

  return new Map([...result.entries()].sort((a, b) => a[0] - b[0]));
}

const fmt = (n: number) => n.toFixed(3);

export function parseSvgPaths(svgString: string): ColoredPath[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  const svgEl = doc.documentElement;
  const vb = svgEl.getAttribute("viewBox");
  const svgW = parseFloat(svgEl.getAttribute("width") || "0") || (vb ? parseFloat(vb.split(/\s+/)[2]) : 100);
  const svgH = parseFloat(svgEl.getAttribute("height") || "0") || (vb ? parseFloat(vb.split(/\s+/)[3]) : 100);

  // Clone parsed SVG nodes safely into a hidden host (avoids innerHTML)
  const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.setAttribute("width", String(svgW));
  host.setAttribute("height", String(svgH));
  host.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden";

  for (const child of Array.from(svgEl.children)) {
    host.appendChild(document.importNode(child, true));
  }
  document.body.appendChild(host);

  const allPaths: ColoredPath[] = [];
  const elements = host.querySelectorAll<SVGGeometryElement>(
    "path, line, rect, circle, ellipse, polyline, polygon"
  );

  for (const el of elements) {
    if (!(el instanceof SVGGeometryElement)) continue;
    const totalLen = el.getTotalLength();
    if (totalLen < 0.1) continue;

    const steps = Math.max(2, Math.ceil(totalLen / 0.3));
    const pts: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const pt = el.getPointAtLength((i / steps) * totalLen);
      pts.push({ x: pt.x, y: pt.y });
    }

    // Remove duplicate closing point for closed paths
    const last = pts[pts.length - 1];
    const first = pts[0];
    if (Math.abs(last.x - first.x) < 0.01 && Math.abs(last.y - first.y) < 0.01) {
      pts.pop();
    }

    allPaths.push({ points: pts, color: getElementColor(el) });
  }

  document.body.removeChild(host);
  return allPaths;
}

export function getSvgDimensions(svgString: string): { w: number; h: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const vb = doc.documentElement.getAttribute("viewBox");
  const w = parseFloat(doc.documentElement.getAttribute("width") || "0") ||
    (vb ? parseFloat(vb.split(/\s+/)[2]) : 100);
  const h = parseFloat(doc.documentElement.getAttribute("height") || "0") ||
    (vb ? parseFloat(vb.split(/\s+/)[3]) : 100);
  return { w, h };
}

function applyTransform(
  p: Point,
  svgDims: { w: number; h: number },
  t: SvgTransform
): Point {
  let { x, y } = p;

  if (t.rotation === 90) {
    // Rotate 90° CW around SVG center
    [x, y] = [y, svgDims.w - x];
    const srcW = svgDims.h;
    return {
      x: t.x + (x / srcW) * t.scale,
      y: t.y + (y / srcW) * t.scale,
    };
  }

  return {
    x: t.x + (x / svgDims.w) * t.scale,
    y: t.y + (y / svgDims.w) * t.scale,
  };
}

export function generateGcode(
  paths: ColoredPath[],
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  config: PlotConfig
): string {
  const lines: string[] = [];

  lines.push("; Pen Plotter GCode – generated by PenPlotter App");
  lines.push("G90 G21");
  lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);

  for (const { points } of paths) {
    if (points.length < 2) continue;

    const first = applyTransform(points[0], svgDims, transform);
    lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} F${config.travelFeed}`);
    lines.push(`G1 Z${fmt(config.penDownZ)} F${config.zFeed}`);

    if (config.dwell > 0) {
      lines.push(`G4 P${(config.dwell / 1000).toFixed(2)}`);
    }

    for (const pt of points.slice(1)) {
      const p = applyTransform(pt, svgDims, transform);
      lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${config.drawFeed}`);
    }

    lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);
  }

  lines.push(`G0 X0 Y0 F${config.travelFeed}`);
  return lines.join("\n");
}

export function generateMultiPenGcode(
  paths: ColoredPath[],
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  config: PlotConfig,
  slots: PenSlot[],
  penChange: PenChangeConfig
): string {
  const grouped = quantizeToSlots(paths, slots);
  const lines: string[] = [];

  lines.push("; Multi-pen GCode – PenPlotter App");
  lines.push("G90 G21");
  lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);

  let currentSlot = -1;

  for (const [slotIdx, slotPaths] of grouped) {
    if (slotPaths.length === 0) continue;
    const slot = slots.find((s) => s.index === slotIdx);

    if (currentSlot !== slotIdx) {
      // Drop current pen at its rack position
      if (currentSlot >= 0) {
        const cs = slots.find((s) => s.index === currentSlot);
        const dropX = penChange.rackX + currentSlot * penChange.slotSpacingX;
        const dropY = penChange.rackY + currentSlot * penChange.slotSpacingY;
        lines.push(`; Stift ablegen: ${cs?.name ?? currentSlot}`);
        lines.push(`G0 X${fmt(dropX)} Y${fmt(dropY)} F${config.travelFeed}`);
        for (const l of penChange.dropGcode.split("\n")) lines.push(l);
      }

      // Pick up new pen
      const pickX = penChange.rackX + slotIdx * penChange.slotSpacingX;
      const pickY = penChange.rackY + slotIdx * penChange.slotSpacingY;
      lines.push(`; Stift aufnehmen: ${slot?.name ?? slotIdx} (${slot?.color ?? ""})`);
      lines.push(`G0 X${fmt(pickX)} Y${fmt(pickY)} F${config.travelFeed}`);
      for (const l of penChange.pickGcode.split("\n")) lines.push(l);

      currentSlot = slotIdx;
    }

    for (const { points } of slotPaths) {
      if (points.length < 2) continue;
      const first = applyTransform(points[0], svgDims, transform);
      lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} F${config.travelFeed}`);
      lines.push(`G1 Z${fmt(config.penDownZ)} F${config.zFeed}`);
      if (config.dwell > 0) lines.push(`G4 P${(config.dwell / 1000).toFixed(2)}`);
      for (const pt of points.slice(1)) {
        const p = applyTransform(pt, svgDims, transform);
        lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${config.drawFeed}`);
      }
      lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);
    }
  }

  // Drop last pen before going home
  if (currentSlot >= 0) {
    const cs = slots.find((s) => s.index === currentSlot);
    const dropX = penChange.rackX + currentSlot * penChange.slotSpacingX;
    const dropY = penChange.rackY + currentSlot * penChange.slotSpacingY;
    lines.push(`; Stift ablegen: ${cs?.name ?? currentSlot}`);
    lines.push(`G0 X${fmt(dropX)} Y${fmt(dropY)} F${config.travelFeed}`);
    for (const l of penChange.dropGcode.split("\n")) lines.push(l);
  }

  lines.push(`G0 X0 Y0 F${config.travelFeed}`);
  return lines.join("\n");
}

export async function generateRasterGcode(
  svgString: string,
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  config: PlotConfig,
  raster: RasterConfig
): Promise<string> {
  const srcW = transform.rotation === 90 ? svgDims.h : svgDims.w;
  const srcH = transform.rotation === 90 ? svgDims.w : svgDims.h;
  const outW = transform.scale;
  const outH = (transform.scale / srcW) * srcH;
  const step = Math.max(0.2, raster.lineStep);
  const canvasW = Math.max(1, Math.ceil(outW / step));
  const canvasH = Math.max(1, Math.ceil(outH / step));
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create raster canvas");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const img = await loadSvgImage(svgString);
  if (transform.rotation === 90) {
    ctx.translate(canvasW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvasH, canvasW);
  } else {
    ctx.drawImage(img, 0, 0, canvasW, canvasH);
  }

  const pixels = ctx.getImageData(0, 0, canvasW, canvasH).data;
  const lines: string[] = [];
  lines.push("; Pen Plotter raster GCode generated by PenPlotter App");
  lines.push("G90 G21");
  lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);

  let segments = 0;
  for (let y = 0; y < canvasH; y++) {
    const runs: Array<[number, number]> = [];
    let runStart = -1;

    for (let x = 0; x < canvasW; x++) {
      const idx = (y * canvasW + x) * 4;
      const alpha = pixels[idx + 3] / 255;
      const lum = pixels[idx] * 0.2126 + pixels[idx + 1] * 0.7152 + pixels[idx + 2] * 0.0722;
      const dark = alpha > 0.05 && lum < raster.threshold;

      if (dark && runStart === -1) {
        runStart = x;
      } else if (!dark && runStart !== -1) {
        if ((x - runStart) * step >= raster.minRun) runs.push([runStart, x - 1]);
        runStart = -1;
      }
    }

    if (runStart !== -1 && (canvasW - runStart) * step >= raster.minRun) {
      runs.push([runStart, canvasW - 1]);
    }

    const orderedRuns = y % 2 === 0 ? runs : runs.reverse();
    for (const [start, end] of orderedRuns) {
      const x1 = transform.x + start * step;
      const x2 = transform.x + Math.min(outW, (end + 1) * step);
      const yy = transform.y + y * step;
      lines.push(`G0 X${fmt(x1)} Y${fmt(yy)} F${config.travelFeed}`);
      lines.push(`G1 Z${fmt(config.penDownZ)} F${config.zFeed}`);
      if (config.dwell > 0) lines.push(`G4 P${(config.dwell / 1000).toFixed(2)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(yy)} F${config.drawFeed}`);
      lines.push(`G0 Z${fmt(config.penUpZ)} F${config.zFeed}`);
      segments += 1;
    }
  }

  lines.push(`; raster segments: ${segments}`);
  lines.push(`G0 X0 Y0 F${config.travelFeed}`);
  return lines.join("\n");
}

function loadSvgImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not render SVG for raster slicing"));
    };
    img.src = url;
  });
}

export function estimateTime(gcode: string, config: PlotConfig): number {
  let totalTime = 0;
  let lastX = 0, lastY = 0;
  let currentFeed = config.travelFeed;

  for (const line of gcode.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith(";")) continue;

    const xM = t.match(/X([-\d.]+)/);
    const yM = t.match(/Y([-\d.]+)/);
    const fM = t.match(/F([\d.]+)/);

    if (fM) currentFeed = parseFloat(fM[1]);
    const x = xM ? parseFloat(xM[1]) : lastX;
    const y = yM ? parseFloat(yM[1]) : lastY;
    const dist = Math.sqrt((x - lastX) ** 2 + (y - lastY) ** 2);
    totalTime += (dist / currentFeed) * 60;
    lastX = x; lastY = y;
  }
  return totalTime;
}
