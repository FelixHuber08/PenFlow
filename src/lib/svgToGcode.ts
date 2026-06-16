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
const fmtF = (n: number) => Math.round(n).toString();

/** Nearest-neighbour path reordering — minimises total pen-travel distance. */
function reorderPaths<T extends { points: Point[] }>(
  paths: T[],
  svgDims: { w: number; h: number },
  transform: SvgTransform
): T[] {
  if (paths.length <= 1) return paths;
  const todo = [...paths];
  const done: T[] = [todo.splice(0, 1)[0]];
  const last = done[0];
  let tail = applyTransform(last.points[last.points.length - 1], svgDims, transform);
  while (todo.length > 0) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < todo.length; i++) {
      const fp = applyTransform(todo[i].points[0], svgDims, transform);
      const d = (fp.x - tail.x) ** 2 + (fp.y - tail.y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const [next] = todo.splice(bi, 1);
    done.push(next);
    tail = applyTransform(next.points[next.points.length - 1], svgDims, transform);
  }
  return done;
}

export function parseSvgPaths(svgString: string): ColoredPath[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  const svgEl = doc.documentElement;
  const vb = svgEl.getAttribute("viewBox");

  // Use viewBox dimensions as the coordinate space — path coordinates from
  // getPointAtLength are in viewBox units regardless of the SVG's width/height
  // attributes (which may be in mm, pt, %, etc.).
  let svgW: number, svgH: number;
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/);
    svgW = parts.length >= 4 ? (parseFloat(parts[2]) || 100) : 100;
    svgH = parts.length >= 4 ? (parseFloat(parts[3]) || 100) : 100;
  } else {
    svgW = parseFloat(svgEl.getAttribute("width") || "0") || 100;
    svgH = parseFloat(svgEl.getAttribute("height") || "0") || 100;
  }

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

  const svgPoint = host.createSVGPoint();

  for (const el of elements) {
    if (!(el instanceof SVGGeometryElement)) continue;
    const totalLen = el.getTotalLength();
    if (totalLen < 0.1) continue;

    // getPointAtLength returns points in the element's *local* coordinate
    // space and ignores any transform on the element or its ancestor <g>s.
    // Bake the cumulative transform (CTM, relative to the host <svg>) into each
    // sample so transformed Illustrator/Inkscape SVGs land in the right place.
    const ctm = el.getCTM();

    // Pick the sample count from the *rendered* length (local length × the CTM's
    // linear scale), not the raw local length. Without this, content authored in
    // a large coordinate space (e.g. MathJax at ~1000 units/em) would be sampled
    // tens of thousands of times per glyph, bloating the G-code. sx = 1 for
    // untransformed elements, so ordinary SVGs are unaffected.
    const sx = ctm ? Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1 : 1;
    const renderedLen = totalLen * sx;
    const steps = Math.max(2, Math.ceil(renderedLen / 0.3));
    const pts: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const pt = el.getPointAtLength((i / steps) * totalLen);
      if (ctm) {
        svgPoint.x = pt.x;
        svgPoint.y = pt.y;
        const tp = svgPoint.matrixTransform(ctm);
        pts.push({ x: tp.x, y: tp.y });
      } else {
        pts.push({ x: pt.x, y: pt.y });
      }
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
  // Prioritise viewBox — it's always in unitless user coordinates, matching
  // getPointAtLength output. Width/height attributes may be "210mm", "100%", etc.
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const w = parseFloat(parts[2]);
      const h = parseFloat(parts[3]);
      if (w > 0 && h > 0) return { w, h };
    }
  }
  const w = parseFloat(doc.documentElement.getAttribute("width") || "0") || 100;
  const h = parseFloat(doc.documentElement.getAttribute("height") || "0") || 100;
  return { w: w || 100, h: h || 100 };
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
  const { penUpZ, penDownZ, travelFeed, drawFeed, zFeed, dwell } = config;
  const lines: string[] = [];

  lines.push("; Pen Plotter GCode – generated by PenPlotter App");
  lines.push("G90 G21 G17 G94"); // absolute, mm, XY-plane, feed mm/min
  lines.push("M5");               // ensure spindle/servo off
  lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);

  const ordered = reorderPaths(paths, svgDims, transform);
  let penIsDown = false;
  let cx = 0, cy = 0; // current machine position

  for (const { points } of ordered) {
    if (points.length < 2) continue;

    const first = applyTransform(points[0], svgDims, transform);
    const distSq = (first.x - cx) ** 2 + (first.y - cy) ** 2;

    if (penIsDown && distSq < 0.01) {
      // Chain: paths share an endpoint — continue drawing without lifting
      if (distSq > 0.000001) {
        lines.push(`G1 X${fmt(first.x)} Y${fmt(first.y)} F${fmtF(drawFeed)}`);
      }
    } else {
      if (penIsDown) {
        lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
        penIsDown = false;
      }
      lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} F${fmtF(travelFeed)}`);
      lines.push(`G1 Z${fmt(penDownZ)} F${fmtF(zFeed)}`);
      if (dwell > 0) lines.push(`G4 P${(dwell / 1000).toFixed(2)}`);
      penIsDown = true;
    }

    cx = first.x; cy = first.y;
    for (const pt of points.slice(1)) {
      const p = applyTransform(pt, svgDims, transform);
      lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${fmtF(drawFeed)}`);
      cx = p.x; cy = p.y;
    }
  }

  if (penIsDown) lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
  lines.push(`G0 X0 Y0 F${fmtF(travelFeed)}`);
  lines.push("M5");
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
  const { penUpZ, penDownZ, travelFeed, drawFeed, zFeed, dwell } = config;
  const grouped = quantizeToSlots(paths, slots);
  const lines: string[] = [];

  lines.push("; Multi-pen GCode – PenPlotter App");
  lines.push("G90 G21 G17 G94"); // absolute, mm, XY-plane, feed mm/min
  lines.push("M5");               // ensure spindle/servo off
  lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);

  let currentSlot = -1;
  let penIsDown = false;
  let cx = 0, cy = 0;

  for (const [slotIdx, slotPaths] of grouped) {
    if (slotPaths.length === 0) continue;
    const slot = slots.find((s) => s.index === slotIdx);

    if (currentSlot !== slotIdx) {
      if (penIsDown) {
        lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
        penIsDown = false;
      }
      if (currentSlot >= 0) {
        const cs = slots.find((s) => s.index === currentSlot);
        const dropX = penChange.rackX + currentSlot * penChange.slotSpacingX;
        const dropY = penChange.rackY + currentSlot * penChange.slotSpacingY;
        lines.push(`; Stift ablegen: ${cs?.name ?? currentSlot}`);
        lines.push(`G0 X${fmt(dropX)} Y${fmt(dropY)} F${fmtF(travelFeed)}`);
        for (const l of penChange.dropGcode.split("\n")) lines.push(l);
      }
      const pickX = penChange.rackX + slotIdx * penChange.slotSpacingX;
      const pickY = penChange.rackY + slotIdx * penChange.slotSpacingY;
      lines.push(`; Stift aufnehmen: ${slot?.name ?? slotIdx} (${slot?.color ?? ""})`);
      lines.push(`G0 X${fmt(pickX)} Y${fmt(pickY)} F${fmtF(travelFeed)}`);
      for (const l of penChange.pickGcode.split("\n")) lines.push(l);
      currentSlot = slotIdx;
      penIsDown = false; // pen state unknown after pick sequence
      cx = pickX; cy = pickY;
    }

    const ordered = reorderPaths(slotPaths, svgDims, transform);
    for (const { points } of ordered) {
      if (points.length < 2) continue;
      const first = applyTransform(points[0], svgDims, transform);
      const distSq = (first.x - cx) ** 2 + (first.y - cy) ** 2;

      if (penIsDown && distSq < 0.01) {
        if (distSq > 0.000001) {
          lines.push(`G1 X${fmt(first.x)} Y${fmt(first.y)} F${fmtF(drawFeed)}`);
        }
      } else {
        if (penIsDown) {
          lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
          penIsDown = false;
        }
        lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} F${fmtF(travelFeed)}`);
        lines.push(`G1 Z${fmt(penDownZ)} F${fmtF(zFeed)}`);
        if (dwell > 0) lines.push(`G4 P${(dwell / 1000).toFixed(2)}`);
        penIsDown = true;
      }

      cx = first.x; cy = first.y;
      for (const pt of points.slice(1)) {
        const p = applyTransform(pt, svgDims, transform);
        lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${fmtF(drawFeed)}`);
        cx = p.x; cy = p.y;
      }
    }
  }

  if (penIsDown) {
    lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
    penIsDown = false;
  }
  if (currentSlot >= 0) {
    const cs = slots.find((s) => s.index === currentSlot);
    const dropX = penChange.rackX + currentSlot * penChange.slotSpacingX;
    const dropY = penChange.rackY + currentSlot * penChange.slotSpacingY;
    lines.push(`; Stift ablegen: ${cs?.name ?? currentSlot}`);
    lines.push(`G0 X${fmt(dropX)} Y${fmt(dropY)} F${fmtF(travelFeed)}`);
    for (const l of penChange.dropGcode.split("\n")) lines.push(l);
  }

  lines.push(`G0 X0 Y0 F${fmtF(travelFeed)}`);
  lines.push("M5");
  return lines.join("\n");
}

export interface RasterDebug {
  canvasW: number;
  canvasH: number;
  step: number;
  /** Mono bitmap (1 byte / px, 0 = bright, 255 = dark) after thresholding. */
  mask: Uint8Array;
  /** Detected per-row runs (inclusive pixel ranges). */
  runs: Array<{ y: number; start: number; end: number }>;
  /** Origin of the bitmap in machine mm (top-left). */
  originX: number;
  originY: number;
  /** Visible width/height in mm (bitmap covers this region). */
  widthMm: number;
  heightMm: number;
  /** Number of dropped (sub-minRun) candidate runs — useful for tuning. */
  dropped: number;
}

async function rasterizeAndDetect(
  svgString: string,
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  raster: RasterConfig
): Promise<RasterDebug> {
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
  const mask = new Uint8Array(canvasW * canvasH);
  const runs: Array<{ y: number; start: number; end: number }> = [];
  const gapBridge = Math.max(0, Math.floor(raster.gapBridge ?? 0));
  let dropped = 0;

  for (let y = 0; y < canvasH; y++) {
    let runStart = -1;
    let lastDark = -1;
    let brightStreak = 0;

    for (let x = 0; x < canvasW; x++) {
      const i4 = (y * canvasW + x) * 4;
      const alpha = pixels[i4 + 3] / 255;
      const lum = pixels[i4] * 0.2126 + pixels[i4 + 1] * 0.7152 + pixels[i4 + 2] * 0.0722;
      const dark = alpha > 0.05 && lum < raster.threshold;
      if (dark) mask[y * canvasW + x] = 255;

      if (dark) {
        if (runStart === -1) runStart = x;
        lastDark = x;
        brightStreak = 0;
      } else if (runStart !== -1) {
        brightStreak++;
        if (brightStreak > gapBridge) {
          const spanMm = (lastDark - runStart + 1) * step;
          if (spanMm >= raster.minRun) runs.push({ y, start: runStart, end: lastDark });
          else dropped++;
          runStart = -1;
          lastDark = -1;
          brightStreak = 0;
        }
      }
    }

    if (runStart !== -1) {
      const spanMm = (lastDark - runStart + 1) * step;
      if (spanMm >= raster.minRun) runs.push({ y, start: runStart, end: lastDark });
      else dropped++;
    }
  }

  return {
    canvasW,
    canvasH,
    step,
    mask,
    runs,
    originX: transform.x,
    originY: transform.y,
    widthMm: outW,
    heightMm: outH,
    dropped,
  };
}

export async function generateRasterDebug(
  svgString: string,
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  raster: RasterConfig
): Promise<RasterDebug> {
  return rasterizeAndDetect(svgString, svgDims, transform, raster);
}

// ── Pattern fill engine ──────────────────────────────────────────────────────
//
// The previous raster slicer only produced horizontal scanlines and the canvas
// resolution was tied to the line spacing. The engine below decouples the two:
// the SVG is rasterized once into a *fine* mask, then the chosen pattern samples
// that mask at arbitrary angles. Every pattern returns the actual toolpath it
// drew, so the on-screen preview is built from the exact same segments that go
// into the G-code (no separate re-parse that could drift out of sync).

interface FillMask {
  /** 1 byte / px, 255 = dark (inside the shape), 0 = bright. */
  data: Uint8Array;
  w: number;
  h: number;
  /** mm per mask pixel. */
  sampleStep: number;
  /** Top-left of the mask in machine mm. */
  originX: number;
  originY: number;
  widthMm: number;
  heightMm: number;
}

async function rasterizeMask(
  svgString: string,
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  raster: RasterConfig
): Promise<FillMask> {
  const srcW = transform.rotation === 90 ? svgDims.h : svgDims.w;
  const srcH = transform.rotation === 90 ? svgDims.w : svgDims.h;
  const outW = transform.scale;
  const outH = (transform.scale / srcW) * srcH;

  // Sample the shape finer than the line spacing so hatching at any angle has a
  // crisp edge to clip against. Bounded so the bitmap never gets huge.
  const sampleStep = Math.min(0.35, Math.max(0.12, Math.max(0.2, raster.lineStep) / 4));
  const w = Math.max(1, Math.ceil(outW / sampleStep));
  const h = Math.max(1, Math.ceil(outH / sampleStep));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create raster canvas");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);

  const img = await loadSvgImage(svgString);
  if (transform.rotation === 90) {
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, h, w);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }

  const pixels = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const i4 = i * 4;
    const alpha = pixels[i4 + 3] / 255;
    const lum = pixels[i4] * 0.2126 + pixels[i4 + 1] * 0.7152 + pixels[i4 + 2] * 0.0722;
    if (alpha > 0.05 && lum < raster.threshold) data[i] = 255;
  }

  return {
    data, w, h, sampleStep,
    originX: transform.x,
    originY: transform.y,
    widthMm: outW,
    heightMm: outH,
  };
}

function maskDark(mask: FillMask, mx: number, my: number): boolean {
  const px = Math.floor((mx - mask.originX) / mask.sampleStep);
  const py = Math.floor((my - mask.originY) / mask.sampleStep);
  if (px < 0 || py < 0 || px >= mask.w || py >= mask.h) return false;
  return mask.data[py * mask.w + px] !== 0;
}

/**
 * Hatch the mask with parallel lines at `angleDeg`, spaced by `raster.lineStep`.
 * Returns one polyline (2 points) per continuous dark run. Lines are emitted in
 * serpentine order so the pen travels the shortest path between them.
 */
function hatch(mask: FillMask, angleDeg: number, raster: RasterConfig): Point[][] {
  const a = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };       // along the line
  const nrm = { x: -Math.sin(a), y: Math.cos(a) };      // across the lines
  const W = mask.widthMm, H = mask.heightMm;

  let tMin = Infinity, tMax = -Infinity, nMin = Infinity, nMax = -Infinity;
  for (const c of [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }]) {
    const t = c.x * dir.x + c.y * dir.y;
    const n = c.x * nrm.x + c.y * nrm.y;
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    nMin = Math.min(nMin, n); nMax = Math.max(nMax, n);
  }

  const spacing = Math.max(0.2, raster.lineStep);
  const sample = mask.sampleStep;
  const gapBridge = Math.max(0, raster.gapBridge ?? 0); // mm
  const strokes: Point[][] = [];
  let flip = false;

  for (let n = nMin + spacing / 2; n <= nMax; n += spacing) {
    const local = (t: number): Point => ({
      x: mask.originX + dir.x * t + nrm.x * n,
      y: mask.originY + dir.y * t + nrm.y * n,
    });
    const rowRuns: Point[][] = [];
    let runStart = NaN, lastDark = NaN, bright = 0;
    const flush = () => {
      if (!Number.isNaN(runStart) && lastDark - runStart >= raster.minRun) {
        rowRuns.push([local(runStart), local(lastDark)]);
      }
      runStart = NaN; lastDark = NaN; bright = 0;
    };

    for (let t = tMin; t <= tMax; t += sample) {
      const p = local(t);
      if (maskDark(mask, p.x, p.y)) {
        if (Number.isNaN(runStart)) runStart = t;
        lastDark = t;
        bright = 0;
      } else if (!Number.isNaN(runStart)) {
        bright += sample;
        if (bright > gapBridge) flush();
      }
    }
    flush();

    if (flip) { rowRuns.reverse(); for (const r of rowRuns) r.reverse(); }
    flip = !flip;
    strokes.push(...rowRuns);
  }
  return strokes;
}

/** Fill the mask with a grid of dots spaced by `raster.lineStep`. */
function dotFill(mask: FillMask, raster: RasterConfig): Point[][] {
  const spacing = Math.max(0.4, raster.lineStep);
  const dot = Math.min(0.2, spacing / 4); // half-length of the tiny dot stroke
  const strokes: Point[][] = [];
  let row = 0;
  for (let y = mask.originY + spacing / 2; y <= mask.originY + mask.heightMm; y += spacing) {
    const xs: number[] = [];
    for (let x = mask.originX + spacing / 2; x <= mask.originX + mask.widthMm; x += spacing) xs.push(x);
    if (row % 2 === 1) xs.reverse();
    for (const x of xs) {
      if (maskDark(mask, x, y)) strokes.push([{ x: x - dot, y }, { x: x + dot, y }]);
    }
    row++;
  }
  return strokes;
}

function patternStrokes(mask: FillMask, raster: RasterConfig): Point[][] {
  switch (raster.pattern) {
    case "vertical":   return hatch(mask, 90, raster);
    case "diagonal":   return hatch(mask, 45, raster);
    case "crosshatch": return [...hatch(mask, 0, raster), ...hatch(mask, 90, raster)];
    case "dots":       return dotFill(mask, raster);
    case "horizontal":
    default:           return hatch(mask, 0, raster);
  }
}

export interface RasterResult {
  gcode: string;
  strokes: GcodeStroke[];
}

export async function generateRasterGcode(
  svgString: string,
  svgDims: { w: number; h: number },
  transform: SvgTransform,
  config: PlotConfig,
  raster: RasterConfig
): Promise<RasterResult> {
  const mask = await rasterizeMask(svgString, svgDims, transform, raster);
  const segs = patternStrokes(mask, raster);

  const { penUpZ, penDownZ, travelFeed, drawFeed, zFeed, dwell } = config;
  const lines: string[] = [];
  lines.push("; Pen Plotter raster GCode generated by PenPlotter App");
  lines.push(`; pattern=${raster.pattern} step=${raster.lineStep}mm mask ${mask.w}x${mask.h}px @ ${mask.sampleStep.toFixed(3)}mm/px`);
  lines.push("G90 G21 G17 G94"); // absolute, mm, XY-plane, feed mm/min
  lines.push("M5");               // ensure spindle/servo off
  lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);

  let penIsDown = false;
  let cx = 0, cy = 0;

  for (const pts of segs) {
    if (pts.length < 2) continue;
    const distSq = (pts[0].x - cx) ** 2 + (pts[0].y - cy) ** 2;

    if (penIsDown && distSq < 0.01) {
      if (distSq > 0.000001) {
        lines.push(`G1 X${fmt(pts[0].x)} Y${fmt(pts[0].y)} F${fmtF(drawFeed)}`);
      }
    } else {
      if (penIsDown) {
        lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
        penIsDown = false;
      }
      lines.push(`G0 X${fmt(pts[0].x)} Y${fmt(pts[0].y)} F${fmtF(travelFeed)}`);
      lines.push(`G1 Z${fmt(penDownZ)} F${fmtF(zFeed)}`);
      if (dwell > 0) lines.push(`G4 P${(dwell / 1000).toFixed(2)}`);
      penIsDown = true;
    }

    cx = pts[0].x; cy = pts[0].y;
    for (const p of pts.slice(1)) {
      lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${fmtF(drawFeed)}`);
      cx = p.x; cy = p.y;
    }
  }

  if (penIsDown) lines.push(`G0 Z${fmt(penUpZ)} F${fmtF(zFeed)}`);
  lines.push(`; raster segments: ${segs.length}`);
  lines.push(`G0 X0 Y0 F${fmtF(travelFeed)}`);
  lines.push("M5");

  const strokes: GcodeStroke[] = segs.map((points) => ({ points, color: "#000000" }));
  return { gcode: lines.join("\n"), strokes };
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

export interface GcodeAnalysis {
  minX: number; maxX: number;
  minY: number; maxY: number;
  /** True if any X/Y/Z/F token contained NaN/Infinity or an unparseable value. */
  hasInvalid: boolean;
  moves: number;
}

/**
 * Scans generated G-code for its XY bounding box and for invalid numbers.
 * Used as a pre-flight safety check before streaming to the machine:
 *  - NaN/Infinity (e.g. from an empty input field) would make GRBL error mid-job.
 *  - Coordinates outside the bed crash the gantry or trip soft-limit alarms.
 */
// A number GRBL's read_float() actually accepts: optional sign, then digits
// and/or a single decimal point — NO exponent (e.g. "1e-5"), no double dots.
// Anything else triggers GRBL error:2 ("Numeric value format is not valid").
const GRBL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function analyzeGcode(gcode: string): GcodeAnalysis {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let x = 0, y = 0, moves = 0;
  let hasInvalid = false;

  for (const raw of gcode.split("\n")) {
    // Drop line (;) and inline ((…)) comments before validating.
    const t = raw.replace(/;.*/, "").replace(/\([^)]*\)/g, "").trim();
    if (!t) continue;
    if (t.startsWith("$")) continue; // GRBL system command ($H, $X, $$…), not a G-word

    const isMove = t.startsWith("G0") || t.startsWith("G1");

    // Split into words (letter + value), tolerating missing spaces ("G1X0Y0").
    // 'e'/'E' are kept inside the value so scientific notation gets rejected
    // instead of being silently split off as a separate (ignored) word.
    let lineX: number | null = null, lineY: number | null = null;
    const word = /([A-Za-z])([0-9.eE+-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = word.exec(t)) !== null) {
      const letter = m[1].toUpperCase();
      const val = m[2];
      if (!GRBL_NUMBER.test(val)) { hasInvalid = true; continue; }
      const num = parseFloat(val);
      if (!Number.isFinite(num)) { hasInvalid = true; continue; }
      if (letter === "X") lineX = num;
      else if (letter === "Y") lineY = num;
    }
    if (lineX !== null) x = lineX;
    if (lineY !== null) y = lineY;

    if (isMove) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      moves++;
    }
  }

  if (moves === 0) {
    minX = maxX = minY = maxY = 0;
  }
  return { minX, maxX, minY, maxY, hasInvalid, moves };
}

export interface GcodeStroke {
  points: { x: number; y: number }[];
  color: string;
}

export function parseGcodeStrokes(gcode: string): GcodeStroke[] {
  const strokes: GcodeStroke[] = [];
  let cx = 0, cy = 0;
  let penDown = false;
  let currentPoints: { x: number; y: number }[] = [];
  let currentColor = "#000000";

  const flushStroke = () => {
    if (currentPoints.length >= 2) {
      strokes.push({ points: currentPoints, color: currentColor });
    }
    currentPoints = [];
  };

  for (const rawLine of gcode.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith(";")) {
      const m = line.match(/\((#[0-9a-fA-F]{6})\)/);
      if (m) currentColor = m[1];
      continue;
    }

    const xm = line.match(/X([-\d.]+)/);
    const ym = line.match(/Y([-\d.]+)/);
    const zm = line.match(/Z([-\d.]+)/);
    const isG0 = line.startsWith("G0");
    const isG1 = line.startsWith("G1");
    if (!isG0 && !isG1) continue;

    if (zm && !xm && !ym) {
      if (isG0) {
        flushStroke();
        penDown = false;
      } else if (isG1) {
        penDown = true;
        currentPoints = [{ x: cx, y: cy }];
      }
      continue;
    }

    if (xm || ym) {
      const nx = xm ? parseFloat(xm[1]) : cx;
      const ny = ym ? parseFloat(ym[1]) : cy;
      if (isG1 && penDown) {
        currentPoints.push({ x: nx, y: ny });
      } else {
        flushStroke();
      }
      cx = nx;
      cy = ny;
    }
  }

  flushStroke();
  return strokes;
}
