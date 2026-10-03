import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";

const GLYPH_FONT = '180px "UnifrakturMaguntia"';
const ASCII_FONT = '10px "JetBrains Mono"';
const RAMP = ".,:;+=xX$@";
const WIDTH = 480, HEIGHT = 290;
interface Point { x: number; y: number; z: number; nx: number; nz: number; edge: boolean }

/** Rasterize the bundled blackletter glyph once, then extrude its outline. */
function makeLetter(): Point[] {
  const mask = new OffscreenCanvas(240, 240);
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const width = measureNaturalWidth(prepareWithSegments("B", GLYPH_FONT));
  ctx.font = GLYPH_FONT; ctx.fillStyle = "white"; ctx.textBaseline = "alphabetic";
  ctx.fillText("B", (240 - width) / 2, 192);
  const pixels = ctx.getImageData(0, 0, 240, 240).data;
  const filled = (x: number, y: number) => x >= 0 && x < 240 && y >= 0 && y < 240 && pixels[(y * 240 + x) * 4 + 3] > 100;
  let left = 240, right = 0, top = 240, bottom = 0;
  for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) if (filled(x, y)) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const points: Point[] = [], scale = 2 / Math.max(1, bottom - top);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (!filled(x, y)) continue;
    const px = (x - (left + right) / 2) * scale, py = (bottom - y) * scale;
    for (const side of [-1, 1]) points.push({ x: px, y: py, z: side * .095, nx: 0, nz: side, edge: false });
    if (!filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1)) {
      const nx = Number(filled(x - 1, y)) - Number(filled(x + 1, y));
      for (let z = -.095; z <= .096; z += .025) points.push({ x: px, y: py, z, nx, nz: 0, edge: true });
    }
  }
  return points;
}

/** All font measurements and glyph rasterization happen before the frame loop. */
export async function createWelcomeAscii(canvas: HTMLCanvasElement) {
  await Promise.all([document.fonts.load(GLYPH_FONT, "B"), document.fonts.load(ASCII_FONT, RAMP)]);
  if (!document.fonts.check(GLYPH_FONT, "B") || typeof OffscreenCanvas === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const points = makeLetter();
  if (!points.length) return null;
  const cellWidth = measureNaturalWidth(prepareWithSegments("M", ASCII_FONT));
  const cellHeight = 10;
  const columns = Math.floor(WIDTH / cellWidth), rows = Math.floor(HEIGHT / cellHeight);
  const depth = new Float32Array(columns * rows), light = new Float32Array(columns * rows);
  const edge = new Uint8Array(columns * rows);
  const atlas = new OffscreenCanvas(Math.ceil(cellWidth * RAMP.length * 2), cellHeight * 2);
  const ink = atlas.getContext("2d");
  if (!ink) return null;
  let color = "", ratio = 0;
  function draw(seconds: number) {
    if (!ctx || !ink) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (ratio !== dpr) {
      ratio = dpr; canvas.width = WIDTH * ratio; canvas.height = HEIGHT * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const nextColor = getComputedStyle(canvas).color;
    if (color !== nextColor) {
      color = nextColor;
      ink.setTransform(2, 0, 0, 2, 0, 0); ink.clearRect(0, 0, atlas.width, atlas.height);
      ink.font = ASCII_FONT; ink.textBaseline = "top"; ink.fillStyle = color;
      for (let i = 0; i < RAMP.length; i++) ink.fillText(RAMP[i], i * cellWidth, 0);
    }
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    depth.fill(-Infinity); light.fill(0); edge.fill(0);
    const angle = seconds * Math.PI * 2 / 16 + .28;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const lean = .065 * Math.sin(angle * 2), cameraTilt = .22;
    const ct = Math.cos(cameraTilt), st = Math.sin(cameraTilt);
    const scale = 106, floor = 247;
    // A sparse ASCII contact shadow stays on the table as the letter turns.
    ctx.fillStyle = color; ctx.font = ASCII_FONT; ctx.textBaseline = "top";
    const shadowWidth = 28 + Math.abs(cos) * 60;
    for (let row = -2; row <= 2; row++) for (let col = -20; col <= 20; col++) {
      const x = col * cellWidth, y = row * cellHeight;
      const radius = x * x / (shadowWidth * shadowWidth) + y * y / 160;
      if (radius >= 1) continue;
      ctx.globalAlpha = .06 + (1 - radius) * .16;
      ctx.fillText(radius < .35 ? ":" : ".", WIDTH / 2 + x, floor + 3 + y);
    }
    for (const p of points) {
      const rx = p.x * cos + p.z * sin + lean * p.y;
      const rz = -p.x * sin + p.z * cos;
      const ry = p.y * ct - rz * st;
      const z = rz * ct + p.y * st;
      const perspective = 5 / (5 - z);
      const x = Math.floor((WIDTH / 2 + rx * scale * perspective) / cellWidth);
      const y = Math.floor((floor - ry * scale * perspective) / cellHeight);
      if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
      const index = y * columns + x;
      if (z <= depth[index]) continue;
      depth[index] = z;
      const normalX = p.nx * cos + p.nz * sin;
      const normalZ = -p.nx * sin + p.nz * cos;
      light[index] = Math.max(.2, Math.min(1, .5 + .3 * normalZ - .28 * normalX + .12 * p.y));
      edge[index] = p.edge ? 1 : 0;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      if (!Number.isFinite(depth[index])) continue;
      const value = light[index];
      const glyph = Math.min(RAMP.length - 1, Math.floor(value * (RAMP.length - 1)));
      ctx.globalAlpha = Math.min(1, .4 + value * .6 + edge[index] * .1);
      ctx.drawImage(atlas, glyph * cellWidth * 2, 0, cellWidth * 2, cellHeight * 2,
        x * cellWidth, y * cellHeight, cellWidth, cellHeight);
    }
    ctx.globalAlpha = 1;
  }
  return { draw };
}
