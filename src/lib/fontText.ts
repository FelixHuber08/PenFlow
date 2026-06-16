// OpenBuilds-CAM-style text rendering using opentype.js.
//
// Unlike the hand-crafted stroke font (strokeFont.ts), this module loads a
// real TTF/OTF file and converts each glyph's bezier outline into a set of
// individual SVG <path> elements — one per closed sub-path (outer contour +
// counter-forms like the inner oval of 'O').
//
// Each sub-path becomes a separate ColoredPath in the existing pipeline, so
// the G-code generator correctly lifts the pen between contours instead of
// drawing connecting lines through the letter interior.

import * as opentype from "opentype.js";

export interface LoadedFont {
  name: string;
  font: opentype.Font;
}

const fontCache = new Map<string, opentype.Font>();

/** Load a TTF/OTF from an ArrayBuffer (e.g., from a Tauri file dialog). */
export function parseFontBuffer(buffer: ArrayBuffer, name: string): LoadedFont {
  const font = opentype.parse(buffer);
  fontCache.set(name, font);
  return { name, font };
}

/**
 * Split the flat opentype PathCommand[] into individual closed sub-paths
 * (separated by 'M'→'Z' cycles). This ensures each letter-contour (including
 * inner holes) becomes its own SVG <path> element so parseSvgPaths treats them
 * as separate strokes with pen-up moves between them.
 */
function splitSubpaths(commands: opentype.PathCommand[]): string[] {
  const result: string[] = [];
  let current = "";

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        // Start of a new sub-path; save previous if non-empty
        if (current) result.push(current.trimEnd());
        current = `M ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)} `;
        break;
      case "L":
        current += `L ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)} `;
        break;
      case "Q":
        current += `Q ${cmd.x1!.toFixed(2)} ${cmd.y1!.toFixed(2)} ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)} `;
        break;
      case "C":
        current += `C ${cmd.x1!.toFixed(2)} ${cmd.y1!.toFixed(2)} ${cmd.x2!.toFixed(2)} ${cmd.y2!.toFixed(2)} ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)} `;
        break;
      case "Z":
        current += "Z";
        result.push(current.trimEnd());
        current = "";
        break;
    }
  }
  if (current.trim()) result.push(current.trimEnd());

  // Filter out degenerate paths (just a move command)
  return result.filter((d) => d.length > 6 && !/^M[\d\s.]+$/.test(d));
}

/**
 * Render text using a loaded opentype.js Font into an SVG string.
 *
 * Font size is 100 units; the caller scales via the existing transform.scale.
 * The SVG contains one <path> per glyph contour so that parseSvgPaths can
 * treat each as a separate stroke.
 */
export function fontTextToSvg(
  loaded: LoadedFont,
  text: string,
  fontSize = 100,
): { svg: string; w: number; h: number } {
  const { font } = loaded;

  // Map each character to its glyph individually instead of font.stringToGlyphs():
  // opentype.js v2 always applies the font's GSUB substitution table in
  // stringToGlyphs(), and several preset fonts (e.g. Inter) use a GSUB lookup
  // format it can't parse, throwing "substitutionType … is not yet supported".
  // charToGlyph() skips substitution entirely (we don't need ligatures for a
  // pen plotter) while still giving us advance widths and kerning.
  const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));
  const scale = fontSize / font.unitsPerEm;
  const ascender = font.ascender * scale;
  const descender = font.descender * scale; // negative value

  // Build all sub-path 'd' strings, translating y so descenders stay positive
  // (SVG is y-down; opentype renders at baseline y=0 so ascenders are negative
  // in screen coords when baseline sits at y=0 → offset baseline down by ascender)
  const baselineY = ascender; // screen Y of the baseline
  const allPaths: string[] = [];
  let curX = 0;

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const glyphPath = g.getPath(curX, baselineY, fontSize);
    const subpaths = splitSubpaths(glyphPath.commands);
    allPaths.push(...subpaths);

    curX += g.advanceWidth! * scale;
    if (i < glyphs.length - 1) {
      // Kerning lookups can also hit unsupported GPOS formats on some fonts;
      // fall back to no kerning rather than aborting the whole render.
      try {
        curX += font.getKerningValue(g, glyphs[i + 1]) * scale;
      } catch {
        /* no kerning for this pair */
      }
    }
  }

  if (allPaths.length === 0) {
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>`, w: 10, h: 10 };
  }

  const pad = 2;
  const svgW = Math.ceil(curX + pad * 2);
  const svgH = Math.ceil(ascender - descender + pad * 2);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`,
    `  <g transform="translate(${pad},${pad})">`,
    ...allPaths.map((d) => `    <path d="${d}" fill="black" stroke="none"/>`),
    `  </g>`,
    `</svg>`,
  ].join("\n");

  return { svg, w: svgW, h: svgH };
}
