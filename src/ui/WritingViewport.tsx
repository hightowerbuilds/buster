import { createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { writingViewportBox } from "../editor/writing-viewport";
import { writingPalette } from "../editor/writing-effects";

/** One DOM coordinate origin for canvas, GPU, mouse, selection overlays and IME. */
export default function WritingViewport(props: { tabId: string; markdown: boolean; children: JSX.Element }) {
  const { store, appearance } = useBuster();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  let root!: HTMLDivElement;
  let inner!: HTMLDivElement;
  const paneId = () => store.paneWorkspace.panes.find(pane => pane.tabId === props.tabId)?.id;
  const box = createMemo(() => writingViewportBox(size().width, size().height, appearance.forPane(paneId()), props.markdown));
  const background = createMemo(() => props.markdown ? writingPalette(store.palette, appearance.forPane(paneId())).editorBg : store.palette.editorBg);
  onMount(() => {
    const measure = () => setSize({ width: root.clientWidth, height: root.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  return <div ref={root} class="writing-viewport" data-markdown={props.markdown ? "true" : "false"}
    style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", "min-width": "0", "min-height": "0", background: background() }}
    onMouseDown={event => {
      if (event.target !== root || event.button !== 0) return;
      event.preventDefault();
      inner.querySelector<HTMLTextAreaElement>(".canvas-editor textarea")?.focus({ preventScroll: true });
    }}
    onWheel={event => {
      if (event.target !== root) return;
      event.preventDefault();
      inner.querySelector(".canvas-editor")?.dispatchEvent(new WheelEvent("wheel", {
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, cancelable: true,
      }));
    }}>
    <div ref={inner} class="writing-viewport-column" style={{ position: "absolute", left: `${box().left}px`, top: `${box().top}px`, width: `${box().width}px`, height: `${box().height}px` }}>
      {props.children}
    </div>
  </div>;
}
