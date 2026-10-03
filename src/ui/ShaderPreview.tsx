import { createEffect, createResource, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { ShaderRenderer, themeColors } from "../lib/background-renderer";
import { createBackgroundPlayback } from "../lib/background-playback";
import "../styles/backgrounds.css";

/** Approval previews use the same motion and performance limits as note backgrounds. */
export default function ShaderPreview(props: { wgsl: string }) {
  const { backgrounds } = useBuster();
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [glsl] = createResource(() => props.wgsl, wgsl => backgrounds.compile(wgsl).catch(e => {
    setError(e instanceof Error ? e.message : String(e));
    return "";
  }));
  let canvas!: HTMLCanvasElement;
  const [renderer, setRenderer] = createSignal<ShaderRenderer>();
  let playback: ReturnType<typeof createBackgroundPlayback> | undefined;
  const initialize = () => {
    playback?.dispose(); renderer()?.dispose();
    try {
      const next = new ShaderRenderer(canvas);
      const colors = themeColors();
      playback = createBackgroundPlayback(canvas, next, {
        scale: 0.5, animate: () => backgrounds.state.animate, notice: setNotice,
        uniforms: time => ({ width: canvas.width, height: canvas.height, time, strength: 1, ...colors }),
      });
      setRenderer(next);
    } catch (e) { setError(String(e)); }
  };
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
    if (failure) playback?.suspend();
    else untrack(() => playback?.reset());
  });
  createEffect(() => { void backgrounds.state.animate; untrack(() => playback?.refresh()); });
  onCleanup(() => { playback?.dispose(); renderer()?.dispose(); });
  return <div class="shader-preview">
    <canvas ref={canvas} width={320} height={180} aria-label="Background preview" />
    <Show when={notice()}><p class="settings-desc" role="status">{notice()}</p></Show>
    <Show when={error()}><p class="bg-error" role="alert">{error()}</p></Show>
  </div>;
}
