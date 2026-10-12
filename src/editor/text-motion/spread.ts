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
 * While open, the opening can be reshaped (the words retarget mid-flight) and
 * the target word's letters can fly out of the line to spell a headword — the
 * Define action uses both.
 *
 * Paragraphs Pretext cannot reproduce (headings, letter-spaced or justified
 * text, inline images or hard breaks) still open — the opening appears below
 * the block and later blocks slide down, but no words move.
 */

import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { canvasMeasure, flowAroundOpening, type FlowRun } from "./flow";
import { graphemes, matchLetters } from "./letters";
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
  /** The widest the opening may grow: the paragraph's column. */
  readonly maxWidth: number;
  /** The paragraph's line height; the opening is sized in whole lines. */
  readonly lineHeight: number;
  /** The target word's font when its letters can take flight (one word in one run), otherwise null. */
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

interface Unit {
  el: HTMLSpanElement;
  word: Measured | null;
  originY: number;
  x: Spring; y: Spring;
  delay: number;
}

interface Letter {
  el: HTMLSpanElement;
  /** Translation that lands the letter on its headword slot, and the burst it passes through. */
  dest: { x: number; y: number }; burst: { x: number; y: number };
  x: Spring; y: Spring; scale: Spring;
  kind: "flying" | "fading" | "arriving";
  text: string; headText: string;
  gatherAt: number; gathered: boolean;
}

interface Measured { node: Text; start: number; text: string; x: number; line: number; style: CSSStyleDeclaration }

const INLINE_TAGS = new Set(["STRONG", "EM", "B", "I", "A", "CODE", "S", "DEL", "U", "SPAN", "MARK", "SUB", "SUP"]);
const OPENING_MIN_ROWS = 3;
const OPENING_CONTENT_HEIGHT = 66; // two rows of action buttons
const OPENING_MAX_WIDTH = 360;
const STAGGER_PX_MS = 0.32;
const STAGGER_MAX_MS = 240;
const LETTER_GATHER_MS = 150;
const LETTER_STAGGER_MS = 16;

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
  const rows = Math.max(OPENING_MIN_ROWS, Math.ceil((OPENING_CONTENT_HEIGHT + 16) / lineHeight));
  let rect: OpeningRect = { left: 0, top: 0, width: Math.min(OPENING_MAX_WIDTH, columnWidth), height: rows * lineHeight };
  let extraHeight = 0;
  let reflowed = false;
  let repart: ((width: number, rows: number) => { dest: Map<Measured, { x: number; y: number }>; rect: OpeningRect; extra: number } | null) | null = null;
  let flyable: { unit: Unit; word: Measured; offset: number; text: string; font: string } | null = null;
  const letters: Letter[] = [];

  if (canReflow(block, blockStyle)) {
    // ── Origins: every word where the browser drew it ──────────────
    // WebKit snaps text rects to whole pixels, so the rects only find each
    // word's line. Exact positions come from layout arithmetic instead: line
    // boxes stack at the paragraph's line height, and x advances along a line
    // by canvas widths — the same measurements Pretext uses for destinations.
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
    const minSpan = px(blockStyle.fontSize) * 4;
    const partAround = (width: number, count: number) => {
      const openingX = Math.max(0, Math.min(columnWidth - width, targetCenterX - columnLeft - width / 2));
      const flow = flowAroundOpening(runs, columnWidth, { left: openingX, right: openingX + width, top: 0, rows: count }, minSpan);
      // Pair Pretext's words with the measured ones, run by run, in order.
      const dest = new Map<Measured, { x: number; y: number }>();
      for (let run = 0; run < runWords.length; run++) {
        const laid = flow.words.filter(word => word.run === run);
        if (laid.length !== runWords[run].length) return null;
        for (let index = 0; index < laid.length; index++) {
          const origin = runWords[run][index];
          if (laid[index].text !== origin.text) return null;
          dest.set(origin, { x: columnLeft + laid[index].x, y: flowTop + laid[index].row * lineHeight });
        }
      }
      return {
        dest,
        rect: { left: columnLeft + openingX, top: flowTop, width, height: count * lineHeight },
        extra: Math.max(0, flowTop + flow.rows * lineHeight - lineTop(lastLine + 1)),
      };
    };
    const parted = partAround(Math.min(OPENING_MAX_WIDTH, columnWidth * 0.72), rows);

    if (parted) {
      reflowed = true;
      repart = partAround;
      rect = parted.rect;
      extraHeight = parted.extra;
      const targetLeft = toContentX(startCoords.left) - 1;
      const targetRight = toContentX(endCoords.right) + 1;
      const targets: Unit[] = [];
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
        const to = parted.dest.get(word);
        const distance = Math.hypot(word.x - targetCenterX, originY - targetTop);
        const unit: Unit = { el, word, originY, x: spring(0, to ? to.x - word.x : 0), y: spring(0, to ? to.y - originY : 0),
          delay: Math.min(STAGGER_MAX_MS, distance * STAGGER_PX_MS) };
        if (word.line === targetLine && word.x >= targetLeft && word.x < targetRight) {
          el.classList.add("is-target");
          targets.push(unit);
        }
        units.push(unit);
        layer.appendChild(el);
      }

      // Letters can fly when the target is one word inside one measured word
      // (punctuation beside it stays in the line).
      const text = view.state.doc.textBetween(options.from, options.to);
      const token = targets.length === 1 ? targets[0].word! : null;
      if (token && text.trim() === text && text) {
        const font = canvasFont(token.style);
        const startX = toContentX(startCoords.left);
        // The occurrence of the text inside the word that starts where the target does.
        let best = -1, bestDistance = Infinity;
        for (let at = token.text.indexOf(text); at >= 0; at = token.text.indexOf(text, at + 1)) {
          const distance = Math.abs(token.x + canvasMeasure(token.text.slice(0, at), font) - startX);
          if (distance < bestDistance) { best = at; bestDistance = distance; }
        }
        if (best >= 0) flyable = { unit: targets[0], word: token, offset: best, text, font };
      }
    }
  }

  if (!reflowed) {
    // Rigid fallback: open a space directly below the block.
    rect = { ...rect, left: columnLeft + Math.max(0, (columnWidth - rect.width) / 2), top: blockBottom + lineHeight * 0.5 };
    extraHeight = rect.height + lineHeight;
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
  let flownScale = 1;
  const stats = { frames: 0, maxFrameMs: 0, words: units.length, reflowed };

  function apply(unit: Unit) {
    const tilt = options.reducedMotion ? 0 : Math.max(-14, Math.min(14, unit.x.velocity * 0.012));
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
      (window as unknown as { __textMotion?: unknown }).__textMotion = { ...stats };
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

  /** Run the opening motion again from where everything is now, e.g. after a reshape. */
  function restart() {
    if (phase === "closing" || phase === "closed") return;
    phase = "opening";
    stats.frames = 0; stats.maxFrameMs = 0;
    run();
  }

  requestAnimationFrame(() => opening.classList.add("is-visible"));
  run();

  return {
    get closing() { return phase === "closing" || phase === "closed"; },
    dispose() { setSpacer(0); finish(true); },
    maxWidth: columnWidth,
    lineHeight,

    targetWord() {
      return flyable ? { font: flyable.font, fontSize: px(flyable.word.style.fontSize) } : null;
    },

    reshape({ width, rows: count }) {
      if (phase === "closing" || phase === "closed") return { ...rect };
      width = Math.min(width, columnWidth);
      count = Math.max(OPENING_MIN_ROWS, count);
      if (repart) {
        // Keep the current opening if Pretext cannot part the text faithfully at the new size.
        const parted = repart(width, count);
        if (!parted) return { ...rect };
        rect = parted.rect;
        height.target = parted.extra;
        for (const unit of units) {
          const to = unit.word && parted.dest.get(unit.word);
          unit.x.target = to ? to.x - unit.word!.x : 0;
          unit.y.target = to ? to.y - unit.originY : 0;
          unit.delay = 0;
        }
      } else {
        rect = { left: columnLeft + Math.max(0, (columnWidth - width) / 2), top: rect.top, width, height: count * lineHeight };
        height.target = rect.height + lineHeight;
      }
      placeOpening();
      restart();
      return { ...rect };
    },

    flyLettersTo(headword, at, scale) {
      if (!flyable || letters.length || phase === "closing" || phase === "closed") return null;
      const { unit, word, offset, text, font } = flyable;
      // The word leaves; anything beside it (punctuation) stays drawn in the line.
      const hidden = document.createElement("span");
      hidden.style.visibility = "hidden";
      hidden.textContent = text;
      unit.el.replaceChildren(word.text.slice(0, offset), hidden, word.text.slice(offset + text.length));

      flownScale = scale;
      const own = graphemes(text);
      const head = graphemes(headword);
      const matched = matchLetters(own, head);
      const slot = (j: number) => at.x + canvasMeasure(head.slice(0, j).join(""), font) * scale;
      const make = (value: string, left: number, top: number) => {
        const el = document.createElement("span");
        el.className = "text-motion-letter";
        el.textContent = value;
        Object.assign(el.style, { left: `${left}px`, top: `${top}px`, font, lineHeight: `${lineHeight}px` });
        layer.appendChild(el);
        return el;
      };
      const wordLeft = word.x + canvasMeasure(word.text.slice(0, offset), font);
      let previous = -1;
      own.forEach((value, i) => {
        const homeX = wordLeft + canvasMeasure(own.slice(0, i).join(""), font);
        const j = matched[i];
        // An unmatched letter heads for the gap where it would have been, fading as it goes.
        const dest = { x: slot(j >= 0 ? j : previous + 1) - homeX, y: at.y - unit.originY };
        if (j >= 0) previous = j;
        const spread = i - (own.length - 1) / 2;
        const burst = { x: spread * lineHeight * 0.35, y: -lineHeight * (0.8 + 0.25 * Math.sin(i * 2.1)) };
        const letter: Letter = {
          el: make(value, homeX, unit.originY), dest, burst,
          x: spring(0, burst.x), y: spring(0, burst.y), scale: spring(1),
          kind: j >= 0 ? "flying" : "fading", text: value, headText: j >= 0 ? head[j] : value,
          gatherAt: LETTER_GATHER_MS + i * LETTER_STAGGER_MS, gathered: false,
        };
        letters.push(letter);
        applyLetter(letter);
      });
      // Headword letters the word lacks appear in place once the others arrive.
      const taken = new Set(matched);
      head.forEach((value, j) => {
        if (taken.has(j)) return;
        const el = make(value, slot(j), at.y);
        el.classList.add("is-arriving");
        el.style.animationDelay = `${LETTER_GATHER_MS + own.length * LETTER_STAGGER_MS + 200}ms`;
        const letter: Letter = {
          el, dest: { x: 0, y: 0 }, burst: { x: 0, y: 0 }, x: spring(0), y: spring(0), scale: spring(scale),
          kind: "arriving", text: value, headText: value, gatherAt: 0, gathered: true,
        };
        letters.push(letter);
        applyLetter(letter);
      });
      restart();
      return { height: lineHeight * scale };
    },

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
      for (const letter of letters) {
        // Letters fly home; the ones that faded return, the ones that appeared leave.
        letter.gathered = true;
        letter.x.target = 0; letter.y.target = 0;
        if (letter.kind === "arriving") letter.el.classList.add("is-departing");
        else { letter.scale.target = 1; letter.el.classList.remove("is-fading"); letter.el.textContent = letter.text; }
      }
      height.target = 0;
      run();
    },
  };
}
