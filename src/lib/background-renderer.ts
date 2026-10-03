/**
 * Draws a translated WGSL background (GLSL ES 3.00 from naga) with WebGL2. The fragment shader reads
 * the `Uniforms` block the app appends to every background; this renderer fills it.
 */

// A single triangle that covers the viewport.
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export type Rgba = [number, number, number, number];
export interface BackgroundUniforms {
  width: number;
  height: number;
  time: number;
  strength: number;
  accent: Rgba;
  paper: Rgba;
  ink: Rgba;
}

/** std140 layout of `struct Uniforms { resolution: vec2f, time: f32, strength: f32, accent, paper, ink: vec4f }`. */
export function packUniforms(u: BackgroundUniforms): Float32Array {
  return new Float32Array([u.width, u.height, u.time, u.strength, ...u.accent, ...u.paper, ...u.ink]);
}

/** Parse a CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) to 0–1 sRGB. */
export function parseColor(value: string, fallback: Rgba = [0, 0, 0, 1]): Rgba {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex && [3, 6, 8].includes(hex.length)) {
    const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/i)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (rgb && rgb.length >= 3 && rgb.slice(0, 3).every(Number.isFinite)) {
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, Number.isFinite(rgb[3]) ? rgb[3] : 1];
  }
  return fallback;
}

export function themeColors(root: Element = document.documentElement): Pick<BackgroundUniforms, "accent" | "paper" | "ink"> {
  const style = getComputedStyle(root);
  return {
    accent: parseColor(style.getPropertyValue("--accent"), [0.54, 0.71, 0.98, 1]),
    paper: parseColor(style.getPropertyValue("--bg-base"), [0.12, 0.12, 0.18, 1]),
    ink: parseColor(style.getPropertyValue("--text"), [0.8, 0.84, 0.96, 1]),
  };
}

export class ShaderRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is unavailable, so shader backgrounds cannot be drawn.");
    this.gl = gl;
  }

  /** Compile and link a translated fragment shader. Returns an error message, or null on success. */
  setShader(fragment: string): string | null {
    const { gl } = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "unknown error";
        gl.deleteShader(shader);
        throw new Error(log);
      }
      return shader;
    };
    let vertex: WebGLShader | null = null;
    let frag: WebGLShader | null = null;
    try {
      vertex = compile(gl.VERTEX_SHADER, VERTEX);
      frag = compile(gl.FRAGMENT_SHADER, fragment);
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, frag);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? "unknown error";
        gl.deleteProgram(program);
        return `WebGL could not link the background: ${log}`;
      }
      // naga names the block after the struct; bind every block (there is at most one) to point 0.
      const blocks = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS) as number;
      for (let i = 0; i < blocks; i++) gl.uniformBlockBinding(program, i, 0);
      if (this.program) gl.deleteProgram(this.program);
      this.program = program;
      this.buffer ??= gl.createBuffer();
      return null;
    } catch (error) {
      return `WebGL could not compile the background: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (frag) gl.deleteShader(frag);
    }
  }

  draw(uniforms: BackgroundUniforms) {
    const { gl, program } = this;
    if (!program || gl.isContextLost()) return;
    gl.viewport(0, 0, uniforms.width, uniforms.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, packUniforms(uniforms), gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** RGBA of one drawn pixel (bottom-left origin), for tests and diagnostics. */
  readPixel(x: number, y: number): number[] {
    const out = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  }

  get contextLost() { return this.gl.isContextLost(); }

  dispose() {
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.program = null;
    this.buffer = null;
  }
}
