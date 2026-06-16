// LaTeX-math → plottable SVG via MathJax (loaded on demand from the jsDelivr
// CDN, the same source the preset fonts use; the app's CSP is null so remote
// scripts/fetches are allowed).
//
// MathJax is configured with `svg: { fontCache: "none" }`, which makes every
// glyph come out as an inline <path> (instead of <use> referencing <defs>), so
// the existing parseSvgPaths pipeline — which samples <path>/<rect>/<line>
// geometry via the browser SVG APIs — can trace the formula directly, exactly
// like it traces TTF letter outlines. Fraction bars / radicals are <rect>s and
// are handled too.

let mjPromise: Promise<MathJaxApi> | null = null;

interface MathJaxApi {
  tex2svg: (tex: string, opts?: { display?: boolean }) => HTMLElement;
  startup?: { promise?: Promise<unknown> };
}

/** Inject the MathJax tex-svg bundle once and resolve when it's ready. */
function loadMathJax(): Promise<MathJaxApi> {
  if (mjPromise) return mjPromise;
  mjPromise = new Promise<MathJaxApi>((resolve, reject) => {
    // MathJax reads window.MathJax for its config *before* the script runs.
    (window as unknown as { MathJax: unknown }).MathJax = {
      tex: { packages: { "[+]": ["ams", "boldsymbol", "color"] } },
      svg: { fontCache: "none" },
      options: { enableMenu: false },
      startup: { typeset: false },
    };
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
    script.async = true;
    script.onload = () => {
      const mj = (window as unknown as { MathJax: MathJaxApi }).MathJax;
      if (mj?.startup?.promise) mj.startup.promise.then(() => resolve(mj));
      else resolve(mj);
    };
    script.onerror = () => {
      mjPromise = null; // allow a retry on the next attempt
      reject(new Error("MathJax konnte nicht geladen werden (Internetverbindung nötig)."));
    };
    document.head.appendChild(script);
  });
  return mjPromise;
}

/**
 * Render a LaTeX math string to a standalone, 0,0-origin SVG plus its
 * dimensions (in MathJax user units — only the aspect ratio matters; the slicer
 * scales the result to the chosen width in mm).
 */
export async function mathToSvg(latex: string): Promise<{ svg: string; w: number; h: number }> {
  const src = latex.trim();
  if (!src) throw new Error("Keine Formel eingegeben.");

  const mj = await loadMathJax();
  const container = mj.tex2svg(src, { display: true });
  const svgEl = container.querySelector("svg");
  if (!svgEl) throw new Error("Formel konnte nicht gerendert werden.");

  // MathJax renders syntactically invalid input as a red <merror> node instead
  // of throwing — detect it so the user gets a clear message.
  if (svgEl.querySelector('[data-mml-node="merror"]')) {
    throw new Error("Ungültige LaTeX-Formel.");
  }

  const vb = (svgEl.getAttribute("viewBox") || "0 0 100 100")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [minX, minY, w, h] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 100, 100];

  // Each MathJax glyph is one <path> holding several sub-paths (outer contour +
  // counters). parseSvgPaths samples a path as a single continuous polyline, so
  // it would draw a connector line across the gap between sub-paths instead of
  // lifting the pen. Split every multi-sub-path <path> into one <path> per
  // sub-path (MathJax emits absolute "M…" commands) so each contour is a
  // separate stroke — same trick fontText.ts uses for TTF glyphs.
  for (const path of Array.from(svgEl.querySelectorAll("path"))) {
    const d = path.getAttribute("d") || "";
    const subs = d.match(/M[^M]*/g);
    if (!subs || subs.length <= 1) continue;
    const parent = path.parentNode;
    if (!parent) continue;
    for (const sub of subs) {
      const clone = path.cloneNode(false) as SVGPathElement;
      clone.setAttribute("d", sub.trim());
      parent.insertBefore(clone, path);
    }
    parent.removeChild(path);
  }

  // MathJax renders at ~1000 units/em; bring it down to ~100/em (matching the
  // TTF text pipeline's fontSize) so getTotalLength-based sampling produces a
  // sane number of points. Also shift by (-minX,-minY): MathJax's viewBox has a
  // negative y origin (top group is scale(1,-1)), and the slicer pipeline
  // assumes content lives in 0,0 → w,h.
  const f = 0.1;
  const ser = new XMLSerializer();
  const inner = Array.from(svgEl.childNodes)
    .map((n) => ser.serializeToString(n))
    .join("");

  const sw = w * f, sh = h * f;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">` +
    `<g transform="scale(${f}) translate(${-minX},${-minY})" fill="#000000" stroke="none">${inner}</g>` +
    `</svg>`;

  return { svg, w: sw, h: sh };
}
