/**
 * Text measurement utilities for the canvas editor, powered by Pretext.
 *
 * Monospace character width is cached per-fontSize since the editor
 * relies on uniform charW for cursor positioning and gutter math.
 */

import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";

const FONT_FAMILY = "JetBrains Mono, Menlo, Monaco, Consolas, monospace";

// ─── Monospace character width (cached per font size) ────────────────

const charWidthCache = new Map<number, number>();

/**
 * Get the width of a single monospace character at the given font size.
 * Uses Pretext's prepare() for measurement instead of raw OffscreenCanvas.
 */
export function getCharWidth(fontSize: number = 14): number {
  let w = charWidthCache.get(fontSize);
  if (w !== undefined) return w;

  const font = `${fontSize}px ${FONT_FAMILY}`;
  const seg = prepareWithSegments("M", font);
  const lines = layoutWithLines(seg, Infinity, fontSize);
  w = lines.lines.length > 0 ? Math.floor(lines.lines[0].width) : Math.floor(fontSize * 0.6);
  charWidthCache.set(fontSize, w);
  return w;
}

// ─── Pretext text measurement ────────────────────────────────────────

/**
 * Measure the pixel width of an arbitrary string using Pretext.
 * Uses prepare + layoutWithLines for accurate measurement.
 */
export function measureTextWidth(text: string, font: string): number {
  if (text.length === 0) return 0;
  const seg = prepareWithSegments(text, font);
  const result = layoutWithLines(seg, Infinity, parseLineHeight(font));
  return result.lines.length > 0 ? result.lines[0].width : 0;
}

/** Extract a numeric line height from a CSS font string. */
function parseLineHeight(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? parseFloat(match[1]) : 14;
}

// ─── CJK / wide-character support ───────────────────────────────────

/**
 * Returns true if the given code unit is a wide (double-width) character.
 * Covers CJK Unified Ideographs, Hangul, Katakana, Hiragana, fullwidth forms,
 * and other East Asian Wide/Fullwidth ranges (Unicode East_Asian_Width=W/F).
 */
export function isWideChar(code: number): boolean {
  if (code < 0x1100) return false; // Fast path for ASCII + Latin
  if (code <= 0x115F) return true;  // Hangul Jamo
  if (code >= 0x2E80 && code <= 0x303E) return true;  // CJK Radicals, Kangxi, Symbols
  if (code >= 0x3040 && code <= 0x33BF) return true;  // Hiragana, Katakana, Bopomofo, CJK Strokes
  if (code >= 0x3400 && code <= 0x4DBF) return true;  // CJK Extension A
  if (code >= 0x4E00 && code <= 0x9FFF) return true;  // CJK Unified Ideographs
  if (code >= 0xA000 && code <= 0xA4CF) return true;  // Yi Syllables + Radicals
  if (code >= 0xAC00 && code <= 0xD7AF) return true;  // Hangul Syllables
  if (code >= 0xF900 && code <= 0xFAFF) return true;  // CJK Compatibility Ideographs
  if (code >= 0xFE10 && code <= 0xFE6F) return true;  // CJK Compatibility Forms + Small Forms
  if (code >= 0xFF01 && code <= 0xFF60) return true;  // Fullwidth Latin + Halfwidth CJK
  if (code >= 0xFFE0 && code <= 0xFFE6) return true;  // Fullwidth Signs
  return false;
}

/**
 * Returns the display width of a string in cell units.
 * Wide characters count as 2, everything else as 1.
 */
export function stringDisplayWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += isWideChar(text.charCodeAt(i)) ? 2 : 1;
  }
  return w;
}

/**
 * Convert a column index (character position within `text`) to a pixel x-offset.
 * Accounts for wide characters before the column.
 */
export function colToPixel(text: string, col: number, charW: number): number {
  let px = 0;
  const end = Math.min(col, text.length);
  for (let i = 0; i < end; i++) {
    px += isWideChar(text.charCodeAt(i)) ? charW * 2 : charW;
  }
  return px;
}

/**
 * Convert a pixel x-offset to a column index (character position within `text`).
 * Rounds to the nearest character boundary. Inverse of colToPixel.
 */
export function pixelToCol(text: string, pixelX: number, charW: number): number {
  let px = 0;
  for (let i = 0; i < text.length; i++) {
    const w = isWideChar(text.charCodeAt(i)) ? charW * 2 : charW;
    if (px + w / 2 > pixelX) return i;
    px += w;
  }
  return text.length;
}

export { FONT_FAMILY };
