import { For, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { useBuster } from "../lib/buster-context";
import { createFocusTrap } from "../lib/a11y";
import { showError } from "../lib/notify";
import { DEFAULT_WRITING_APPEARANCE, type WritingAppearanceValues, type AppearanceScope } from "../lib/writing-appearance";
import "../styles/writing-layout.css";

export default function WritingLayoutControls() {
  const { store, appearance } = useBuster();
  const [open, setOpen] = createSignal(false);
  const [paneId, setPaneId] = createSignal("");
  const [workspaceId, setWorkspaceId] = createSignal("");
  const [scope, setScope] = createSignal<AppearanceScope>("pane");
  const [draft, setDraft] = createSignal<WritingAppearanceValues>({ ...DEFAULT_WRITING_APPEARANCE });
  const [baseline, setBaseline] = createSignal<WritingAppearanceValues>({ ...DEFAULT_WRITING_APPEARANCE });
  const [revision, setRevision] = createSignal(0);
  const [message, setMessage] = createSignal("");
  const [ownedPreview, setOwnedPreview] = createSignal("");
  const [preset, setPreset] = createSignal("Quiet");
  const [presetName, setPresetName] = createSignal("");
  let dialog: HTMLDivElement | undefined;
  function cancelOwnedPreview() {
    const id = ownedPreview();
    if (id && appearance.state.preview?.id === id) appearance.cancelPreview(id, appearance.state.revision);
    setOwnedPreview("");
  }
  const close = () => { cancelOwnedPreview(); setOpen(false); trap.deactivate(); };
  const trap = createFocusTrap(() => dialog, close);
  onCleanup(() => { cancelOwnedPreview(); if (open()) trap.deactivate(); });
  const target = () => ({ scope: scope(), ...(scope() === "pane" ? { paneId: paneId() } : scope() === "workspace" ? { workspaceId: workspaceId() } : {}), revision: revision() });
  function load() {
    try {
      const current = appearance.inspect(scope() === "pane" ? paneId() : undefined, scope() === "workspace" ? workspaceId() : undefined);
      setDraft({ ...current.effective }); setBaseline({ ...current.committed }); setRevision(current.revision); setMessage(current.warning);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function run(action: () => unknown) {
    try { action(); if (appearance.state.preview?.id !== ownedPreview()) setOwnedPreview(""); if (open()) load(); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setMessage(message); if (!open()) showError(message); }
  }
  function changes() {
    const patch: Partial<WritingAppearanceValues> = {};
    for (const key of Object.keys(draft()) as (keyof WritingAppearanceValues)[]) if (draft()[key] !== baseline()[key]) Object.assign(patch, { [key]: draft()[key] });
    return patch;
  }
  function apply() {
    const patch = changes();
    if (Object.keys(patch).length) run(() => appearance.apply({ ...target(), changes: patch }));
    else if (ownedPreview() && appearance.state.preview?.id === ownedPreview()) run(() => appearance.cancelPreview(ownedPreview(), revision()));
    else setMessage("No appearance changes to apply.");
  }
  function preview() {
    const patch = changes();
    if (!Object.keys(patch).length) {
      if (ownedPreview() && appearance.state.preview?.id === ownedPreview()) run(() => appearance.cancelPreview(ownedPreview(), revision()));
      else setMessage("Change a setting to preview it.");
      return;
    }
    try {
      const current = appearance.preview({ ...target(), changes: patch, ...(ownedPreview() ? { previewId: ownedPreview() } : {}) });
      setOwnedPreview(current.preview!.id); setRevision(current.revision); setMessage("Preview is temporary. Apply to keep it, or cancel to restore your appearance.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  const fields = [["paddingTop", "Top padding"], ["paddingBottom", "Bottom padding"], ["paddingLeft", "Left padding"], ["paddingRight", "Right padding"]] as const;
  const effects = [["cursorGlow", "Cursor glow", -1, 100], ["vignette", "Vignette", -1, 100], ["grain", "Grain", -1, 100], ["focusDim", "Surrounding line dimming", 0, 0.45], ["typingPulse", "Typing pulse", 0, 1], ["effectDuration", "Pulse duration (ms)", 100, 1000]] as const;
  return <>
    <button onClick={() => { setPaneId(store.paneWorkspace.activePaneId); setWorkspaceId(appearance.workspaceId() ?? ""); setScope("pane"); setOwnedPreview(""); load(); setOpen(true); trap.activate(); }}>Writing appearance</button>
    <button title="Stop writing effects across all panes" onClick={() => run(() => appearance.stopEffects(appearance.state.revision))}>Stop effects</button>
    <Show when={open()}><Portal>
      <div class="writing-layout-overlay" onClick={close}>
        <div ref={dialog} class="writing-layout-dialog" role="dialog" aria-modal="true" aria-labelledby="writing-layout-title" onClick={e => e.stopPropagation()}>
          <div class="writing-layout-heading"><h2 id="writing-layout-title">Writing appearance</h2><button aria-label="Close writing appearance" onClick={close}>×</button></div>
          <p>Layout and optional effects for Markdown notes. Narrow panes reduce padding to keep text readable.</p>
          <label>Apply to<select value={scope()} onChange={e => { cancelOwnedPreview(); setScope(e.currentTarget.value as AppearanceScope); load(); }}>
            <option value="pane">This pane · this session</option><option value="workspace" disabled={!workspaceId()}>This workspace · remembered</option><option value="app">App defaults · remembered</option>
          </select></label>
          <form onSubmit={e => { e.preventDefault(); apply(); }}>
            <div class="writing-layout-grid"><For each={fields}>{([key, label]) => <label>{label} (px)
              <input type="number" min="0" max="160" step="any" required value={draft()[key]} onInput={e => setDraft({ ...draft(), [key]: e.currentTarget.valueAsNumber })}/>
            </label>}</For></div>
            <label>Column width (px; 0 fills the pane)<input type="number" min="0" max="1600" step="any" required value={draft().columnWidth} onInput={e => setDraft({ ...draft(), columnWidth: e.currentTarget.valueAsNumber })}/></label>
            <p class="writing-layout-hint">Fixed columns: 320–1600 px, including line numbers.</p>
            <label>Alignment<select value={draft().alignment} onChange={e => setDraft({ ...draft(), alignment: e.currentTarget.value as "left" | "center" })}><option value="left">Left</option><option value="center">Center</option></select></label>
            <details><summary>Typography and atmosphere</summary>
              <label>Font size (px; 0 uses editor settings)<input type="number" min="0" max="32" step="any" required value={draft().fontSize} onInput={e => setDraft({ ...draft(), fontSize: e.currentTarget.valueAsNumber })}/></label>
              <p class="writing-layout-hint">Custom size: 10–32 px. Font family uses the existing global editor setting.</p>
              <label>Line spacing (0 for default; 1.2–2.4 × font size)<input type="number" min="0" max="2.4" step="any" required value={draft().lineHeight} onInput={e => setDraft({ ...draft(), lineHeight: e.currentTarget.valueAsNumber })}/></label>
              <label>Page colors<select value={draft().background} onChange={e => setDraft({ ...draft(), background: e.currentTarget.value as WritingAppearanceValues["background"] })}><option value="theme">Current theme</option><option value="paper">Paper</option><option value="midnight">Midnight</option><option value="sage">Sage</option></select></label>
              <div class="writing-layout-grid"><For each={effects}>{([key, label, min, max]) => <label>{label}<input type="number" min={min} max={max} step="any" required value={draft()[key]} onInput={e => setDraft({ ...draft(), [key]: e.currentTarget.valueAsNumber })}/></label>}</For></div>
              <p class="writing-layout-hint">Glow, vignette and grain: 0–100, or -1 to follow your theme. Dimming: 0–0.45. Pulse: 0–1. Effects preserve readable text and selection.</p>
              <label class="writing-motion"><input type="checkbox" checked={draft().motion} onChange={e => setDraft({ ...draft(), motion: e.currentTarget.checked })}/>Allow typing animation (respects Reduce Motion)</label>
            </details>
            <Show when={revision() !== appearance.state.revision}><p role="status">Appearance changed while this panel was open. Reload before applying.</p></Show>
            <Show when={message()}><p role="status">{message()}</p></Show>
            <div class="writing-layout-buttons"><button type="button" onClick={() => { cancelOwnedPreview(); load(); }}>Reload</button><button type="button" onClick={preview}>Preview</button><button type="submit">Apply</button></div>
          </form>
          <Show when={appearance.state.preview}><p class="writing-layout-hint">A temporary preview is active.</p><button onClick={() => run(() => { const p = appearance.state.preview; if (p) appearance.cancelPreview(p.id, revision()); setOwnedPreview(""); })}>Cancel preview</button></Show>
          <details class="writing-presets"><summary>Saved appearances</summary>
            <label>Appearance<select value={preset()} onChange={e => setPreset(e.currentTarget.value)}><For each={appearance.presets().presets}>{item => <option value={item.name}>{item.name}{item.builtin ? "" : " · saved"}</option>}</For></select></label>
            <div class="writing-layout-buttons"><button onClick={() => run(() => appearance.applyPreset({ ...target(), name: preset() }))}>Use appearance</button><button disabled={!appearance.state.presets.some(item => item.name === preset())} onClick={() => run(() => { appearance.deletePreset(preset(), revision()); setPreset("Quiet"); })}>Delete saved</button></div>
            <label>Save current appearance as<input maxLength={48} value={presetName()} onInput={e => setPresetName(e.currentTarget.value)}/></label>
            <p class="writing-layout-hint">Saves the current applied or previewed appearance. Apply or preview your form changes first. An existing custom name is replaced.</p>
            <button disabled={!presetName().trim()} onClick={() => run(() => appearance.savePreset({ ...target(), name: presetName() }))}>Save appearance</button>
          </details>
          <div class="writing-layout-buttons"><button onClick={() => run(() => appearance.reset(target()))}>{scope() === "app" ? "Reset app defaults" : "Use inherited defaults"}</button><button disabled={!appearance.state.historyLength} onClick={() => run(() => appearance.revert(revision()))}>Revert last change</button></div>
          <p class="writing-layout-hint">Pane overrides workspace, then app defaults. Preview ends when closed. Revert changes appearance across scopes; writing and text undo stay intact.</p>
        </div>
      </div>
    </Portal></Show>
  </>;
}
