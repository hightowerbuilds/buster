import { describe, expect, it, vi } from "vitest";
import { FeatureCommands } from "./feature-commands";
import { createWritingAppearance, DEFAULT_WRITING_APPEARANCE, registerWritingAppearanceCommands, type WritingAppearanceValues } from "./writing-appearance";

function fixture(saved: string | null = null) {
  let paneIds = ["left", "right"];
  let workspaceId: string | null = null;
  const save = vi.fn((_value: string) => {});
  const appearance = createWritingAppearance({ paneIds: () => paneIds, workspaceId: () => workspaceId, load: () => saved, save });
  const commands = new FeatureCommands();
  registerWritingAppearanceCommands(commands, appearance);
  const apply = (changes: Partial<WritingAppearanceValues>, paneId?: string) => appearance.apply({
    scope: paneId ? "pane" : "app", ...(paneId ? { paneId } : {}), revision: appearance.state.revision, changes,
  });
  const run = (command: string, args: Record<string, unknown> = {}, requestId: string = crypto.randomUUID()) => commands.dispatch({ command, args, requestId }, "ai");
  return { appearance, save, apply, run, commands, setWorkspaceId: (id: string | null) => { workspaceId = id; }, setPaneIds: (ids: string[]) => { paneIds = ids; } };
}

describe("writing appearance preferences", () => {
  it("inherits app defaults and persists only app changes, leaving other panes independent", () => {
    const f = fixture();
    f.apply({ paddingLeft: 64 }, "left");
    expect(f.save).not.toHaveBeenCalled();
    f.apply({ paddingLeft: 40, paddingTop: 32, columnWidth: 720 });
    expect(f.appearance.forPane("left")).toEqual({ ...DEFAULT_WRITING_APPEARANCE, paddingLeft: 64, paddingTop: 32, columnWidth: 720 });
    expect(f.appearance.forPane("right")).toEqual(f.appearance.forPane());
    expect(f.appearance.inspect("left")).toMatchObject({ persistence: "session", overrides: { paddingLeft: 64 }, revision: 2 });
    const saved = f.save.mock.calls[0][0];
    expect(JSON.parse(saved)).toEqual({ version: 1, app: { ...DEFAULT_WRITING_APPEARANCE, paddingLeft: 40, paddingTop: 32, columnWidth: 720 }, workspaces: {}, presets: [] });
    const reopened = fixture(saved);
    expect(reopened.appearance.forPane("left")).toEqual(f.appearance.forPane());
    expect(reopened.appearance.inspect()).toMatchObject({ revision: 0, canRevert: false, persistence: "local" });
  });

  it("reset removes a pane override completely and app reset preserves other pane overrides", () => {
    const f = fixture();
    f.apply({ paddingLeft: 60, alignment: "center" }, "left");
    f.apply({ paddingRight: 90 }, "right");
    f.apply({ paddingTop: 48 });
    f.appearance.reset({ scope: "pane", paneId: "left", revision: 3 });
    expect(f.appearance.inspect("left").overrides).toEqual({});
    f.apply({ paddingLeft: 100 });
    expect(f.appearance.forPane("left").paddingLeft).toBe(100);
    f.appearance.reset({ scope: "app", revision: 5 });
    expect(f.appearance.forPane()).toEqual(DEFAULT_WRITING_APPEARANCE);
    expect(f.appearance.forPane("left")).toEqual(DEFAULT_WRITING_APPEARANCE);
    expect(f.appearance.forPane("right").paddingRight).toBe(90);
  });

  it("revert removes newly added nested override keys and restores inheritance", () => {
    const f = fixture();
    f.apply({ paddingLeft: 60 }, "left");
    f.apply({ paddingRight: 80, alignment: "center" }, "left");
    f.appearance.revert(2);
    expect(f.appearance.inspect("left").overrides).toEqual({ paddingLeft: 60 });
    expect(f.appearance.forPane("left").alignment).toBe("left");
    f.appearance.revert(3);
    expect(f.appearance.inspect("left").overrides).toEqual({});
    expect(f.appearance.inspect().canRevert).toBe(false);
    expect(() => f.appearance.revert(4)).toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
    expect(f.save).not.toHaveBeenCalled();
  });

  it("can revert reset and persists app restoration without persisting pane overrides", () => {
    const f = fixture();
    f.apply({ columnWidth: 640 }, "left");
    f.appearance.reset({ scope: "pane", paneId: "left", revision: 1 });
    f.appearance.revert(2);
    expect(f.appearance.inspect("left").overrides).toEqual({ columnWidth: 640 });
    f.apply({ alignment: "center" });
    f.appearance.revert(4);
    expect(f.appearance.forPane().alignment).toBe("left");
    expect(JSON.parse(f.save.mock.calls[1][0])).toEqual({ version: 1, app: DEFAULT_WRITING_APPEARANCE, workspaces: {}, presets: [] });
  });

  it.each([
    {}, { paddingTop: -1 }, { paddingBottom: 161 }, { paddingLeft: NaN }, { paddingRight: Infinity },
    { columnWidth: 1 }, { columnWidth: 319 }, { columnWidth: 1601 }, { alignment: "right" },
    { paddingTop: 40, arbitraryEffect: "flash" }, { paddingTop: "20" },
  ])("rejects invalid patches atomically: %j", changes => {
    const f = fixture();
    const before = f.appearance.inspect();
    expect(() => f.apply(changes as Partial<WritingAppearanceValues>)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENTS" }));
    expect(f.appearance.inspect()).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
  });

  it("accepts bounds, fill width and fractional pixel padding", () => {
    const f = fixture();
    f.apply({ paddingTop: 0, paddingBottom: 160, paddingLeft: 24.5, columnWidth: 320 });
    f.apply({ columnWidth: 1600 });
    f.apply({ columnWidth: 0 });
    expect(f.appearance.inspect().effective).toMatchObject({ paddingTop: 0, paddingBottom: 160, paddingLeft: 24.5, columnWidth: 0 });
  });

  it("rejects stale app, pane, reset and revert operations without losing history", () => {
    const f = fixture();
    f.apply({ paddingTop: 36 });
    const before = f.appearance.inspect();
    for (const mutate of [
      () => f.appearance.apply({ scope: "app", revision: 0, changes: { paddingTop: 55 } }),
      () => f.appearance.apply({ scope: "pane", paneId: "left", revision: 0, changes: { paddingTop: 55 } }),
      () => f.appearance.reset({ scope: "app", revision: 0 }),
      () => f.appearance.revert(0),
      () => f.appearance.revert(1.5),
    ]) expect(mutate).toThrow(expect.objectContaining({ code: "STALE_APPEARANCE" }));
    expect(f.appearance.inspect()).toEqual(before);
    expect(f.save).toHaveBeenCalledTimes(1);
    f.appearance.revert(1);
    expect(f.appearance.forPane()).toEqual(DEFAULT_WRITING_APPEARANCE);
  });

  it("rejects missing pane targets and cannot restore a closed pane's overrides", () => {
    const f = fixture();
    f.apply({ paddingTop: 36 }, "left");
    f.apply({ paddingTop: 70 }, "left");
    f.setPaneIds(["right"]);
    expect(() => f.appearance.inspect("left")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => f.apply({ paddingTop: 30 }, "left")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => f.appearance.reset({ scope: "pane", revision: 2 })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(f.appearance.forPane("left")).toEqual(DEFAULT_WRITING_APPEARANCE);
    f.appearance.revert(2);
    f.setPaneIds(["left", "right"]);
    expect(f.appearance.inspect("left").overrides).toEqual({});
  });

  it("persistence failures leave current state and undo history intact, including failed revert", () => {
    const f = fixture();
    f.apply({ paddingTop: 36 });
    const before = f.appearance.inspect();
    f.save.mockImplementation(() => { throw new Error("quota"); });
    for (const operation of [
      () => f.apply({ paddingTop: 70 }),
      () => f.appearance.reset({ scope: "app", revision: 1 }),
      () => f.appearance.revert(1),
    ]) {
      expect(operation).toThrow(expect.objectContaining({ code: "PERSISTENCE_UNAVAILABLE" }));
      expect(f.appearance.inspect()).toEqual(before);
    }
    f.save.mockImplementation(() => {});
    f.appearance.revert(1);
    expect(f.appearance.inspect()).toMatchObject({ revision: 2, canRevert: false, effective: DEFAULT_WRITING_APPEARANCE });
  });

  it.each(["invalid JSON", "null", '{"version":2,"app":{"paddingTop":40}}', '{"version":1,"app":{"paddingTop":40,"paddingRight":-1}}'])
  ("falls back atomically on invalid preferences without overwriting them: %s", saved => {
    const f = fixture(saved);
    expect(f.appearance.forPane()).toEqual(DEFAULT_WRITING_APPEARANCE);
    expect(f.appearance.inspect().warning).not.toBe("");
    f.apply({ paddingTop: 30 }, "left");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.appearance.inspect().warning).not.toBe("");
    f.apply({ paddingTop: 44 });
    expect(f.appearance.inspect().warning).toBe("");
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("bounds undo history to the latest twenty changes", () => {
    const f = fixture();
    for (let i = 1; i <= 25; i++) f.apply({ paddingTop: i }, "left");
    for (let i = 0; i < 20; i++) f.appearance.revert(f.appearance.state.revision);
    expect(f.appearance.forPane("left").paddingTop).toBe(5);
    expect(f.appearance.inspect().canRevert).toBe(false);
  });
});

describe("appearance command interface", () => {
  it("advertises only supported properties and exposes requested geometry without writes", async () => {
    const f = fixture();
    expect(await f.run("appearance capabilities")).toMatchObject({ ok: true, data: { scopes: ["app", "workspace", "pane"], properties: { columnWidth: { includes: "editor gutter", fill: 0 } } } });
    expect(await f.run("appearance inspect", { paneId: "left" })).toMatchObject({ ok: true, data: { scope: "pane", revision: 0, effective: DEFAULT_WRITING_APPEARANCE } });
    expect(f.commands.describe()).toHaveLength(15);
    expect(f.save).not.toHaveBeenCalled();
  });

  it("deduplicates retries so a mutation and its undo happen only once", async () => {
    const f = fixture();
    const args = { scope: "app", revision: 0, changes: { paddingTop: 80 } };
    const results = await Promise.all([f.run("appearance apply", args, "apply-one"), f.run("appearance apply", args, "apply-one")]);
    expect(results[0]).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(results[1]).toEqual(results[0]);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(await f.run("appearance apply", args, "different-request")).toMatchObject({ ok: false, error: { code: "STALE_APPEARANCE" } });
    const revert = await f.run("appearance revert", { revision: 1 }, "undo-one");
    expect(await f.run("appearance revert", { revision: 1 }, "undo-one")).toEqual(revert);
    expect(f.appearance.inspect()).toMatchObject({ revision: 2, canRevert: false, effective: DEFAULT_WRITING_APPEARANCE });
    expect(f.save).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown properties, invalid targets and incomplete schemas without changes", async () => {
    const f = fixture();
    for (const args of [
      { scope: "app", changes: { paddingTop: 40 } },
      { scope: "app", revision: 0, changes: { paddingTop: "40" } },
      { scope: "app", revision: 0, changes: { color: "red" } },
      { scope: "app", revision: 0, changes: { alignment: "right" } },
      { scope: "app", paneId: "left", revision: 0, changes: { paddingTop: 40 } },
      { scope: "document", revision: 0, changes: { paddingTop: 40 } },
      { scope: "app", revision: 0, changes: {}, hidden: true },
    ]) expect(await f.run("appearance apply", args)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.run("appearance inspect", { paneId: "missing" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("appearance reset", { scope: "pane", paneId: "missing", revision: 0 })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.appearance.inspect()).toMatchObject({ revision: 0, canRevert: false, effective: DEFAULT_WRITING_APPEARANCE });
    expect(f.save).not.toHaveBeenCalled();
  });
});

describe("workspace appearance, previews and effects", () => {
  it("migrates old layout preferences additively with safe typography and effect defaults", () => {
    const f = fixture(JSON.stringify({ version: 1, app: { paddingTop: 46, alignment: "center" } }));
    expect(f.appearance.forPane()).toEqual({ ...DEFAULT_WRITING_APPEARANCE, paddingTop: 46, alignment: "center" });
    expect(f.appearance.inspect().warning).toBe("");
    expect(f.appearance.presets().presets.filter(preset => !preset.builtin)).toHaveLength(0);
    expect(f.save).not.toHaveBeenCalled();
  });

  it("inherits app then current workspace then pane and persists workspace identity across restart", () => {
    const f = fixture(); f.setWorkspaceId("/projects/book");
    f.apply({ paddingTop: 38, fontSize: 15 });
    f.appearance.apply({ scope: "workspace", workspaceId: "/projects/book", revision: 1, changes: { paddingTop: 50, background: "paper" } });
    f.apply({ paddingTop: 80 }, "left");
    expect(f.appearance.inspect().effective.paddingTop).toBe(38);
    expect(f.appearance.inspect(undefined, "/projects/book")).toMatchObject({ persistence: "local", effective: { paddingTop: 50, fontSize: 15, background: "paper" } });
    expect(f.appearance.forPane("left")).toMatchObject({ paddingTop: 80, fontSize: 15, background: "paper" });
    expect(f.appearance.forPane("right").paddingTop).toBe(50);
    const reopened = fixture(f.save.mock.calls[1][0]); reopened.setWorkspaceId("/projects/book");
    expect(reopened.appearance.forPane("left")).toMatchObject({ paddingTop: 50, fontSize: 15, background: "paper" });
    reopened.setWorkspaceId("/projects/other"); expect(reopened.appearance.forPane("left").paddingTop).toBe(38);
    reopened.setWorkspaceId("/projects/book"); expect(reopened.appearance.forPane("left").paddingTop).toBe(50);
  });

  it("rejects stale workspace identities even when the revision has not changed", async () => {
    const f = fixture(); f.setWorkspaceId("/book");
    const target = { scope: "workspace", workspaceId: "/book", revision: 0 };
    f.setWorkspaceId("/other");
    for (const command of ["appearance apply", "appearance preview"])
      expect(await f.run(command, { ...target, changes: { fontSize: 18 } })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("appearance reset", target)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("appearance inspect", { workspaceId: "/book" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("appearance apply", { scope: "workspace", revision: 0, changes: { fontSize: 18 } })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.appearance.state.revision).toBe(0); expect(f.save).not.toHaveBeenCalled();
  });

  it("workspace reset restores inheritance and revert restores only the intended scope", () => {
    const f = fixture(); f.setWorkspaceId("/book");
    f.appearance.apply({ scope: "workspace", workspaceId: "/book", revision: 0, changes: { background: "sage", lineHeight: 1.8 } });
    f.apply({ fontSize: 20 }, "left");
    f.appearance.reset({ scope: "workspace", workspaceId: "/book", revision: 2 });
    expect(f.appearance.forPane("left")).toMatchObject({ background: "theme", lineHeight: 0, fontSize: 20 });
    f.appearance.revert(3);
    expect(f.appearance.forPane("left")).toMatchObject({ background: "sage", lineHeight: 1.8, fontSize: 20 });
  });

  it.each([{ fontSize: 9 }, { fontSize: 33 }, { lineHeight: 1 }, { lineHeight: 2.5 }, { focusDim: .46 }, { cursorGlow: -2 }, { grain: 101 }, { typingPulse: 1.1 }, { effectDuration: 99 }, { effectDuration: 1001 }, { motion: "yes" }, { background: "neon" }])
  ("rejects invalid typography/effects without half-applying other properties: %j", invalid => {
    const f = fixture();
    expect(() => f.apply({ paddingTop: 40, ...invalid } as Partial<WritingAppearanceValues>)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENTS" }));
    expect(f.appearance.forPane()).toEqual(DEFAULT_WRITING_APPEARANCE); expect(f.save).not.toHaveBeenCalled();
  });

  it("previews without saving or creating history, updates only with its identity, and cancels cleanly", () => {
    const f = fixture();
    const preview = f.appearance.preview({ scope: "pane", paneId: "left", revision: 0, changes: { fontSize: 21, background: "paper" } });
    expect(preview).toMatchObject({ revision: 1, canRevert: false, committed: DEFAULT_WRITING_APPEARANCE, effective: { fontSize: 21, background: "paper" } });
    const id = preview.preview!.id;
    expect(f.appearance.forPane("right")).toEqual(DEFAULT_WRITING_APPEARANCE);
    f.appearance.preview({ scope: "pane", paneId: "left", revision: 1, previewId: id, changes: { fontSize: 24 } });
    expect(f.appearance.forPane("left")).toMatchObject({ fontSize: 24, background: "theme" });
    expect(f.appearance.inspect().preview!.id).toBe(id);
    expect(f.save).not.toHaveBeenCalled(); expect(f.appearance.state.historyLength).toBe(0);
    f.appearance.cancelPreview(id, 2);
    expect(f.appearance.forPane("left")).toEqual(DEFAULT_WRITING_APPEARANCE);
    expect(f.appearance.inspect()).toMatchObject({ revision: 3, preview: null, canRevert: false });
    expect(f.save).not.toHaveBeenCalled();
  });

  it("rejects competing, stale and expired preview requests without changing the active preview", async () => {
    const f = fixture(); const preview = f.appearance.preview({ scope: "app", revision: 0, changes: { fontSize: 20 } });
    expect(await f.run("appearance preview", { scope: "app", revision: 1, changes: { fontSize: 22 } })).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(await f.run("appearance preview", { scope: "app", revision: 0, previewId: preview.preview!.id, changes: { fontSize: 22 } })).toMatchObject({ ok: false, error: { code: "STALE_APPEARANCE" } });
    expect(await f.run("appearance preview cancel", { revision: 1, previewId: "other" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.appearance.inspect()).toEqual(preview);
    f.appearance.cancelPreview(preview.preview!.id, 1);
    expect(await f.run("appearance preview", { scope: "app", revision: 2, previewId: preview.preview!.id, changes: { fontSize: 22 } })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("applies a preview explicitly and reverts to committed values without reviving the preview", () => {
    const f = fixture(); f.apply({ fontSize: 17 });
    f.appearance.preview({ scope: "app", revision: 1, changes: { fontSize: 24 } });
    f.apply({ fontSize: 24 });
    expect(f.appearance.inspect()).toMatchObject({ effective: { fontSize: 24 }, preview: null, revision: 3 });
    expect(f.save).toHaveBeenCalledTimes(2);
    f.appearance.revert(3);
    expect(f.appearance.inspect()).toMatchObject({ effective: { fontSize: 17 }, preview: null, revision: 4 });
  });

  it("failed persistence leaves a preview usable and does not consume undo history", () => {
    const f = fixture(); const preview = f.appearance.preview({ scope: "app", revision: 0, changes: { background: "paper" } });
    f.save.mockImplementation(() => { throw new Error("quota"); });
    expect(() => f.apply({ background: "paper" })).toThrow(expect.objectContaining({ code: "PERSISTENCE_UNAVAILABLE" }));
    expect(f.appearance.inspect()).toEqual(preview); expect(f.appearance.state.historyLength).toBe(0);
    f.appearance.cancelPreview(preview.preview!.id, 1);
    expect(f.appearance.forPane()).toEqual(DEFAULT_WRITING_APPEARANCE);
  });

  it("keeps workspace previews out of a different workspace and pane previews out of closed panes", () => {
    const f = fixture(); f.setWorkspaceId("/book");
    const preview = f.appearance.preview({ scope: "workspace", workspaceId: "/book", revision: 0, changes: { fontSize: 25 } });
    expect(f.appearance.forPane("left").fontSize).toBe(25);
    f.setWorkspaceId("/other"); expect(f.appearance.forPane("left").fontSize).toBe(0);
    f.appearance.cancelPreview(preview.preview!.id, 1);
    f.appearance.preview({ scope: "pane", paneId: "left", revision: 2, changes: { fontSize: 22 } });
    f.setPaneIds(["right"]); expect(f.appearance.forPane("left").fontSize).toBe(0);
  });

  it("saves effective appearance as a named preset and applies/deletes it independently of source scope", () => {
    const f = fixture(); f.setWorkspaceId("/book");
    f.apply({ fontSize: 18 }); f.apply({ background: "sage", columnWidth: 780 }, "left");
    f.appearance.savePreset({ scope: "pane", paneId: "left", revision: 2, name: "  My reading  " });
    const preset = f.appearance.presets().presets.find(p => p.name === "My reading")!;
    expect(preset).toMatchObject({ builtin: false, values: { fontSize: 18, background: "sage", columnWidth: 780 } });
    const reopened = fixture(f.save.mock.calls[1][0]);
    reopened.appearance.applyPreset({ scope: "pane", paneId: "right", revision: 0, name: "My reading" });
    expect(reopened.appearance.forPane("right")).toEqual(preset.values);
    expect(reopened.save).not.toHaveBeenCalled();
    reopened.appearance.deletePreset("My reading", 1);
    expect(reopened.appearance.presets().presets.some(p => p.name === "My reading")).toBe(false);
    expect(reopened.appearance.forPane("right")).toEqual(preset.values);
    expect(() => reopened.appearance.deletePreset("Quiet", 2)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("limits custom presets, allows replacing one at the limit, and keeps built-in names immutable", () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.appearance.savePreset({ scope: "app", revision: i, name: `Preset ${i}` });
    expect(() => f.appearance.savePreset({ scope: "app", revision: 30, name: "Overflow" })).toThrow(expect.objectContaining({ code: "LIMIT_REACHED" }));
    for (const name of ["Quiet", " ", "x".repeat(49)]) expect(() => f.appearance.savePreset({ scope: "app", revision: 30, name })).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENTS" }));
    f.appearance.savePreset({ scope: "app", revision: 30, name: "Preset 0" });
    expect(f.appearance.presets().presets.filter(p => !p.builtin)).toHaveLength(30);
    expect(() => f.appearance.applyPreset({ scope: "app", revision: 31, name: "Missing" })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("stops effects across app, stored workspaces and panes, cancels previews, and is undoable", () => {
    const f = fixture(); f.setWorkspaceId("/book");
    f.apply({ typingPulse: .4, cursorGlow: 25, background: "midnight" });
    f.appearance.apply({ scope: "workspace", workspaceId: "/book", revision: 1, changes: { grain: 20, focusDim: .2 } });
    f.setWorkspaceId("/other");
    f.appearance.apply({ scope: "workspace", workspaceId: "/other", revision: 2, changes: { vignette: 20 } });
    f.apply({ typingPulse: .8, fontSize: 22 }, "left");
    f.appearance.preview({ scope: "app", revision: 4, changes: { typingPulse: 1 } });
    f.appearance.stopEffects(5);
    const stopped = { typingPulse: 0, cursorGlow: 0, grain: 0, focusDim: 0, vignette: 0, motion: false };
    expect(f.appearance.inspect()).toMatchObject({ preview: null, effective: { ...stopped, background: "midnight" } });
    expect(f.appearance.forPane("left")).toMatchObject({ ...stopped, fontSize: 22 });
    f.setWorkspaceId("/book"); expect(f.appearance.forPane("right")).toMatchObject(stopped);
    f.appearance.revert(6);
    expect(f.appearance.forPane("left")).toMatchObject({ typingPulse: .8, grain: 20, focusDim: .2, fontSize: 22 });
    expect(f.appearance.state.preview).toBeNull();
  });

  it("rejects non-effect changes on effects set and deduplicates preview/preset commands", async () => {
    const f = fixture();
    expect(await f.run("effects set", { scope: "app", revision: 0, changes: { fontSize: 20 } })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    const args = { scope: "pane", paneId: "left", revision: 0, changes: { typingPulse: .2 } };
    const preview = await f.run("appearance preview", args, "preview");
    expect(await f.run("appearance preview", args, "preview")).toEqual(preview);
    expect(f.appearance.state.revision).toBe(1);
    const save = { scope: "pane", paneId: "left", revision: 1, name: "Preview snapshot" };
    const preset = await f.run("appearance presets save", save, "preset");
    expect(await f.run("appearance presets save", save, "preset")).toEqual(preset);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.appearance.presets().presets.find(p => p.name === "Preview snapshot")!.values.typingPulse).toBe(.2);
  });
});
