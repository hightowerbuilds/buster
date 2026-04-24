/**
 * terminal-webgl.ts — WebGL2-accelerated renderer for the terminal emulator.
 *
 * Architecture:
 *  - TerminalGlyphAtlas: caches WHITE glyph bitmaps keyed on char + font variant
 *    (not color), so truecolor output never explodes the atlas.
 *  - Two shader programs:
 *    1. Solid — colored quads (backgrounds, selection, cursor, decorations)
 *    2. Text  — textured quads tinted by per-instance color
 *  - Each pass is a single instanced draw call.
 *  - Falls back to Canvas 2D (existing renderer) when WebGL2 is unavailable.
 */

// ── Glyph Atlas ──────────────────────────────────────────

interface GlyphEntry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ATLAS_SIZE = 2048;
const GLYPH_PAD = 1;

/** 0 = normal, 1 = bold, 2 = italic, 3 = bold+italic */
export type FontVariant = 0 | 1 | 2 | 3;

class TerminalGlyphAtlas {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private cache = new Map<string, GlyphEntry>();
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight: number;
  private _dirty = false;
  private fontSize: number;
  private fontFamily: string;

  constructor(fontSize: number, fontFamily: string) {
    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
    this.ctx.textBaseline = "top";
    this.rowHeight = fontSize + 4;
  }

  get dirty(): boolean { return this._dirty; }
  clearDirty(): void { this._dirty = false; }
  get texture(): OffscreenCanvas { return this.canvas; }

  getGlyph(char: string, variant: FontVariant): GlyphEntry {
    const key = `${char}\0${variant}`;
    let entry = this.cache.get(key);
    if (entry) return entry;

    // Set font for this variant — always white
    const weight = (variant & 1) ? "bold " : "";
    const style = (variant & 2) ? "italic " : "";
    this.ctx.font = `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
    this.ctx.fillStyle = "#ffffff";

    const metrics = this.ctx.measureText(char);
    const w = Math.ceil(metrics.width) + GLYPH_PAD * 2;
    const h = this.rowHeight;

    if (this.cursorX + w > ATLAS_SIZE) {
      this.cursorX = 0;
      this.cursorY += this.rowHeight + GLYPH_PAD;
    }
    if (this.cursorY + h > ATLAS_SIZE) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    this.ctx.fillText(char, this.cursorX + GLYPH_PAD, this.cursorY + GLYPH_PAD);
    entry = { x: this.cursorX, y: this.cursorY, w, h };
    this.cache.set(key, entry);
    this.cursorX += w + GLYPH_PAD;
    this._dirty = true;
    return entry;
  }

  reset(): void {
    this.cache.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this._dirty = true;
  }
}

// ── Shaders ──────────────────────────────────────────────

const SOLID_VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_dest;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 pixel = a_dest.xy + a_pos * a_dest.zw;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}`;

const SOLID_FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() {
  fragColor = v_color;
}`;

const TEXT_VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_dest;
in vec4 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_texCoord;
out vec4 v_color;
void main() {
  vec2 pixel = a_dest.xy + a_pos * a_dest.zw;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_texCoord = a_uv.xy + a_pos * (a_uv.zw - a_uv.xy);
  v_color = a_color;
}`;

const TEXT_FRAG = `#version 300 es
precision highp float;
in vec2 v_texCoord;
in vec4 v_color;
out vec4 fragColor;
uniform sampler2D u_atlas;
void main() {
  float cov = texture(u_atlas, v_texCoord).a;
  if (cov < 0.01) discard;
  fragColor = vec4(v_color.rgb * cov, cov * v_color.a);
}`;

// ── Renderer ─────────────────────────────────────────────

const MAX_INSTANCES = 25000;

class TerminalWebGLRenderer {
  private gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;

  // Shared unit quad
  private quadVBO: WebGLBuffer;

  // Solid program (backgrounds, overlays, cursor, decorations)
  private solidProg: WebGLProgram;
  private solidVAO: WebGLVertexArrayObject;
  private solidDestBuf: WebGLBuffer;
  private solidColorBuf: WebGLBuffer;
  private solidDest = new Float32Array(MAX_INSTANCES * 4);
  private solidColor = new Float32Array(MAX_INSTANCES * 4);
  private solidCount = 0;
  private solidResLoc: WebGLUniformLocation;

  // Text program (glyphs)
  private textProg: WebGLProgram;
  private textVAO: WebGLVertexArrayObject;
  private textDestBuf: WebGLBuffer;
  private textUvBuf: WebGLBuffer;
  private textColorBuf: WebGLBuffer;
  private textDest = new Float32Array(MAX_INSTANCES * 4);
  private textUv = new Float32Array(MAX_INSTANCES * 4);
  private textColor = new Float32Array(MAX_INSTANCES * 4);
  private textCount = 0;
  private textResLoc: WebGLUniformLocation;
  private atlasTexture: WebGLTexture;

  // Atlas
  atlas: TerminalGlyphAtlas;

  // Frame state
  private _ready = false;
  private viewW = 0;
  private viewH = 0;

  constructor(fontSize: number, fontFamily: string) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;

    this.atlas = new TerminalGlyphAtlas(fontSize, fontFamily);

    // Shared quad VBO (two triangles)
    const quadVerts = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    this.quadVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // ── Solid program ──
    this.solidProg = this.createProgram(SOLID_VERT, SOLID_FRAG);
    this.solidResLoc = gl.getUniformLocation(this.solidProg, "u_resolution")!;

    this.solidDestBuf = gl.createBuffer()!;
    this.solidColorBuf = gl.createBuffer()!;

    this.solidVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.solidVAO);

    const sPosLoc = gl.getAttribLocation(this.solidProg, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(sPosLoc);
    gl.vertexAttribPointer(sPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidDestBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.solidDest.byteLength, gl.DYNAMIC_DRAW);
    const sDestLoc = gl.getAttribLocation(this.solidProg, "a_dest");
    gl.enableVertexAttribArray(sDestLoc);
    gl.vertexAttribPointer(sDestLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(sDestLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.solidColor.byteLength, gl.DYNAMIC_DRAW);
    const sColorLoc = gl.getAttribLocation(this.solidProg, "a_color");
    gl.enableVertexAttribArray(sColorLoc);
    gl.vertexAttribPointer(sColorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(sColorLoc, 1);

    gl.bindVertexArray(null);

    // ── Text program ──
    this.textProg = this.createProgram(TEXT_VERT, TEXT_FRAG);
    this.textResLoc = gl.getUniformLocation(this.textProg, "u_resolution")!;

    this.textDestBuf = gl.createBuffer()!;
    this.textUvBuf = gl.createBuffer()!;
    this.textColorBuf = gl.createBuffer()!;

    this.textVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.textVAO);

    const tPosLoc = gl.getAttribLocation(this.textProg, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(tPosLoc);
    gl.vertexAttribPointer(tPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textDestBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.textDest.byteLength, gl.DYNAMIC_DRAW);
    const tDestLoc = gl.getAttribLocation(this.textProg, "a_dest");
    gl.enableVertexAttribArray(tDestLoc);
    gl.vertexAttribPointer(tDestLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(tDestLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textUvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.textUv.byteLength, gl.DYNAMIC_DRAW);
    const tUvLoc = gl.getAttribLocation(this.textProg, "a_uv");
    gl.enableVertexAttribArray(tUvLoc);
    gl.vertexAttribPointer(tUvLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(tUvLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.textColor.byteLength, gl.DYNAMIC_DRAW);
    const tColorLoc = gl.getAttribLocation(this.textProg, "a_color");
    gl.enableVertexAttribArray(tColorLoc);
    gl.vertexAttribPointer(tColorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(tColorLoc, 1);

    gl.bindVertexArray(null);

    // Atlas texture
    this.atlasTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._ready = true;
  }

  get ready(): boolean { return this._ready; }

  // ── Frame lifecycle ──

  beginFrame(width: number, height: number, bgR: number, bgG: number, bgB: number): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.viewW = width;
    this.viewH = height;

    gl.viewport(0, 0, w, h);
    gl.clearColor(bgR, bgG, bgB, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.atlas.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.texture);
      this.atlas.clearDirty();
    }

    this.solidCount = 0;
    this.textCount = 0;
  }

  // ── Solid quads ──

  addQuad(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    if (this.solidCount >= MAX_INSTANCES) return;
    const i = this.solidCount * 4;
    this.solidDest[i] = x;
    this.solidDest[i + 1] = y;
    this.solidDest[i + 2] = w;
    this.solidDest[i + 3] = h;
    this.solidColor[i] = r;
    this.solidColor[i + 1] = g;
    this.solidColor[i + 2] = b;
    this.solidColor[i + 3] = a;
    this.solidCount++;
  }

  flushQuads(): void {
    if (this.solidCount === 0) return;
    const gl = this.gl;

    gl.useProgram(this.solidProg);
    gl.uniform2f(this.solidResLoc, this.viewW, this.viewH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidDestBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.solidDest.subarray(0, this.solidCount * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidColorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.solidColor.subarray(0, this.solidCount * 4));

    gl.bindVertexArray(this.solidVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.solidCount);
    gl.bindVertexArray(null);

    this.solidCount = 0;
  }

  // ── Text glyphs ──

  addGlyph(x: number, y: number, glyph: GlyphEntry, r: number, g: number, b: number, a: number): void {
    if (this.textCount >= MAX_INSTANCES || glyph.w === 0) return;
    const i = this.textCount * 4;

    this.textDest[i] = x;
    this.textDest[i + 1] = y;
    this.textDest[i + 2] = glyph.w;
    this.textDest[i + 3] = glyph.h;

    this.textUv[i] = glyph.x / ATLAS_SIZE;
    this.textUv[i + 1] = glyph.y / ATLAS_SIZE;
    this.textUv[i + 2] = (glyph.x + glyph.w) / ATLAS_SIZE;
    this.textUv[i + 3] = (glyph.y + glyph.h) / ATLAS_SIZE;

    this.textColor[i] = r;
    this.textColor[i + 1] = g;
    this.textColor[i + 2] = b;
    this.textColor[i + 3] = a;

    this.textCount++;
  }

  flushText(): void {
    if (this.textCount === 0) return;
    const gl = this.gl;

    gl.useProgram(this.textProg);
    gl.uniform2f(this.textResLoc, this.viewW, this.viewH);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textDestBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.textDest.subarray(0, this.textCount * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textUvBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.textUv.subarray(0, this.textCount * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textColorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.textColor.subarray(0, this.textCount * 4));

    gl.bindVertexArray(this.textVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.textCount);
    gl.bindVertexArray(null);

    this.textCount = 0;
  }

  // ── Font change ──

  updateFont(fontSize: number, fontFamily: string): void {
    this.atlas = new TerminalGlyphAtlas(fontSize, fontFamily);
  }

  // ── Cleanup ──

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.solidProg);
    gl.deleteProgram(this.textProg);
    gl.deleteVertexArray(this.solidVAO);
    gl.deleteVertexArray(this.textVAO);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteBuffer(this.solidDestBuf);
    gl.deleteBuffer(this.solidColorBuf);
    gl.deleteBuffer(this.textDestBuf);
    gl.deleteBuffer(this.textUvBuf);
    gl.deleteBuffer(this.textColorBuf);
    gl.deleteTexture(this.atlasTexture);
    this._ready = false;
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }

  private createProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vertSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("Shader link: " + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error("Shader compile: " + info);
    }
    return s;
  }
}

// ── Public API ───────────────────────────────────────────

/** Parse "#rrggbb" → [r/255, g/255, b/255] as floats for GL. */
function hexToGL(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Parse "rgba(r, g, b, a)" → [r/255, g/255, b/255, a] as floats for GL. */
function rgbaToGL(rgba: string): [number, number, number, number] {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) {
    // Fallback: try hex
    const [r, g, b] = hexToGL(rgba);
    return [r, g, b, 1.0];
  }
  return [
    parseInt(m[1]) / 255,
    parseInt(m[2]) / 255,
    parseInt(m[3]) / 255,
    m[4] !== undefined ? parseFloat(m[4]) : 1.0,
  ];
}

/**
 * High-level terminal WebGL context. Owns the GL canvas, renderer, and atlas.
 * Drop-in replacement for the Canvas 2D render path in CanvasTerminal.
 */
export class TerminalGLContext {
  readonly canvas: HTMLCanvasElement;
  private renderer: TerminalWebGLRenderer;
  private currentFontSize: number;
  private currentFontFamily: string;

  private constructor(fontSize: number, fontFamily: string) {
    this.renderer = new TerminalWebGLRenderer(fontSize, fontFamily);
    this.canvas = this.renderer.canvas;
    this.currentFontSize = fontSize;
    this.currentFontFamily = fontFamily;
  }

  static tryCreate(fontSize: number, fontFamily: string): TerminalGLContext | null {
    try {
      return new TerminalGLContext(fontSize, fontFamily);
    } catch {
      return null;
    }
  }

  isActive(): boolean { return this.renderer.ready; }

  /** Begin a frame. Clears with the given background hex color. Rebuilds atlas if font changed. */
  beginFrame(width: number, height: number, bgHex: string, fontSize: number, fontFamily: string): void {
    if (fontSize !== this.currentFontSize || fontFamily !== this.currentFontFamily) {
      this.renderer.updateFont(fontSize, fontFamily);
      this.currentFontSize = fontSize;
      this.currentFontFamily = fontFamily;
    }
    const [r, g, b] = hexToGL(bgHex);
    this.renderer.beginFrame(width, height, r, g, b);
  }

  /** Add an opaque background quad from RGB 0-255 values. */
  addBg(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    this.renderer.addQuad(x, y, w, h, r / 255, g / 255, b / 255, 1.0);
  }

  /** Add a translucent overlay from a CSS rgba() or hex string. */
  addOverlayCss(x: number, y: number, w: number, h: number, css: string): void {
    const [r, g, b, a] = rgbaToGL(css);
    this.renderer.addQuad(x, y, w, h, r, g, b, a);
  }

  /** Add a translucent overlay from raw RGBA floats (0-1). */
  addOverlay(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    this.renderer.addQuad(x, y, w, h, r, g, b, a);
  }

  /** Flush all queued solid quads in one draw call. */
  flushQuads(): void { this.renderer.flushQuads(); }

  /** Add a text glyph. fg values are 0-255. */
  addChar(char: string, variant: FontVariant, x: number, y: number, fgR: number, fgG: number, fgB: number, alpha?: number): void {
    const glyph = this.renderer.atlas.getGlyph(char, variant);
    this.renderer.addGlyph(x, y, glyph, fgR / 255, fgG / 255, fgB / 255, alpha ?? 1.0);
  }

  /** Add a text glyph with a hex color string. */
  addCharHex(char: string, variant: FontVariant, x: number, y: number, hex: string): void {
    const glyph = this.renderer.atlas.getGlyph(char, variant);
    const [r, g, b] = hexToGL(hex);
    this.renderer.addGlyph(x, y, glyph, r, g, b, 1.0);
  }

  /** Flush all queued text glyphs in one draw call. */
  flushText(): void {
    // Re-upload atlas if new glyphs were added during this frame
    if (this.renderer.atlas.dirty) {
      // Access GL through the renderer to upload — use beginFrame's upload path
      // The atlas is uploaded at beginFrame, but new glyphs added during the frame
      // won't be on the GPU yet. Force a re-upload.
      this.renderer["gl"].bindTexture(
        this.renderer["gl"].TEXTURE_2D,
        this.renderer["atlasTexture"],
      );
      this.renderer["gl"].texImage2D(
        this.renderer["gl"].TEXTURE_2D, 0,
        this.renderer["gl"].RGBA,
        this.renderer["gl"].RGBA,
        this.renderer["gl"].UNSIGNED_BYTE,
        this.renderer.atlas.texture,
      );
      this.renderer.atlas.clearDirty();
    }
    this.renderer.flushText();
  }

  dispose(): void { this.renderer.dispose(); }
}
