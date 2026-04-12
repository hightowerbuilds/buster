import { Component, createMemo } from "solid-js";
import { marked } from "marked";
import { useBuster } from "../lib/buster-context";

interface BlogPreviewProps {
  text: string;
  fontSize: number;
}

const BlogPreview: Component<BlogPreviewProps> = (props) => {
  const { store } = useBuster();
  const html = createMemo(() => {
    try {
      return marked.parse(props.text, { async: false }) as string;
    } catch {
      return `<p>${props.text}</p>`;
    }
  });

  const style = createMemo(() => {
    const p = store.palette;
    return {
      "--blog-text": p.text,
      "--blog-text-dim": p.textDim,
      "--blog-text-muted": p.textMuted,
      "--blog-bg": p.editorBg,
      "--blog-surface": p.surface0,
      "--blog-border": p.border,
      "--blog-accent": p.accent,
      "--blog-code-bg": p.surface1,
    } as Record<string, string>;
  });

  return (
    <div
      class="blog-preview"
      style={{
        ...style(),
        "font-size": `${props.fontSize}px`,
      }}
      innerHTML={html()}
    />
  );
};

export default BlogPreview;
