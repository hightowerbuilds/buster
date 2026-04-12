import { TOUR_STEPS } from "./tourSteps";
import type { createMatrixRain } from "./tour-matrix-rain";
import { measureTextWidth } from "../editor/text-measure";

export interface SlideState {
  subtitleProgress: number;
  hintProgress: number;
  indicatorAlpha: number;
  navHintAlpha: number;
}

// Module-level state for blog scroll (persists across frames)
let blogScrollOffset = 0;
let blogInitialized = false;

export function renderSettledSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  currentStep: number,
  w: number,
  h: number,
  time: number,
  matrixRain?: ReturnType<typeof createMatrixRain>
) {
  const step = TOUR_STEPS[currentStep];
  if (!step) return;

  const isBuster = step.title === "BUSTER";
  const subY = isBuster ? (h - 320) * 0.35 + 320 + 30 : h * 0.25 + 110;

  if (step.special === "terminal") {
    renderTerminalSlide(ctx, state, step, w, h, subY, matrixRain);
  } else if (step.special === "blog") {
    renderBlogSlide(ctx, state, w, h, subY);
  } else if (step.special === "layouts") {
    renderLayoutsSlide(ctx, state, step, w, h, subY);
  } else if (step.special === "shortcuts") {
    renderShortcutsSlide(ctx, state, step, w, subY);
  } else if (step.special === "extensions") {
    renderExtensionsSlide(ctx, state, step, w, subY);
  } else if (step.special === "git") {
    renderGitSlide(ctx, state, step, w, subY);
  } else if (step.special === "ai") {
    renderAiSlide(ctx, state, step, w, subY);
  } else {
    renderStandardSlide(ctx, state, step, w, subY, time);
  }

  renderIndicator(ctx, state, currentStep, step, w, h);
}

function renderStandardSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  step: (typeof TOUR_STEPS)[number],
  w: number,
  subY: number,
  time: number
) {
  state.subtitleProgress = Math.min(state.subtitleProgress + 0.4, step.subtitle.length);
  const subText = step.subtitle.slice(0, Math.floor(state.subtitleProgress));

  ctx.font = '16px "Courier New", Courier, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(166, 173, 200, ${Math.min(1, state.subtitleProgress * 0.1)})`;
  ctx.fillText(subText, w / 2, subY);

  // Typewriter cursor
  if (state.subtitleProgress < step.subtitle.length || Math.floor(time / 30) % 2 === 0) {
    const cursorX = w / 2 + measureTextWidth(subText, '16px "Courier New", Courier, monospace') / 2 + 2;
    ctx.fillStyle = `rgba(196, 206, 212, ${state.subtitleProgress < step.subtitle.length ? 1 : 0.6})`;
    ctx.fillRect(cursorX, subY, 2, 16);
  }

  // Hint
  if (state.subtitleProgress >= step.subtitle.length) {
    state.hintProgress = Math.min(state.hintProgress + 0.025, 1);
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(196, 206, 212, ${state.hintProgress * 0.9})`;
    ctx.textAlign = "center";
    ctx.fillText(step.hint, w / 2, subY + 35);
  }
}

function renderTerminalSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  step: (typeof TOUR_STEPS)[number],
  w: number,
  h: number,
  subY: number,
  matrixRain?: ReturnType<typeof createMatrixRain>
) {
  state.subtitleProgress = Math.min(state.subtitleProgress + 0.3, step.subtitle.length);
  state.hintProgress = Math.min(state.hintProgress + 0.015, 1);

  // Full-screen Matrix rain
  if (matrixRain) {
    // Lazy init on first settled frame
    if (state.hintProgress < 0.02) {
      matrixRain.init(w, h);
    }
    matrixRain.render(ctx, w, h, 0);
  }

  // Subtitle + hint over the rain
  const promptY = subY + 20;

  // Dark backing strip for legibility
  const stripAlpha = Math.min(0.6, state.subtitleProgress * 0.05);
  ctx.fillStyle = `rgba(30, 30, 46, ${stripAlpha})`;
  ctx.fillRect(0, promptY - 8, w, 60);

  ctx.font = '16px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const typed = step.subtitle.slice(0, Math.floor(state.subtitleProgress));
  ctx.fillStyle = `rgba(166, 227, 161, ${Math.min(1, state.subtitleProgress * 0.08)})`;
  ctx.fillText("$ " + typed, w / 2, promptY);

  if (state.subtitleProgress >= step.subtitle.length) {
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(196, 206, 212, ${state.hintProgress * 0.9})`;
    ctx.textAlign = "center";
    ctx.fillText(step.hint, w / 2, promptY + 30);
  }
}

// ── Blog Mode slide ─────────────────────────────────────────────

interface BlogLine {
  text: string;
  type: "h1" | "h2" | "body" | "code" | "rule" | "bullet" | "emphasis" | "blank";
}

const BLOG_CONTENT: BlogLine[] = [
  { text: "# Building a Canvas IDE", type: "h1" },
  { text: "", type: "blank" },
  { text: "Every pixel on this screen is drawn", type: "body" },
  { text: "by JavaScript on a <canvas> element.", type: "body" },
  { text: "No DOM nodes. No innerHTML. Just paint.", type: "body" },
  { text: "", type: "blank" },
  { text: "---", type: "rule" },
  { text: "", type: "blank" },
  { text: "## Why Canvas?", type: "h2" },
  { text: "", type: "blank" },
  { text: "The DOM was designed for documents.", type: "body" },
  { text: "Code editors need something faster.", type: "body" },
  { text: "", type: "blank" },
  { text: "- No layout thrashing", type: "bullet" },
  { text: "- Direct GPU compositing", type: "bullet" },
  { text: "- 60fps with 10,000 lines", type: "bullet" },
  { text: "- Sub-pixel text positioning", type: "bullet" },
  { text: "", type: "blank" },
  { text: "## Code Blocks", type: "h2" },
  { text: "", type: "blank" },
  { text: "  fn main() {", type: "code" },
  { text: "      let ctx = canvas.context();", type: "code" },
  { text: '      ctx.fill_text("hello");', type: "code" },
  { text: "  }", type: "code" },
  { text: "", type: "blank" },
  { text: "## The Stack", type: "h2" },
  { text: "", type: "blank" },
  { text: "  Tauri .... native shell", type: "code" },
  { text: "  Rust ..... tree-sitter, pty, git", type: "code" },
  { text: "  Solid .... reactive UI", type: "code" },
  { text: "  Canvas ... every pixel", type: "code" },
  { text: "", type: "blank" },
  { text: "---", type: "rule" },
  { text: "", type: "blank" },
  { text: "## Blog Mode", type: "h2" },
  { text: "", type: "blank" },
  { text: "Open any .md file and toggle reader", type: "body" },
  { text: "view. Markdown becomes a clean,", type: "body" },
  { text: "typeset article. No export needed.", type: "body" },
  { text: "", type: "blank" },
  { text: "- Headings, lists, blockquotes", type: "bullet" },
  { text: "- Syntax-highlighted code fences", type: "bullet" },
  { text: "- Inline images on canvas", type: "bullet" },
  { text: "- Smooth scroll at 60fps", type: "bullet" },
  { text: "", type: "blank" },
  { text: "---", type: "rule" },
  { text: "", type: "blank" },
  { text: "Write code. Write prose. Ship both.", type: "emphasis" },
  { text: "", type: "blank" },
  { text: "", type: "blank" },
  { text: "", type: "blank" },
];

const BLOG_LINE_H = 20;
const BLOG_TOTAL_H = BLOG_CONTENT.length * BLOG_LINE_H;

function renderBlogSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  w: number,
  h: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.015, 1);
  const alpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbDark = [48, 98, 48];
  const gbBg = [15, 56, 15];

  // Panel dimensions
  const paneW = Math.min(480, w * 0.55);
  const paneH = Math.min(380, h * 0.52);
  const paneX = (w - paneW) / 2;
  const paneY = subY - 10;

  // Panel background
  ctx.fillStyle = `rgba(${gbBg[0]}, ${gbBg[1]}, ${gbBg[2]}, ${alpha * 0.5})`;
  ctx.fillRect(paneX, paneY, paneW, paneH);

  // Border
  ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${alpha * 0.4})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(paneX, paneY, paneW, paneH);

  // Scan lines
  for (let sl = 0; sl < paneH; sl += 3) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.04})`;
    ctx.fillRect(paneX, paneY + sl, paneW, 1);
  }

  // Caret
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${alpha * 0.7})`;
  ctx.fillText(">", paneX + 6, paneY + 5);

  // Title bar
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${alpha * 0.6})`;
  ctx.fillText("README.md  [blog mode]", paneX + 20, paneY + 5);

  // Divider below title
  ctx.strokeStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${alpha * 0.3})`;
  ctx.beginPath();
  ctx.moveTo(paneX + 4, paneY + 20);
  ctx.lineTo(paneX + paneW - 4, paneY + 20);
  ctx.stroke();

  // Scrolling content area
  const contentY = paneY + 24;
  const contentH = paneH - 28;
  const contentPad = 16;

  // Initialize / advance scroll
  if (!blogInitialized) {
    blogScrollOffset = 0;
    blogInitialized = true;
  }
  blogScrollOffset += 0.4;
  if (blogScrollOffset > BLOG_TOTAL_H) {
    blogScrollOffset = 0;
  }

  // Clip to content area
  ctx.save();
  ctx.beginPath();
  ctx.rect(paneX, contentY, paneW, contentH);
  ctx.clip();

  ctx.font = '13px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Draw lines (render two copies for seamless wrap)
  for (let pass = 0; pass < 2; pass++) {
    const baseOffset = pass * BLOG_TOTAL_H;
    for (let i = 0; i < BLOG_CONTENT.length; i++) {
      const line = BLOG_CONTENT[i];
      const lineY = contentY + baseOffset + i * BLOG_LINE_H - blogScrollOffset;

      // Skip lines outside visible area
      if (lineY < contentY - BLOG_LINE_H || lineY > contentY + contentH) continue;

      // Fade at edges
      let edgeFade = 1;
      const distFromTop = lineY - contentY;
      const distFromBottom = (contentY + contentH) - lineY;
      if (distFromTop < 30) edgeFade = Math.max(0, distFromTop / 30);
      if (distFromBottom < 30) edgeFade = Math.min(edgeFade, Math.max(0, distFromBottom / 30));

      const lineAlpha = alpha * edgeFade;
      if (lineAlpha < 0.01) continue;

      const lx = paneX + contentPad;

      switch (line.type) {
        case "h1":
          ctx.font = '15px "JetBrains Mono", monospace';
          ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * 0.95})`;
          ctx.fillText(line.text, lx, lineY);
          ctx.font = '13px "JetBrains Mono", monospace';
          break;
        case "h2":
          ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * 0.9})`;
          ctx.fillText(line.text, lx, lineY);
          break;
        case "body":
          ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${lineAlpha * 0.75})`;
          ctx.fillText(line.text, lx, lineY);
          break;
        case "code": {
          // Faint background rect for code
          const codeW = paneW - contentPad * 2;
          ctx.fillStyle = `rgba(0, 0, 0, ${lineAlpha * 0.15})`;
          ctx.fillRect(lx - 4, lineY - 2, codeW + 8, BLOG_LINE_H);
          ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * 0.7})`;
          ctx.fillText(line.text, lx, lineY);
          break;
        }
        case "rule":
          ctx.strokeStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${lineAlpha * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(lx, lineY + BLOG_LINE_H / 2);
          ctx.lineTo(paneX + paneW - contentPad, lineY + BLOG_LINE_H / 2);
          ctx.stroke();
          break;
        case "bullet":
          ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * 0.8})`;
          ctx.fillText("\u2022", lx, lineY);
          ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${lineAlpha * 0.75})`;
          ctx.fillText(line.text.slice(2), lx + 14, lineY);
          break;
        case "emphasis":
          ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${lineAlpha * 0.6})`;
          ctx.fillText(line.text, lx, lineY);
          break;
        case "blank":
          break;
      }
    }
  }

  ctx.restore();

  // Scrollbar
  const scrollFrac = blogScrollOffset / BLOG_TOTAL_H;
  const thumbH = Math.max(20, (contentH / BLOG_TOTAL_H) * contentH);
  const thumbY = contentY + scrollFrac * (contentH - thumbH);
  ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${alpha * 0.4})`;
  ctx.fillRect(paneX + paneW - 6, thumbY, 3, thumbH);

  // Subtitle below panel
  if (state.hintProgress > 0.5) {
    const subAlpha = (state.hintProgress - 0.5) * 2;
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${Math.min(1, subAlpha) * 0.8})`;
    ctx.fillText("your markdown, rendered for reading. no export needed.", w / 2, paneY + paneH + 20);

    ctx.font = '14px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${Math.min(1, subAlpha) * 0.6})`;
    ctx.fillText("headings  |  code fences  |  lists  |  images", w / 2, paneY + paneH + 46);
  }
}

// Reset blog scroll when leaving slide
export function resetBlogState() {
  blogScrollOffset = 0;
  blogInitialized = false;
}

function renderLayoutsSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  step: (typeof TOUR_STEPS)[number],
  w: number,
  h: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.02, 1);
  const layoutAlpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbBg = [15, 56, 15];

  const boxH = Math.min(260, h * 0.42);
  const boxW = Math.min(320, w * 0.28);
  const gap = Math.min(30, w * 0.025);
  const totalLayoutW = boxW * 3 + gap * 2;
  const startX = (w - totalLayoutW) / 2;
  const layoutY = subY - 10;
  const charSize = 12;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  function drawGBPanel(px: number, py: number, pw: number, ph: number) {
    ctx.fillStyle = `rgba(${gbBg[0]}, ${gbBg[1]}, ${gbBg[2]}, ${layoutAlpha * 0.4})`;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${layoutAlpha * 0.4})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);
    ctx.font = `${charSize}px "JetBrains Mono", monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${layoutAlpha * 0.7})`;
    ctx.fillText(">", px + 6, py + 5);
    for (let sl = 0; sl < ph; sl += 3) {
      ctx.fillStyle = `rgba(0, 0, 0, ${layoutAlpha * 0.04})`;
      ctx.fillRect(px, py + sl, pw, 1);
    }
  }

  // g2
  const columnGap = 6;
  const colPanelW = (boxW - columnGap) / 2;
  drawGBPanel(startX, layoutY, colPanelW, boxH);
  drawGBPanel(startX + colPanelW + columnGap, layoutY, colPanelW, boxH);
  ctx.font = '16px "Courier New", Courier, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${layoutAlpha * 0.8})`;
  ctx.fillText("g2", startX + boxW / 2, layoutY + boxH + 22);

  // Grid
  const gridX = startX + boxW + gap;
  const cellW = (boxW - 6) / 2;
  const cellH = (boxH - 6) / 2;
  drawGBPanel(gridX, layoutY, cellW, cellH);
  drawGBPanel(gridX + cellW + 6, layoutY, cellW, cellH);
  drawGBPanel(gridX, layoutY + cellH + 6, cellW, cellH);
  drawGBPanel(gridX + cellW + 6, layoutY + cellH + 6, cellW, cellH);
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${layoutAlpha * 0.8})`;
  ctx.fillText("g4", gridX + boxW / 2, layoutY + boxH + 22);

  // Trio
  const trioX = startX + (boxW + gap) * 2;
  const mainW = Math.floor(boxW * 0.6);
  const sideW = boxW - mainW - 4;
  const sideH = Math.floor((boxH - 4) / 2);
  drawGBPanel(trioX, layoutY, mainW, boxH);
  drawGBPanel(trioX + mainW + 4, layoutY, sideW, sideH);
  drawGBPanel(trioX + mainW + 4, layoutY + sideH + 4, sideW, sideH);
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${layoutAlpha * 0.8})`;
  ctx.fillText("g3", trioX + boxW / 2, layoutY + boxH + 22);

  // Hint
  if (state.hintProgress > 0.5) {
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${(state.hintProgress - 0.5) * 2 * 0.7})`;
    ctx.textAlign = "center";
    ctx.fillText(step.hint, w / 2, layoutY + boxH + 52);
  }
}

function renderShortcutsSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  _step: (typeof TOUR_STEPS)[number],
  w: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.02, 1);
  const alpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbDark = [48, 98, 48];
  const gbBg2 = [15, 56, 15];

  const shortcuts = [
    { combo: "cmd + S", action: "save" },
    { combo: "cmd + F", action: "find" },
    { combo: "cmd + O", action: "open" },
    { combo: "cmd + Z", action: "undo" },
    { combo: "ctrl + `", action: "terminal" },
    { combo: "cmd + ,", action: "settings" },
    { combo: "cmd + D", action: "add cursor" },
    { combo: "alt + click", action: "multi-cursor" },
    { combo: "ctrl + space", action: "autocomplete" },
    { combo: "F12", action: "go to def" },
    { combo: "cmd + click", action: "go to def" },
    { combo: "cmd + shift+G", action: "git panel" },
    { combo: "cmd + T", action: "new terminal" },
    { combo: "esc", action: "close" },
  ];

  const paneW = Math.min(500, w * 0.55);
  const rowH = 28;
  const paneH = shortcuts.length * rowH + 20;
  const paneX = (w - paneW) / 2;
  const paneY = subY - 10;

  ctx.fillStyle = `rgba(${gbBg2[0]}, ${gbBg2[1]}, ${gbBg2[2]}, ${alpha * 0.4})`;
  ctx.fillRect(paneX, paneY, paneW, paneH);
  ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${alpha * 0.4})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(paneX, paneY, paneW, paneH);

  for (let sl = 0; sl < paneH; sl += 3) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.04})`;
    ctx.fillRect(paneX, paneY + sl, paneW, 1);
  }

  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${alpha * 0.7})`;
  ctx.fillText(">", paneX + 6, paneY + 5);

  ctx.font = '14px "JetBrains Mono", monospace';
  for (let i = 0; i < shortcuts.length; i++) {
    const rowY = paneY + 10 + i * rowH;
    const sc = shortcuts[i];
    const rowAlpha = Math.min(1, Math.max(0, (state.hintProgress * 2 - i * 0.15)));
    if (rowAlpha <= 0) continue;

    if (i > 0) {
      ctx.strokeStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${rowAlpha * alpha * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(paneX + 12, rowY);
      ctx.lineTo(paneX + paneW - 12, rowY);
      ctx.stroke();
    }

    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${rowAlpha * alpha * 0.9})`;
    ctx.fillText(sc.combo, paneX + 20, rowY + 7);

    ctx.textAlign = "right";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${rowAlpha * alpha * 0.6})`;
    ctx.fillText(sc.action, paneX + paneW - 20, rowY + 7);
  }
}

function renderExtensionsSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  _step: (typeof TOUR_STEPS)[number],
  w: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.015, 1);
  const alpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbDark = [48, 98, 48];
  const gbBg = [15, 56, 15];

  // The code listing — extension.toml manifest
  const codeLines = [
    '# extension.toml',
    '',
    '[extension]',
    'id = "my-agent"',
    'name = "My Agent Gateway"',
    '',
    '[capabilities]',
    'network = true',
    'workspace_read = true',
    '',
    '[[commands]]',
    'id = "connect"',
    'label = "Connect Agent"',
  ];

  const paneW = Math.min(440, w * 0.5);
  const lineH = 22;
  const paneH = codeLines.length * lineH + 24;
  const paneX = (w - paneW) / 2;
  const paneY = subY - 10;

  // Pane background
  ctx.fillStyle = `rgba(${gbBg[0]}, ${gbBg[1]}, ${gbBg[2]}, ${alpha * 0.5})`;
  ctx.fillRect(paneX, paneY, paneW, paneH);

  // Border
  ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${alpha * 0.4})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(paneX, paneY, paneW, paneH);

  // Scan lines
  for (let sl = 0; sl < paneH; sl += 3) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.04})`;
    ctx.fillRect(paneX, paneY + sl, paneW, 1);
  }

  // Caret
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${alpha * 0.7})`;
  ctx.fillText(">", paneX + 6, paneY + 5);

  // Code lines — staggered reveal
  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i < codeLines.length; i++) {
    const lineAlpha = Math.min(1, Math.max(0, state.hintProgress * 2.5 - i * 0.12));
    if (lineAlpha <= 0) continue;

    const ly = paneY + 12 + i * lineH;
    const line = codeLines[i];

    // Color based on content
    if (line.startsWith('#')) {
      ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${lineAlpha * alpha * 0.8})`;
    } else if (line.startsWith('[')) {
      ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * alpha * 0.95})`;
    } else if (line.includes('=')) {
      ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${lineAlpha * alpha * 0.85})`;
    } else {
      ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${lineAlpha * alpha * 0.7})`;
    }

    ctx.textAlign = "left";
    ctx.fillText(line, paneX + 20, ly);
  }

  // Subtitle below
  if (state.hintProgress > 0.6) {
    const subAlpha = (state.hintProgress - 0.6) * 2.5;
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${Math.min(1, subAlpha) * 0.8})`;
    ctx.fillText("wasm-sandboxed. gateway-agnostic. any agent.", w / 2, paneY + paneH + 20);

    ctx.font = '14px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${Math.min(1, subAlpha) * 0.6})`;
    ctx.fillText("zeroclaw  |  hermes  |  any gateway you build", w / 2, paneY + paneH + 46);
  }
}

function renderGitSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  _step: (typeof TOUR_STEPS)[number],
  w: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.015, 1);
  const alpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbDark = [48, 98, 48];
  const gbBg = [15, 56, 15];

  const features = [
    { cmd: "status", desc: "staged, unstaged, conflicts" },
    { cmd: "commit", desc: "commit with message, amend" },
    { cmd: "push / pull", desc: "sync with remote" },
    { cmd: "branch", desc: "create, switch, delete" },
    { cmd: "stash", desc: "save, pop, drop" },
    { cmd: "blame", desc: "cmd+shift+b in editor" },
    { cmd: "diff", desc: "gutter indicators per line" },
    { cmd: "log", desc: "commit graph with lanes" },
  ];

  const paneW = Math.min(460, w * 0.55);
  const rowH = 28;
  const paneH = features.length * rowH + 20;
  const paneX = (w - paneW) / 2;
  const paneY = subY - 10;

  ctx.fillStyle = `rgba(${gbBg[0]}, ${gbBg[1]}, ${gbBg[2]}, ${alpha * 0.4})`;
  ctx.fillRect(paneX, paneY, paneW, paneH);
  ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${alpha * 0.4})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(paneX, paneY, paneW, paneH);

  for (let sl = 0; sl < paneH; sl += 3) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.04})`;
    ctx.fillRect(paneX, paneY + sl, paneW, 1);
  }

  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${alpha * 0.7})`;
  ctx.fillText(">", paneX + 6, paneY + 5);

  ctx.font = '14px "JetBrains Mono", monospace';
  for (let i = 0; i < features.length; i++) {
    const rowY = paneY + 10 + i * rowH;
    const f = features[i];
    const rowAlpha = Math.min(1, Math.max(0, state.hintProgress * 2 - i * 0.12));
    if (rowAlpha <= 0) continue;

    if (i > 0) {
      ctx.strokeStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${rowAlpha * alpha * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(paneX + 12, rowY);
      ctx.lineTo(paneX + paneW - 12, rowY);
      ctx.stroke();
    }

    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${rowAlpha * alpha * 0.9})`;
    ctx.fillText(f.cmd, paneX + 20, rowY + 7);

    ctx.textAlign = "right";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${rowAlpha * alpha * 0.6})`;
    ctx.fillText(f.desc, paneX + paneW - 20, rowY + 7);
  }

  if (state.hintProgress > 0.6) {
    const subAlpha = (state.hintProgress - 0.6) * 2.5;
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${Math.min(1, subAlpha) * 0.8})`;
    ctx.fillText("28 git commands. zero terminal required.", w / 2, paneY + paneH + 20);
  }
}

function renderAiSlide(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  _step: (typeof TOUR_STEPS)[number],
  w: number,
  subY: number
) {
  state.hintProgress = Math.min(state.hintProgress + 0.015, 1);
  const alpha = Math.min(1, state.hintProgress * 1.5);

  const gbLight = [155, 188, 15];
  const gbMid = [139, 172, 15];
  const gbDark = [48, 98, 48];
  const gbBg = [15, 56, 15];

  const chatLines = [
    { role: "you", text: "add error handling to the api routes" },
    { role: "buster", text: "reading src/routes/api.ts..." },
    { role: "tool", text: "> read_file(src/routes/api.ts)" },
    { role: "buster", text: "i'll wrap each handler in try/catch" },
    { role: "tool", text: "> write_file(src/routes/api.ts)" },
    { role: "buster", text: "done. 4 routes updated." },
  ];

  const paneW = Math.min(480, w * 0.55);
  const rowH = 32;
  const paneH = chatLines.length * rowH + 20;
  const paneX = (w - paneW) / 2;
  const paneY = subY - 10;

  ctx.fillStyle = `rgba(${gbBg[0]}, ${gbBg[1]}, ${gbBg[2]}, ${alpha * 0.4})`;
  ctx.fillRect(paneX, paneY, paneW, paneH);
  ctx.strokeStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${alpha * 0.4})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(paneX, paneY, paneW, paneH);

  for (let sl = 0; sl < paneH; sl += 3) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.04})`;
    ctx.fillRect(paneX, paneY + sl, paneW, 1);
  }

  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${alpha * 0.7})`;
  ctx.fillText(">", paneX + 6, paneY + 5);

  const roleColors: Record<string, number[]> = {
    you: [137, 180, 250],
    buster: [166, 227, 161],
    tool: [249, 226, 175],
  };

  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i < chatLines.length; i++) {
    const rowY = paneY + 12 + i * rowH;
    const line = chatLines[i];
    const rowAlpha = Math.min(1, Math.max(0, state.hintProgress * 2 - i * 0.18));
    if (rowAlpha <= 0) continue;

    const color = roleColors[line.role] ?? gbLight;

    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${rowAlpha * alpha * 0.7})`;
    ctx.fillText(line.role, paneX + 16, rowY + 4);

    ctx.fillStyle = `rgba(${gbLight[0]}, ${gbLight[1]}, ${gbLight[2]}, ${rowAlpha * alpha * 0.85})`;
    ctx.fillText(line.text, paneX + 16 + 60, rowY + 4);
  }

  if (state.hintProgress > 0.6) {
    const subAlpha = (state.hintProgress - 0.6) * 2.5;
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${gbMid[0]}, ${gbMid[1]}, ${gbMid[2]}, ${Math.min(1, subAlpha) * 0.8})`;
    ctx.fillText("reads files. writes code. runs commands. asks before acting.", w / 2, paneY + paneH + 20);

    ctx.font = '14px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(${gbDark[0]}, ${gbDark[1]}, ${gbDark[2]}, ${Math.min(1, subAlpha) * 0.6})`;
    ctx.fillText("sonnet 4.6  |  opus 4.6  |  haiku 4.5  |  local models", w / 2, paneY + paneH + 46);
  }
}

function renderIndicator(
  ctx: CanvasRenderingContext2D,
  state: SlideState,
  currentStep: number,
  step: (typeof TOUR_STEPS)[number],
  w: number,
  h: number
) {
  state.indicatorAlpha = Math.min(state.indicatorAlpha + 0.02, 1);
  ctx.font = '16px "Courier New", Courier, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(88, 91, 112, ${state.indicatorAlpha * 0.6})`;
  ctx.fillText(`${currentStep + 1} / ${TOUR_STEPS.length}`, w / 2, h - 50);

  const navReady = (step.special === "shortcuts" || step.special === "extensions" || step.special === "git" || step.special === "ai" || step.special === "blog") ? state.hintProgress >= 0.3 : state.hintProgress >= 0.5;
  if (navReady || state.subtitleProgress >= (step.subtitle.length || 1)) {
    state.navHintAlpha = Math.min(state.navHintAlpha + 0.015, 1);
    ctx.font = '16px "Courier New", Courier, monospace';
    ctx.fillStyle = `rgba(88, 91, 112, ${state.navHintAlpha * 0.4})`;
    ctx.fillText("enter  next   |   \u2190  back   |   esc  skip", w / 2, h - 30);
  }
}
