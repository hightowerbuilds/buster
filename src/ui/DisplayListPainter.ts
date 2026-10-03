/**
 * Display List Painter — executes structured draw commands on a canvas.
 * Used by extensions to render visual output through the surface system.
 */

export interface DrawCommand {
  op: string;
  [key: string]: unknown;
}

// Cache decoded images to avoid re-creating them on every paint
const imageCache = new Map<string, HTMLImageElement>();

/**
 * Paint a display list onto a 2D canvas context.
 * All coordinates in the command list are in logical (CSS) pixels.
 * The painter handles DPR scaling via ctx.scale().
 */
export function paintDisplayList(
  ctx: CanvasRenderingContext2D,
  commands: DrawCommand[],
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.scale(dpr, dpr);

  for (const cmd of commands) {
    switch (cmd.op) {
      case "fill_rect": {
        ctx.fillStyle = (cmd.color as string) || "#000";
        const radius = (cmd.radius as number) || 0;
        if (radius > 0) {
          ctx.beginPath();
          ctx.roundRect(cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number, radius);
          ctx.fill();
        } else {
          ctx.fillRect(cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number);
        }
        break;
      }

      case "stroke_rect": {
        ctx.strokeStyle = (cmd.color as string) || "#000";
        ctx.lineWidth = (cmd.line_width as number) || 1;
        const radius = (cmd.radius as number) || 0;
        if (radius > 0) {
          ctx.beginPath();
          ctx.roundRect(cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number, radius);
          ctx.stroke();
        } else {
          ctx.strokeRect(cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number);
        }
        break;
      }

      case "draw_text": {
        ctx.fillStyle = (cmd.color as string) || "#000";
        ctx.font = (cmd.font as string) || "14px sans-serif";
        ctx.textAlign = (cmd.align as CanvasTextAlign) || "left";
        ctx.textBaseline = (cmd.baseline as CanvasTextBaseline) || "top";
        ctx.fillText(cmd.text as string, cmd.x as number, cmd.y as number);
        break;
      }

      case "draw_line": {
        ctx.strokeStyle = (cmd.color as string) || "#000";
        ctx.lineWidth = (cmd.line_width as number) || 1;
        ctx.beginPath();
        ctx.moveTo(cmd.x1 as number, cmd.y1 as number);
        ctx.lineTo(cmd.x2 as number, cmd.y2 as number);
        ctx.stroke();
        break;
      }

      case "fill_circle": {
        ctx.fillStyle = (cmd.color as string) || "#000";
        ctx.beginPath();
        ctx.arc(cmd.cx as number, cmd.cy as number, cmd.r as number, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case "stroke_circle": {
        ctx.strokeStyle = (cmd.color as string) || "#000";
        ctx.lineWidth = (cmd.line_width as number) || 1;
        ctx.beginPath();
        ctx.arc(cmd.cx as number, cmd.cy as number, cmd.r as number, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case "fill_path": {
        ctx.fillStyle = (cmd.color as string) || "#000";
        const path = new Path2D(cmd.d as string);
        ctx.fill(path);
        break;
      }

      case "stroke_path": {
        ctx.strokeStyle = (cmd.color as string) || "#000";
        ctx.lineWidth = (cmd.line_width as number) || 1;
        const path = new Path2D(cmd.d as string);
        ctx.stroke(path);
        break;
      }

      case "draw_image": {
        const src = cmd.src as string;
        let img = imageCache.get(src);
        if (img && img.complete) {
          ctx.drawImage(img, cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number);
        } else if (!img) {
          img = new Image();
          img.src = src;
          imageCache.set(src, img);
          // Image will be drawn on the next paint call once loaded
        }
        break;
      }

      case "push_clip": {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cmd.x as number, cmd.y as number, cmd.w as number, cmd.h as number);
        ctx.clip();
        break;
      }

      case "pop_clip": {
        ctx.restore();
        break;
      }

      case "push_transform": {
        ctx.save();
        ctx.transform(
          cmd.a as number, cmd.b as number,
          cmd.c as number, cmd.d as number,
          cmd.e as number, cmd.f as number,
        );
        break;
      }

      case "pop_transform": {
        ctx.restore();
        break;
      }

      case "set_opacity": {
        ctx.globalAlpha = (cmd.alpha as number) ?? 1;
        break;
      }
    }
  }

  ctx.restore();
}

/** Clear the image cache (call when a surface is released). */
export function clearImageCache(): void {
  imageCache.clear();
}
