import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { gitConflictMarkers, gitResolveConflict, readFile } from "../lib/ipc";
import type { ConflictRegion } from "../lib/ipc";
import { createFocusTrap } from "../lib/a11y";

interface ConflictResolverProps {
  filePath: string;
  workspaceRoot: string;
  onResolved: () => void;
  onCancel: () => void;
}

type Resolution = "ours" | "theirs" | "both" | null;

const ConflictResolver: Component<ConflictResolverProps> = (props) => {
  const [regions, setRegions] = createSignal<ConflictRegion[]>([]);
  const [resolutions, setResolutions] = createSignal<Resolution[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [fileContent, setFileContent] = createSignal("");

  onMount(async () => {
    try {
      const markers = await gitConflictMarkers(props.workspaceRoot, props.filePath);
      setRegions(markers);
      setResolutions(new Array(markers.length).fill(null));

      const file = await readFile(props.workspaceRoot + "/" + props.filePath);
      setFileContent(file.content);
    } catch (err) {
      console.error("Failed to load conflict markers:", err);
    }
    setLoading(false);
  });

  function setResolution(index: number, choice: Resolution) {
    const updated = [...resolutions()];
    updated[index] = choice;
    setResolutions(updated);
  }

  function allResolved() {
    return resolutions().length > 0 && resolutions().every((r) => r !== null);
  }

  function buildResolvedContent(): string {
    const lines = fileContent().split("\n");
    const result: string[] = [];
    let i = 0;
    const regs = regions();
    let regIdx = 0;

    while (i < lines.length) {
      if (regIdx < regs.length && lines[i].startsWith("<<<<<<<")) {
        const resolution = resolutions()[regIdx];
        const region = regs[regIdx];

        // Skip past the conflict markers
        // Find ======= and >>>>>>>
        i++; // skip <<<<<<<
        while (i < lines.length && !lines[i].startsWith("=======")) {
          i++;
        }
        i++; // skip =======
        while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
          i++;
        }
        i++; // skip >>>>>>>

        // Insert the resolved content
        if (resolution === "ours" && region.ours) {
          result.push(region.ours);
        } else if (resolution === "theirs" && region.theirs) {
          result.push(region.theirs);
        } else if (resolution === "both") {
          if (region.ours) result.push(region.ours);
          if (region.theirs) result.push(region.theirs);
        }

        regIdx++;
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join("\n");
  }

  async function handleSave() {
    if (!allResolved()) return;
    setSaving(true);
    try {
      const content = buildResolvedContent();
      await gitResolveConflict(props.workspaceRoot, props.filePath, content);
      props.onResolved();
    } catch (err) {
      console.error("Failed to resolve conflict:", err);
    }
    setSaving(false);
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("conflict-overlay")) {
      props.onCancel();
    }
  }

  let dialogRef: HTMLDivElement | undefined;
  const trap = createFocusTrap(() => dialogRef, () => props.onCancel());
  onMount(() => trap.activate());
  onCleanup(() => trap.deactivate());

  return (
    <div class="conflict-overlay" onClick={handleOverlayClick}>
      <div ref={dialogRef} class="conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-filepath">
        <div id="conflict-title" class="conflict-title">Resolve Conflicts</div>
        <div id="conflict-filepath" class="conflict-filepath">{props.filePath}</div>

        <Show when={loading()}>
          <div class="conflict-loading">Loading conflict regions...</div>
        </Show>

        <Show when={!loading() && regions().length === 0}>
          <div class="conflict-empty">No conflict markers found in this file.</div>
        </Show>

        <Show when={!loading() && regions().length > 0}>
          <For each={regions()}>
            {(region, idx) => (
              <div class="conflict-region">
                <div class="conflict-region-header">
                  Conflict {idx() + 1} (lines {region.start_line}-{region.end_line})
                  <Show when={resolutions()[idx()] !== null}>
                    <span class="conflict-resolved-badge">resolved</span>
                  </Show>
                </div>
                <div class="conflict-ours">
                  <div class="conflict-ours-label">Ours</div>
                  {region.ours || "(empty)"}
                </div>
                <div class="conflict-theirs">
                  <div class="conflict-theirs-label">Theirs</div>
                  {region.theirs || "(empty)"}
                </div>
                <div class="conflict-buttons">
                  <button
                    class={`conflict-btn ${resolutions()[idx()] === "ours" ? "conflict-btn-active" : ""}`}
                    onClick={() => setResolution(idx(), "ours")}
                  >
                    Accept Ours
                  </button>
                  <button
                    class={`conflict-btn ${resolutions()[idx()] === "theirs" ? "conflict-btn-active" : ""}`}
                    onClick={() => setResolution(idx(), "theirs")}
                  >
                    Accept Theirs
                  </button>
                  <button
                    class={`conflict-btn ${resolutions()[idx()] === "both" ? "conflict-btn-active" : ""}`}
                    onClick={() => setResolution(idx(), "both")}
                  >
                    Accept Both
                  </button>
                </div>
              </div>
            )}
          </For>

          <div class="conflict-actions">
            <button class="conflict-cancel-btn" onClick={props.onCancel}>
              Cancel
            </button>
            <button
              class="conflict-save-btn"
              disabled={!allResolved() || saving()}
              onClick={handleSave}
            >
              {saving() ? "Saving..." : "Save Resolution"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default ConflictResolver;
