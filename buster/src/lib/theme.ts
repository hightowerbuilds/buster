// Theme engine — generates full IDE palettes from a single seed hue,
// and defines canvas-specific visual effects no CSS editor can do.

export interface ThemePalette {
  // Backgrounds
  editorBg: string;
  gutterBg: string;
  surface0: string;
  surface1: string;
  surface2: string;

  // Text
  text: string;
  textDim: string;
  textMuted: string;

  // Accents
  accent: string;
  accent2: string;
  cursor: string;
  cursorAlt: string;

  // UI chrome
  border: string;
  selection: string;
  searchHighlight: string;
  currentLine: string;

  // Diagnostics
  error: string;
  warning: string;
  info: string;

  // Syntax highlighting — every tree-sitter token type
  syntax: Record<string, string>;
  syntaxDefault: string;

  // Canvas effects (0–100 intensity)
  bgGlow: number;
  cursorGlow: number;
  vignette: number;
  grain: number;

  // Accent as RGB tuple for gradient compositing
  accentRgb: [number, number, number];

  // CSS variable overrides for DOM shell
  cssBase: string;
  cssMantle: string;
  cssCrust: string;
}

// --- HSL math (no browser CSS dependency) ---

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function hsla(h: number, s: number, l: number, a: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// --- Palette generator ---

function generateSyntax(h: number): Record<string, string> {
  const kw    = hslToHex(h, 70, 75);
  const func  = hslToHex((h + 210) % 360, 65, 75);
  const str   = hslToHex((h + 120) % 360, 60, 72);
  const typ   = hslToHex((h + 50) % 360, 65, 78);
  const con   = hslToHex((h + 30) % 360, 70, 75);
  const cmt   = hslToHex(h, 10, 52);
  const op    = hslToHex((h + 170) % 360, 50, 78);
  const spc   = hslToHex((h + 300) % 360, 65, 82);
  const punct = hslToHex(h, 10, 60);
  const txt   = hslToHex(h, 30, 88);
  const err   = hslToHex(0, 65, 72);
  const param = hslToHex((h + 340) % 360, 50, 72);

  return {
    attribute: typ,
    comment: cmt,
    constant: con,
    "constant.builtin": con,
    constructor: func,
    embedded: txt,
    function: func,
    "function.builtin": con,
    "function.macro": kw,
    keyword: kw,
    module: typ,
    number: con,
    operator: op,
    property: func,
    punctuation: punct,
    "punctuation.bracket": punct,
    "punctuation.delimiter": punct,
    "punctuation.special": spc,
    string: str,
    "string.escape": spc,
    "string.special": spc,
    tag: kw,
    type: typ,
    "type.builtin": typ,
    variable: txt,
    "variable.builtin": err,
    "variable.parameter": param,
  };
}

export interface ThemeEffects {
  bgGlow: number;
  cursorGlow: number;
  vignette: number;
  grain: number;
}

export function generatePalette(hue: number, fx: ThemeEffects): ThemePalette {
  const h = ((hue % 360) + 360) % 360;
  const text = hslToHex(h, 30, 88);
  const accentRgb = hslToRgb(h, 80, 76);

  return {
    editorBg:        hslToHex(h, 20, 12),
    gutterBg:        hslToHex(h, 20, 10),
    surface0:        hslToHex(h, 15, 20),
    surface1:        hslToHex(h, 12, 28),
    surface2:        hslToHex(h, 10, 36),

    text,
    textDim:         hslToHex(h, 20, 72),
    textMuted:       hslToHex(h, 10, 40),

    accent:          hslToHex(h, 80, 76),
    accent2:         hslToHex((h + 60) % 360, 70, 82),
    cursor:          hslToHex((h + 20) % 360, 60, 90),
    cursorAlt:       hslToHex((h + 300) % 360, 70, 82),

    border:          hslToHex(h, 15, 22),
    selection:       hsla(h, 40, 40, 0.45),
    searchHighlight: hsla((h + 50) % 360, 60, 70, 0.25),
    currentLine:     hsla(h, 15, 25, 0.5),

    error:   hslToHex(0, 70, 75),
    warning: hslToHex(30, 80, 75),
    info:    hslToHex(h, 70, 75),

    syntax: generateSyntax(h),
    syntaxDefault: text,

    ...fx,
    accentRgb,

    cssBase:   hslToHex(h, 20, 12),
    cssMantle: hslToHex(h, 20, 10),
    cssCrust:  hslToHex(h, 20, 7),
  };
}

// --- Catppuccin Mocha (the default) ---

export const CATPPUCCIN: ThemePalette = {
  editorBg: "#1e1e2e",
  gutterBg: "#181825",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",

  text:      "#cdd6f4",
  textDim:   "#a6adc8",
  textMuted: "#585b70",

  accent:    "#89b4fa",
  accent2:   "#f5c2e7",
  cursor:    "#f5e0dc",
  cursorAlt: "#f5c2e7",

  border:          "#313244",
  selection:       "rgba(68, 68, 119, 0.6)",
  searchHighlight: "rgba(249, 226, 175, 0.25)",
  currentLine:     "rgba(49, 50, 68, 0.5)",

  error:   "#f38ba8",
  warning: "#fab387",
  info:    "#89b4fa",

  syntax: {
    attribute: "#f9e2af",
    comment: "#8b8fa5",
    constant: "#fab387",
    "constant.builtin": "#fab387",
    constructor: "#89b4fa",
    embedded: "#cdd6f4",
    function: "#89b4fa",
    "function.builtin": "#fab387",
    "function.macro": "#cba6f7",
    keyword: "#cba6f7",
    module: "#f9e2af",
    number: "#fab387",
    operator: "#89dceb",
    property: "#89b4fa",
    punctuation: "#9399b2",
    "punctuation.bracket": "#9399b2",
    "punctuation.delimiter": "#9399b2",
    "punctuation.special": "#f5c2e7",
    string: "#a6e3a1",
    "string.escape": "#f5c2e7",
    "string.special": "#f5c2e7",
    tag: "#cba6f7",
    type: "#f9e2af",
    "type.builtin": "#f9e2af",
    variable: "#cdd6f4",
    "variable.builtin": "#f38ba8",
    "variable.parameter": "#eba0ac",
  },
  syntaxDefault: "#cdd6f4",

  bgGlow: 0,
  cursorGlow: 0,
  vignette: 0,
  grain: 0,
  accentRgb: [137, 180, 250],

  cssBase:   "#1e1e2e",
  cssMantle: "#181825",
  cssCrust:  "#11111b",
};

// --- Light theme ---

export const LIGHT_THEME: ThemePalette = {
  editorBg: "#e8e0d4",
  gutterBg: "#e0d8cb",
  surface0: "#d5ccbf",
  surface1: "#cac1b3",
  surface2: "#bfb6a8",

  text:      "#3b3228",
  textDim:   "#5c5245",
  textMuted: "#968c7e",

  accent:    "#946b2d",
  accent2:   "#a65d8c",
  cursor:    "#8b5e34",
  cursorAlt: "#a65d8c",

  border:          "#d5ccbf",
  selection:       "rgba(148, 107, 45, 0.16)",
  searchHighlight: "rgba(196, 122, 26, 0.2)",
  currentLine:     "rgba(213, 204, 191, 0.4)",

  error:   "#c4302b",
  warning: "#b87318",
  info:    "#4a7e96",

  syntax: {
    attribute: "#8a6200",
    comment: "#8a8275",
    constant: "#a05a20",
    "constant.builtin": "#a05a20",
    constructor: "#2e6b8a",
    embedded: "#3b3228",
    function: "#2e6b8a",
    "function.builtin": "#a05a20",
    "function.macro": "#7a4e8a",
    keyword: "#7a4e8a",
    module: "#8a6200",
    number: "#a05a20",
    operator: "#3d7a7e",
    property: "#2e6b8a",
    punctuation: "#7a7468",
    "punctuation.bracket": "#7a7468",
    "punctuation.delimiter": "#7a7468",
    "punctuation.special": "#964a80",
    string: "#537d2a",
    "string.escape": "#964a80",
    "string.special": "#964a80",
    tag: "#7a4e8a",
    type: "#8a6200",
    "type.builtin": "#8a6200",
    variable: "#3b3228",
    "variable.builtin": "#c4302b",
    "variable.parameter": "#a0503a",
  },
  syntaxDefault: "#3b3228",

  bgGlow: 0,
  cursorGlow: 0,
  vignette: 0,
  grain: 0,
  accentRgb: [148, 107, 45],

  cssBase:   "#e8e0d4",
  cssMantle: "#e0d8cb",
  cssCrust:  "#d8d0c4",
};

// --- Canvas effects (called from render loops) ---

let grainCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let grainW = 0;
let grainH = 0;

function ensureGrain(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  // Regenerate at quarter-res for performance, scale up for organic look
  const gw = Math.ceil(w / 4);
  const gh = Math.ceil(h / 4);
  if (grainCanvas && grainW === gw && grainH === gh) return grainCanvas;
  grainCanvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(gw, gh)
    : document.createElement("canvas");
  if (!(grainCanvas instanceof OffscreenCanvas)) {
    (grainCanvas as HTMLCanvasElement).width = gw;
    (grainCanvas as HTMLCanvasElement).height = gh;
  }
  const ctx = grainCanvas.getContext("2d") as CanvasRenderingContext2D;
  const img = ctx.createImageData(gw, gh);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainW = gw;
  grainH = gh;
  return grainCanvas;
}

export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, p: ThemePalette) {
  if (p.vignette <= 0) return;
  const alpha = (p.vignette / 100) * 0.5;
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

export function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, p: ThemePalette) {
  if (p.grain <= 0) return;
  const grain = ensureGrain(w, h);
  ctx.save();
  ctx.globalAlpha = (p.grain / 100) * 0.06;
  ctx.globalCompositeOperation = "overlay";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(grain as any, 0, 0, w, h);
  ctx.restore();
}

export function applyCursorGlow(ctx: CanvasRenderingContext2D, p: ThemePalette) {
  if (p.cursorGlow <= 0) return;
  ctx.shadowColor = p.cursor;
  ctx.shadowBlur = (p.cursorGlow / 100) * 25;
}

export function clearCursorGlow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

// --- Apply palette to CSS variables (for DOM shell) ---

export function applyPaletteToCss(p: ThemePalette) {
  const root = document.documentElement;
  root.style.setProperty("--bg-base", p.cssBase);
  root.style.setProperty("--bg-mantle", p.cssMantle);
  root.style.setProperty("--bg-crust", p.cssCrust);
  root.style.setProperty("--bg-surface0", p.surface0);
  root.style.setProperty("--bg-surface1", p.surface1);
  root.style.setProperty("--bg-surface2", p.surface2);
  root.style.setProperty("--text", p.text);
  root.style.setProperty("--text-dim", p.textDim);
  root.style.setProperty("--text-muted", p.textMuted);
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--accent2", p.accent2);
  root.style.setProperty("--border", p.border);
  root.style.setProperty("--red", p.error);
  root.style.setProperty("--green", p.syntax.string || "#a6e3a1");
  root.style.setProperty("--yellow", p.warning);
}

// --- VS Code theme import ---

/** Map VS Code token scopes to Buster's Tree-sitter token names */
const SCOPE_MAP: Record<string, string[]> = {
  "comment": ["comment"],
  "string": ["string"],
  "string.escape": ["string.escape"],
  "constant.numeric": ["number", "constant"],
  "constant": ["constant", "constant.builtin"],
  "keyword": ["keyword", "tag"],
  "keyword.control": ["keyword"],
  "keyword.operator": ["operator"],
  "storage.type": ["type", "type.builtin"],
  "entity.name.type": ["type", "type.builtin", "module"],
  "entity.name.function": ["function", "constructor"],
  "entity.name.tag": ["tag"],
  "entity.other.attribute-name": ["attribute"],
  "variable": ["variable"],
  "variable.parameter": ["variable.parameter"],
  "variable.language": ["variable.builtin"],
  "support.function": ["function.builtin"],
  "support.variable": ["constant.builtin"],
  "punctuation": ["punctuation", "punctuation.bracket", "punctuation.delimiter"],
  "meta.embedded": ["embedded"],
  "markup.heading": ["keyword"],
  "markup.bold": ["keyword"],
  "markup.italic": ["string"],
};

interface VSCodeTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

interface VSCodeThemeJSON {
  name?: string;
  colors?: Record<string, string>;
  tokenColors?: VSCodeTokenColor[];
}

export function importVSCodeTheme(json: VSCodeThemeJSON, fx: ThemeEffects): ThemePalette {
  const c = json.colors ?? {};
  const tokens = json.tokenColors ?? [];

  // Extract UI colors with fallbacks to Catppuccin
  const editorBg = c["editor.background"] ?? CATPPUCCIN.editorBg;
  const gutterBg = c["editorGutter.background"] ?? c["editor.background"] ?? CATPPUCCIN.gutterBg;
  const text = c["editor.foreground"] ?? CATPPUCCIN.text;
  const accent = c["focusBorder"] ?? c["button.background"] ?? CATPPUCCIN.accent;
  const border = c["editorGroup.border"] ?? c["panel.border"] ?? CATPPUCCIN.border;
  const selection = c["editor.selectionBackground"] ?? CATPPUCCIN.selection;
  const searchHL = c["editor.findMatchHighlightBackground"] ?? CATPPUCCIN.searchHighlight;
  const currentLine = c["editor.lineHighlightBackground"] ?? CATPPUCCIN.currentLine;
  const error = c["editorError.foreground"] ?? CATPPUCCIN.error;
  const warning = c["editorWarning.foreground"] ?? CATPPUCCIN.warning;
  const info = c["editorInfo.foreground"] ?? CATPPUCCIN.info;
  const sidebarBg = c["sideBar.background"] ?? editorBg;
  const activityBg = c["activityBar.background"] ?? sidebarBg;

  // Build syntax map from tokenColors
  const syntax: Record<string, string> = { ...CATPPUCCIN.syntax };
  for (const tc of tokens) {
    if (!tc.settings?.foreground) continue;
    const color = tc.settings.foreground;
    const scopes = Array.isArray(tc.scope) ? tc.scope : tc.scope ? [tc.scope] : [];
    for (const scope of scopes) {
      const targets = SCOPE_MAP[scope];
      if (targets) {
        for (const t of targets) syntax[t] = color;
      }
    }
  }

  // Derive secondary colors
  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "").slice(0, 6);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };

  const darken = (hex: string, amount: number): string => {
    const [r, g, b] = hexToRgb(hex);
    const f = 1 - amount;
    return `#${Math.round(r * f).toString(16).padStart(2, "0")}${Math.round(g * f).toString(16).padStart(2, "0")}${Math.round(b * f).toString(16).padStart(2, "0")}`;
  };

  const lighten = (hex: string, amount: number): string => {
    const [r, g, b] = hexToRgb(hex);
    return `#${Math.min(255, Math.round(r + (255 - r) * amount)).toString(16).padStart(2, "0")}${Math.min(255, Math.round(g + (255 - g) * amount)).toString(16).padStart(2, "0")}${Math.min(255, Math.round(b + (255 - b) * amount)).toString(16).padStart(2, "0")}`;
  };

  const textDim = c["editorLineNumber.foreground"] ?? lighten(editorBg, 0.4);
  const textMuted = c["editorLineNumber.foreground"] ?? lighten(editorBg, 0.25);
  const accentRgb = hexToRgb(accent);

  return {
    editorBg,
    gutterBg,
    surface0: c["input.background"] ?? lighten(editorBg, 0.08),
    surface1: lighten(editorBg, 0.14),
    surface2: lighten(editorBg, 0.2),
    text,
    textDim,
    textMuted,
    accent,
    accent2: c["badge.background"] ?? lighten(accent, 0.2),
    cursor: c["editorCursor.foreground"] ?? text,
    cursorAlt: c["editorCursor.foreground"] ?? accent,
    border,
    selection,
    searchHighlight: searchHL,
    currentLine,
    error,
    warning,
    info,
    syntax,
    syntaxDefault: text,
    ...fx,
    accentRgb: accentRgb as [number, number, number],
    cssBase: editorBg,
    cssMantle: sidebarBg,
    cssCrust: darken(editorBg, 0.15),
  };
}

// --- Derive terminal ANSI colors from the app palette ---

export function paletteToTerminalColors(p: ThemePalette): Record<string, string> {
  return {
    background:    p.editorBg,
    foreground:    p.text,
    cursor:        p.cursor,
    selection:     p.surface1,
    black:         p.cssCrust,
    red:           p.error,
    green:         p.syntax.string || "#a6e3a1",
    yellow:        p.warning,
    blue:          p.accent,
    magenta:       p.accent2,
    cyan:          p.info,
    white:         p.textDim,
    brightBlack:   p.textMuted,
    brightRed:     p.error,
    brightGreen:   p.syntax.string || "#a6e3a1",
    brightYellow:  p.warning,
    brightBlue:    p.accent,
    brightMagenta: p.accent2,
    brightCyan:    p.info,
    brightWhite:   p.text,
  };
}

export function clearCssOverrides() {
  const root = document.documentElement;
  const props = ["--bg-base", "--bg-mantle", "--bg-crust", "--bg-surface0", "--bg-surface1",
    "--bg-surface2", "--text", "--text-dim", "--text-muted", "--accent", "--accent2", "--border",
    "--red", "--green", "--yellow"];
  for (const p of props) root.style.removeProperty(p);
}
