import type { ThemePalette } from "../lib/theme";
import type { WritingAppearanceValues } from "../lib/writing-appearance";

type RGB = [number, number, number];
function rgb(color: string): RGB | null {
  const hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) return [0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16)) as RGB;
  const match = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function hex(value: RGB): string {
  return `#${value.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}
function blend(a: RGB, b: RGB, amount: number): RGB {
  return a.map((channel, index) => channel + (b[index] - channel) * amount) as RGB;
}
function luminance(value: RGB): number {
  const channels = value.map(channel => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function writingContrast(foreground: string, background: string): number {
  const a = rgb(foreground), b = rgb(background);
  if (!a || !b) return 1;
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Focus dimming never drops ordinary text below a 4.5:1 contrast floor. */
export function writingTextColor(color: string, background: string, dim = 0): string {
  const bg = rgb(background);
  if (!bg) return color;
  const source = rgb(color) ?? (luminance(bg) > 0.5 ? [25, 25, 25] : [235, 235, 235]);
  const desired = blend(source, bg, Math.max(0, Math.min(0.45, dim)));
  const extreme: RGB = luminance(bg) > 0.179 ? [0, 0, 0] : [255, 255, 255];
  if (writingContrast(hex(desired), background) >= 4.5) return hex(desired);
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (writingContrast(hex(blend(desired, extreme, mid)), background) < 4.5) low = mid;
    else high = mid;
  }
  return hex(blend(desired, extreme, high));
}

/** Reuse the app's palette/effects; explicit writing overrides affect Markdown only. */
export function writingPalette(base: ThemePalette, appearance: WritingAppearanceValues): ThemePalette {
  let palette = { ...base };
  if (appearance.background === "paper") {
    palette = { ...palette, editorBg: "#f5f0e6", gutterBg: "#ece5d8", surface0: "#e8dfd0", surface1: "#ddd0bd",
      text: "#302b25", textDim: "#62564a", textMuted: "#766653", syntaxDefault: "#302b25", cursor: "#29251f", cursorAlt: "#633e81",
      accent: "#295d8b", accentRgb: [41, 93, 139], border: "#c9bcaa", currentLine: "rgba(70,55,35,0.045)",
      selection: "rgba(44,103,171,0.24)", searchHighlight: "rgba(169,112,10,0.28)" };
  } else if (appearance.background === "midnight") {
    palette = { ...palette, editorBg: "#101722", gutterBg: "#0c121b", currentLine: "rgba(125,150,200,0.06)" };
  } else if (appearance.background === "sage") {
    palette = { ...palette, editorBg: "#19241f", gutterBg: "#131d18", currentLine: "rgba(140,185,150,0.06)" };
  }
  if (appearance.background !== "theme") {
    palette.text = writingTextColor(palette.text, palette.editorBg);
    palette.syntaxDefault = writingTextColor(palette.syntaxDefault, palette.editorBg);
    palette.cursor = writingTextColor(palette.cursor, palette.editorBg);
    palette.syntax = Object.fromEntries(Object.entries(base.syntax).map(([key, color]) => [key, writingTextColor(color, palette.editorBg)]));
  }
  for (const key of ["cursorGlow", "vignette", "grain"] as const)
    if (appearance[key] >= 0) palette[key] = appearance[key];
  // A heavy black vignette on light paper would reduce dark text contrast.
  if (appearance.background === "paper") palette.vignette = Math.min(palette.vignette, 30);
  return palette;
}

export function writingTypography(appearance: Pick<WritingAppearanceValues, "fontSize" | "lineHeight"> | null, inheritedSize: number) {
  const fontSize = appearance && appearance.fontSize > 0 ? appearance.fontSize : inheritedSize;
  return { fontSize, lineHeight: appearance && appearance.lineHeight > 0 ? Math.ceil(fontSize * appearance.lineHeight) : fontSize + 8 };
}

/** A single bounded pulse, restarted by typing; there is no idle animation loop. */
export function writingPulse(now: number, started: number | null, duration: number, intensity: number, enabled: boolean): number {
  if (!enabled || started === null || intensity <= 0) return 0;
  const elapsed = Math.max(0, now - started);
  return Math.max(0, 1 - elapsed / Math.max(100, Math.min(1000, duration))) * Math.max(0, Math.min(1, intensity));
}
