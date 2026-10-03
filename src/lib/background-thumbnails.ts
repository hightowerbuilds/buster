import { ShaderRenderer, themeColors } from "./background-renderer";

const WIDTH = 240;
const HEIGHT = 150;
const THUMBNAIL_TIME = 4;

let renderer: ShaderRenderer | null = null;
let canvas: HTMLCanvasElement | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

/**
 * A still image of a background, drawn once through a shared WebGL2 context so the gallery does not
 * hold one context per card. Rejects with the translation or WebGL error.
 */
export function backgroundThumbnail(wgsl: string, compile: (wgsl: string) => Promise<string>): Promise<string> {
  let pending = cache.get(wgsl);
  if (pending) return pending;
  pending = queue.then(async () => {
    const glsl = await compile(wgsl);
    if (!renderer || renderer.contextLost) {
      canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      renderer = new ShaderRenderer(canvas);
    }
    const failure = renderer.setShader(glsl);
    if (failure) throw new Error(failure);
    renderer.draw({ width: WIDTH, height: HEIGHT, time: THUMBNAIL_TIME, strength: 1, ...themeColors() });
    // Flip to match the page, where the canvas is mirrored so shaders see WGSL's top-left origin.
    const flipped = document.createElement("canvas");
    flipped.width = WIDTH;
    flipped.height = HEIGHT;
    const context = flipped.getContext("2d")!;
    context.translate(0, HEIGHT);
    context.scale(1, -1);
    context.drawImage(canvas!, 0, 0);
    return flipped.toDataURL("image/png");
  });
  queue = pending.catch(() => {});
  cache.set(wgsl, pending);
  pending.catch(() => cache.delete(wgsl));
  return pending;
}
