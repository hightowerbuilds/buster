import type { BackgroundUniforms, ShaderRenderer } from "./background-renderer";

const FRAME_MS = 1000 / 30;

/** Conservative frame-pacing guard. CPU submission time alone does not measure GPU work. */
export class BackgroundBudget {
  level = 0;
  private samples = 0;
  private slow = 0;
  private warmup = 5;
  get scale() { return 1 / (2 ** this.level); }
  get paused() { return this.level === 3; }
  resetWindow() { this.samples = 0; this.slow = 0; this.warmup = 5; }
  observe(milliseconds: number): boolean {
    if (this.paused || !Number.isFinite(milliseconds) || milliseconds < 0) return false;
    if (this.warmup-- > 0) return false;
    this.samples++;
    if (milliseconds > 55) this.slow++;
    if (this.samples < 12) return false;
    const degrade = this.slow >= 8;
    if (degrade) this.level++;
    this.resetWindow();
    return degrade;
  }
}

/** Shared playback for notes and approval previews. Call reset only for a new shader. */
export function createBackgroundPlayback(canvas: HTMLCanvasElement, renderer: Pick<ShaderRenderer, "draw" | "contextLost">, options: {
  uniforms(time: number): BackgroundUniforms;
  animate(): boolean;
  scale: number;
  notice(message: string): void;
}) {
  let budget = new BackgroundBudget();
  let frame = 0;
  let lastDraw = 0;
  let elapsed = 0;
  let disposed = false;
  let enabled = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const resize = () => {
    const scale = options.scale * budget.scale * (window.devicePixelRatio || 1);
    let width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    let height = Math.max(1, Math.floor(canvas.clientHeight * scale));
    const cap = Math.min(1, Math.sqrt(2_000_000 / (width * height)));
    width = Math.max(1, Math.floor(width * cap)); height = Math.max(1, Math.floor(height * cap));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };
  const visible = () => !document.hidden && canvas.clientWidth > 0 && canvas.clientHeight > 0;
  const moving = () => options.animate() && !motion.matches && !budget.paused;
  const draw = (time: number) => renderer.draw({ ...options.uniforms(time), width: canvas.width, height: canvas.height });
  const tick = (now: number) => {
    frame = 0;
    if (disposed || !enabled || !visible() || renderer.contextLost || !moving()) return;
    if (!lastDraw || now - lastDraw >= FRAME_MS) {
      const interval = lastDraw ? now - lastDraw : FRAME_MS;
      elapsed += Math.min(interval, 100) / 1000;
      lastDraw = now;
      const start = performance.now();
      draw(elapsed);
      if (budget.observe(Math.max(interval, performance.now() - start))) {
        options.notice(budget.paused
          ? "Background animation paused to keep writing responsive."
          : "Background detail reduced to keep writing responsive.");
        // Retain the last rendered frame when pausing.
        if (budget.paused) return;
        resize();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const refresh = () => {
    cancelAnimationFrame(frame); frame = 0; lastDraw = 0;
    budget.resetWindow();
    if (disposed || !enabled || !visible() || renderer.contextLost) return;
    resize();
    if (moving()) frame = requestAnimationFrame(tick);
    else draw(budget.paused ? elapsed : 4);
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(canvas);
  document.addEventListener("visibilitychange", refresh);
  motion.addEventListener("change", refresh);
  return {
    refresh,
    reset() { enabled = true; budget = new BackgroundBudget(); elapsed = 0; options.notice(""); refresh(); },
    suspend() { enabled = false; cancelAnimationFrame(frame); frame = 0; },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      motion.removeEventListener("change", refresh);
    },
  };
}
