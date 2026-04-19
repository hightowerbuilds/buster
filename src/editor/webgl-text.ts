/**
 * WebGL-accelerated text renderer with glyph atlas.
 *
 * Renders all visible text in a single instanced draw call by:
 * 1. Building a glyph atlas texture (each unique char+color → one cached entry)
 * 2. Submitting all visible characters as instanced quads
 * 3. GPU composes them in one pass
 *
 * Falls back to Canvas 2D if WebGL is unavailable.
 */

// ── Glyph Atlas ──────────────────────────────────────────────

interface GlyphEntry {
  x: number;       // atlas x position
  y: number;       // atlas y position
  w: number;       // glyph width
  h: number;       // glyph height
}

const ATLAS_SIZE = 2048;
const GLYPH_PAD = 1;

export class GlyphAtlas {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private cache = new Map<string, GlyphEntry>();
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight = 0;
  private _dirty = false;

  constructor(fontSize: number, fontFamily: string) {
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.textBaseline = "top";
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    this.rowHeight = fontSize + 4;
  }

  get dirty(): boolean { return this._dirty; }
  clearDirty(): void { this._dirty = false; }
  get texture(): OffscreenCanvas { return this.canvas; }

  /** Get or create a glyph entry for a character. */
  getGlyph(char: string, color: string): GlyphEntry {
    const key = `${char}\0${color}`;
    let entry = this.cache.get(key);
    if (entry) return entry;

    const metrics = this.ctx.measureText(char);
    const w = Math.ceil(metrics.width) + GLYPH_PAD * 2;
    const h = this.rowHeight;

    // Advance to next row if this glyph doesn't fit
    if (this.cursorX + w > ATLAS_SIZE) {
      this.cursorX = 0;
      this.cursorY += this.rowHeight + GLYPH_PAD;
    }

    // Atlas is full — can't add more glyphs (shouldn't happen with reasonable text)
    if (this.cursorY + h > ATLAS_SIZE) {
      // Return a zero-size entry — will render nothing
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    // Render glyph to atlas
    this.ctx.fillStyle = color;
    this.ctx.fillText(char, this.cursorX + GLYPH_PAD, this.cursorY + GLYPH_PAD);

    entry = { x: this.cursorX, y: this.cursorY, w, h };
    this.cache.set(key, entry);
    this.cursorX += w + GLYPH_PAD;
    this._dirty = true;

    return entry;
  }

  /** Reset atlas (call when font size changes). */
  reset(): void {
    this.cache.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this._dirty = true;
  }
}

// ── WebGL Instanced Renderer ─────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;

// Per-vertex (unit quad)
in vec2 a_pos;

// Per-instance
in vec4 a_dest;    // x, y, w, h in screen pixels
in vec4 a_uv;      // u0, v0, u1, v1 in atlas texture coords

uniform vec2 u_resolution;

out vec2 v_texCoord;

void main() {
  vec2 pixel = a_dest.xy + a_pos * a_dest.zw;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_texCoord = a_uv.xy + a_pos * (a_uv.zw - a_uv.xy);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_atlas;

void main() {
  fragColor = texture(u_atlas, v_texCoord);
  if (fragColor.a < 0.01) discard;
}`;

export class WebGLTextRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private destBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private atlasTexture: WebGLTexture;
  private resolutionLoc: WebGLUniformLocation;
  private maxInstances = 20000;
  private destData: Float32Array;
  private uvData: Float32Array;
  private instanceCount = 0;
  private _ready = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) throw new Error("WebGL 2 not available");
    this.gl = gl;

    // Compile shaders
    const vs = this.compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error("Shader link failed: " + gl.getProgramInfoLog(this.program));
    }

    // Uniforms
    this.resolutionLoc = gl.getUniformLocation(this.program, "u_resolution")!;

    // Unit quad (two triangles)
    const quadVerts = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // a_pos (per-vertex)
    const posLoc = gl.getAttribLocation(this.program, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // a_dest (per-instance)
    this.destData = new Float32Array(this.maxInstances * 4);
    this.destBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.destBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.destData.byteLength, gl.DYNAMIC_DRAW);
    const destLoc = gl.getAttribLocation(this.program, "a_dest");
    gl.enableVertexAttribArray(destLoc);
    gl.vertexAttribPointer(destLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(destLoc, 1);

    // a_uv (per-instance)
    this.uvData = new Float32Array(this.maxInstances * 4);
    this.uvBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.uvData.byteLength, gl.DYNAMIC_DRAW);
    const uvLoc = gl.getAttribLocation(this.program, "a_uv");
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(uvLoc, 1);

    gl.bindVertexArray(null);

    // Atlas texture
    this.atlasTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._ready = true;
  }

  get ready(): boolean { return this._ready; }

  /** Start a new frame — clear instance buffers. */
  begin(): void {
    this.instanceCount = 0;
  }

  /** Add a character to the instance buffer. */
  addChar(
    screenX: number, screenY: number,
    glyph: GlyphEntry,
    atlasSize: number,
  ): void {
    if (this.instanceCount >= this.maxInstances) return;
    const i = this.instanceCount * 4;

    // Destination rect (screen pixels)
    this.destData[i] = screenX;
    this.destData[i + 1] = screenY;
    this.destData[i + 2] = glyph.w;
    this.destData[i + 3] = glyph.h;

    // UV coordinates (normalized 0-1)
    this.uvData[i] = glyph.x / atlasSize;
    this.uvData[i + 1] = glyph.y / atlasSize;
    this.uvData[i + 2] = (glyph.x + glyph.w) / atlasSize;
    this.uvData[i + 3] = (glyph.y + glyph.h) / atlasSize;

    this.instanceCount++;
  }

  /** Upload atlas texture to GPU. */
  uploadAtlas(atlas: GlyphAtlas): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.texture);
  }

  /** Flush — draw all queued characters in one instanced call. */
  flush(width: number, height: number): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;

    // Resize viewport
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    // Clear
    gl.clearColor(0, 0, 0, 0); // transparent — 2D canvas behind handles background
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Upload instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.destBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.destData.subarray(0, this.instanceCount * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.uvData.subarray(0, this.instanceCount * 4));

    // Draw
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  /** Clean up WebGL resources. */
  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.destBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteTexture(this.atlasTexture);
    this._ready = false;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile failed: " + info);
    }
    return shader;
  }
}

// ── Public API ───────────────────────────────────────────────

let glRenderer: WebGLTextRenderer | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let atlas: GlyphAtlas | null = null;
let currentFontSize = 0;
let currentFontFamily = "";

/**
 * Initialize the WebGL text renderer. Call once when the editor mounts.
 * Returns the WebGL canvas element to layer behind the 2D canvas.
 */
export function initWebGLText(fontSize: number, fontFamily: string): HTMLCanvasElement | null {
  try {
    glCanvas = document.createElement("canvas");
    glCanvas.style.position = "absolute";
    glCanvas.style.top = "0";
    glCanvas.style.left = "0";
    glCanvas.style.width = "100%";
    glCanvas.style.height = "100%";
    glCanvas.style.pointerEvents = "none";

    glRenderer = new WebGLTextRenderer(glCanvas);
    atlas = new GlyphAtlas(fontSize, fontFamily);
    currentFontSize = fontSize;
    currentFontFamily = fontFamily;

    return glCanvas;
  } catch {
    // WebGL not available — fall back to Canvas 2D
    glRenderer = null;
    glCanvas = null;
    atlas = null;
    return null;
  }
}

/** Check if WebGL text rendering is active. */
export function isWebGLActive(): boolean {
  return glRenderer !== null && glRenderer.ready;
}

/** Begin a new text rendering frame. */
export function beginTextFrame(fontSize: number, fontFamily: string): void {
  if (!glRenderer || !atlas) return;
  if (fontSize !== currentFontSize || fontFamily !== currentFontFamily) {
    atlas.reset();
    atlas = new GlyphAtlas(fontSize, fontFamily);
    currentFontSize = fontSize;
    currentFontFamily = fontFamily;
  }
  glRenderer.begin();
}

/** Queue a text string for GPU rendering. */
export function queueText(text: string, x: number, y: number, color: string, charW: number): void {
  if (!glRenderer || !atlas || !text) return;
  for (let i = 0; i < text.length; i++) {
    const glyph = atlas.getGlyph(text[i], color);
    if (glyph.w > 0) {
      glRenderer.addChar(x + i * charW, y, glyph, ATLAS_SIZE);
    }
  }
}

/** Flush the GPU text frame — draws all queued characters. */
export function flushTextFrame(width: number, height: number): void {
  if (!glRenderer || !atlas) return;
  if (atlas.dirty) {
    glRenderer.uploadAtlas(atlas);
    atlas.clearDirty();
  }
  glRenderer.flush(width, height);
}

/** Dispose WebGL resources. */
export function disposeWebGLText(): void {
  glRenderer?.dispose();
  glRenderer = null;
  glCanvas = null;
  atlas = null;
}
