import { UI_FONT_FAMILY } from "../lib/fonts";
/**
 * ImageViewer — displays image files in a zoomable canvas.
 * Tries Tauri asset protocol first, falls back to base64 IPC.
 */

import { Component, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readBinaryFile } from "../lib/ipc";

interface ImageViewerProps {
  filePath: string;
  fileName: string;
}

const ImageViewer: Component<ImageViewerProps> = (props) => {
  let containerRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;
  let img: HTMLImageElement | null = null;

  const [zoom, setZoom] = createSignal(1);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [naturalW, setNaturalW] = createSignal(0);
  const [naturalH, setNaturalH] = createSignal(0);
  const [fileSize, setFileSize] = createSignal(0);

  function draw() {
    if (!img || !canvasRef || !containerRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const z = zoom();
    const w = img.naturalWidth * z;
    const h = img.naturalHeight * z;

    canvasRef.style.width = `${w}px`;
    canvasRef.style.height = `${h}px`;
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Checkerboard background for transparency
    const tileSize = 8;
    for (let y = 0; y < h; y += tileSize) {
      for (let x = 0; x < w; x += tileSize) {
        const dark = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0;
        ctx.fillStyle = dark ? "#1e1e2e" : "#28283c";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }

    ctx.drawImage(img, 0, 0, w, h);
  }

  function fitToContainer() {
    if (!img || !containerRef) return;
    const cw = containerRef.clientWidth - 40;
    const ch = containerRef.clientHeight - 80;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (iw === 0 || ih === 0) return;

    const fit = Math.min(cw / iw, ch / ih, 1);
    setZoom(fit);
  }

  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.05, Math.min(z * delta, 20)));
  }

  function onImageLoaded() {
    setLoaded(true);
    setNaturalW(img!.naturalWidth);
    setNaturalH(img!.naturalHeight);
    fitToContainer();
  }

  async function loadImage() {
    img = new Image();
    img.onload = onImageLoaded;

    // Try asset protocol first (fastest — no base64 overhead)
    const assetUrl = convertFileSrc(props.filePath);
    img.onerror = async () => {
      // Asset protocol failed — fall back to base64 via IPC
      try {
        const result = await readBinaryFile(props.filePath);
        setFileSize(result.size);
        img!.onerror = () => setError("Failed to decode image");
        img!.src = result.data_url;
      } catch (e) {
        setError(`Failed to load image: ${e}`);
      }
    };
    img.src = assetUrl;
  }

  onMount(() => {
    loadImage();
    containerRef.addEventListener("wheel", handleWheel, { passive: false });
  });

  onCleanup(() => {
    containerRef?.removeEventListener("wheel", handleWheel);
  });

  // Re-draw whenever zoom changes
  createEffect(() => {
    zoom(); // track
    if (loaded()) draw();
  });

  function formatSize(bytes: number): string {
    if (bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  const btnStyle = {
    background: "#313244",
    border: "none",
    color: "#cdd6f4",
    padding: "2px 8px",
    cursor: "pointer",
    "font-family": UI_FONT_FAMILY,
    "font-size": "12px",
    "border-radius": "3px",
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        background: "#11111b",
        "font-family": UI_FONT_FAMILY,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "8px 16px",
          color: "#cdd6f4",
          "font-size": "12px",
          "flex-shrink": "0",
          width: "100%",
          "box-sizing": "border-box",
          "border-bottom": "1px solid #313244",
          background: "#181825",
        }}
      >
        <span style={{ opacity: "0.6" }}>{props.fileName}</span>
        {loaded() && (
          <>
            <span style={{ opacity: "0.4" }}>
              {naturalW()} x {naturalH()}
            </span>
            {fileSize() > 0 && (
              <span style={{ opacity: "0.4" }}>{formatSize(fileSize())}</span>
            )}
            <button style={btnStyle} onClick={() => setZoom(z => Math.max(0.05, z * 0.8))}>-</button>
            <span style={{ "min-width": "50px", "text-align": "center" }}>
              {Math.round(zoom() * 100)}%
            </span>
            <button style={btnStyle} onClick={() => setZoom(z => Math.min(20, z * 1.25))}>+</button>
            <button style={btnStyle} onClick={fitToContainer}>Fit</button>
            <button style={btnStyle} onClick={() => setZoom(1)}>1:1</button>
          </>
        )}
      </div>

      {/* Image area */}
      <div
        style={{
          flex: "1",
          overflow: "auto",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "100%",
          padding: "20px",
          "box-sizing": "border-box",
        }}
      >
        {error() ? (
          <div style={{ color: "#f38ba8" }}>{error()}</div>
        ) : !loaded() ? (
          <div style={{ color: "#6c7086" }}>Loading...</div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
};

export default ImageViewer;
