import { Component, createSignal, createEffect, on, For, Show } from "solid-js";
import { listDirectory, createFile, createDirectory, moveEntry } from "../lib/ipc";
import { TreeItem, SidebarContextMenu, type TreeNode, isDragging, getDragNode, refreshDir, setRefreshDir } from "./SidebarTree";
import { basename } from "buster-path";

interface SidebarProps {
  onFileSelect: (path: string) => void;
  onFolderOpen?: (path: string) => void;
  onChangeDirectory?: () => void;
  onCloseDirectory?: () => void;
  onHideSidebar?: () => void;
  onPopOut?: () => void;
  onReturn?: () => void;
  poppedOut?: boolean;
  workspaceRoot?: string | null;
}

const Sidebar: Component<SidebarProps> = (props) => {
  const [rootEntries, setRootEntries] = createSignal<TreeNode[]>([]);
  const [rootPath, setRootPath] = createSignal<string | null>(null);
  const [creatingRoot, setCreatingRoot] = createSignal<{ type: "file" | "folder" } | null>(null);
  const [rootDropTarget, setRootDropTarget] = createSignal(false);

  createEffect(
    on(
      () => props.workspaceRoot,
      (newRoot) => {
        if (newRoot && newRoot !== rootPath()) {
          setRootPath(newRoot);
          refreshRoot(newRoot);
        } else if (!newRoot) {
          setRootPath(null);
          setRootEntries([]);
        }
      }
    )
  );

  async function openFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true });
    if (selected) {
      setRootPath(selected as string);
      props.onFolderOpen?.(selected as string);
      await refreshRoot(selected as string);
    }
  }

  async function refreshRoot(path?: string) {
    const p = path || rootPath();
    if (!p) return;
    try {
      const entries = await listDirectory(p);
      const prev = rootEntries();
      const prevMap = new Map(prev.map((o) => [o.path, o]));
      setRootEntries(entries.map((e) =>
        prevMap.get(e.path) || { ...e, children: [], expanded: false, parentPath: p }
      ));
    } catch (err) {
      console.error("Failed to list directory:", err);
    }
  }

  async function handleRootCreate(name: string, type: "file" | "folder") {
    const trimmed = name.trim();
    setCreatingRoot(null);
    if (!trimmed || !rootPath()) return;
    const fullPath = rootPath()! + "/" + trimmed;
    try {
      if (type === "file") {
        await createFile(fullPath);
      } else {
        await createDirectory(fullPath);
      }
      await refreshRoot();
    } catch (err) {
      console.error("Create failed:", err);
    }
  }

  // ── Root drop zone handlers ──
  function handleRootPointerEnter() {
    const node = getDragNode();
    if (isDragging() && node && node.parentPath !== rootPath()) {
      setRootDropTarget(true);
    }
  }

  function handleRootPointerLeave() {
    setRootDropTarget(false);
  }

  async function handleRootDrop() {
    const node = getDragNode();
    if (!isDragging() || !node || !rootDropTarget()) { setRootDropTarget(false); return; }
    const root = rootPath();
    if (!root) { setRootDropTarget(false); return; }
    const sourceParent = node.parentPath || null;
    try {
      await moveEntry(node.path, root);
      await refreshRoot();
      if (sourceParent && sourceParent !== root) setRefreshDir(sourceParent);
    } catch (err) {
      console.error("Move to root failed:", err);
    }
    setRootDropTarget(false);
  }

  // Targeted refresh: when refreshDir matches root, re-list root entries
  createEffect(on(refreshDir, (dir) => {
    if (dir && dir === rootPath()) refreshRoot();
  }, { defer: true }));

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">
          {rootPath()
            ? basename(rootPath()!) || rootPath()
            : "Explorer"}
        </span>
        <div class="sidebar-header-actions">
          <Show when={!props.poppedOut}>
            <button
              class="btn-icon sidebar-collapse-btn"
              title="Hide Sidebar"
              aria-label="Hide Sidebar"
              onClick={() => props.onHideSidebar?.()}
            >&laquo;</button>
          </Show>
          <button
            class="btn-icon sidebar-popout-btn"
            title={props.poppedOut ? "Return to sidebar" : "Pop out to tab"}
            onClick={() => props.poppedOut ? props.onReturn?.() : props.onPopOut?.()}
          >{props.poppedOut ? "Return" : "Pop Out"}</button>
        </div>
      </div>
      <div class="sidebar-actions-bar">
        <button
          class="btn-icon"
          title="Open Directory"
          onClick={() => props.onChangeDirectory ? props.onChangeDirectory() : openFolder()}
        >Open</button>
        <button
          class="btn-icon"
          title="New File"
          onClick={() => rootPath() ? setCreatingRoot({ type: "file" }) : openFolder()}
        >New File</button>
        <button
          class="btn-icon"
          title="New Folder"
          onClick={() => rootPath() ? setCreatingRoot({ type: "folder" }) : openFolder()}
        >New Folder</button>
        <Show when={rootPath()}>
          <button
            class="btn-icon"
            title="Close Directory"
            onClick={() => props.onCloseDirectory?.()}
          >Close</button>
        </Show>
      </div>

      <Show
        when={rootPath()}
        fallback={
          <div class="sidebar-empty">
            <button class="btn" onClick={openFolder}>Open Folder</button>
          </div>
        }
      >
        <div class="tree" role="tree" aria-label="File explorer">
          <Show when={creatingRoot()}>
            <div
              class="tree-item tree-file"
              style={{ "padding-left": "8px" }}
            >
              <span class="file-icon">{creatingRoot()!.type === "folder" ? ">" : "#"}</span>
              <input
                class="tree-rename-input"
                placeholder={creatingRoot()!.type === "folder" ? "folder name" : "file name"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRootCreate(e.currentTarget.value, creatingRoot()!.type);
                  if (e.key === "Escape") setCreatingRoot(null);
                  e.stopPropagation();
                }}
                onBlur={(e) => handleRootCreate(e.currentTarget.value, creatingRoot()!.type)}
                onClick={(e) => e.stopPropagation()}
                ref={(el) => setTimeout(() => el.focus(), 0)}
              />
            </div>
          </Show>
          <For each={rootEntries()}>
            {(entry) => (
              <TreeItem
                node={entry}
                depth={0}
                onFileSelect={props.onFileSelect}
                onMoved={() => refreshRoot()}
                workspaceRoot={rootPath() || undefined}
              />
            )}
          </For>
          <Show when={isDragging()}>
            <div
              class={`tree-root-zone ${rootDropTarget() ? "tree-drop-target" : ""}`}
              onPointerEnter={handleRootPointerEnter}
              onPointerLeave={handleRootPointerLeave}
              onPointerUp={handleRootDrop}
            >
              / {(rootPath() ? basename(rootPath()!) : "") || "root"}
            </div>
          </Show>
        </div>
      </Show>

      <SidebarContextMenu />
    </div>
  );
};

export default Sidebar;
