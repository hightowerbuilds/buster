import { Component, createSignal, createEffect, on, For, Show } from "solid-js";
import type { DirEntry } from "../lib/ipc";
import { listDirectory, moveEntry, createFile, createDirectory, renameEntry, deleteEntry } from "../lib/ipc";
import { createFocusTrap } from "../lib/a11y";
import { join, relativeTo, isDescendant } from "buster-path";

export interface TreeNode extends DirEntry {
  children?: TreeNode[];
  expanded?: boolean;
  parentPath?: string;
}

const DRAG_THRESHOLD = 5;

// ── Drag state (module-level) ──
let dragNode: TreeNode | null = null;
let dragActive = false;
let suppressNextClick = false;

// Reactive signal mirrors dragActive for UI bindings (e.g. root drop zone)
export const [isDragging, setIsDragging] = createSignal(false);

// Fire-and-forget signal: set a directory path to make it refresh its children
export const [refreshDir, setRefreshDir] = createSignal<string | null>(null, { equals: false });

export function getDragNode(): TreeNode | null { return dragNode; }

// Context menu state (shared across tree items)
const [ctxMenu, setCtxMenu] = createSignal<{ x: number; y: number; path: string; relativePath: string; name: string; isDir: boolean; parentPath?: string; onRename?: () => void; onDeleted?: () => void } | null>(null);

// Delete confirmation modal state
const [deleteConfirm, setDeleteConfirm] = createSignal<{ path: string; name: string; isDir: boolean; onDeleted?: () => void } | null>(null);

function dismissCtxMenu() { setCtxMenu(null); }

// Listen for mousedown outside to dismiss (mousedown instead of click so it fires
// before focus changes, and we skip the right-click that opened the menu).
if (typeof document !== "undefined") {
  let skipNextMousedown = false;
  document.addEventListener("contextmenu", () => { skipNextMousedown = true; });
  document.addEventListener("mousedown", (e) => {
    if (skipNextMousedown) { skipNextMousedown = false; return; }
    if (!ctxMenu()) return;
    // Don't dismiss if clicking inside the context menu itself
    const target = e.target as HTMLElement;
    if (target.closest?.(".ctx-menu")) return;
    dismissCtxMenu();
  });
}

// ── TreeItem component ──────────────────────────────────────────

export const TreeItem: Component<{
  node: TreeNode;
  depth: number;
  onFileSelect: (path: string) => void;
  onMoved: () => void;
  workspaceRoot?: string;
  creatingChild?: { type: "file" | "folder" } | null;
  onCreatingChildDone?: () => void;
}> = (props) => {
  const [children, setChildren] = createSignal<TreeNode[]>([]);
  const [expanded, setExpanded] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [dropTarget, setDropTarget] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");

  function renderNodeLabel() {
    return <span class="tree-name" title={props.node.name}>{props.node.name}</span>;
  }

  async function toggle() {
    if (!props.node.is_dir) {
      props.onFileSelect(props.node.path);
      return;
    }
    if (!loaded()) {
      await loadChildren();
    }
    setExpanded(!expanded());
  }

  async function loadChildren() {
    try {
      const entries = await listDirectory(props.node.path);
      const prev = children();
      const prevMap = new Map(prev.map((o) => [o.path, o]));
      setChildren(entries.map((e) =>
        prevMap.get(e.path) || { ...e, children: [], expanded: false, parentPath: props.node.path }
      ));
      setLoaded(true);
    } catch (err) {
      console.error("Failed to list directory:", err);
    }
  }

  function refreshChildren() {
    setLoaded(false);
    if (expanded()) {
      loadChildren();
    }
  }

  // React to targeted refresh signals from drag-and-drop / rename / delete
  createEffect(on(refreshDir, (dir) => {
    if (dir && dir === props.node.path && loaded()) {
      loadChildren();
    }
  }, { defer: true }));

  function startRename() {
    setRenameValue(props.node.name);
    setRenaming(true);
  }

  async function commitRename() {
    const newName = renameValue().trim();
    setRenaming(false);
    if (!newName || newName === props.node.name) return;
    try {
      await renameEntry(props.node.path, newName);
      if (props.node.parentPath) setRefreshDir(props.node.parentPath);
    } catch (err) {
      console.error("Rename failed:", err);
    }
  }

  async function commitCreate(name: string, type: "file" | "folder") {
    const trimmed = name.trim();
    props.onCreatingChildDone?.();
    if (!trimmed) return;
    const fullPath = join(props.node.path, trimmed);
    try {
      if (type === "file") {
        await createFile(fullPath);
      } else {
        await createDirectory(fullPath);
      }
      await loadChildren();
      setExpanded(true);
    } catch (err) {
      console.error("Create failed:", err);
    }
  }

  function handleClick() {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (renaming()) return;
    toggle();
  }

  function handlePointerDown(e: PointerEvent) {
    if (renaming()) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      if (!dragActive && (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD)) {
        dragActive = true;
        dragNode = props.node;
        suppressNextClick = true;
        setIsDragging(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";

        let ghost = document.getElementById("sidebar-drag-ghost");
        if (!ghost) {
          ghost = document.createElement("div");
          ghost.id = "sidebar-drag-ghost";
          ghost.className = "sidebar-drag-ghost";
          document.body.appendChild(ghost);
        }
        ghost.textContent = props.node.name;
        ghost.style.display = "block";
      }
      if (dragActive) {
        const ghost = document.getElementById("sidebar-drag-ghost");
        if (ghost) {
          ghost.style.left = `${ev.clientX + 12}px`;
          ghost.style.top = `${ev.clientY - 8}px`;
        }
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      const ghost = document.getElementById("sidebar-drag-ghost");
      if (ghost) ghost.style.display = "none";

      const wasDragging = dragActive;
      dragActive = false;
      dragNode = null;
      setIsDragging(false);

      if (wasDragging) {
        requestAnimationFrame(() => { suppressNextClick = false; });
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handlePointerEnter() {
    if (dragActive && props.node.is_dir && dragNode
        && dragNode.path !== props.node.path
        && dragNode.parentPath !== props.node.path
        && !isDescendant(dragNode.path, props.node.path)) {
      setDropTarget(true);
    }
  }

  function handlePointerLeave() {
    setDropTarget(false);
  }

  async function handlePointerUp() {
    if (dragActive && dropTarget() && dragNode && dragNode.path !== props.node.path) {
      const sourceParent = dragNode.parentPath || null;
      try {
        await moveEntry(dragNode.path, props.node.path);
        refreshChildren();
        if (sourceParent) setRefreshDir(sourceParent);
      } catch (err) {
        console.error("Move failed:", err);
      }
    }
    setDropTarget(false);
  }

  function handleTreeKeyDown(e: KeyboardEvent) {
    if (renaming()) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight" && props.node.is_dir) {
      e.preventDefault();
      if (!expanded()) toggle();
    } else if (e.key === "ArrowLeft" && props.node.is_dir) {
      e.preventDefault();
      if (expanded()) setExpanded(false);
    }
  }

  return (
    <div role="treeitem" aria-expanded={props.node.is_dir ? expanded() : undefined} aria-label={props.node.name} aria-level={props.depth + 1}>
      <div
        class={`tree-item ${!props.node.is_dir ? "tree-file" : "tree-dir"} ${dropTarget() ? "tree-drop-target" : ""}`}
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleTreeKeyDown}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          const root = props.workspaceRoot || "";
          const rel = root ? relativeTo(root, props.node.path) : props.node.path;
          setCtxMenu({ x: e.clientX, y: e.clientY, path: props.node.path, relativePath: rel, name: props.node.name, isDir: props.node.is_dir, parentPath: props.node.parentPath, onRename: startRename, onDeleted: () => { if (props.node.parentPath) setRefreshDir(props.node.parentPath); } });
        }}
      >
        <span class="file-icon">
          {props.node.is_dir ? (expanded() ? "v" : ">") : "#"}
        </span>
        <Show when={renaming()} fallback={renderNodeLabel()}>
          <input
            class="tree-rename-input"
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
              e.stopPropagation();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
          />
        </Show>
      </div>
      <Show when={expanded()}>
        <div role="group">
          <Show when={props.creatingChild}>
            <div
              class="tree-item tree-file"
              style={{ "padding-left": `${(props.depth + 1) * 16 + 8}px` }}
            >
              <span class="file-icon">{props.creatingChild!.type === "folder" ? ">" : "#"}</span>
              <input
                class="tree-rename-input"
                placeholder={props.creatingChild!.type === "folder" ? "folder name" : "file name"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCreate(e.currentTarget.value, props.creatingChild!.type);
                  if (e.key === "Escape") props.onCreatingChildDone?.();
                  e.stopPropagation();
                }}
                onBlur={(e) => commitCreate(e.currentTarget.value, props.creatingChild!.type)}
                onClick={(e) => e.stopPropagation()}
                ref={(el) => setTimeout(() => el.focus(), 0)}
              />
            </div>
          </Show>
          <For each={children()}>
            {(child) => (
              <TreeItem
                node={child}
                depth={props.depth + 1}
                onFileSelect={props.onFileSelect}
                onMoved={props.onMoved}
                workspaceRoot={props.workspaceRoot}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// ── Context menu + Delete modal ────────────────────────────────

export const SidebarContextMenu: Component = () => {
  let ctxMenuRef: HTMLDivElement | undefined;
  let deleteModalRef: HTMLDivElement | undefined;

  const ctxTrap = createFocusTrap(() => ctxMenuRef, () => setCtxMenu(null));
  const deleteTrap = createFocusTrap(() => deleteModalRef, () => setDeleteConfirm(null));

  createEffect(on(ctxMenu, (m) => { if (m) ctxTrap.activate(); else ctxTrap.deactivate(); }));
  createEffect(on(deleteConfirm, (d) => { if (d) deleteTrap.activate(); else deleteTrap.deactivate(); }));

  return (
    <>
      <Show when={ctxMenu()}>
        {(() => {
          const menu = ctxMenu()!;
          return (
            <div
              ref={ctxMenuRef}
              class="ctx-menu"
              role="menu"
              style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            >
              <button
                class="ctx-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(menu.path);
                  setCtxMenu(null);
                }}
              >
                Copy Path
              </button>
              <button
                class="ctx-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(menu.relativePath);
                  setCtxMenu(null);
                }}
              >
                Copy Relative Path
              </button>
              <button
                class="ctx-menu-item"
                onClick={() => {
                  menu.onRename?.();
                  setCtxMenu(null);
                }}
              >
                Rename
              </button>
              <div class="ctx-menu-separator" />
              <button
                class="ctx-menu-item ctx-menu-item-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  const info = { path: menu.path, name: menu.name, isDir: menu.isDir, onDeleted: menu.onDeleted };
                  setCtxMenu(null);
                  // Delay so the modal doesn't render during the same click event
                  requestAnimationFrame(() => setDeleteConfirm(info));
                }}
              >
                Delete
              </button>
            </div>
          );
        })()}
      </Show>

      <Show when={deleteConfirm()}>
        {(() => {
          const info = deleteConfirm()!;
          return (
            <div class="delete-modal-backdrop" onClick={() => setDeleteConfirm(null)}>
              <div ref={deleteModalRef} class="delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-body" onClick={(e) => e.stopPropagation()}>
                <div id="delete-modal-title" class="delete-modal-title">Delete {info.isDir ? "Folder" : "File"}</div>
                <div id="delete-modal-body" class="delete-modal-body">
                  Are you sure you want to delete <strong>{info.name}</strong>?
                  {info.isDir && <span> This will delete all contents inside it.</span>}
                  <br />This cannot be undone.
                </div>
                <div class="delete-modal-actions">
                  <button class="delete-modal-btn delete-modal-cancel" onClick={() => setDeleteConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    class="delete-modal-btn delete-modal-confirm"
                    onClick={async () => {
                      try {
                        await deleteEntry(info.path);
                        info.onDeleted?.();
                      } catch (err) {
                        console.error("Delete failed:", err);
                      }
                      setDeleteConfirm(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </Show>
    </>
  );
};
