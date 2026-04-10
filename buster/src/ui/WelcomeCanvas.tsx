import { Component, onMount, onCleanup } from "solid-js";
import { basename } from "buster-path";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>/*+-=_|\\;:'\",.<>?!@#$%^&~`";

// Module-level cache for sampled pixel positions — survives component remounts
let cachedPixelPoints: { x: number; y: number }[] | null = null;
let cachedPixelKey = "";

// Pre-computed rain alpha strings
const RAIN_COLORS: string[] = [];
for (let i = 0; i <= 100; i++) {
  RAIN_COLORS.push(`rgba(88, 91, 112, ${(i / 100).toFixed(2)})`);
}

interface Particle {
  tx: number; ty: number; // target (home) position
  x: number; y: number;   // current position
  vx: number; vy: number; // velocity
  ch: string;
  alpha: number; targetAlpha: number;
  settled: boolean;
  falling: boolean;        // knocked loose by drag
  gravity: number;         // per-particle gravity multiplier
}

interface RainDrop {
  x: number; y: number;
  speed: number; ch: string; alpha: number;
}

interface WelcomeCanvasProps {
  recentFolders?: string[];
  onOpenFolder?: (path: string) => void;
}

const WelcomeCanvas: Component<WelcomeCanvasProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animId: number;
  let particles: Particle[] = [];
  let rainDrops: RainDrop[] = [];
  let time = 0;
  let subtitleProgress = 0;
  let folderFadeProgress = 0;
  let phase: "scatter" | "assemble" | "settled" = "scatter";
  let mouseX = 0;
  let mouseY = 0;
  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  let prevDragX = 0;
  let prevDragY = 0;
  let folderHitAreas: { x: number; y: number; w: number; h: number; path: string }[] = [];
  let phaseTimer = 0;
  let reassembleTimer = 0; // counts frames since last drag to trigger reassembly

  const SUBTITLE = "canvas-rendered ide";
  const DRAG_RADIUS = 40;  // how close the drag must be to knock particles loose
  const GRAVITY = 0.15;

  function sampleTextPixels(
    text: string, fontSize: number, offsetX: number, offsetY: number, step: number
  ): { x: number; y: number }[] {
    const key = `${text}:${fontSize}:${Math.round(offsetX)}:${Math.round(offsetY)}:${step}`;
    if (cachedPixelPoints && cachedPixelKey === key) return cachedPixelPoints;

    const c = document.createElement("canvas");
    c.width = 2000; c.height = 500;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.font = `${fontSize}px "UnifrakturMaguntia", "JetBrains Mono", monospace`;
    ctx.textBaseline = "top";
    ctx.fillText(text, 10, 10);

    const metrics = ctx.measureText(text);
    const width = Math.min(Math.ceil(metrics.width) + 20, 2000);
    const height = Math.min(fontSize + 40, 500);

    const imageData = ctx.getImageData(0, 0, width, height);
    const points: { x: number; y: number }[] = [];

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = (y * width + x) * 4;
        if (imageData.data[idx + 3]! > 128) {
          points.push({ x: x + offsetX, y: y + offsetY });
        }
      }
    }

    cachedPixelPoints = points;
    cachedPixelKey = key;
    return points;
  }

  function init() {
    if (!canvasRef) return;
    const w = canvasRef.clientWidth;
    const h = canvasRef.clientHeight;
    if (w === 0 || h === 0) return;

    // Measure title — scale to fit 85% of canvas width
    const measure = document.createElement("canvas");
    measure.width = 1; measure.height = 1;
    const mCtx = measure.getContext("2d")!;
    let titleSize = 320;
    const maxWidth = w * 0.85;
    while (titleSize > 48) {
      mCtx.font = `${titleSize}px "UnifrakturMaguntia", "JetBrains Mono", monospace`;
      if (mCtx.measureText("Buster").width <= maxWidth) break;
      titleSize -= 8;
    }

    mCtx.font = `${titleSize}px "UnifrakturMaguntia", "JetBrains Mono", monospace`;
    const titleW = mCtx.measureText("Buster").width;
    const offsetX = (w - titleW) / 2 - 10;
    const offsetY = (h - titleSize) * 0.35;

    const points = sampleTextPixels("Buster", titleSize, offsetX, offsetY, 5);

    particles = points.map((p) => ({
      tx: p.x, ty: p.y,
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!,
      alpha: 0.1 + Math.random() * 0.3,
      targetAlpha: 0.7 + Math.random() * 0.3,
      settled: false,
      falling: false,
      gravity: 0.8 + Math.random() * 0.4,
    }));

    rainDrops = [];
    for (let i = 0; i < 30; i++) {
      rainDrops.push({
        x: Math.random() * w, y: Math.random() * h,
        speed: 0.5 + Math.random() * 1.5,
        ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!,
        alpha: 0.03 + Math.random() * 0.06,
      });
    }

    phase = "scatter";
    phaseTimer = 0;
    subtitleProgress = 0;
    folderFadeProgress = 0;
    reassembleTimer = 0;
  }

  function render() {
    if (!canvasRef) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvasRef.clientWidth;
    const h = canvasRef.clientHeight;
    if (w === 0 || h === 0) { animId = requestAnimationFrame(render); return; }

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvasRef.width !== targetW || canvasRef.height !== targetH) {
      canvasRef.width = targetW;
      canvasRef.height = targetH;
    }
    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    time++;
    phaseTimer++;

    // Background
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, w, h);

    if (phase === "scatter" && phaseTimer > 15) {
      phase = "assemble";
      phaseTimer = 0;
    }

    // Background rain
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.textBaseline = "top";
    for (const drop of rainDrops) {
      drop.y += drop.speed;
      if (drop.y > h) {
        drop.y = -10;
        drop.x = Math.random() * w;
        drop.ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
      }
      ctx.fillStyle = RAIN_COLORS[Math.round(drop.alpha * 100)]!;
      ctx.fillText(drop.ch, drop.x, drop.y);
    }

    // Drag interaction — knock particles loose
    if (dragging && phase === "settled") {
      const dvx = dragX - prevDragX;
      const dvy = dragY - prevDragY;
      const dragSpeed = Math.sqrt(dvx * dvx + dvy * dvy);

      for (const p of particles) {
        if (p.falling) continue;
        const dx = p.x - dragX;
        const dy = p.y - dragY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DRAG_RADIUS) {
          p.falling = true;
          p.settled = false;
          // Fling in the direction of the drag + outward from center
          const outX = dist > 0 ? dx / dist : (Math.random() - 0.5);
          const outY = dist > 0 ? dy / dist : (Math.random() - 0.5);
          const force = (1 - dist / DRAG_RADIUS) * 3;
          p.vx = dvx * 0.5 + outX * force + (Math.random() - 0.5) * 2;
          p.vy = dvy * 0.5 + outY * force + (Math.random() - 0.5) * 2 - dragSpeed * 0.3;
        }
      }
      reassembleTimer = 0;
    }

    // Auto-reassemble after drag stops (2 seconds of no dragging)
    if (!dragging && particles.some(p => p.falling)) {
      reassembleTimer++;
      if (reassembleTimer > 120) {
        for (const p of particles) {
          if (p.falling) {
            p.falling = false;
          }
        }
      }
    }

    // Particles
    const particleFont = '8px "JetBrains Mono", monospace';
    let settledCount = 0;

    for (const p of particles) {
      if (p.falling) {
        // Apply gravity — letters fall
        p.vy += GRAVITY * p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        // Fade out as they fall off screen
        p.alpha *= 0.995;
        if (p.y > h + 50) {
          p.alpha = 0;
        }
      } else if (phase === "scatter") {
        p.x += p.vx * 2; p.y += p.vy * 2;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        p.alpha += (0.15 - p.alpha) * 0.12;
      } else if (phase === "assemble" || (!p.settled && !p.falling)) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          p.x += dx * 0.18; p.y += dy * 0.18;
          p.vx = 0; p.vy = 0;
        } else {
          p.x = p.tx; p.y = p.ty; p.settled = true; settledCount++;
        }
        p.alpha += (p.targetAlpha - p.alpha) * 0.12;
      } else {
        // Settled — gentle breathing
        p.x = p.tx + Math.sin(time * 0.015 + p.tx * 0.01) * 0.5;
        p.y = p.ty + Math.cos(time * 0.012 + p.ty * 0.01) * 0.5;
        settledCount++;
        if (Math.random() < 0.002) p.ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
      }

      if (p.alpha > 0.01) {
        ctx.font = particleFont;
        ctx.fillStyle = `rgba(205, 214, 244, ${Math.min(1, p.alpha).toFixed(2)})`;
        ctx.fillText(p.ch, p.x - 4, p.y - 5);
      }
    }

    if (phase === "assemble" && settledCount > particles.length * 0.9) {
      phase = "settled";
      phaseTimer = 0;
    }

    // Subtitle + recent folders
    if (phase === "settled") {
      subtitleProgress = Math.min(subtitleProgress + 1.2, SUBTITLE.length);
      const subText = SUBTITLE.slice(0, Math.floor(subtitleProgress));

      ctx.font = '16px "Courier New", Courier, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const subY = h * 0.72;

      ctx.fillStyle = `rgba(166, 173, 200, ${Math.min(1, subtitleProgress * 0.1)})`;
      ctx.fillText(subText, w / 2, subY);

      // Cursor
      if (subtitleProgress < SUBTITLE.length || Math.floor(time / 30) % 2 === 0) {
        const cursorX = w / 2 + ctx.measureText(subText).width / 2 + 2;
        ctx.fillStyle = `rgba(205, 214, 244, ${subtitleProgress < SUBTITLE.length ? 1 : 0.6})`;
        ctx.fillRect(cursorX, subY, 2, 16);
      }

      // Recent folders
      if (subtitleProgress >= SUBTITLE.length) {
        folderFadeProgress = Math.min(folderFadeProgress + 0.06, 1);

        const folders = props.recentFolders ?? [];
        if (folders.length > 0 && folderFadeProgress > 0.5) {
          const folderAlpha = Math.min(1, (folderFadeProgress - 0.5) * 2);
          const fy = subY + 35;
          folderHitAreas = [];

          ctx.font = '16px "JetBrains Mono", monospace';

          const gap = 20;
          const items = folders.map((f) => {
            const name = basename(f);
            return { display: `/${name}`, path: f, width: ctx.measureText(`/${name}`).width };
          });
          const totalW = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
          let curX = w / 2 - totalW / 2;

          for (const item of items) {
            const hitX = curX - 6;
            const hitW = item.width + 12;
            const isHover = mouseX >= hitX && mouseX <= hitX + hitW && mouseY >= fy - 4 && mouseY <= fy + 18;

            folderHitAreas.push({ x: hitX, y: fy - 4, w: hitW, h: 22, path: item.path });

            ctx.textAlign = "left";
            ctx.fillStyle = isHover
              ? `rgba(232, 237, 242, ${folderAlpha * 0.95})`
              : `rgba(166, 173, 200, ${folderAlpha * 0.6})`;
            ctx.fillText(item.display, curX, fy);
            curX += item.width + gap;
          }
        }
      }
    }

    // Scan line
    const scanY = (time * 2) % h;
    ctx.fillStyle = "rgba(205, 214, 244, 0.008)";
    ctx.fillRect(0, scanY, w, 2);

    prevDragX = dragX;
    prevDragY = dragY;

    animId = requestAnimationFrame(render);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    if (dragging) {
      dragX = mouseX;
      dragY = mouseY;
    }
    const overFolder = folderHitAreas.some(
      (a) => mouseX >= a.x && mouseX <= a.x + a.w && mouseY >= a.y && mouseY <= a.y + a.h
    );
    // Show grab cursor over the text area, pointer over folders
    if (overFolder) {
      canvasRef.style.cursor = "pointer";
    } else if (dragging) {
      canvasRef.style.cursor = "grabbing";
    } else if (phase === "settled") {
      // Check if mouse is near any settled particle
      const nearText = particles.some(p => p.settled && !p.falling &&
        Math.abs(p.x - mouseX) < 30 && Math.abs(p.y - mouseY) < 30);
      canvasRef.style.cursor = nearText ? "grab" : "default";
    } else {
      canvasRef.style.cursor = "default";
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Don't start drag if clicking a folder
    const overFolder = folderHitAreas.some(
      (a) => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h
    );
    if (overFolder) return;

    dragging = true;
    dragX = cx; dragY = cy;
    prevDragX = cx; prevDragY = cy;
    if (canvasRef) canvasRef.style.cursor = "grabbing";
  }

  function handleMouseUp() {
    dragging = false;
    if (canvasRef) canvasRef.style.cursor = "default";
  }

  function handleClick(e: MouseEvent) {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    for (const area of folderHitAreas) {
      if (cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h) {
        props.onOpenFolder?.(area.path);
        return;
      }
    }
  }

  onMount(() => {
    if (!canvasRef) return;

    canvasRef.addEventListener("mousemove", handleMouseMove);
    canvasRef.addEventListener("mousedown", handleMouseDown);
    canvasRef.addEventListener("mouseup", handleMouseUp);
    canvasRef.addEventListener("mouseleave", handleMouseUp);
    canvasRef.addEventListener("click", handleClick);

    requestAnimationFrame(() => {
      init();
      render();
    });

    const obs = new ResizeObserver(() => {
      particles = [];
      cancelAnimationFrame(animId);
      init();
      phase = "assemble";
      phaseTimer = 0;
      for (const p of particles) {
        p.x = p.tx + (Math.random() - 0.5) * 80;
        p.y = p.ty + (Math.random() - 0.5) * 80;
        p.alpha = 0.3;
      }
      render();
    });
    obs.observe(canvasRef);

    onCleanup(() => {
      cancelAnimationFrame(animId);
      obs.disconnect();
      canvasRef?.removeEventListener("mousemove", handleMouseMove);
      canvasRef?.removeEventListener("mousedown", handleMouseDown);
      canvasRef?.removeEventListener("mouseup", handleMouseUp);
      canvasRef?.removeEventListener("mouseleave", handleMouseUp);
      canvasRef?.removeEventListener("click", handleClick);
    });
  });

  return (
    <canvas
      ref={canvasRef}
      class="welcome-canvas"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
};

export default WelcomeCanvas;
