import { createEffect, createResource, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { ShaderRenderer, themeColors } from "../lib/background-renderer";
import { createBackgroundPlayback } from "../lib/background-playback";
import { showError, showInfo } from "../lib/notify";
import "../styles/backgrounds.css";

/** Draws the selected WGSL background behind the active note. */
export default function ShaderBackground() {
  const { backgrounds } = useBuster();
  const [error, setError] = createSignal("");
  const [glsl] = createResource(() => backgrounds.selected()?.wgsl, wgsl => backgrounds.compile(wgsl).catch(e => {
    const message = e instanceof Error ? e.message : String(e);
    setError(message); showError(message);
    return "";
  }));
  let canvas!: HTMLCanvasElement;
  const [renderer, setRenderer] = createSignal<ShaderRenderer>();
  let playback: ReturnType<typeof createBackgroundPlayback> | undefined;
  let colors = themeColors();
  let colorAge = 0;
  function initialize() {
    playback?.dispose(); renderer()?.dispose();
    try {
      const next = new ShaderRenderer(canvas);
      playback = createBackgroundPlayback(canvas, next, {
        scale: 0.5,
        animate: () => backgrounds.state.animate,
        notice: message => { if (message) showInfo(message); },
        uniforms: time => {
          if (++colorAge > 60) { colors = themeColors(); colorAge = 0; }
          return { width: canvas.width, height: canvas.height, time, strength: backgrounds.state.strength, ...colors };
        },
      });
      setRenderer(next);
    } catch (e) { setError(String(e)); showError(String(e)); }
  }
  onMount(() => {
    initialize();
    const lost = (event: Event) => { event.preventDefault(); playback?.dispose(); };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", initialize);
    onCleanup(() => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", initialize);
    });
  });
  createEffect(() => {
    const source = glsl(), current = renderer();
    if (glsl.loading || !source || !current) { playback?.suspend(); return; }
    const failure = current.setShader(source);
    setError(failure ?? "");
    if (failure) { playback?.suspend(); showError(failure); }
    else untrack(() => playback?.reset());
  });
  createEffect(() => {
    void backgrounds.state.animate; void backgrounds.state.strength;
    untrack(() => { colors = themeColors(); playback?.refresh(); });
  });
  onCleanup(() => { playback?.dispose(); renderer()?.dispose(); });
  return <canvas ref={canvas} class="shader-background" aria-hidden="true" data-error={error() || undefined}
    style={{ opacity: String(backgrounds.state.strength) }} />;
}
