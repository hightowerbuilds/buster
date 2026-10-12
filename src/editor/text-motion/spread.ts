/**
 * Spread — parts a note's text around a word and holds an opening there.
 *
 * The ProseMirror DOM is never rearranged. Opening the spread:
 *   1. measures each word of the target paragraph where the browser drew it
 *      (the origins), so the first frame matches the page exactly;
 *   2. renders those words in a motion layer and makes the paragraph's own
 *      text transparent through a node decoration;
 *   3. reflows the lines below the word around an opening with Pretext (the
 *      destinations), and grows a spacer widget so later blocks slide down
 *      with ordinary layout;
 *   4. springs every word from origin to destination, staggered outward.
 * Closing springs everything back to the measured origins, then removes the
 * decorations and the layer so the real text is visible again.
 *
 * Paragraphs Pretext cannot reproduce (headings, letter-spaced or justified
 * text, inline images or hard breaks) still open — the opening appears below
 * the block and later blocks slide down, but no words move.
 */

import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { canvasMeasure, flowAroundOpening, type FlowRun } from "./flow";
import { LIVELY, SETTLE, isSettled, spring, stepSpring, type Spring, type SpringConfig } from "./spring";

export interface SpreadOptions {
  view: EditorView;
  /** The scrolling element that contains the editor; the motion layer is positioned in its content box. */
  scroller: HTMLElement;
  /** ProseMirror range of the target word or selection, within one textblock. */
  from: number;
  to: number;
  reducedMotion: boolean;
  setDecorations(decorations: DecorationSet): void;
  /** Render the opening's content into `host`; return a disposer. */
  renderOpening(host: HTMLElement): () => void;
  /** Called once the spread has fully closed and every trace is removed. */
  onClosed(): void;
}

export interface SpreadHandle {
  /** `changed`: the document was edited, so skip the return trip and reveal the real text. */
  close(options?: { changed?: boolean }): void;
  /** End immediately without animating, e.g. when another spread replaces this one. */
  dispose(): void;
  readonly closing: boolean;
}

interface Unit {
  el: HTMLSpanElement;
  originX: number; originY: number;
  x: Spring; y: Spring;
  delay: number;
  target: boolean;
}

const INLINE_TAGS = new Set(["STRONG", "EM", "B", "I", "A", "CODE", "S", "DEL", "U", "SPAN", "MARK", "SUB", "SUP"]);
const OPENING_MIN_ROWS = 3;
const OPENING_CONTENT_HEIGHT = 48;
const OPENING_MAX_WIDTH = 360;
const STAGGER_PX_MS = 0.32;
const STAGGER_MAX_MS = 240;

const canvasFont = (style: CSSStyleDeclaration) => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
const px = (value: string) => Number.parseFloat(value) || 0;

function lineHeightOf(style: CSSStyleDeclaration): number {
  const value = px(style.lineHeight);
  return value > 0 ? value : px(style.fontSize) * 1.2;
}

/** Only plain prose in left-aligned, normally spaced paragraphs can be reflowed faithfully. */
function canReflow(block: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (block.tagName !== "P") return false;
  if (!["start", "left"].includes(style.textAlign)) return false;
  if (style.letterSpacing !== "normal" && px(style.letterSpacing) !== 0) return false;
  if (style.wordSpacing !== "normal" && px(style.wordSpacing) !== 0) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!INLINE_TAGS.has((node as Element).tagName)) return false;
  }
  return true;
}

export function openSpread(options: SpreadOptions): SpreadHandle {
  const { view, scroller } = options;
  const $from = view.state.doc.resolve(options.from);
  const blockPos = $from.before();
  const blockEnd = blockPos + $from.parent.nodeSize;
  const block = view.nodeDOM(blockPos) as HTMLElement | null;
  if (!block) throw new Error("The paragraph is not on screen.");

  const scrollerRect = scroller.getBoundingClientRect();
  const toContentX = (clientX: number) => clientX - scrollerRect.left + scroller.scrollLeft;
  const toContentY = (clientY: number) => clientY - scrollerRect.top + scroller.scrollTop;

  const blockStyle = getComputedStyle(block);
  const lineHeight = lineHeightOf(blockStyle);
  const blockRect = block.getBoundingClientRect();
  const columnLeft = toContentX(blockRect.left) + px(blockStyle.paddingLeft) + px(blockStyle.borderLeftWidth);
  const columnWidth = block.clientWidth - px(blockStyle.paddingLeft) - px(blockStyle.paddingRight);
  const blockBottom = toContentY(blockRect.bottom);
  const startCoords = view.coordsAtPos(options.from, 1);
  const endCoords = view.coordsAtPos(options.to, -1);
  const targetTop = toContentY(startCoords.top);
  const targetCenterX = (toContentX(startCoords.left) + toContentX(endCoords.right)) / 2;

  const layer = document.createElement("div");
  layer.className = "text-motion-layer";
  layer.setAttribute("aria-hidden", "true");
  const opening = document.createElement("div");
  opening.className = "text-motion-opening";

  const units: Unit[] = [];
  let openingTop = blockBottom;
  let openingLeft = columnLeft;
  let openingWidth = Math.min(OPENING_MAX_WIDTH, columnWidth);
  let extraHeight = 0;
  let reflowed = false;

  if (canReflow(block, blockStyle)) {
    // ── Origins: every word where the browser drew it ──────────────
    // WebKit snaps text rects to whole pixels, so the rects only find each
    // word's line. Exact positions come from layout arithmetic instead: line
    // boxes stack at the paragraph's line height, and x advances along a line
    // by canvas widths — the same measurements Pretext uses for destinations.
    interface Measured { node: Text; start: number; text: string; x: number; line: number; style: CSSStyleDeclaration }
    const contentTop = toContentY(blockRect.top) + px(blockStyle.paddingTop) + px(blockStyle.borderTopWidth);
    const lineTop = (line: number) => contentTop + line * lineHeight;
    const lineAt = (top: number, bottom: number) => Math.max(0, Math.round(((top + bottom) / 2 - contentTop - lineHeight / 2) / lineHeight));
    const nodes: Text[] = [];
    const fonts = new Map<Text, string>();
    const measured: Measured[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const style = getComputedStyle(node.parentElement!);
      nodes.push(node);
      fonts.set(node, canvasFont(style));
      for (const match of node.data.matchAll(/\S+/g)) {
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const rect = Array.from(range.getClientRects()).find(r => r.width > 0);
        if (rect) measured.push({ node, start: match.index, text: match[0], x: toContentX(rect.left),
          line: lineAt(toContentY(rect.top), toContentY(rect.bottom)), style });
      }
    }
    const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
    const advance = (a: Measured, b: Measured) => {
      let width = 0;
      for (let i = nodeIndex.get(a.node)!; i <= nodeIndex.get(b.node)!; i++) {
        const node = nodes[i];
        const from = node === a.node ? a.start : 0;
        const to = node === b.node ? b.start : node.data.length;
        if (to > from) width += canvasMeasure(node.data.slice(from, to), fonts.get(node)!);
      }
      return width;
    };
    measured.forEach((word, index) => {
      const snapped = word.x;
      const previous = measured[index - 1];
      const exact = previous?.line === word.line ? previous.x + advance(previous, word)
        : Math.abs(snapped - columnLeft) < 1.5 ? columnLeft : snapped;
      // Trust the arithmetic only while it agrees with where the browser drew the word.
      word.x = Math.abs(exact - snapped) <= 1.5 ? exact : snapped;
    });
    const lastLine = measured.reduce((max, word) => Math.max(max, word.line), 0);
    const targetLine = lineAt(toContentY(startCoords.top), toContentY(startCoords.bottom));

    // ── Destinations: the remaining lines, parted around the opening ──
    const firstMoving = measured.findIndex(word => word.line > targetLine);
    const flowTop = lineTop(targetLine + 1);
    const runs: FlowRun[] = [];
    const runWords: Measured[][] = [];
    if (firstMoving >= 0) {
      let current: Text | null = null;
      for (const word of measured.slice(firstMoving)) {
        if (word.node !== current) {
          current = word.node;
          const start = runs.length === 0 ? word.start : 0;
          runs.push({ text: word.node.data.slice(start), font: fonts.get(word.node)! });
          runWords.push([]);
        }
        runWords[runWords.length - 1].push(word);
      }
    }
    openingWidth = Math.min(OPENING_MAX_WIDTH, columnWidth * 0.72);
    const openingX = Math.max(0, Math.min(columnWidth - openingWidth, targetCenterX - columnLeft - openingWidth / 2));
    const rows = Math.max(OPENING_MIN_ROWS, Math.ceil((OPENING_CONTENT_HEIGHT + 16) / lineHeight));
    const flow = flowAroundOpening(runs, columnWidth, { left: openingX, right: openingX + openingWidth, top: 0, rows },
      px(blockStyle.fontSize) * 4);

    // Pair Pretext's words with the measured ones, run by run, in order.
    const placed = new Map<Measured, { x: number; y: number }>();
    let faithful = true;
    for (let run = 0; run < runWords.length && faithful; run++) {
      const laid = flow.words.filter(word => word.run === run);
      if (laid.length !== runWords[run].length) { faithful = false; break; }
      laid.forEach((word, index) => {
        const origin = runWords[run][index];
        if (word.text !== origin.text) { faithful = false; return; }
        placed.set(origin, { x: columnLeft + word.x, y: flowTop + word.row * lineHeight });
      });
    }

    if (faithful) {
      reflowed = true;
      openingTop = flowTop;
      openingLeft = columnLeft + openingX;
      extraHeight = Math.max(0, flowTop + flow.rows * lineHeight - lineTop(lastLine + 1));
      const targetLeft = toContentX(startCoords.left) - 1;
      const targetRight = toContentX(endCoords.right) + 1;
      for (const word of measured) {
        const el = document.createElement("span");
        el.className = "text-motion-word";
        el.textContent = word.text;
        const s = word.style;
        const originY = lineTop(word.line);
        Object.assign(el.style, {
          left: `${word.x}px`, top: `${originY}px`, font: canvasFont(s), color: s.color,
          // The paragraph's own line box, so each glyph sits exactly where the paragraph put it.
          lineHeight: `${lineHeight}px`,
          textDecoration: s.textDecorationLine === "none" ? "" : `${s.textDecorationLine} ${s.textDecorationColor}`,
          backgroundColor: s.backgroundColor,
        });
        const dest = placed.get(word);
        const dx = dest ? dest.x - word.x : 0;
        const dy = dest ? dest.y - originY : 0;
        const distance = Math.hypot(word.x - targetCenterX, originY - targetTop);
        const isTarget = word.line === targetLine && word.x >= targetLeft && word.x < targetRight;
        if (isTarget) el.classList.add("is-target");
        units.push({ el, originX: word.x, originY, x: spring(0, dx), y: spring(0, dy),
          delay: Math.min(STAGGER_MAX_MS, distance * STAGGER_PX_MS), target: isTarget });
        layer.appendChild(el);
      }
    }
  }

  if (!reflowed) {
    // Rigid fallback: open a full-width space directly below the block.
    openingTop = blockBottom + lineHeight * 0.5;
    openingLeft = columnLeft + Math.max(0, (columnWidth - openingWidth) / 2);
    extraHeight = Math.max(OPENING_MIN_ROWS * lineHeight, OPENING_CONTENT_HEIGHT + lineHeight);
  }

  Object.assign(opening.style, {
    left: `${openingLeft}px`, top: `${openingTop}px`, width: `${openingWidth}px`,
    height: `${Math.max(OPENING_MIN_ROWS, Math.ceil((OPENING_CONTENT_HEIGHT + 16) / lineHeight)) * lineHeight}px`,
  });
  layer.appendChild(opening);
  scroller.appendChild(layer);

  // ── Spacer: later blocks slide down with ordinary layout ──────────
  const spacer = document.createElement("div");
  spacer.className = "text-motion-spacer";
  spacer.contentEditable = "false";
  const next = block.nextElementSibling;
  const collapsedMargin = Math.min(px(blockStyle.marginBottom), next ? px(getComputedStyle(next).marginTop) : 0);
  const height = spring(0, extraHeight);
  const setSpacer = (value: number) => {
    const h = Math.max(0, value);
    spacer.style.height = `${h}px`;
    // A spacer with height stops the neighbours' margins from collapsing;
    // cancel the difference so the motion starts and ends without a jump.
    spacer.style.marginBottom = h > 0 ? `${-collapsedMargin}px` : "0px";
  };
  setSpacer(0);

  const decorations = [Decoration.widget(blockEnd, spacer, { side: -1, ignoreSelection: true, key: "text-motion-spacer" })];
  if (reflowed) decorations.push(Decoration.node(blockPos, blockEnd, { class: "text-motion-ghost" }));
  options.setDecorations(DecorationSet.create(view.state.doc, decorations));

  const disposeOpening = options.renderOpening(opening);

  // ── Animation ──────────────────────────────────────────────────────
  let phase: "opening" | "open" | "closing" | "closed" = "opening";
  let frame = 0;
  let last = 0;
  let started = 0;
  const stats = { frames: 0, maxFrameMs: 0, words: units.length, reflowed };

  function apply(unit: Unit) {
    const tilt = options.reducedMotion ? 0 : Math.max(-14, Math.min(14, unit.x.velocity * 0.012));
    unit.el.style.transform = unit.x.value || unit.y.value || tilt
      ? `translate(${unit.x.value}px, ${unit.y.value}px) rotate(${tilt}deg)` : "";
  }

  function settleAll() {
    for (const unit of units) {
      unit.x.value = unit.x.target; unit.x.velocity = 0;
      unit.y.value = unit.y.target; unit.y.velocity = 0;
      apply(unit);
    }
    height.value = height.target; height.velocity = 0;
    setSpacer(height.value);
  }

  function tick(now: number) {
    frame = 0;
    const dt = last ? (now - last) / 1000 : 1 / 60;
    if (last) { stats.frames++; stats.maxFrameMs = Math.max(stats.maxFrameMs, now - last); }
    last = now;
    const elapsed = now - started;
    const config: SpringConfig = phase === "closing" ? SETTLE : LIVELY;
    let moving = false;
    for (const unit of units) {
      if (elapsed < unit.delay) { moving = true; continue; }
      stepSpring(unit.x, dt, config);
      stepSpring(unit.y, dt, config);
      apply(unit);
      if (!isSettled(unit.x) || !isSettled(unit.y)) moving = true;
    }
    stepSpring(height, dt, config);
    setSpacer(height.value);
    if (!isSettled(height)) moving = true;
    if (moving) { frame = requestAnimationFrame(tick); return; }
    if (phase === "opening") {
      phase = "open";
      (window as unknown as { __textMotion?: unknown }).__textMotion = stats;
      console.info("[text-motion]", JSON.stringify(stats));
    } else if (phase === "closing") finish();
  }

  function run() {
    cancelAnimationFrame(frame);
    last = 0;
    started = performance.now();
    if (options.reducedMotion) {
      settleAll();
      if (phase === "opening") phase = "open"; else if (phase === "closing") finish();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function finish(immediate = false) {
    if (phase === "closed") return;
    phase = "closed";
    cancelAnimationFrame(frame);
    disposeOpening();
    // Reveal the real text first; drop the identical layer on the next frame.
    options.setDecorations(DecorationSet.empty);
    if (immediate) { layer.remove(); options.onClosed(); return; }
    requestAnimationFrame(() => { layer.remove(); options.onClosed(); });
  }

  requestAnimationFrame(() => opening.classList.add("is-visible"));
  run();

  return {
    get closing() { return phase === "closing" || phase === "closed"; },
    dispose() { setSpacer(0); finish(true); },
    close({ changed = false } = {}) {
      if (phase === "closing" || phase === "closed") return;
      opening.classList.remove("is-visible");
      if (changed) {
        // The words no longer match the document; fade the layer over the real text.
        phase = "closing";
        layer.classList.add("is-leaving");
        cancelAnimationFrame(frame);
        setSpacer(0);
        options.setDecorations(DecorationSet.empty);
        setTimeout(() => { if (phase === "closing") finish(); }, 140);
        return;
      }
      phase = "closing";
      for (const unit of units) {
        unit.x.target = 0; unit.y.target = 0;
        unit.delay = Math.max(0, STAGGER_MAX_MS * 0.5 - unit.delay * 0.5);
      }
      height.target = 0;
      run();
    },
  };
}
