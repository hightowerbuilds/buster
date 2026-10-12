/**
 * Spread — parts a note's text around a word and holds an opening there.
 *
 * The ProseMirror DOM is never rearranged. Opening the spread:
 *   1. measures each word of the target paragraph, and of the paragraphs just
 *      below it on screen, where the browser drew it (the origins), so the
 *      first frame matches the page exactly;
 *   2. renders those words in a motion layer and makes the paragraphs' own
 *      text transparent through node decorations;
 *   3. reflows the lines below the word around an opening with Pretext (the
 *      destinations). When the opening reaches past the target paragraph, the
 *      next paragraphs part around it too; a spacer widget after the last of
 *      them grows so later blocks slide down with ordinary layout;
 *   4. springs every word from origin to destination, staggered outward.
 * Closing springs everything back to the measured origins, then removes the
 * decorations and the layer so the real text is visible again. Closing after
 * an edit (Paste, Bold, a suggestion) measures the edited paragraphs and lands
 * each surviving word on its new place instead; words that changed fade.
 *
 * While open, the opening can be reshaped (the words retarget mid-flight), the
 * whole scene re-measures and retargets when the column changes size, and the
 * target word's letters can fly out of the line to spell a headword — the
 * Define action uses these.
 *
 * Paragraphs Pretext cannot reproduce (headings, letter-spaced or justified
 * text, inline images or hard breaks) still open — the opening appears below
 * the block and later blocks slide down, but no words move.
 */

import type { Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { canvasMeasure, flowAroundOpening, wordPieces, type Float, type FlowRun } from "./flow";
import { graphemes, matchLetters, matchSequences } from "./letters";
import { LIVELY, SETTLE, isSettled, spring, stepSpring, type Spring, type SpringConfig } from "./spring";

/** How much the text moves: not at all, the default, or with more overshoot, tilt, and scatter. */
export type MotionIntensity = "off" | "calm" | "wild";

export interface SpreadOptions {
  view: EditorView;
  /** The scrolling element that contains the editor; the motion layer is positioned in its content box. */
  scroller: HTMLElement;
  /** ProseMirror range of the target word or selection, within one textblock. */
  from: number;
  to: number;
  motion: MotionIntensity;
  /** `render: false` when the view is about to render a new state that picks the decorations up. */
  setDecorations(decorations: DecorationSet, render?: boolean): void;
  /** Render the opening's content into `host`; return a disposer. */
  renderOpening(host: HTMLElement): () => void;
  /** Called once the spread has fully closed and every trace is removed. */
  onClosed(): void;
}

export interface SpreadHandle {
  /**
   * `changed`: the document was edited, so the words cannot simply go home.
   * With `doc` (the edited document, about to render) they land on their new
   * places; without it the layer fades over the real text.
   */
  close(options?: { changed?: boolean; doc?: PMNode }): void;
  /** End immediately without animating, e.g. when another spread replaces this one. */
  dispose(): void;
  /** The column changed size: measure again and retarget everything mid-flight. */
  relayout(): void;
  readonly closing: boolean;
  /** The widest the opening may grow: the paragraph's column. */
  readonly maxWidth: number;
  /** The paragraph's line height; the opening is sized in whole lines. */
  readonly lineHeight: number;
  /** The target word's font when its letters can take flight (one word, in one or more runs), otherwise null. */
  targetWord(): { font: string; fontSize: number } | null;
  /** Resize the opening and retarget the parted words mid-flight. Returns the opening in layer coordinates. */
  reshape(size: { width: number; rows: number }): OpeningRect;
  /**
   * Send the target word's letters out of the line to spell `headword` with its
   * top-left at `at` (layer coordinates), scaled by `scale`. Returns the
   * headword's drawn height, or null when the word cannot fly.
   */
  flyLettersTo(headword: string, at: { x: number; y: number }, scale: number): { height: number } | null;
}

export interface OpeningRect { left: number; top: number; width: number; height: number }

interface Measured { para: number; node: Text; start: number; text: string; x: number; line: number; style: CSSStyleDeclaration; font: string }

interface Paragraph {
  block: HTMLElement;
  /** Child indexes from the document down to this block, to find it again in an edited document. */
  path: number[];
  lineHeight: number;
  columnLeft: number;
  columnWidth: number;
  /** Top of the first line box, in layer coordinates. */
  contentTop: number;
  words: Measured[];
  lastLine: number;
  /** The Courier drop cap's float: where it ends, relative to the column and content top. */
  cap: { right: number; bottom: number } | null;
  /** The drop cap's ASCII art, which moves with the paragraph when it shifts down. */
  art: HTMLElement | null;
}

interface Layout {
  dest: Map<Measured, { x: number; y: number }>;
  /** How far each paragraph's first line moves down. */
  shift: number[];
  rect: OpeningRect;
  extra: number;
}

interface Scene {
  paragraphs: Paragraph[];
  /** Why the target took the rigid fallback, or null. */
  fallback: string | null;
  /** Why no further paragraph below joined, for the stats. */
  neighbourStop: string;
  lineHeight: number;
  columnLeft: number;
  columnWidth: number;
  blockBottom: number;
  targetTop: number;
  targetCenterX: number;
  /** The words the target covers, in order. */
  targets: Measured[];
  /** Part the text around an opening of `width` × `rows`; null when Pretext cannot reproduce it (see `fallback`). */
  part(width: number, rows: number): Layout | null;
}

interface Unit {
  el: HTMLElement;
  /** A word drawn in the layer, or null for a drop cap's art, which moves in place. */
  word: Measured | null;
  para: number;
  originX: number; originY: number;
  x: Spring; y: Spring;
  delay: number;
}

interface Letter {
  el: HTMLSpanElement;
  unit: Unit | null;
  /** Translation that lands the letter on its headword slot, and the burst it passes through. */
  dest: { x: number; y: number }; burst: { x: number; y: number };
  x: Spring; y: Spring; scale: Spring;
  kind: "flying" | "fading" | "arriving";
  text: string; headText: string;
  font: string; headFont: string;
  gatherAt: number; gathered: boolean;
}

interface Profile {
  open: SpringConfig; close: SpringConfig;
  staggerPxMs: number; staggerMaxMs: number;
  tiltMax: number; tiltGain: number;
  /** Scale of the letters' burst before they gather into the headword. */
  burst: number; gatherMs: number; letterStaggerMs: number;
}
const PROFILES: Record<Exclude<MotionIntensity, "off">, Profile> = {
  calm: { open: LIVELY, close: SETTLE, staggerPxMs: 0.32, staggerMaxMs: 240, tiltMax: 14, tiltGain: 0.012, burst: 1, gatherMs: 150, letterStaggerMs: 16 },
  wild: { open: { stiffness: 210, damping: 10 }, close: { stiffness: 300, damping: 21 }, staggerPxMs: 0.5, staggerMaxMs: 380,
    tiltMax: 28, tiltGain: 0.026, burst: 2.6, gatherMs: 280, letterStaggerMs: 26 },
};

const INLINE_TAGS = new Set(["STRONG", "EM", "B", "I", "A", "CODE", "S", "DEL", "U", "SPAN", "MARK", "SUB", "SUP"]);
const OPENING_MIN_ROWS = 3;
const OPENING_CONTENT_HEIGHT = 66; // two rows of action buttons
const OPENING_MAX_WIDTH = 360;
/** Paragraphs below the target that may part too; the opening grows to about a dozen rows at most. */
const MAX_NEIGHBOURS = 4;
const NEIGHBOUR_REACH_ROWS = 14;
/** Words this far outside the visible part of the note jump straight to their places. */
const OFFSCREEN_MARGIN = 120;

const canvasFont = (style: CSSStyleDeclaration) => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
const px = (value: string) => Number.parseFloat(value) || 0;

function lineHeightOf(style: CSSStyleDeclaration): number {
  const value = px(style.lineHeight);
  return value > 0 ? value : px(style.fontSize) * 1.2;
}

/** Widgets drawn into the paragraph (Courier's ASCII art canvas) are not its text. */
const skipDecorations = (node: Node) =>
  (node as Element).classList?.contains("ascii-art") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;

/**
 * Only plain prose in left-aligned, normally spaced paragraphs can be reflowed
 * faithfully. Returns why not, or null when it can.
 */
function reflowBlocker(block: HTMLElement, style: CSSStyleDeclaration): string | null {
  if (block.tagName !== "P") return `block <${block.tagName.toLowerCase()}>`;
  if (!["start", "left"].includes(style.textAlign)) return `text-align ${style.textAlign}`;
  if (style.letterSpacing !== "normal" && px(style.letterSpacing) !== 0) return `letter-spacing ${style.letterSpacing}`;
  if (style.wordSpacing !== "normal" && px(style.wordSpacing) !== 0) return `word-spacing ${style.wordSpacing}`;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT, { acceptNode: skipDecorations });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    if (!INLINE_TAGS.has(element.tagName)) return `inline <${element.tagName.toLowerCase()}${element.className ? `.${element.className}` : ""}>`;
  }
  return null;
}

/** The node at `path` (child indexes from the document down) and the position before it. */
function resolvePath(doc: PMNode, path: number[]): { pos: number; node: PMNode } | null {
  let node = doc, pos = 0;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth];
    if (index >= node.childCount) return null;
    for (let child = 0; child < index; child++) pos += node.child(child).nodeSize;
    node = node.child(index);
    if (depth < path.length - 1) pos += 1;
  }
  return { pos, node };
}

type ToContent = { x(clientX: number): number; y(clientY: number): number };

/**
 * Every word of a paragraph where the browser drew it. Words are split into
 * Pretext's break segments (wordPieces), so each piece sits on one line here
 * and in Pretext's layout alike. WebKit snaps text rects to whole pixels, so the
 * rects only find each word's line. Exact positions come from layout
 * arithmetic instead: line boxes stack at the paragraph's line height, and x
 * advances along a line by canvas widths — the same measurements Pretext uses
 * for destinations.
 */
function measureParagraph(block: HTMLElement, path: number[], para: number, to: ToContent): Paragraph | string {
  const style = getComputedStyle(block);
  const blocked = reflowBlocker(block, style);
  if (blocked) return blocked;
  const lineHeight = lineHeightOf(style);
  const rect = block.getBoundingClientRect();
  const columnLeft = to.x(rect.left) + px(style.paddingLeft) + px(style.borderLeftWidth);
  const columnWidth = block.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  const contentTop = to.y(rect.top) + px(style.paddingTop) + px(style.borderTopWidth);
  const lineAt = (top: number, bottom: number) => Math.max(0, Math.round(((top + bottom) / 2 - contentTop - lineHeight / 2) / lineHeight));
  const nodes: Text[] = [];
  const words: Measured[] = [];
  const range = document.createRange();
  // A Courier drop cap floats at the paragraph's start and stays where it is;
  // the rows beside it start after it in a new layout too. (Its real letter is
  // a hidden, nearly zero-width word of its own and moves with the rest.)
  const capHost = block.querySelector<HTMLElement>(":scope > .ascii-cap");
  const capStyle = capHost && getComputedStyle(capHost);
  let cap: Paragraph["cap"] = null;
  if (capHost && capStyle && capStyle.float !== "none" && capStyle.display !== "none") {
    const box = capHost.getBoundingClientRect();
    cap = { right: to.x(box.right) + px(capStyle.marginRight) - columnLeft, bottom: to.y(box.bottom) + px(capStyle.marginBottom) - contentTop };
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: skipDecorations });
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    if (next.nodeType !== Node.TEXT_NODE) continue;
    const node = next as Text;
    const nodeStyle = getComputedStyle(node.parentElement!);
    const font = canvasFont(nodeStyle);
    nodes.push(node);
    for (const piece of wordPieces(node.data, font)) {
      range.setStart(node, piece.start); range.setEnd(node, piece.start + piece.text.length);
      const box = Array.from(range.getClientRects()).find(r => r.width > 0);
      if (box) words.push({ para, node, start: piece.start, text: piece.text, x: to.x(box.left), line: lineAt(to.y(box.top), to.y(box.bottom)), style: nodeStyle, font });
    }
  }
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const advance = (a: Measured, b: Measured) => {
    // Pieces of one word share a text node: measure through `b` and take `b`
    // back off, so the kerning across the join ("-A" in "Saxe-Altenburg") counts.
    if (a.node === b.node) return canvasMeasure(a.node.data.slice(a.start, b.start + b.text.length), a.font) - canvasMeasure(b.text, a.font);
    let width = 0;
    for (let i = nodeIndex.get(a.node)!; i <= nodeIndex.get(b.node)!; i++) {
      const node = nodes[i];
      const from = node === a.node ? a.start : 0;
      const end = node === b.node ? b.start : node.data.length;
      const font = node === a.node ? a.font : node === b.node ? b.font : canvasFont(getComputedStyle(node.parentElement!));
      if (end > from) width += canvasMeasure(node.data.slice(from, end), font);
    }
    return width;
  };
  words.forEach((word, index) => {
    const snapped = word.x;
    const previous = words[index - 1];
    const exact = previous?.line === word.line ? previous.x + advance(previous, word)
      : Math.abs(snapped - columnLeft) < 1.5 ? columnLeft : snapped;
    // Trust the arithmetic only while it agrees with where the browser drew the word.
    word.x = Math.abs(exact - snapped) <= 1.5 ? exact : snapped;
  });
  const art = cap ? capHost : null;
  return {
    block, path, lineHeight, columnLeft, columnWidth, contentTop, words, cap, art,
    lastLine: words.reduce((max, word) => Math.max(max, word.line), 0),
  };
}

const lineTop = (paragraph: Paragraph, line: number) => paragraph.contentTop + line * paragraph.lineHeight;
const textBottom = (paragraph: Paragraph) => lineTop(paragraph, paragraph.lastLine + 1);

/** Runs of `words` for Pretext, each starting at its first word, with the words of each run. */
function runsOf(words: Measured[]) {
  const runs: FlowRun[] = [], runWords: Measured[][] = [], runStarts: number[] = [];
  let current: Text | null = null;
  for (const word of words) {
    if (word.node !== current) {
      current = word.node;
      const start = runs.length === 0 ? word.start : 0;
      runs.push({ text: word.node.data.slice(start), font: word.font });
      runStarts.push(start);
      runWords.push([]);
    }
    runWords[runWords.length - 1].push(word);
  }
  return { runs, runWords, runStarts };
}

/**
 * Lay `words` out again from `top` (layer coordinates) around the opening,
 * pairing each measured piece with the laid word that contains it by offset in
 * its run's text. A laid word may hold several pieces ("Saxe-" and "Altenburg,"
 * when Pretext keeps them on one line); a piece must never straddle two laid
 * words. Returns the rows the text uses, or a reason it could not be paired.
 */
function flowWords(words: Measured[], paragraph: Paragraph, top: number, opening: OpeningRect, float: Float | null,
  dest: Map<Measured, { x: number; y: number }>): number | string {
  const { runs, runWords, runStarts } = runsOf(words);
  if (!runs.length) return 0;
  const { lineHeight, columnLeft, columnWidth } = paragraph;
  // A span beside the opening narrower than the widest piece stays empty, so
  // Pretext never has to break a word that doesn't fit.
  const widest = words.reduce((max, word) => Math.max(max, canvasMeasure(word.text, word.font)), 0);
  const minSpan = Math.max(px(paragraph.words[0]?.style.fontSize ?? "16") * 4, Math.ceil(widest) + 1);
  const left = opening.left - columnLeft;
  const flow = flowAroundOpening(runs, columnWidth,
    { left, right: left + opening.width, top: (opening.top - top) / lineHeight, rows: opening.height / lineHeight }, minSpan, canvasMeasure, float);
  let rows = 0;
  for (let run = 0; run < runWords.length; run++) {
    const laid = flow.words.filter(word => word.run === run);
    let j = 0;
    for (const piece of runWords[run]) {
      const start = piece.start - runStarts[run], end = start + piece.text.length;
      while (j < laid.length && laid[j].start >= 0 && laid[j].start + laid[j].text.length <= start) j++;
      const word = laid[j];
      if (!word || word.start < 0 || word.start > start || word.start + word.text.length < end
        || word.text.slice(start - word.start, end - word.start) !== piece.text) {
        return `flow run ${run}/${runWords.length}: piece ${JSON.stringify(piece.text)} at ${start} vs laid ${JSON.stringify(word?.text ?? null)} at ${word?.start ?? null}`;
      }
      // Where the piece starts inside the laid word, kerning across the join included.
      const within = start === word.start ? 0 : canvasMeasure(word.text.slice(0, end - word.start), piece.font) - canvasMeasure(piece.text, piece.font);
      dest.set(piece, { x: columnLeft + word.x + within, y: top + word.row * lineHeight });
      rows = Math.max(rows, word.row + 1);
    }
  }
  return rows;
}

/** Measure the target paragraph and the paragraphs below it that may part, and how to part them. */
function measureScene(options: SpreadOptions): Scene {
  const { view, scroller } = options;
  const scrollerRect = scroller.getBoundingClientRect();
  const to: ToContent = {
    x: clientX => clientX - scrollerRect.left + scroller.scrollLeft,
    y: clientY => clientY - scrollerRect.top + scroller.scrollTop,
  };
  const $from = view.state.doc.resolve(options.from);
  const blockPos = $from.before();
  const block = view.nodeDOM(blockPos) as HTMLElement | null;
  if (!block) throw new Error("The paragraph is not on screen.");
  const path = Array.from({ length: $from.depth }, (_, depth) => $from.index(depth));

  const blockStyle = getComputedStyle(block);
  const lineHeight = lineHeightOf(blockStyle);
  const blockRect = block.getBoundingClientRect();
  const columnLeft = to.x(blockRect.left) + px(blockStyle.paddingLeft) + px(blockStyle.borderLeftWidth);
  const columnWidth = block.clientWidth - px(blockStyle.paddingLeft) - px(blockStyle.paddingRight);
  const startCoords = view.coordsAtPos(options.from, 1);
  const endCoords = view.coordsAtPos(options.to, -1);
  // A selection can wrap onto later lines: the opening goes below its last line,
  // centered in the column, and the motion ripples out from that line.
  const multiLine = endCoords.top - startCoords.top > lineHeight / 2;
  const scene: Scene = {
    paragraphs: [], fallback: null, neighbourStop: "", lineHeight, columnLeft, columnWidth, blockBottom: to.y(blockRect.bottom),
    targetTop: to.y(endCoords.top),
    targetCenterX: multiLine ? columnLeft + columnWidth / 2 : (to.x(startCoords.left) + to.x(endCoords.right)) / 2,
    targets: [],
    part: () => null,
  };
  const target = measureParagraph(block, path, 0, to);
  if (typeof target === "string") { scene.fallback = target; return scene; }
  scene.paragraphs.push(target);

  // Paragraphs just below, in the same column, that the opening could reach.
  const reach = textBottom(target) + NEIGHBOUR_REACH_ROWS * lineHeight;
  const visibleBottom = scroller.scrollTop + scroller.clientHeight + OFFSCREEN_MARGIN;
  for (let k = 1; k <= MAX_NEIGHBOURS; k++) {
    const nextPath = [...path.slice(0, -1), path[path.length - 1] + k];
    const stop = (reason: string) => { scene.neighbourStop = `${k}: ${reason}`; };
    const found = resolvePath(view.state.doc, nextPath);
    if (!found || found.node.type.name !== "paragraph") { stop(found ? found.node.type.name : "end"); break; }
    const element = view.nodeDOM(found.pos) as HTMLElement | null;
    if (!element || element.parentElement !== block.parentElement) { stop("not on screen"); break; }
    const neighbour = measureParagraph(element, nextPath, k, to);
    if (typeof neighbour === "string" || !neighbour.words.length) { stop(typeof neighbour === "string" ? neighbour : "empty"); break; }
    if (Math.abs(neighbour.columnLeft - columnLeft) > 1 || Math.abs(neighbour.columnWidth - columnWidth) > 1
      || Math.abs(neighbour.lineHeight - lineHeight) > 0.5 || (neighbour.cap && !neighbour.art)) { stop(neighbour.cap && !neighbour.art ? "a drop cap without its art" : "different column"); break; }
    if (neighbour.contentTop > Math.min(reach, visibleBottom)) { stop("out of reach"); break; }
    scene.paragraphs.push(neighbour);
  }

  const lineAt = (top: number, bottom: number) => Math.max(0, Math.round(((top + bottom) / 2 - target.contentTop - lineHeight / 2) / lineHeight));
  const startLine = lineAt(to.y(startCoords.top), to.y(startCoords.bottom));
  const endLine = lineAt(to.y(endCoords.top), to.y(endCoords.bottom));
  const targetLeft = to.x(startCoords.left) - 1, targetRight = to.x(endCoords.right) + 1;
  scene.targets = target.words.filter(word => word.line >= startLine && word.line <= endLine
    && (word.line > startLine || word.x >= targetLeft) && (word.line < endLine || word.x < targetRight));

  scene.part = (width, rows) => {
    const dest = new Map<Measured, { x: number; y: number }>();
    const shift: number[] = [0];
    // The target paragraph: lines through the target stay; the rest part around the opening.
    const flowTop = lineTop(target, endLine + 1);
    const openingX = Math.max(0, Math.min(columnWidth - width, scene.targetCenterX - columnLeft - width / 2));
    const rect: OpeningRect = { left: columnLeft + openingX, top: flowTop, width, height: rows * lineHeight };
    for (const word of target.words) if (word.line <= endLine) dest.set(word, { x: word.x, y: lineTop(target, word.line) });
    // Rows of a new layout beside a drop cap start after it; the cap moves with
    // its paragraph's first line (`paragraphTop`).
    const capFloat = (paragraph: Paragraph, paragraphTop: number, flowTop: number): Float | null => {
      const capBottom = paragraph.cap ? paragraphTop + paragraph.cap.bottom : 0;
      return paragraph.cap && capBottom > flowTop ? { rows: Math.ceil((capBottom - flowTop) / lineHeight), right: paragraph.cap.right } : null;
    };
    const used = flowWords(target.words.filter(word => word.line > endLine), target, flowTop, rect, capFloat(target, target.contentTop, flowTop), dest);
    if (typeof used === "string") { scene.fallback = used; return null; }
    let bottom = flowTop + used * lineHeight;
    let previous = target;
    const openingBottom = rect.top + rect.height;
    for (const paragraph of scene.paragraphs.slice(1)) {
      // The gap between paragraphs is kept; a paragraph the opening reaches parts around it.
      const top = bottom + (paragraph.contentTop - textBottom(previous));
      shift.push(top - paragraph.contentTop);
      if (top < openingBottom) {
        const rowsUsed = flowWords(paragraph.words, paragraph, top, rect, capFloat(paragraph, top, top), dest);
        if (typeof rowsUsed === "string") { scene.fallback = `neighbour ${paragraph.words[0]?.text}: ${rowsUsed}`; return null; }
        bottom = top + rowsUsed * lineHeight;
      } else {
        for (const word of paragraph.words) dest.set(word, { x: word.x, y: lineTop(paragraph, word.line) + top - paragraph.contentTop });
        bottom = top + (paragraph.lastLine + 1) * lineHeight;
      }
      previous = paragraph;
    }
    return { dest, shift, rect, extra: Math.max(0, Math.max(bottom, openingBottom) - textBottom(previous)) };
  };
  return scene;
}

export function openSpread(options: SpreadOptions): SpreadHandle {
  const { view, scroller } = options;
  const profile = PROFILES[options.motion === "off" ? "calm" : options.motion];
  const still = options.motion === "off";

  let scene = measureScene(options);
  const layer = document.createElement("div");
  layer.className = "text-motion-layer";
  layer.setAttribute("aria-hidden", "true");
  const opening = document.createElement("div");
  opening.className = "text-motion-opening";

  const units: Unit[] = [];
  const letters: Letter[] = [];
  let rows = Math.max(OPENING_MIN_ROWS, Math.ceil((OPENING_CONTENT_HEIGHT + 16) / scene.lineHeight));
  let rect: OpeningRect = { left: 0, top: 0, width: Math.min(OPENING_MAX_WIDTH, scene.columnWidth), height: rows * scene.lineHeight };
  let extraHeight = 0;
  let layout = scene.paragraphs.length ? scene.part(Math.min(OPENING_MAX_WIDTH, scene.columnWidth * 0.72), rows) : null;
  // A neighbour Pretext can't reproduce: part the target paragraph alone.
  if (!layout && scene.paragraphs.length > 1) {
    scene.paragraphs.length = 1;
    scene.fallback = null;
    layout = scene.part(Math.min(OPENING_MAX_WIDTH, scene.columnWidth * 0.72), rows);
  }
  const reflowed = !!layout;
  if (!reflowed) scene.paragraphs = [];
  /** Where the rigid fallback opens: centered below the block. */
  const rigidRect = (width: number, count: number): OpeningRect => ({
    left: scene.columnLeft + Math.max(0, (scene.columnWidth - width) / 2), top: scene.blockBottom + scene.lineHeight * 0.5,
    width, height: count * scene.lineHeight,
  });

  const delayFor = (x: number, y: number) =>
    Math.min(profile.staggerMaxMs, Math.hypot(x - scene.targetCenterX, y - scene.targetTop) * profile.staggerPxMs);

  function makeWordUnit(word: Measured, paragraph: Paragraph): Unit {
    const el = document.createElement("span");
    el.className = "text-motion-word";
    el.textContent = word.text;
    const s = word.style;
    const originY = lineTop(paragraph, word.line);
    Object.assign(el.style, {
      left: `${word.x}px`, top: `${originY}px`, font: word.font, color: s.color,
      // The paragraph's own line box, so each glyph sits exactly where the paragraph put it.
      lineHeight: `${paragraph.lineHeight}px`,
      textDecoration: s.textDecorationLine === "none" ? "" : `${s.textDecorationLine} ${s.textDecorationColor}`,
      backgroundColor: s.backgroundColor,
    });
    layer.appendChild(el);
    return { el, word, para: word.para, originX: word.x, originY, x: spring(0), y: spring(0), delay: delayFor(word.x, originY) };
  }

  if (layout) {
    rect = layout.rect;
    extraHeight = layout.extra;
    for (const [index, paragraph] of scene.paragraphs.entries()) {
      for (const word of paragraph.words) {
        const unit = makeWordUnit(word, paragraph);
        const to = layout.dest.get(word);
        if (to) { unit.x.target = to.x - unit.originX; unit.y.target = to.y - unit.originY; }
        if (index === 0 && scene.targets.includes(word)) unit.el.classList.add("is-target");
        units.push(unit);
      }
      // A neighbour's drop cap art moves down with its paragraph.
      if (paragraph.art && index > 0) {
        units.push({ el: paragraph.art, word: null, para: index, originX: 0, originY: 0,
          x: spring(0), y: spring(0, layout.shift[index] ?? 0), delay: delayFor(scene.targetCenterX, paragraph.contentTop) });
      }
    }
  } else {
    // Rigid fallback: open a space directly below the block.
    rect = rigidRect(rect.width, rows);
    extraHeight = rect.height + scene.lineHeight;
  }

  // Letters can fly when the target is one word (in one run, or split across
  // runs or break segments) — punctuation beside it stays in the line.
  type Part = { unit: Unit; offset: number; text: string; font: string };
  let flyable: { parts: Part[]; font: string; fontSize: number } | null = null;
  {
    const text = view.state.doc.textBetween(options.from, options.to);
    const pieces = units.filter(unit => unit.word && scene.targets.includes(unit.word));
    if (pieces.length && text && !/\s/.test(text)) {
      const joined = pieces.map(unit => unit.word!.text).join("");
      const startX = view.coordsAtPos(options.from, 1).left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      const first = pieces[0].word!;
      // The occurrence of the text that starts where the target does.
      let best = -1, bestDistance = Infinity;
      for (let at = joined.indexOf(text); at >= 0 && at < first.text.length; at = joined.indexOf(text, at + 1)) {
        const distance = Math.abs(first.x + canvasMeasure(first.text.slice(0, at), first.font) - startX);
        if (distance < bestDistance) { best = at; bestDistance = distance; }
      }
      if (best >= 0) {
        const parts: Part[] = [];
        let offset = 0;
        for (const unit of pieces) {
          const word = unit.word!;
          const from = Math.max(best, offset), end = Math.min(best + text.length, offset + word.text.length);
          if (end > from) parts.push({ unit, offset: from - offset, text: word.text.slice(from - offset, end - offset), font: word.font });
          offset += word.text.length;
        }
        if (parts.map(part => part.text).join("") === text) {
          flyable = { parts, font: parts[0].font, fontSize: px(parts[0].unit.word!.style.fontSize) };
        }
      }
    }
  }

  const placeOpening = () => Object.assign(opening.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
  });
  placeOpening();
  layer.appendChild(opening);
  scroller.appendChild(layer);

  // ── Spacer: later blocks slide down with ordinary layout ──────────
  const spacer = document.createElement("div");
  spacer.className = "text-motion-spacer";
  spacer.contentEditable = "false";
  const height = spring(0, extraHeight);
  let collapsedMargin = 0;
  const setSpacer = (value: number) => {
    const h = Math.max(0, value);
    spacer.style.height = `${h}px`;
    // A spacer with height stops the neighbours' margins from collapsing;
    // cancel the difference so the motion starts and ends without a jump.
    spacer.style.marginBottom = h > 0 ? `${-collapsedMargin}px` : "0px";
  };

  /** Ghost every moving paragraph and put the spacer after the last block that takes part. */
  function decorationsFor(doc: PMNode, paths: number[][]): DecorationSet | null {
    const found = paths.map(path => resolvePath(doc, path));
    if (found.some(item => !item || !item.node.isTextblock)) return null;
    const last = found[found.length - 1]!;
    const lastBlock = view.nodeDOM(last.pos) as HTMLElement | null;
    const next = lastBlock?.nextElementSibling;
    collapsedMargin = lastBlock ? Math.min(px(getComputedStyle(lastBlock).marginBottom), next ? px(getComputedStyle(next).marginTop) : 0) : 0;
    const decorations = [Decoration.widget(last.pos + last.node.nodeSize, spacer, { side: -1, ignoreSelection: true, key: "text-motion-spacer" })];
    if (reflowed) for (const item of found) decorations.push(Decoration.node(item!.pos, item!.pos + item!.node.nodeSize, { class: "text-motion-ghost" }));
    return DecorationSet.create(doc, decorations);
  }
  const $from = view.state.doc.resolve(options.from);
  const targetPath = Array.from({ length: $from.depth }, (_, depth) => $from.index(depth));
  const paths = () => reflowed ? scene.paragraphs.map(paragraph => paragraph.path) : [targetPath];
  setSpacer(0);
  options.setDecorations(decorationsFor(view.state.doc, paths())!);

  const disposeOpening = options.renderOpening(opening);

  // ── Animation ──────────────────────────────────────────────────────
  let phase: "opening" | "open" | "closing" | "closed" = "opening";
  let frame = 0;
  let last = 0;
  let started = 0;
  let flownScale = 1;
  const stats = { frames: 0, maxFrameMs: 0, words: units.filter(unit => unit.word).length, paragraphs: scene.paragraphs.length, reflowed, motion: options.motion,
    ...(scene.neighbourStop ? { neighbourStop: scene.neighbourStop } : {}),
    ...(scene.fallback ? { fallback: scene.fallback } : {}) };

  function apply(unit: Unit) {
    if (!unit.word) { unit.el.style.transform = unit.y.value ? `translateY(${unit.y.value}px)` : ""; return; }
    const tilt = still ? 0 : Math.max(-profile.tiltMax, Math.min(profile.tiltMax, unit.x.velocity * profile.tiltGain));
    unit.el.style.transform = unit.x.value || unit.y.value || tilt
      ? `translate(${unit.x.value}px, ${unit.y.value}px) rotate(${tilt}deg)` : "";
  }

  function applyLetter(letter: Letter) {
    letter.el.style.transform = `translate(${letter.x.value}px, ${letter.y.value}px) scale(${letter.scale.value})`;
  }

  /** Turn a letter from its burst toward its headword slot. */
  function gather(letter: Letter) {
    letter.gathered = true;
    letter.x.target = letter.dest.x; letter.y.target = letter.dest.y;
    if (letter.kind === "fading") letter.el.classList.add("is-fading");
    else letter.scale.target = flownScale;
    if (letter.headText !== letter.text) letter.el.textContent = letter.headText;
    if (letter.headFont !== letter.font) letter.el.style.font = letter.headFont;
  }

  function settleAll() {
    if (phase === "opening") for (const letter of letters) if (!letter.gathered) gather(letter);
    for (const unit of units) {
      for (const s of [unit.x, unit.y]) { s.value = s.target; s.velocity = 0; }
      apply(unit);
    }
    for (const letter of letters) {
      for (const s of [letter.x, letter.y, letter.scale]) { s.value = s.target; s.velocity = 0; }
      applyLetter(letter);
    }
    height.value = height.target; height.velocity = 0;
    setSpacer(height.value);
  }

  /** Words that start and end well outside the visible part of the note jump straight to their places. */
  function skipOffscreen() {
    const top = scroller.scrollTop - OFFSCREEN_MARGIN, bottom = scroller.scrollTop + scroller.clientHeight + OFFSCREEN_MARGIN;
    const outside = (y: number) => y < top || y > bottom;
    for (const unit of units) {
      if (!unit.word || !outside(unit.originY + unit.y.value) || !outside(unit.originY + unit.y.target)) continue;
      unit.x.value = unit.x.target; unit.y.value = unit.y.target; unit.x.velocity = unit.y.velocity = 0;
      apply(unit);
    }
  }

  /** How the spread closed, for the smoke test and the console. */
  const report = (close: Record<string, unknown>) => {
    (window as unknown as { __textMotionClose?: unknown }).__textMotionClose = close;
  };
  const publish = () => {
    (window as unknown as { __textMotion?: unknown }).__textMotion = { ...stats };
    console.info("[text-motion]", JSON.stringify(stats));
  };

  function tick(now: number) {
    frame = 0;
    const dt = last ? (now - last) / 1000 : 1 / 60;
    if (last) { stats.frames++; stats.maxFrameMs = Math.max(stats.maxFrameMs, now - last); }
    last = now;
    const elapsed = now - started;
    const config = phase === "closing" ? profile.close : profile.open;
    let moving = false;
    for (const unit of units) {
      if (elapsed < unit.delay) { moving = true; continue; }
      stepSpring(unit.x, dt, config);
      stepSpring(unit.y, dt, config);
      apply(unit);
      if (!isSettled(unit.x) || !isSettled(unit.y)) moving = true;
    }
    for (const letter of letters) {
      if (!letter.gathered) {
        if (phase === "opening" && elapsed >= letter.gatherAt) gather(letter);
        else if (phase === "opening") moving = true;
      }
      for (const s of [letter.x, letter.y, letter.scale]) stepSpring(s, dt, config);
      applyLetter(letter);
      if (!isSettled(letter.x) || !isSettled(letter.y) || !isSettled(letter.scale)) moving = true;
    }
    stepSpring(height, dt, config);
    setSpacer(height.value);
    if (!isSettled(height)) moving = true;
    if (moving) { frame = requestAnimationFrame(tick); return; }
    if (phase === "opening") {
      phase = "open";
      publish();
    } else if (phase === "closing") finish();
  }

  function run() {
    cancelAnimationFrame(frame);
    last = 0;
    started = performance.now();
    if (still) {
      settleAll();
      if (phase === "opening") { phase = "open"; publish(); } else if (phase === "closing") finish();
      return;
    }
    skipOffscreen();
    frame = requestAnimationFrame(tick);
  }

  function finish(immediate = false, render = true) {
    if (phase === "closed") return;
    phase = "closed";
    cancelAnimationFrame(frame);
    disposeOpening();
    for (const unit of units) if (!unit.word) unit.el.style.transform = "";
    // Reveal the real text first; drop the identical layer on the next frame.
    options.setDecorations(DecorationSet.empty, render);
    if (immediate) { layer.remove(); options.onClosed(); return; }
    requestAnimationFrame(() => { layer.remove(); options.onClosed(); });
  }

  /** Run the opening motion again from where everything is now, e.g. after a reshape. */
  function restart() {
    if (phase === "closing" || phase === "closed") return;
    phase = "opening";
    stats.frames = 0; stats.maxFrameMs = 0;
    run();
  }

  /** Retarget every word to `next`, e.g. after a reshape or a relayout. */
  function retarget(next: Layout) {
    rect = next.rect;
    height.target = next.extra;
    for (const unit of units) {
      if (!unit.word) { unit.y.target = next.shift[unit.para] ?? 0; unit.delay = 0; continue; }
      const to = next.dest.get(unit.word);
      unit.x.target = to ? to.x - unit.originX : 0;
      unit.y.target = to ? to.y - unit.originY : 0;
      unit.delay = 0;
    }
  }

  /** The words fade over the real text (when the edited paragraphs can't be measured again). */
  function crossfade(render: boolean) {
    report({ mode: "crossfade" });
    phase = "closing";
    layer.classList.add("is-leaving");
    cancelAnimationFrame(frame);
    setSpacer(0);
    options.setDecorations(DecorationSet.empty, render);
    setTimeout(() => { if (phase === "closing") finish(); }, 140);
  }

  /**
   * The document was edited (Paste, Bold, a chosen suggestion): keep the
   * paragraphs ghosted in the edited document, measure them once it renders,
   * and land each word that survived on its new place. Words that changed
   * fade out where they are; new words fade in where they now sit.
   */
  function settleOnto(doc: PMNode) {
    const decorations = decorationsFor(doc, paths());
    if (!decorations) { crossfade(false); return; }
    phase = "closing";
    cancelAnimationFrame(frame);
    if (!reflowed) {
      report({ mode: "settle", rigid: true });
      // Nothing moved in the rigid fallback: the space below the block closes.
      options.setDecorations(decorations, false);
      height.target = 0;
      run();
      return;
    }
    for (const letter of letters) { letter.gathered = true; letter.el.classList.add("is-departing"); }
    const before = scene.paragraphs.map(paragraph => paragraph.contentTop);
    const bottomBefore = textBottom(scene.paragraphs[scene.paragraphs.length - 1]) + height.value;
    options.setDecorations(decorations, false);
    queueMicrotask(() => {
      if (phase !== "closing") return;
      const scrollerRect = scroller.getBoundingClientRect();
      const to: ToContent = { x: x => x - scrollerRect.left + scroller.scrollLeft, y: y => y - scrollerRect.top + scroller.scrollTop };
      const fresh: Paragraph[] = [];
      for (const [index, paragraph] of scene.paragraphs.entries()) {
        const found = resolvePath(view.state.doc, paragraph.path);
        const element = found && view.nodeDOM(found.pos) as HTMLElement | null;
        const measured = element ? measureParagraph(element, paragraph.path, index, to) : "gone";
        if (typeof measured === "string") { crossfade(true); return; }
        fresh.push(measured);
      }
      for (const [index, paragraph] of fresh.entries()) {
        const old = units.filter(unit => unit.word && unit.para === index);
        const matched = matchSequences(old, paragraph.words, (unit, word) => unit.word!.text === word.text && unit.word!.font === word.font);
        const taken = new Set<number>();
        old.forEach((unit, i) => {
          const word = paragraph.words[matched[i]];
          if (!word) { unit.el.classList.add("is-leaving"); unit.x.target = unit.x.value; unit.y.target = unit.y.value; return; }
          taken.add(matched[i]);
          unit.x.target = word.x - unit.originX;
          unit.y.target = lineTop(paragraph, word.line) - unit.originY;
          unit.delay = 0;
        });
        paragraph.words.forEach((word, j) => {
          if (taken.has(j)) return;
          const unit = makeWordUnit(word, paragraph);
          unit.el.classList.add("is-entering");
          unit.delay = 0;
          units.push(unit);
        });
        // A neighbour's art is drawn at its real place again once the spacer above it is gone.
        for (const unit of units) if (!unit.word && unit.para === index) {
          unit.y.value -= paragraph.contentTop - before[index];
          unit.y.target = 0;
        }
      }
      report({ mode: "settle", matched: units.filter(unit => unit.word && !unit.el.classList.contains("is-leaving") && !unit.el.classList.contains("is-entering")).length,
        entering: units.filter(unit => unit.el.classList.contains("is-entering")).length,
        leaving: units.filter(unit => unit.el.classList.contains("is-leaving")).length });
      const bottomAfter = textBottom(fresh[fresh.length - 1]);
      height.value = Math.max(0, bottomBefore - bottomAfter);
      height.target = 0;
      setSpacer(height.value);
      run();
    });
  }

  requestAnimationFrame(() => opening.classList.add("is-visible"));
  run();

  let relayoutFrame = 0;

  const handle: SpreadHandle = {
    get closing() { return phase === "closing" || phase === "closed"; },
    dispose() { cancelAnimationFrame(relayoutFrame); setSpacer(0); finish(true); },
    get maxWidth() { return scene.columnWidth; },
    get lineHeight() { return scene.lineHeight; },

    targetWord() {
      return flyable ? { font: flyable.font, fontSize: flyable.fontSize } : null;
    },

    reshape({ width, rows: count }) {
      if (phase === "closing" || phase === "closed") return { ...rect };
      width = Math.min(width, scene.columnWidth);
      count = Math.max(OPENING_MIN_ROWS, count);
      if (reflowed) {
        // Keep the current opening if Pretext cannot part the text faithfully at the new size.
        const next = scene.part(width, count);
        if (!next) return { ...rect };
        retarget(next);
      } else {
        rect = { ...rigidRect(width, count), top: rect.top };
        height.target = rect.height + scene.lineHeight;
      }
      rows = count;
      placeOpening();
      restart();
      return { ...rect };
    },

    relayout() {
      if (phase === "closing" || phase === "closed" || relayoutFrame) return;
      relayoutFrame = requestAnimationFrame(() => {
        relayoutFrame = 0;
        if (phase === "closing" || phase === "closed") return;
        let next: Scene;
        try { next = measureScene(options); } catch { handle.close({ changed: true }); return; }
        if (reflowed) next.paragraphs = next.paragraphs.slice(0, scene.paragraphs.length);
        // The same words in the same paragraphs, or the scene starts over.
        const same = !reflowed || !next.fallback && next.paragraphs.length === scene.paragraphs.length
          && next.paragraphs.every((paragraph, i) => paragraph.words.length === scene.paragraphs[i].words.length
            && paragraph.words.every((word, j) => word.text === scene.paragraphs[i].words[j].text));
        if (!same) { handle.close({ changed: true }); return; }
        const width = Math.min(rect.width, next.columnWidth);
        const parted = reflowed ? next.part(width, rows) : null;
        if (reflowed && !parted) { handle.close({ changed: true }); return; }
        const previous = { left: rect.left, top: rect.top };
        // Each word's origin moves to where the browser draws it now; it keeps
        // its current place on screen and springs on from there.
        const moved = new Map<Unit, { dx: number; dy: number }>();
        for (const unit of units) {
          if (!unit.word) continue;
          const paragraph = next.paragraphs[unit.para];
          const word = paragraph.words[scene.paragraphs[unit.para].words.indexOf(unit.word)];
          const originY = lineTop(paragraph, word.line);
          const dx = word.x - unit.originX, dy = originY - unit.originY;
          unit.word = word; unit.originX = word.x; unit.originY = originY;
          unit.x.value -= dx; unit.y.value -= dy;
          unit.el.style.left = `${word.x}px`; unit.el.style.top = `${originY}px`;
          moved.set(unit, { dx, dy });
        }
        scene = next;
        if (parted) retarget(parted);
        else { rect = { ...rigidRect(width, rows) }; height.target = rect.height + scene.lineHeight; }
        // Flown letters keep their place on screen and head for the moved headword.
        const rdx = rect.left - previous.left, rdy = rect.top - previous.top;
        for (const letter of letters) {
          const home = letter.unit ? moved.get(letter.unit) ?? { dx: 0, dy: 0 } : { dx: rdx, dy: rdy };
          letter.el.style.left = `${px(letter.el.style.left) + home.dx}px`;
          letter.el.style.top = `${px(letter.el.style.top) + home.dy}px`;
          letter.x.value -= home.dx; letter.y.value -= home.dy;
          if (letter.unit) { letter.dest.x += rdx - home.dx; letter.dest.y += rdy - home.dy; }
          if (letter.gathered && letter.kind !== "arriving") { letter.x.target = letter.dest.x; letter.y.target = letter.dest.y; }
        }
        placeOpening();
        restart();
      });
    },

    flyLettersTo(headword, at, scale) {
      if (!flyable || letters.length || phase === "closing" || phase === "closed") return null;
      const { parts, font: headFont } = flyable;
      // The word leaves; anything beside it (punctuation) stays drawn in the line.
      for (const part of parts) {
        const hidden = document.createElement("span");
        hidden.style.visibility = "hidden";
        hidden.textContent = part.text;
        const text = part.unit.word!.text;
        part.unit.el.replaceChildren(text.slice(0, part.offset), hidden, text.slice(part.offset + part.text.length));
      }

      flownScale = scale;
      const own: Array<{ value: string; unit: Unit; homeX: number; font: string }> = [];
      for (const part of parts) {
        const word = part.unit.word!;
        const left = word.x + canvasMeasure(word.text.slice(0, part.offset), part.font);
        const values = graphemes(part.text);
        values.forEach((value, i) => own.push({ value, unit: part.unit, font: part.font, homeX: left + canvasMeasure(values.slice(0, i).join(""), part.font) }));
      }
      const head = graphemes(headword);
      const matched = matchLetters(own.map(letter => letter.value), head);
      const slot = (j: number) => at.x + canvasMeasure(head.slice(0, j).join(""), headFont) * scale;
      const make = (value: string, left: number, top: number, font: string) => {
        const el = document.createElement("span");
        el.className = "text-motion-letter";
        el.textContent = value;
        Object.assign(el.style, { left: `${left}px`, top: `${top}px`, font, lineHeight: `${scene.lineHeight}px` });
        layer.appendChild(el);
        return el;
      };
      let previous = -1;
      own.forEach(({ value, unit, homeX, font }, i) => {
        const j = matched[i];
        // An unmatched letter heads for the gap where it would have been, fading as it goes.
        const dest = { x: slot(j >= 0 ? j : previous + 1) - homeX, y: at.y - unit.originY };
        if (j >= 0) previous = j;
        const spread = i - (own.length - 1) / 2;
        const lh = scene.lineHeight;
        const burst = { x: spread * lh * 0.35 * profile.burst, y: -lh * (0.8 + 0.25 * Math.sin(i * 2.1)) * profile.burst };
        const letter: Letter = {
          el: make(value, homeX, unit.originY, font), unit, dest, burst,
          x: spring(0, burst.x), y: spring(0, burst.y), scale: spring(1),
          kind: j >= 0 ? "flying" : "fading", text: value, headText: j >= 0 ? head[j] : value, font, headFont,
          gatherAt: profile.gatherMs + i * profile.letterStaggerMs, gathered: false,
        };
        letters.push(letter);
        applyLetter(letter);
      });
      // Headword letters the word lacks appear in place once the others arrive.
      const taken = new Set(matched);
      head.forEach((value, j) => {
        if (taken.has(j)) return;
        const el = make(value, slot(j), at.y, headFont);
        el.classList.add("is-arriving");
        el.style.animationDelay = `${profile.gatherMs + own.length * profile.letterStaggerMs + 200}ms`;
        const letter: Letter = {
          el, unit: null, dest: { x: 0, y: 0 }, burst: { x: 0, y: 0 }, x: spring(0), y: spring(0), scale: spring(scale),
          kind: "arriving", text: value, headText: value, font: headFont, headFont, gatherAt: 0, gathered: true,
        };
        letters.push(letter);
        applyLetter(letter);
      });
      restart();
      return { height: scene.lineHeight * scale };
    },

    close({ changed = false, doc } = {}) {
      if (phase === "closed") return;
      if (phase === "closing") {
        // A second edit while landing on the first: show the real text at once.
        if (doc) { setSpacer(0); finish(true, false); }
        return;
      }
      cancelAnimationFrame(relayoutFrame); relayoutFrame = 0;
      opening.classList.remove("is-visible");
      if (changed) {
        if (doc && !still) settleOnto(doc);
        else crossfade(!doc);
        return;
      }
      phase = "closing";
      report({ mode: "return" });
      for (const unit of units) {
        unit.x.target = 0; unit.y.target = 0;
        unit.delay = Math.max(0, profile.staggerMaxMs * 0.5 - unit.delay * 0.5);
      }
      for (const letter of letters) {
        // Letters fly home; the ones that faded return, the ones that appeared leave.
        letter.gathered = true;
        letter.x.target = 0; letter.y.target = 0;
        if (letter.kind === "arriving") letter.el.classList.add("is-departing");
        else {
          letter.scale.target = 1; letter.el.classList.remove("is-fading");
          letter.el.textContent = letter.text; letter.el.style.font = letter.font;
        }
      }
      height.target = 0;
      run();
    },
  };
  return handle;
}
