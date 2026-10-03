import { invoke } from "@tauri-apps/api/core";
import { batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export interface BackgroundItem { id: string; name: string; prompt: string; createdAt: number; updatedAt: number; wgsl: string }
export interface BackgroundLibrary { version: number; selected: string | null; strength: number; animate: boolean; items: BackgroundItem[] }
export interface SaveBackground { id?: string; name: string; prompt: string; wgsl: string }

export interface BackgroundIpc {
  load(): Promise<BackgroundLibrary>;
  compile(wgsl: string): Promise<string>;
  save(request: SaveBackground): Promise<BackgroundItem>;
  remove(id: string): Promise<void>;
  configure(request: { selected?: string | null; strength?: number; animate?: boolean }): Promise<BackgroundLibrary>;
}

export const nativeBackgroundIpc: BackgroundIpc = {
  load: () => invoke<BackgroundLibrary>("backgrounds_load"),
  compile: wgsl => invoke<string>("background_compile", { wgsl }),
  save: request => invoke<BackgroundItem>("background_save", { request }),
  remove: id => invoke("background_delete", { id }),
  configure: request => invoke<BackgroundLibrary>("backgrounds_configure", { request }),
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The library of saved WGSL backgrounds, the selection, and translated GLSL for drawing. */
export function createBackgrounds(ipc: BackgroundIpc) {
  const [state, setState] = createStore({
    loaded: false,
    error: "",
    selected: null as string | null,
    strength: 0.35,
    animate: true,
    items: [] as BackgroundItem[],
  });
  // Keyed by source so edits recompile and identical shaders are shared.
  const translated = new Map<string, Promise<string>>();

  const apply = (library: BackgroundLibrary) => batch(() => {
    setState({ loaded: true, error: "", selected: library.selected, strength: library.strength, animate: library.animate });
    setState("items", reconcile(library.items, { key: "id" }));
  });

  async function load() {
    try { apply(await ipc.load()); }
    catch (error) { setState({ loaded: true, error: message(error) }); }
  }

  /** WGSL → GLSL ES 3.00. Rejects with naga's message when the shader is invalid. */
  function compile(wgsl: string): Promise<string> {
    let pending = translated.get(wgsl);
    if (!pending) {
      pending = ipc.compile(wgsl);
      translated.set(wgsl, pending);
      pending.catch(() => translated.delete(wgsl));
    }
    return pending;
  }

  const byId = (id: string | null) => (id ? state.items.find(item => item.id === id) : undefined);

  async function save(request: SaveBackground) {
    const item = await ipc.save(request);
    apply(await ipc.load());
    return item;
  }

  async function select(id: string | null) { apply(await ipc.configure({ selected: id })); }
  async function configure(options: { strength?: number; animate?: boolean }) { apply(await ipc.configure(options)); }
  async function remove(id: string) {
    await ipc.remove(id);
    apply(await ipc.load());
  }

  async function rename(id: string, name: string) {
    const item = byId(id);
    if (!item) throw new Error("This background no longer exists.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a background name.");
    return save({ id, name: trimmed, prompt: item.prompt, wgsl: item.wgsl });
  }

  return { state, load, compile, byId, selected: () => byId(state.selected), save, select, configure, remove, rename };
}

export type BackgroundService = ReturnType<typeof createBackgrounds>;
