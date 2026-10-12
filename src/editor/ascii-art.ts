/**
 * Courier writing style: text drawn in ASCII characters.
 *
 * Two kinds of art, one renderer:
 * - **Drop caps.** Every paragraph opens on a large first letter: the art
 *   floats at the start of the paragraph, sized to the letter, and the real
 *   letter stays in the text, transparent and practically zero-width (an inline
 *   decoration). No `::first-letter` styling: in WebKit any `::first-letter`
 *   rule breaks typing at the end of a paragraph's first line (each key
 *   replaces the one before it).
 * - **Headings.** Heading 1 and Heading 2 text is transparent and drawn over in
 *   ASCII, character by character where WebKit laid it out.
 *
 * The real text always stays in place, so the caret, selection, and Markdown
 * are untouched. A widget decoration holds a canvas over the text. New art
 * assembles out of noise; afterwards a few characters shimmer. When a
 * heading's text changes, only the cells that gained ink assemble, so typed
 * letters arrive one by one.
 *
 * ProseMirror recreates a block's widget when the block's text changes, so a
 * new widget in the same block takes over the drawing of the one it replaces:
 * a drop cap with the same letter doesn't move, and a heading only animates
 * the cells that gained ink. When a whole-document replace (undo, an assistant
 * edit) recreates the blocks themselves, `seen` remembers what was already
 * shown so it doesn't assemble again.
 */

import { Decoration } from "prosemirror-view";
import type { Node as ProseNode } from "prosemirror-model";
import { canvasMeasure } from "./text-motion/flow";

/** Light to dense. Index 0 is an empty cell. */
export const RAMP = " .:-=+*#%@";
const FONT_FAMILY = '"Courier New", Courier, "Nimbus Mono PS", monospace';
const ASSEMBLE_MS = 700;
const WAVE_MS = 450;
/** How long a newly typed heading character takes to arrive. */
const TYPE_MS = 260;
const IDLE_FPS = 8;
const SHIMMER = 0.035;
const SUPERSAMPLE = 4;
/** Character rows per drop cap, and per line of a heading's font size. */
const CAP_ROWS = 12;
const HEADING_ROWS_PER_EM = 11;

/** The text `::first-letter` selects: leading punctuation and the first letter or digit. */
export function capLetter(text: string): string | null {
  return text.match(/^\s*(\p{P}*[\p{L}\p{N}])/u)?.[1] ?? null;
}

/** Ink coverage of a mask, one ramp index per cell (0 = empty). */
function levelsOf(pixels: Uint8ClampedArray, width: number, columns: number, rows: number): Uint8Array {
  const levels = new Uint8Array(columns * rows);
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

function mask(columns: number, rows: number) {
  const width = columns * SUPERSAMPLE, height = rows * SUPERSAMPLE;
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (ctx) ctx.fillStyle = "#fff";
  return { ctx, width, height };
}

/** `letter` fitted to the whole grid, keeping its proportions. */
export function rasterizeLetter(letter: string, columns: number, rows: number): Uint8Array {
  const { ctx, width, height } = mask(columns, rows);
  if (!ctx) return new Uint8Array(columns * rows);
  ctx.font = `700 100px ${FONT_FAMILY}`;
  const probe = ctx.measureText(letter);
  const inkWidth = Math.max(1, probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight);
  const inkHeight = Math.max(1, probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent);
  const scale = Math.min(width / inkWidth, height / inkHeight) * 0.96;
  ctx.font = `700 ${100 * scale}px ${FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(letter, (width - inkWidth * scale) / 2 + probe.actualBoundingBoxLeft * scale, (height - inkHeight * scale) / 2 + probe.actualBoundingBoxAscent * scale);
  return levelsOf(ctx.getImageData(0, 0, width, height).data, width, columns, rows);
}

/** One character of a heading, where WebKit drew it relative to the art's box, in that text's font. */
interface Glyph { text: string; x: number; y: number; font: string }

/** The heading's characters drawn where they are on the page, scaled onto the grid. */
function rasterizeGlyphs(glyphs: Glyph[], box: { width: number; height: number }, columns: number, rows: number): Uint8Array {
  const { ctx, width, height } = mask(columns, rows);
  if (!ctx) return new Uint8Array(columns * rows);
  ctx.setTransform(width / box.width, 0, 0, height / box.height, 0, 0);
  ctx.textBaseline = "alphabetic";
  for (const glyph of glyphs) {
    ctx.font = glyph.font;
    ctx.fillText(glyph.text, glyph.x, glyph.y + ctx.measureText(glyph.text).fontBoundingBoxAscent);
  }
  return levelsOf(ctx.getImageData(0, 0, width, height).data, width, columns, rows);
}

/** A cheap, stable pseudo-random number in [0, 1) for a cell and a time step. */
const noise = (cell: number, step: number) => {
  const n = Math.sin(cell * 12.9898 + step * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

type ArtKind = "cap" | "heading";
interface Layout {
  width: number; height: number; ratio: number;
  columns: number; rows: number; cell: number;
  /** What the art was drawn from; a change redraws it. */
  source: string;
  levels: Uint8Array;
  /** When each cell's character arrives (performance.now() time); 0 = already there. */
  arrive: Float64Array;
}
interface Art {
  kind: ArtKind;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** A drop cap's letter. */
  letter: string;
  /** Assemble on first draw (a block not seen before). */
  assemble: boolean;
  connected: boolean;
  layout: Layout | null;
  /** The block's text and size when last measured: a cheap check for changes. */
  quick: string;
  /** The block the art was attached to, so a replacement widget can take over. */
  block: Element | null;
}

const arts = new Set<Art>();
let frame = 0;
let lastIdle = 0;
let reducedMotion = () => false;

/** Let the editor say when motion is off (app setting or the system preference). */
export function setAsciiArtMotion(reduced: () => boolean) { reducedMotion = reduced; }

const px = (value: string) => Number.parseFloat(value) || 0;

/** Text nodes of a block, leaving out the art's own widget. */
function textNodes(block: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: node => (node as Element).classList?.contains("ascii-art") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeType === Node.TEXT_NODE) nodes.push(node as Text);
  return nodes;
}

/** A drop cap is this many times the body text size, one line tall at that size. */
const CAP_SCALE = 4.8;

/**
 * The size of `paragraph`'s drop cap: `letter` in bold at CAP_SCALE times the
 * paragraph's font, one line tall. The art floats at the start of the
 * paragraph at this size, and the lines beside it wrap around it.
 */
export function capSize(paragraph: HTMLElement, letter: string): DOMRect {
  const style = getComputedStyle(paragraph);
  const size = px(style.fontSize) * CAP_SCALE;
  return new DOMRect(0, 0, Math.ceil(canvasMeasure(letter, `700 ${size}px ${style.fontFamily}`)), Math.ceil(size));
}

/** A heading's content box, and each of its characters where WebKit drew it. */
function headingGlyphs(heading: HTMLElement): { box: DOMRect; glyphs: Glyph[]; source: string } | null {
  const outer = heading.getBoundingClientRect();
  const style = getComputedStyle(heading);
  const left = outer.left + heading.clientLeft + px(style.paddingLeft);
  const top = outer.top + heading.clientTop + px(style.paddingTop);
  const width = heading.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  const height = heading.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
  if (width <= 0 || height <= 0) return null;
  const glyphs: Glyph[] = [];
  const range = document.createRange();
  let source = "";
  for (const node of textNodes(heading)) {
    const s = getComputedStyle(node.parentElement!);
    const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    source += `${font}|`;
    for (let i = 0; i < node.data.length; i++) {
      const text = node.data[i];
      source += text;
      if (!text.trim()) continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = Array.from(range.getClientRects()).find(r => r.width > 0);
      if (rect) glyphs.push({ text, x: rect.left - left, y: rect.top - top, font });
    }
  }
  return { box: new DOMRect(left, top, width, height), glyphs, source };
}

/**
 * Lay the art out over `box`. A new source (other text, size, or font) is
 * redrawn; cells that already had ink keep their character, and cells that
 * gain ink assemble.
 */
function place(art: Art, box: DOMRect, now: number, source: string, raster: (columns: number, rows: number) => Uint8Array, cellSize: number): boolean {
  const block = art.host.parentElement!;
  const outer = block.getBoundingClientRect();
  const width = Math.round(box.width), height = Math.round(box.height);
  // A drop cap floats in its paragraph at its own size; heading art lies over the heading.
  Object.assign(art.host.style, art.kind === "cap" ? { width: `${width}px`, height: `${height}px` } : {
    left: `${box.left - outer.left - block.clientLeft}px`, top: `${box.top - outer.top - block.clientTop}px`,
    width: `${width}px`, height: `${height}px`,
  });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const previous = art.layout;
  const key = `${width}x${height}@${ratio}|${source}`;
  if (previous && previous.source === key) return false;
  // Courier cells are 0.6em wide.
  const cell = Math.max(3, cellSize);
  const columns = Math.max(3, Math.floor(width / (cell * 0.6))), rows = Math.max(3, Math.floor(height / cell));
  const levels = raster(columns, rows);
  const arrive = new Float64Array(columns * rows);
  const motion = !reducedMotion();
  if (!previous) {
    // First draw: a new block assembles in a wave down the art.
    if (art.assemble && motion) {
      for (let i = 0; i < arrive.length; i++) arrive[i] = now + (Math.floor(i / columns) / rows) * WAVE_MS + noise(i, 7) * (ASSEMBLE_MS - WAVE_MS);
    }
  } else if (motion && previous.columns === columns) {
    // Same grid width: cells that gain ink arrive; the rest stay as they were.
    for (let i = 0; i < arrive.length; i++) {
      const before = i < previous.levels.length ? previous.levels[i] : 0;
      arrive[i] = levels[i] && !before ? now + noise(i, 11) * TYPE_MS : i < previous.arrive.length ? previous.arrive[i] : 0;
    }
  }
  art.canvas.width = Math.round(width * ratio);
  art.canvas.height = Math.round(height * ratio);
  art.layout = { width, height, ratio, columns, rows, cell, source: key, levels, arrive };
  return true;
}

/** Draw the art; returns whether any character is still arriving. */
function draw(art: Art, now: number): boolean {
  const layout = art.layout;
  const ctx = art.canvas.getContext("2d");
  if (!layout || !ctx) return false;
  const { columns, rows, cell, levels, arrive, ratio } = layout;
  const cellWidth = layout.width / columns, cellHeight = layout.height / rows;
  const still = reducedMotion();
  const step = Math.floor(now / 60), shimmerStep = Math.floor(now / (1000 / IDLE_FPS));
  let arriving = false;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.font = `700 ${cell}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = getComputedStyle(art.host).color;
  for (let i = 0; i < levels.length; i++) {
    let level = levels[i];
    let alpha = 1;
    if (!still && now < arrive[i]) {
      arriving = true;
      // Not yet arrived: faint characters flicker where the art will be.
      if (noise(i, step) > (level ? 0.35 : 0.9)) { level = 1 + Math.floor(noise(i, step + 1) * (RAMP.length - 1)); alpha = 0.3; }
      else continue;
    } else if (!level) continue;
    else if (!still && noise(i, shimmerStep) < SHIMMER) level = Math.max(1, Math.min(RAMP.length - 1, level + (noise(i, shimmerStep + 3) < 0.5 ? -1 : 1)));
    ctx.globalAlpha = alpha;
    ctx.fillText(RAMP[level], (i % columns) * cellWidth, Math.floor(i / columns) * cellHeight);
  }
  ctx.globalAlpha = 1;
  const state = arriving ? "assembling" : "settled";
  if (art.host.dataset.state !== state) art.host.dataset.state = state;
  // How many cells are still arriving, and how many have ink, for tests and debugging.
  let pending = 0, ink = 0;
  for (let i = 0; i < levels.length; i++) { if (levels[i]) ink++; if (!still && now < arrive[i]) pending++; }
  art.host.dataset.arriving = String(pending);
  art.host.dataset.ink = String(ink);
  return arriving;
}

/**
 * Measure and lay out one piece of art when it may have changed: while it is
 * arriving, on the idle tick, or (for a heading) when its text or size moved.
 * Returns whether the layout changed, or null when there is nothing to draw.
 */
function layOut(art: Art, now: number, force: boolean): boolean | null {
  const block = art.host.parentElement;
  if (!block) return null;
  const quick = `${block.clientWidth}x${block.clientHeight}|${block.textContent}`;
  if (art.layout && !force && quick === art.quick) return false;
  art.quick = quick;
  if (art.kind === "cap") {
    const box = capSize(block, art.letter);
    return place(art, box, now, `cap:${art.letter}`, (columns, rows) => rasterizeLetter(art.letter, columns, rows), box.height / CAP_ROWS);
  }
  const heading = headingGlyphs(block);
  if (!heading || !heading.glyphs.length) return null;
  const fontSize = px(getComputedStyle(block).fontSize);
  return place(art, heading.box, now, heading.source, (columns, rows) => rasterizeGlyphs(heading.glyphs, heading.box, columns, rows), fontSize / HEADING_ROWS_PER_EM);
}

function tick(now: number) {
  frame = 0;
  let busy = false;
  const idle = now - lastIdle >= 1000 / IDLE_FPS;
  // Art whose widget was removed, by the block it was in, for a replacement to take over.
  const replaced = new Map<Element, Art>();
  for (const art of arts) {
    if (art.host.isConnected || !art.connected) continue;
    if (art.block) replaced.set(art.block, art);
    arts.delete(art);
  }
  for (const art of arts) {
    if (!art.host.isConnected) continue;
    let adopted = false;
    if (!art.connected) {
      art.connected = true;
      art.block = art.host.parentElement;
      const before = art.block && replaced.get(art.block);
      if (before?.layout && before.kind === art.kind) {
        // Same block, new widget (its text changed): carry the drawing over.
        art.layout = before.layout;
        art.assemble = false;
        art.canvas.width = before.canvas.width;
        art.canvas.height = before.canvas.height;
        adopted = true;
      }
    }
    const arriving = art.host.dataset.state === "assembling";
    const laid = layOut(art, now, arriving || idle || adopted);
    if (laid === null) { art.host.style.visibility = "hidden"; continue; }
    const changed = laid || adopted;
    art.host.style.visibility = "";
    const rect = art.host.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (arriving || idle || changed) busy = draw(art, now) || busy;
  }
  if (idle) lastIdle = now;
  // Under reduced motion, settled art is drawn once and redrawn only when the page changes.
  if (arts.size && (busy || !reducedMotion())) frame = requestAnimationFrame(tick);
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(tick);
}

/** Redraw all art now, e.g. after the theme or font size changed. */
export function refreshAsciiArt() {
  for (const art of arts) { art.quick = ""; if (art.layout) art.layout.source = ""; }
  lastIdle = 0;
  schedule();
}

function createArt(kind: ArtKind, letter: string, assemble: boolean): HTMLElement {
  const host = document.createElement("span");
  host.className = `ascii-art ascii-${kind}`;
  host.contentEditable = "false";
  host.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  arts.add({ kind, host, canvas, letter, assemble, connected: false, layout: null, quick: "", block: null });
  schedule();
  return host;
}

const built = new WeakMap<Set<string>, { doc: ProseNode; decorations: Decoration[] }>();

/**
 * Widgets for the Courier style: a drop cap at the start of each paragraph
 * that opens on a letter or digit, and the art for each Heading 1 and 2.
 * `seen` holds every block already shown in this editor; a block not seen
 * before assembles when its widget is drawn. Decisions are made once per
 * document (ProseMirror may ask more than once), and every current block
 * counts as seen afterwards, so recreated widgets (undo, an assistant edit)
 * appear settled. Callers must pass DecorationSet.create a copy: it nulls the
 * entries of the array it is given.
 */
export function asciiArtDecorations(doc: ProseNode, seen: Set<string>): Decoration[] {
  const cached = built.get(seen);
  if (cached?.doc === doc) return cached.decorations;
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const heading = node.type.name === "heading" && (node.attrs.level === 1 || node.attrs.level === 2);
    const letter = node.type.name === "paragraph" ? capLetter(node.textContent) : null;
    if (!heading && !letter) return;
    const fingerprint = `${heading ? `h${node.attrs.level}` : "p"}:${node.textContent.slice(0, 80)}`;
    const assemble = !seen.has(fingerprint);
    seen.add(fingerprint);
    decorations.push(heading
      ? Decoration.widget(offset + 1, () => createArt("heading", "", assemble), { key: `ascii-heading:${node.attrs.level}`, side: -1, ignoreSelection: true })
      : Decoration.widget(offset + 1, () => createArt("cap", letter!, assemble), { key: `ascii-cap:${letter}`, side: -1, ignoreSelection: true }));
    if (letter) {
      // The real letter stays in the text but out of sight; the art stands in for it.
      const start = offset + 1 + node.textContent.search(/\S/);
      decorations.push(Decoration.inline(start, start + letter.length, { class: "drop-cap-letter" }));
    }
  });
  while (seen.size > 4000) seen.delete(seen.values().next().value!);
  built.set(seen, { doc, decorations });
  return decorations;
}
