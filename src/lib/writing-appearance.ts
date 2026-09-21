import { batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { CommandFailure, emptyArgs, objectResult, type CommandSchema, type FeatureCommands } from "./feature-commands";

export interface WritingLayout {
  paddingTop: number; paddingBottom: number; paddingLeft: number; paddingRight: number;
  columnWidth: number; alignment: "left" | "center";
}
export interface WritingAppearanceValues extends WritingLayout {
  fontSize: number; lineHeight: number; background: "theme" | "paper" | "midnight" | "sage";
  focusDim: number; cursorGlow: number; vignette: number; grain: number;
  typingPulse: number; motion: boolean; effectDuration: number;
}
export const DEFAULT_WRITING_LAYOUT: WritingLayout = {
  paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24, columnWidth: 0, alignment: "left",
};
export const DEFAULT_WRITING_APPEARANCE: WritingAppearanceValues = {
  ...DEFAULT_WRITING_LAYOUT, fontSize: 0, lineHeight: 0, background: "theme", focusDim: 0,
  cursorGlow: -1, vignette: -1, grain: -1, typingPulse: 0, motion: true, effectDuration: 240,
};
export const WRITING_APPEARANCE_KEY = "bustermark-writing-layout-v1";
export type AppearanceScope = "app" | "workspace" | "pane";
export interface AppearanceTarget { scope: AppearanceScope; paneId?: string; workspaceId?: string; revision: number }
type Patch = Partial<WritingAppearanceValues>;
interface Preset { name: string; values: WritingAppearanceValues }
interface Snapshot { app: WritingAppearanceValues; workspaces: Record<string, Patch>; panes: Record<string, Patch>; presets: Preset[] }
interface Preview { id: string; scope: AppearanceScope; paneId?: string; workspaceId?: string; changes: Patch }
interface Deps { paneIds(): string[]; workspaceId?(): string | null; load(): string | null; save(value: string): void }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const fail = (code: string, message: string): never => { throw new CommandFailure(code, message); };
const numeric: Record<string, { min: number; max: number; special?: number; unit?: string }> = {
  paddingTop: { min: 0, max: 160, unit: "px" }, paddingBottom: { min: 0, max: 160, unit: "px" },
  paddingLeft: { min: 0, max: 160, unit: "px" }, paddingRight: { min: 0, max: 160, unit: "px" },
  columnWidth: { min: 320, max: 1600, special: 0, unit: "px including gutter" },
  fontSize: { min: 10, max: 32, special: 0, unit: "px; 0 inherits editor settings" },
  lineHeight: { min: 1.2, max: 2.4, special: 0, unit: "font-size multiplier; 0 uses font size + 8 px" },
  focusDim: { min: 0, max: 0.45 }, cursorGlow: { min: 0, max: 100, special: -1 },
  vignette: { min: 0, max: 100, special: -1 }, grain: { min: 0, max: 100, special: -1 },
  typingPulse: { min: 0, max: 1 }, effectDuration: { min: 100, max: 1000, unit: "ms" },
};
const enums = { alignment: ["left", "center"], background: ["theme", "paper", "midnight", "sage"] };
const effectKeys = ["focusDim", "cursorGlow", "vignette", "grain", "typingPulse", "motion", "effectDuration"] as const;
const stopped: Patch = { focusDim: 0, cursorGlow: 0, vignette: 0, grain: 0, typingPulse: 0, motion: false };
export const BUILTIN_WRITING_PRESETS: Preset[] = [
  { name: "Quiet", values: { ...DEFAULT_WRITING_APPEARANCE, ...stopped } },
  { name: "Reading room", values: { ...DEFAULT_WRITING_APPEARANCE, columnWidth: 800, alignment: "center", fontSize: 16, lineHeight: 1.65, background: "paper", ...stopped } },
  { name: "Night focus", values: { ...DEFAULT_WRITING_APPEARANCE, columnWidth: 760, alignment: "center", background: "midnight", focusDim: 0.18, cursorGlow: 20, vignette: 12, grain: 0, typingPulse: 0.12 } },
];
function owns(value: object, key: string) { return Object.prototype.hasOwnProperty.call(value, key); }
function validatePatch(value: unknown): asserts value is Patch {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) fail("INVALID_ARGUMENTS", "Provide at least one supported writing appearance property.");
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (owns(numeric, key)) {
      const spec = numeric[key];
      if (typeof item !== "number" || !Number.isFinite(item) || (item !== spec.special && (item < spec.min || item > spec.max)))
        fail("INVALID_ARGUMENTS", `${key} must be ${spec.min}–${spec.max}${spec.special === undefined ? "" : `, or ${spec.special} for its default behavior`}.`);
    } else if (owns(enums, key)) {
      if (!(enums[key as keyof typeof enums] as readonly unknown[]).includes(item)) fail("INVALID_ARGUMENTS", `Unsupported ${key}.`);
    } else if (key === "motion") {
      if (typeof item !== "boolean") fail("INVALID_ARGUMENTS", "Motion must be true or false.");
    } else fail("INVALID_ARGUMENTS", `Unsupported writing appearance property: ${key}`);
  }
}
function safeKey(key: string) { return key && !["__proto__", "constructor", "prototype"].includes(key); }

export function createWritingAppearance(deps: Deps) {
  let initial: Snapshot = { app: { ...DEFAULT_WRITING_APPEARANCE }, workspaces: {}, panes: {}, presets: [] }, warning = "";
  try {
    const raw = deps.load();
    if (raw !== null) {
      const saved = JSON.parse(raw);
      if (saved.version !== 1) throw new Error("Unknown preference version");
      validatePatch(saved.app);
      const workspaces: Record<string, Patch> = {};
      if (saved.workspaces !== undefined) {
        if (!saved.workspaces || typeof saved.workspaces !== "object" || Array.isArray(saved.workspaces)) throw new Error("Invalid workspaces");
        for (const [id, patch] of Object.entries(saved.workspaces)) { if (!safeKey(id)) throw new Error("Invalid workspace"); validatePatch(patch); workspaces[id] = patch; }
      }
      const presets: Preset[] = saved.presets ?? [];
      if (!Array.isArray(presets) || presets.length > 30) throw new Error("Invalid presets");
      const names = new Set(BUILTIN_WRITING_PRESETS.map(p => p.name));
      for (const preset of presets) {
        if (typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 48 || names.has(preset.name)) throw new Error("Invalid preset name");
        names.add(preset.name); validatePatch(preset.values); preset.values = { ...DEFAULT_WRITING_APPEARANCE, ...preset.values };
      }
      initial = { app: { ...DEFAULT_WRITING_APPEARANCE, ...saved.app }, workspaces, panes: {}, presets };
    }
  } catch { warning = "Saved writing appearance could not be loaded. Defaults are in use; saved data stays intact until you save appearance preferences."; }
  const [state, setState] = createStore<Snapshot & { revision: number; warning: string; historyLength: number; preview: Preview | null }>({ ...initial, revision: 0, warning, historyLength: 0, preview: null });
  const history: Snapshot[] = [];
  const workspaceId = () => deps.workspaceId?.() || null;
  const snapshot = (): Snapshot => clone({ app: state.app, workspaces: state.workspaces, panes: state.panes, presets: state.presets });
  function requirePane(id: string | undefined) { if (!id || !safeKey(id) || !deps.paneIds().includes(id)) fail("NOT_FOUND", "This writing pane no longer exists."); return id!; }
  function requireWorkspace(id: string | undefined) { if (!id || !safeKey(id) || id !== workspaceId()) fail("NOT_FOUND", "The targeted workspace is no longer open."); return id!; }
  function forPane(paneId?: string): WritingAppearanceValues {
    const id = workspaceId(), p = state.preview;
    return { ...state.app, ...(p?.scope === "app" ? p.changes : {}),
      ...(id ? state.workspaces[id] : {}), ...(p?.scope === "workspace" && p.workspaceId === id ? p.changes : {}),
      ...(paneId && deps.paneIds().includes(paneId) ? state.panes[paneId] : {}),
      ...(p?.scope === "pane" && p.paneId === paneId && deps.paneIds().includes(paneId!) ? p.changes : {}) };
  }
  function inspect(paneId?: string, workspace?: string) {
    if (paneId !== undefined) requirePane(paneId);
    if (workspace !== undefined) requireWorkspace(workspace);
    if (paneId && workspace) fail("INVALID_ARGUMENTS", "Inspect a pane or a workspace, not both.");
    const scope: AppearanceScope = paneId ? "pane" : workspace ? "workspace" : "app";
    const committed = { ...state.app, ...(scope !== "app" && workspaceId() ? state.workspaces[workspaceId()!] : {}), ...(paneId ? state.panes[paneId] : {}) };
    const p = state.preview;
    const effective = scope === "pane" ? forPane(paneId) : { ...state.app, ...(p?.scope === "app" ? p.changes : {}), ...(workspace ? state.workspaces[workspace] : {}), ...(workspace && p?.scope === "workspace" && p.workspaceId === workspace ? p.changes : {}) };
    return { revision: state.revision, scope, paneId: paneId ?? null, workspaceId: workspace ?? (paneId ? workspaceId() : null),
      effective: clone(effective), committed: clone(committed), overrides: clone(paneId ? state.panes[paneId] ?? {} : workspace ? state.workspaces[workspace] ?? {} : {}),
      app: clone(state.app), persistence: paneId ? "session" : "local", warning: state.warning, preview: p ? clone(p) : null, canRevert: state.historyLength > 0 };
  }
  function checkRevision(revision: number) { if (!Number.isInteger(revision) || revision !== state.revision) fail("STALE_APPEARANCE", "Writing appearance changed. Reload its current values before applying your change."); }
  function validateTarget(target: AppearanceTarget) {
    checkRevision(target.revision);
    if (target.scope === "pane" && target.workspaceId === undefined) requirePane(target.paneId);
    else if (target.scope === "workspace" && target.paneId === undefined) requireWorkspace(target.workspaceId);
    else if (target.scope !== "app" || target.paneId !== undefined || target.workspaceId !== undefined) fail("INVALID_ARGUMENTS", "Choose app, workspace with its ID, or pane with its ID.");
  }
  const persistent = (next: Snapshot) => JSON.stringify({ version: 1, app: next.app, workspaces: next.workspaces, presets: next.presets });
  function publish(next: Snapshot, persist: boolean) {
    if (persist) { try { deps.save(persistent(next)); } catch { fail("PERSISTENCE_UNAVAILABLE", "Writing appearance could not be saved. Your current appearance was kept."); } }
    for (const id of Object.keys(next.panes)) if (!deps.paneIds().includes(id)) delete next.panes[id];
    setState("app", reconcile(next.app)); setState("workspaces", reconcile(next.workspaces)); setState("panes", reconcile(next.panes)); setState("presets", reconcile(next.presets));
    setState({ preview: null, revision: state.revision + 1, warning: persist ? "" : state.warning });
  }
  function commit(next: Snapshot, persist: boolean) {
    const previous = snapshot();
    batch(() => { publish(next, persist); history.push(previous); if (history.length > 20) history.shift(); setState("historyLength", history.length); });
  }
  const result = (target: AppearanceTarget) => inspect(target.scope === "pane" ? target.paneId : undefined, target.scope === "workspace" ? target.workspaceId : undefined);
  function apply(target: AppearanceTarget & { changes: Patch }) {
    validateTarget(target); validatePatch(target.changes); const next = snapshot();
    if (target.scope === "app") next.app = { ...next.app, ...target.changes };
    else if (target.scope === "workspace") next.workspaces[target.workspaceId!] = { ...next.workspaces[target.workspaceId!], ...target.changes };
    else next.panes[target.paneId!] = { ...next.panes[target.paneId!], ...target.changes };
    commit(next, target.scope !== "pane"); return result(target);
  }
  function reset(target: AppearanceTarget) {
    validateTarget(target); const next = snapshot();
    if (target.scope === "app") next.app = { ...DEFAULT_WRITING_APPEARANCE };
    else if (target.scope === "workspace") delete next.workspaces[target.workspaceId!];
    else delete next.panes[target.paneId!];
    commit(next, target.scope !== "pane"); return result(target);
  }
  function revert(revision: number) {
    checkRevision(revision); const previous = history[history.length - 1];
    if (!previous) fail("UNAVAILABLE", "There are no writing appearance changes to revert in this session.");
    const next = clone(previous);
    batch(() => { publish(next, persistent(snapshot()) !== persistent(next)); history.pop(); setState("historyLength", history.length); });
    return inspect();
  }
  function preview(target: AppearanceTarget & { changes: Patch; previewId?: string }) {
    validateTarget(target); validatePatch(target.changes);
    if (state.preview && target.previewId !== state.preview.id) fail("BUSY", "An appearance preview is already open. Apply or cancel it first.");
    if (target.previewId && target.previewId !== state.preview?.id) fail("NOT_FOUND", "This preview is no longer active.");
    const p: Preview = { id: state.preview?.id ?? crypto.randomUUID(), scope: target.scope, paneId: target.paneId, workspaceId: target.workspaceId, changes: clone(target.changes) };
    batch(() => { setState("preview", reconcile(p)); setState("revision", state.revision + 1); }); return result(target);
  }
  function cancelPreview(previewId: string, revision: number) {
    checkRevision(revision); if (state.preview?.id !== previewId) fail("NOT_FOUND", "This preview is no longer active.");
    setState({ preview: null, revision: state.revision + 1 }); return inspect();
  }
  function presets() { return { revision: state.revision, presets: [...BUILTIN_WRITING_PRESETS.map(p => ({ ...clone(p), builtin: true })), ...state.presets.map(p => ({ ...clone(p), builtin: false }))] }; }
  function savePreset(target: AppearanceTarget & { name: string }) {
    validateTarget(target); const name = target.name.trim();
    if (!name || name.length > 48 || BUILTIN_WRITING_PRESETS.some(p => p.name === name)) fail("INVALID_ARGUMENTS", "Use a custom preset name of 1–48 characters.");
    const next = snapshot();
    if (next.presets.length >= 30 && !next.presets.some(p => p.name === name)) fail("LIMIT_REACHED", "Keep up to 30 custom appearances.");
    next.presets = [...next.presets.filter(p => p.name !== name), { name, values: result(target).effective }]; commit(next, true); return presets();
  }
  function applyPreset(target: AppearanceTarget & { name: string }) {
    validateTarget(target); const preset = [...BUILTIN_WRITING_PRESETS, ...state.presets].find(p => p.name === target.name);
    if (!preset) fail("NOT_FOUND", "This saved appearance no longer exists."); return apply({ ...target, changes: preset!.values });
  }
  function deletePreset(name: string, revision: number) {
    checkRevision(revision); const next = snapshot(); if (!next.presets.some(p => p.name === name)) fail("NOT_FOUND", "Choose a custom saved appearance to delete.");
    next.presets = next.presets.filter(p => p.name !== name); commit(next, true); return presets();
  }
  function stopEffects(revision: number) {
    checkRevision(revision); const next = snapshot(); next.app = { ...next.app, ...stopped };
    for (const id of Object.keys(next.workspaces)) next.workspaces[id] = { ...next.workspaces[id], ...stopped };
    for (const id of Object.keys(next.panes)) next.panes[id] = { ...next.panes[id], ...stopped };
    commit(next, true); return inspect();
  }
  function effects() { return { effects: effectKeys.map(name => ({ name, ...(numeric[name] ?? { type: "boolean" }) })), reducedMotion: "OS reduced motion always suppresses animated typing feedback; motion=false also suppresses it.", inherits: "cursorGlow, vignette, grain use -1 to inherit existing theme settings" }; }
  function setEffects(target: AppearanceTarget & { changes: Patch }) {
    if (Object.keys(target.changes).some(key => !(effectKeys as readonly string[]).includes(key))) fail("INVALID_ARGUMENTS", "effects set accepts only properties reported by effects list.");
    return apply(target);
  }
  function capabilities() { return { version: 1, appliesTo: "Markdown writing viewports", scopes: ["app", "workspace", "pane"], workspaceId: workspaceId(), precedence: ["app", "workspace", "pane"],
    persistence: { app: "local preferences", workspace: "local preferences keyed by workspace path", pane: "current session only", preview: "temporary; explicit apply/cancel" },
    properties: { ...numeric, columnWidth: { ...numeric.columnWidth, fill: 0, includes: "editor gutter" }, alignment: { values: enums.alignment }, background: { values: enums.background }, motion: { type: "boolean" } },
    defaults: { ...DEFAULT_WRITING_APPEARANCE }, responsive: "Insets shrink in narrow panes; inspect reports requested values, not measured geometry.",
    undo: "appearance revert restores the last appearance change; text undo is unaffected", effects: effects().effects,
    fontFamily: "Use existing global editor font settings; independent pane font family is not supported.", unavailable: ["paragraph spacing", "per-heading fonts", "arbitrary CSS", "caret trails", "character entrance effects"] }; }
  return { state, workspaceId, forPane, inspect, apply, reset, revert, preview, cancelPreview, presets, savePreset, applyPreset, deletePreset, effects, setEffects, stopEffects, capabilities };
}
export type WritingAppearance = ReturnType<typeof createWritingAppearance>;

export function registerWritingAppearanceCommands(commands: FeatureCommands, appearance: WritingAppearance) {
  const num: CommandSchema = { type: "number" }, str: CommandSchema = { type: "string", minLength: 1 };
  const fields: Record<string, CommandSchema> = Object.fromEntries(Object.keys(numeric).map(key => [key, num]));
  for (const [key, values] of Object.entries(enums)) fields[key] = { type: "string", enum: values }; fields.motion = { type: "boolean" };
  const target: Record<string, CommandSchema> = { scope: { type: "string", enum: ["app", "workspace", "pane"] }, paneId: str, workspaceId: str, revision: num };
  const obj = (properties: Record<string, CommandSchema>, required: string[] = []): CommandSchema => ({ type: "object", properties, required, additionalProperties: false });
  const examples: Record<string, object> = {
    "appearance preview cancel": { previewId: "<preview ID>", revision: 1 },
    "appearance presets save": { scope: "app", revision: 0, name: "My writing desk" },
    "appearance presets apply": { scope: "app", revision: 0, name: "Reading room" },
    "appearance presets delete": { revision: 1, name: "My writing desk" },
    "effects set": { scope: "app", revision: 0, changes: { typingPulse: 0.15, motion: true } }, "effects stop": { revision: 1 },
  };
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write", example = examples[name] ? `${name} ${JSON.stringify(examples[name])}` : name) => commands.register({ name, description, inputSchema, outputSchema: objectResult, run, effect, version: 1, examples: [example] });
  add("appearance capabilities", "Discover supported writing appearance properties, bounds, scopes and renderer limitations.", emptyArgs, () => appearance.capabilities(), "read");
  add("appearance inspect", "Inspect inherited appearance, committed values, preview and revision.", obj({ paneId: str, workspaceId: str }), args => appearance.inspect(args.paneId, args.workspaceId), "read");
  add("appearance apply", "Apply a validated patch, commit preferences, and end any preview; never edit note text.", obj({ ...target, changes: obj(fields) }, ["scope", "revision", "changes"]), args => appearance.apply(args), "write", 'appearance apply {"scope":"app","revision":0,"changes":{"columnWidth":760,"alignment":"center"}}');
  add("appearance reset", "Reset app defaults or remove workspace/pane overrides; other scopes are retained.", obj(target, ["scope", "revision"]), args => appearance.reset(args), "write", 'appearance reset {"scope":"app","revision":0}');
  add("appearance revert", "Restore the last committed appearance change, separate from document undo.", obj({ revision: num }, ["revision"]), args => appearance.revert(args.revision), "write", 'appearance revert {"revision":1}');
  add("appearance preview", "Preview without saving; use returned preview ID to update or cancel.", obj({ ...target, changes: obj(fields), previewId: str }, ["scope", "revision", "changes"]), args => appearance.preview(args), "write", 'appearance preview {"scope":"app","revision":0,"changes":{"background":"paper"}}');
  add("appearance preview cancel", "Discard the identified preview without changing committed appearance.", obj({ previewId: str, revision: num }, ["previewId", "revision"]), args => appearance.cancelPreview(args.previewId, args.revision));
  add("appearance presets list", "List built-in and custom saved appearances.", emptyArgs, () => appearance.presets(), "read");
  add("appearance presets save", "Save effective appearance at an explicit scope as a custom preset.", obj({ ...target, name: str }, ["scope", "revision", "name"]), args => appearance.savePreset(args));
  add("appearance presets apply", "Apply a named preset to an explicit scope.", obj({ ...target, name: str }, ["scope", "revision", "name"]), args => appearance.applyPreset(args));
  add("appearance presets delete", "Delete a custom appearance; built-in appearances are retained.", obj({ name: str, revision: num }, ["name", "revision"]), args => appearance.deletePreset(args.name, args.revision));
  add("effects list", "List effect controls and reduced-motion behavior.", emptyArgs, () => appearance.effects(), "read");
  add("effects inspect", "Inspect effective effects and appearance revision.", obj({ paneId: str, workspaceId: str }), args => appearance.inspect(args.paneId, args.workspaceId), "read");
  add("effects set", "Set supported effect controls at an explicit scope.", obj({ ...target, changes: obj(Object.fromEntries(effectKeys.map(key => [key, fields[key]]))) }, ["scope", "revision", "changes"]), args => appearance.setEffects(args));
  add("effects stop", "Disable effects and motion across all scopes, ending any preview.", obj({ revision: num }, ["revision"]), args => appearance.stopEffects(args.revision));
}
