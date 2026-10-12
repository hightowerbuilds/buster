/**
 * Courier writing style: every paragraph opens on a large first letter drawn in
 * ASCII characters.
 *
 * The real letter stays in the text. CSS (`p::first-letter` under
 * `[data-writing-style="courier"]`) makes it large, floats it, and makes it
 * transparent, so the caret, selection, and Markdown are untouched. A widget
 * decoration at the start of the paragraph holds a canvas that draws the
 * letter over that space: when a paragraph (or its first letter) is new, the
 * characters assemble out of noise; afterwards a few of them shimmer.
 *
 * Widgets are keyed by their letter, so ProseMirror keeps an unchanged
 * paragraph's canvas across edits. When a whole-document replace (undo, an
 * assistant edit) recreates paragraphs, `seen` remembers what was already
 * shown so those letters don't assemble again.
 */

import { Decoration } from "prosemirror-view";
import type { Node as ProseNode } from "prosemirror-model";
import { canvasMeasure } from "./text-motion/flow";

/** Light to dense. Index 0 is an empty cell. */
export const RAMP = " .:-=+*#%@";
const FONT_FAMILY = '"Courier New", Courier, "Nimbus Mono PS", monospace';
const ASSEMBLE_MS = 700;
const WAVE_MS = 450;
const IDLE_FPS = 8;
const SHIMMER = 0.035;
const SUPERSAMPLE = 4;

/** The text `::first-letter` selects: leading punctuation and the first letter or digit. */
export function capLetter(text: string): string | null {
  return text.match(/^\s*(\p{P}*[\p{L}\p{N}])/u)?.[1] ?? null;
}

/** Ink coverage of `letter` in each cell of a `columns` × `rows` grid, as ramp indices (0 = empty). */
export function rasterize(letter: string, columns: number, rows: number, measureCanvas = (w: number, h: number) => new OffscreenCanvas(w, h)): Uint8Array {
  const levels = new Uint8Array(columns * rows);
  const width = columns * SUPERSAMPLE, height = rows * SUPERSAMPLE;
  const canvas = measureCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return levels;
  // Size the glyph so its ink fills the grid, keeping its proportions.
  ctx.font = `700 100px ${FONT_FAMILY}`;
  const probe = ctx.measureText(letter);
  const inkWidth = Math.max(1, probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight);
  const inkHeight = Math.max(1, probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent);
  const scale = Math.min(width / inkWidth, height / inkHeight) * 0.96;
  ctx.font = `700 ${100 * scale}px ${FONT_FAMILY}`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const x = (width - inkWidth * scale) / 2 + probe.actualBoundingBoxLeft * scale;
  const y = (height - inkHeight * scale) / 2 + probe.actualBoundingBoxAscent * scale;
  ctx.fillText(letter, x, y);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let ink = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++) for (let dx = 0; dx < SUPERSAMPLE; dx++) {
        ink += pixels[(((row * SUPERSAMPLE + dy) * width) + column * SUPERSAMPLE + dx) * 4 + 3];
      }
      const coverage = ink / (255 * SUPERSAMPLE * SUPERSAMPLE);
      levels[row * columns + column] = coverage < 0.08 ? 0 : Math.min(RAMP.length - 1, Math.ceil(coverage * (RAMP.length - 1)));
    }
  }
  return levels;
}

/** A cheap, stable pseudo-random number in [0, 1) for a cell and a time step. */
const noise = (cell: number, step: number) => {
  const n = Math.sin(cell * 12.9898 + step * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

interface Cap {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  letter: string;
  /** When assembly started; -Infinity for a letter shown settled. */
  born: number;
  connected: boolean;
  layout: { width: number; height: number; ratio: number; columns: number; rows: number; cell: number; levels: Uint8Array; delays: Float32Array } | null;
}

const caps = new Set<Cap>();
let frame = 0;
let lastIdle = 0;
let reducedMotion = () => false;

/** Let the editor say when motion is off (app setting or the system preference). */
export function setAsciiCapMotion(reduced: () => boolean) { reducedMotion = reduced; }

/**
 * The floated `::first-letter` box of `paragraph`, in viewport coordinates.
 * WebKit reports no rect for the floated letter itself, and its float is wider
 * than the glyph's advance (by about a character of the body text), so the
 * box is measured from what WebKit does report: it starts at the top-left of
 * the paragraph's content box, ends where the first character after the
 * letter begins (less the letter's right margin), and is as tall as the
 * letter's line height. With nothing after the letter, the advance is used.
 */
export function dropCapBox(paragraph: HTMLElement, letter: string): DOMRect | null {
  const cap = getComputedStyle(paragraph, "::first-letter");
  if (cap.float === "none") return null;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const outer = paragraph.getBoundingClientRect();
  const block = getComputedStyle(paragraph);
  const height = px(cap.lineHeight) || px(cap.fontSize) * 1.2;
  const left = outer.left + paragraph.clientLeft + px(block.paddingLeft) + px(cap.marginLeft);
  const top = outer.top + paragraph.clientTop + px(block.paddingTop) + px(cap.marginTop);
  let width = canvasMeasure(letter, `${cap.fontStyle} ${cap.fontWeight} ${cap.fontSize} ${cap.fontFamily}`);
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: node => (node as Element).classList?.contains("ascii-cap") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let text: Text | null = null;
  for (let node = walker.nextNode(); node && !text; node = walker.nextNode()) if (node.nodeType === Node.TEXT_NODE) text = node as Text;
  const after = text ? text.data.search(/\S/) + letter.length : -1;
  if (text && after > 0 && after < text.data.length) {
    const range = document.createRange();
    range.setStart(text, after); range.setEnd(text, after + 1);
    const next = Array.from(range.getClientRects()).find(rect => rect.width > 0 || rect.height > 0);
    // Only the first line of text sits beside the letter's top.
    if (next && next.top < top + height && next.left > left) width = Math.max(width, next.left - px(cap.marginRight) - left);
  }
  return width > 0 && height > 0 ? new DOMRect(left, top, width, height) : null;
}

function capBox(cap: Cap): DOMRect | null {
  return cap.host.parentElement ? dropCapBox(cap.host.parentElement, cap.letter) : null;
}

function place(cap: Cap, box: DOMRect) {
  const paragraph = cap.host.parentElement!;
  const outer = paragraph.getBoundingClientRect();
  const width = Math.round(box.width), height = Math.round(box.height);
  Object.assign(cap.host.style, {
    left: `${box.left - outer.left - paragraph.clientLeft}px`, top: `${box.top - outer.top - paragraph.clientTop}px`,
    width: `${width}px`, height: `${height}px`,
  });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (cap.layout && cap.layout.width === width && cap.layout.height === height && cap.layout.ratio === ratio) return;
  // About a dozen rows of characters fill the letter; Courier cells are 0.6em wide.
  const cell = Math.max(4, height / 12);
  const columns = Math.max(3, Math.floor(width / (cell * 0.6))), rows = Math.max(3, Math.floor(height / cell));
  const levels = rasterize(cap.letter, columns, rows);
  // Assembly sweeps down the letter with a little jitter per cell.
  const delays = new Float32Array(columns * rows);
  for (let i = 0; i < delays.length; i++) delays[i] = (Math.floor(i / columns) / rows) * WAVE_MS + noise(i, 7) * (ASSEMBLE_MS - WAVE_MS);
  cap.canvas.width = Math.round(width * ratio);
  cap.canvas.height = Math.round(height * ratio);
  cap.layout = { width, height, ratio, columns, rows, cell, levels, delays };
}

function draw(cap: Cap, now: number) {
  const layout = cap.layout;
  const ctx = cap.canvas.getContext("2d");
  if (!layout || !ctx) return;
  const { columns, rows, cell, levels, delays, ratio } = layout;
  const cellWidth = layout.width / columns, cellHeight = layout.height / rows;
  const still = reducedMotion();
  const age = still ? Infinity : now - cap.born;
  const state = age < ASSEMBLE_MS ? "assembling" : "settled";
  if (cap.host.dataset.state !== state) cap.host.dataset.state = state;
  const step = Math.floor(now / 60), shimmerStep = Math.floor(now / (1000 / IDLE_FPS));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.font = `700 ${cell}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = getComputedStyle(cap.host).color;
  for (let i = 0; i < levels.length; i++) {
    let level = levels[i];
    let alpha = 1;
    if (age < delays[i]) {
      // Not yet arrived: faint characters flicker where the letter will be.
      if (noise(i, step) > (level ? 0.35 : 0.9)) { level = 1 + Math.floor(noise(i, step + 1) * (RAMP.length - 1)); alpha = 0.3; }
      else continue;
    } else if (!level) continue;
    else if (!still && noise(i, shimmerStep) < SHIMMER) level = Math.max(1, Math.min(RAMP.length - 1, level + (noise(i, shimmerStep + 3) < 0.5 ? -1 : 1)));
    ctx.globalAlpha = alpha;
    ctx.fillText(RAMP[level], (i % columns) * cellWidth, Math.floor(i / columns) * cellHeight);
  }
  ctx.globalAlpha = 1;
}

function tick(now: number) {
  frame = 0;
  let assembling = false;
  const idle = now - lastIdle >= 1000 / IDLE_FPS;
  for (const cap of caps) {
    if (!cap.host.isConnected) {
      if (cap.connected) caps.delete(cap);
      continue;
    }
    cap.connected = true;
    const fresh = now - cap.born < ASSEMBLE_MS && !reducedMotion();
    if (fresh) assembling = true;
    if (!fresh && !idle && cap.layout) continue;
    const box = capBox(cap);
    if (!box) { cap.host.style.visibility = "hidden"; continue; }
    cap.host.style.visibility = "";
    place(cap, box);
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    draw(cap, now);
  }
  if (idle) lastIdle = now;
  // Settled letters under reduced motion are drawn once and only redrawn when the page changes.
  if (caps.size && (assembling || !reducedMotion())) frame = requestAnimationFrame(tick);
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(tick);
}

/** Redraw every cap now, e.g. after the theme or font size changed. */
export function refreshAsciiCaps() {
  for (const cap of caps) cap.layout = null;
  lastIdle = 0;
  schedule();
}

function createCap(letter: string, assemble: boolean): HTMLElement {
  const host = document.createElement("span");
  host.className = "ascii-cap";
  host.contentEditable = "false";
  host.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  caps.add({ host, canvas, letter, born: assemble ? performance.now() : -Infinity, connected: false, layout: null });
  schedule();
  return host;
}

const built = new WeakMap<Set<string>, { doc: ProseNode; decorations: Decoration[] }>();

/**
 * One widget per paragraph that starts with a letter or digit. `seen` holds
 * every paragraph text already shown in this editor; a paragraph not seen
 * before assembles when its widget is drawn. Decisions are made once per
 * document (ProseMirror may ask more than once), and every current paragraph
 * counts as seen afterwards, so recreated widgets (undo, an assistant edit)
 * appear settled.
 */
export function asciiCapDecorations(doc: ProseNode, seen: Set<string>): Decoration[] {
  const cached = built.get(seen);
  if (cached?.doc === doc) return cached.decorations;
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "paragraph") return;
    const letter = capLetter(node.textContent);
    if (!letter) return;
    const fingerprint = node.textContent.slice(0, 80);
    const assemble = !seen.has(fingerprint);
    seen.add(fingerprint);
    decorations.push(Decoration.widget(offset + 1, () => createCap(letter, assemble),
      { key: `ascii-cap:${letter}`, side: -1, ignoreSelection: true }));
  });
  while (seen.size > 4000) seen.delete(seen.values().next().value!);
  built.set(seen, { doc, decorations });
  return decorations;
}
