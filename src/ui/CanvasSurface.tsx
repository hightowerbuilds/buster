import type { Component, JSX } from "solid-js";

interface CanvasSurfaceProps {
  class?: string;
  style?: JSX.CSSProperties;
  containerRef?: (el: HTMLDivElement) => void;
  canvasRef?: (el: HTMLCanvasElement) => void;
  inputRef?: (el: HTMLTextAreaElement) => void;
  a11y?: JSX.Element;
  searchOverlay?: JSX.Element;
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseDown?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseMove?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseUp?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onWheel?: JSX.EventHandlerUnion<HTMLDivElement, WheelEvent>;
  onContextMenu?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  textareaProps?: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { "data-tab-focus-target"?: string };
  children?: JSX.Element;
}

const HIDDEN_TEXTAREA_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "0",
  left: "0",
  width: "1px",
  height: "1px",
  opacity: "0",
  padding: "0",
  border: "none",
  outline: "none",
  "pointer-events": "none",
  "z-index": "-1",
  resize: "none",
  overflow: "hidden",
};

const CanvasSurface: Component<CanvasSurfaceProps> = (props) => {
  const textareaProps = props.textareaProps ?? {};
  const textareaStyle = {
    ...HIDDEN_TEXTAREA_STYLE,
    ...(textareaProps.style as JSX.CSSProperties | undefined),
  };

  return (
    <div
      ref={props.containerRef}
      class={props.class}
      style={props.style}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      onMouseMove={props.onMouseMove}
      onMouseUp={props.onMouseUp}
      onWheel={props.onWheel}
      onContextMenu={props.onContextMenu}
    >
      <canvas
        ref={props.canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {props.a11y}
      {props.searchOverlay}
      <textarea
        {...textareaProps}
        ref={props.inputRef}
        style={textareaStyle}
      />
      {props.children}
    </div>
  );
};

export default CanvasSurface;
