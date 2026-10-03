import { For, Show, createResource, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { backgroundThumbnail } from "../lib/background-thumbnails";
import type { BackgroundItem } from "../lib/backgrounds";
import "../styles/backgrounds.css";

/** Settings → Appearances: saved WGSL backgrounds to pick from, plus strength and motion. */
export default function BackgroundGallery() {
  const { backgrounds } = useBuster();
  const state = backgrounds.state;
  const [error, setError] = createSignal("");
  const [confirming, setConfirming] = createSignal<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const Card = (props: { item: BackgroundItem }) => {
    const [renaming, setRenaming] = createSignal(false);
    const [name, setName] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    let renameButton!: HTMLButtonElement;
    const closeRename = () => { setRenaming(false); renameButton?.focus(); };
    const saveName = async () => {
      if (saving()) return;
      setSaving(true); setError("");
      try { await backgrounds.rename(props.item.id, name()); closeRename(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setSaving(false); }
    };
    const [image] = createResource(() => props.item.wgsl, wgsl => backgroundThumbnail(wgsl, backgrounds.compile).catch(() => ""));
    const selected = () => state.selected === props.item.id;
    return (
      <div class="bg-card" classList={{ "bg-card-selected": selected() }}>
        <button type="button" role="radio" aria-checked={selected()} class="bg-card-pick"
          title={props.item.prompt || props.item.name} onClick={() => void run(() => backgrounds.select(props.item.id))}>
          <Show when={image()} fallback={<span class="bg-thumb bg-thumb-empty">{image.loading ? "Rendering…" : "Can't preview"}</span>}>
            <img class="bg-thumb" src={image()} alt="" />
          </Show>
          <span class="bg-card-name">{props.item.name}</span>
          <Show when={props.item.prompt}><span class="bg-card-prompt">{props.item.prompt}</span></Show>
        </button>
        <button ref={renameButton} type="button" class="bg-card-rename" aria-label={`Rename ${props.item.name}`}
          onClick={() => { setName(props.item.name); setRenaming(true); }}>Rename</button>
        <Show when={renaming()}>
          <form class="bg-card-rename-form" onSubmit={e => { e.preventDefault(); void saveName(); }}
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!saving()) closeRename(); } }}>
            <input aria-label="Background name" value={name()} required disabled={saving()}
              ref={el => queueMicrotask(() => { el.focus(); el.select(); })}
              onInput={e => setName(e.currentTarget.value)} />
            <button type="submit" disabled={saving() || !name().trim()}>{saving() ? "Saving…" : "Save"}</button>
            <button type="button" disabled={saving()} onClick={closeRename}>Cancel</button>
          </form>
        </Show>
        <Show when={confirming() === props.item.id} fallback={
          <button type="button" class="bg-card-delete" aria-label={`Delete ${props.item.name}`} title="Delete" onClick={() => setConfirming(props.item.id)}>×</button>
        }>
          <div class="bg-card-confirm" role="group" aria-label={`Delete ${props.item.name}?`}>
            <span>Delete?</span>
            <button type="button" onClick={() => { setConfirming(null); void run(() => backgrounds.remove(props.item.id)); }}>Delete</button>
            <button type="button" onClick={() => setConfirming(null)}>Keep</button>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <section aria-label="Backgrounds" class="bg-gallery">
      <h2 class="settings-section-title">Backgrounds</h2>
      <p class="settings-section-description">Shader backgrounds drawn behind your notes. Ask the Language Model for one, such as "a slow violet aurora".</p>
      <div class="bg-grid" role="radiogroup" aria-label="Note background">
        <div class="bg-card" classList={{ "bg-card-selected": !state.selected }}>
          <button type="button" role="radio" aria-checked={!state.selected} class="bg-card-pick" onClick={() => void run(() => backgrounds.select(null))}>
            <span class="bg-thumb bg-thumb-none" />
            <span class="bg-card-name">None</span>
          </button>
        </div>
        <For each={state.items}>{item => <Card item={item} />}</For>
      </div>
      <Show when={state.loaded && !state.items.length}><p class="settings-desc bg-empty">No backgrounds yet.</p></Show>
      <div class="settings-row">
        <div class="settings-row-content">
          <div class="settings-info">
            <span class="settings-label" id="bg-strength-label">Strength</span>
            <span class="settings-desc">How strongly the background shows behind note text</span>
          </div>
          <div class="bg-strength">
            <input type="range" min="0" max="100" step="5" aria-labelledby="bg-strength-label" value={Math.round(state.strength * 100)}
              onChange={e => void run(() => backgrounds.configure({ strength: Number(e.currentTarget.value) / 100 }))} />
            <span class="settings-num-value">{Math.round(state.strength * 100)}%</span>
          </div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-content">
          <div class="settings-info">
            <span class="settings-label" id="bg-animate-label">Animate</span>
            <span class="settings-desc">Play the background's motion; off shows a still frame. Reduced-motion settings always show a still frame.</span>
          </div>
          <input type="checkbox" class="bg-animate" aria-labelledby="bg-animate-label" checked={state.animate}
            onChange={e => void run(() => backgrounds.configure({ animate: e.currentTarget.checked }))} />
        </div>
      </div>
      <Show when={error() || state.error}><p class="bg-error" role="alert">{error() || state.error}</p></Show>
      <div class="settings-section-divider" />
    </section>
  );
}
