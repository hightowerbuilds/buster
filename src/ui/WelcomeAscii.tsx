import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { createWelcomeAscii } from "./welcome-ascii";

export default function WelcomeAscii() {
  let canvas!: HTMLCanvasElement;
  let disposed = false, frame = 0;
  const [ready, setReady] = createSignal(false);
  onMount(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let renderer: Awaited<ReturnType<typeof createWelcomeAscii>>;
    let elapsed = 0, previous = 0, painted = -Infinity, visible = true;
    function tick(now: number) {
      frame = 0;
      if (disposed || document.hidden || !visible || !renderer) return;
      if (previous) elapsed += Math.min(now - previous, 100);
      previous = now;
      if (now - painted >= 1000 / 30) { renderer.draw(motion.matches ? 0 : elapsed / 1000); painted = now; }
      if (!motion.matches) frame = requestAnimationFrame(tick);
    }
    function restart() {
      cancelAnimationFrame(frame); frame = 0; previous = 0; painted = -Infinity;
      if (!disposed && renderer && !document.hidden && visible) frame = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; restart(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", restart);
    motion.addEventListener("change", restart);
    // Palette changes repaint even when reduced motion has paused the spin.
    const theme = new MutationObserver(restart);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    void createWelcomeAscii(canvas).then(result => {
      if (disposed || !result) return;
      renderer = result; renderer.draw(0); setReady(true); restart();
    }).catch(() => { /* The bundled letter remains as a static fallback. */ });
    onCleanup(() => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); theme.disconnect();
      document.removeEventListener("visibilitychange", restart); motion.removeEventListener("change", restart);
    });
  });
  return <div class="welcome-ascii" aria-hidden="true">
    <canvas ref={canvas} width="960" height="580" style={{ opacity: ready() ? 1 : 0 }} />
    <Show when={!ready()}><span class="welcome-ascii-fallback">B</span></Show>
  </div>;
}
