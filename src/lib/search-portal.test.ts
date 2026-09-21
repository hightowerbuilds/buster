import { describe, expect, it, vi } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { FeatureCommands } from "./feature-commands";
import { newPaneWorkspace } from "./writing-panes";
import { createSearchPortal, registerSearchPortalCommands } from "./search-portal";

function fixture(text = "Hello world.\nAnother café passage.") {
  const engine = createEditorEngine(text);
  const other = createEditorEngine("Unsaved café [brackets] café.");
  let workspace = newPaneWorkspace("draft");
  const tabs = new Set(["draft", "other", "loading"]);
  const openPanel = vi.fn((id: string) => { const tabId = `portal_${id}`; tabs.add(tabId); return tabId; });
  const focusSource = vi.fn();
  const focusPanel = vi.fn();
  const closePanel = vi.fn((id: string) => tabs.delete(id));
  const createNote = vi.fn((_: string, _tabId: string) => { tabs.add("kept"); return "kept"; });
  const reviewPassage = vi.fn(() => ({ reviewId: "review" }));
  const service = createSearchPortal({ workspace: () => workspace, notes: () => [{ tabId: "draft", name: "Draft.md" }, { tabId: "other", name: "Untitled.md" }, { tabId: "loading", name: "Loading.md" }],
    engine: id => id === "draft" ? engine : id === "other" ? other : undefined, hasTab: id => tabs.has(id), openPanel, focusSource, focusPanel, closePanel, createNote, reviewPassage });
  const commands = new FeatureCommands(); registerSearchPortalCommands(commands, service);
  const run = (command: string, args = {}, requestId: string = crypto.randomUUID()) => commands.dispatch({ command, args, requestId }, "ai");
  const open = () => service.open().portalId;
  return { service, engine, other, openPanel, focusPanel, focusSource, createNote, reviewPassage, closePanel, tabs, run, open,
    displayPortal: (tabId: string) => { workspace = { ...workspace, panes: workspace.panes.map(pane => ({ ...pane, tabId })) }; } };
}

describe("local search portal", () => {
  it("reuses the source note's portal and captures a newly selected query without searching", () => {
    const f = fixture(); const id = f.open(); f.service.query(id, "world");
    expect(f.open()).toBe(id);
    expect(f.service.read(id).status).toBe("completed");
    f.engine.setSelection({ line: 0, col: 0 }, { line: 0, col: 5 });
    expect(f.open()).toBe(id);
    expect(f.openPanel).toHaveBeenCalledOnce();
    expect(f.service.read(id)).toMatchObject({ query: "Hello", status: "ready", results: [], source: { text: "Hello" } });
  });
  it("does not split emoji at either snippet boundary", () => {
    const text = `👩${"a".repeat(89)}MATCH${"b".repeat(89)}👩`;
    const f = fixture(text); const hit = f.service.query(f.open(), "MATCH").results[0];
    expect(hit.passage.text).toBe(text);
    expect(f.engine.getTextRange(hit.passage.range.anchor, hit.passage.range.head)).toBe(text);
  });
  it("captures selected context and seeds an editable query without running a search", () => {
    const f = fixture(); f.engine.setSelection({ line: 1, col: 8 }, { line: 1, col: 12 });
    const id = f.open();
    expect(f.service.read(id)).toMatchObject({ query: "café", status: "ready", results: [], source: { tabId: "draft", text: "café" } });
    expect(f.reviewPassage).not.toHaveBeenCalled();
    f.engine.clearSelection();
    expect(f.service.read(id).source!.text).toBe("café");
  });
  it("searches current unsaved engine text, reports skipped engines, and uses literal phrases", () => {
    const f = fixture(); f.other.setCursor({ line: 0, col: 0 }); f.other.insert("Fresh ");
    const id = f.open();
    const fresh = f.service.query(id, "fresh");
    expect(fresh.results).toHaveLength(1);
    expect(fresh.results[0]).toMatchObject({ name: "Untitled.md", target: { tabId: "other", text: "Fresh", range: { anchor: { line: 0, col: 0 }, head: { line: 0, col: 5 } } } });
    expect(fresh.skippedNotes).toBe(1);
    expect(f.service.query(id, "[brackets]").results).toHaveLength(1);
    expect(f.service.query(id, ".*").results).toHaveLength(0);
  });
  it("retains correct UTF-16 offsets when case folding changes preceding Unicode text", () => {
    const f = fixture("İ 👩🏽‍💻 CAFÉ"); const id = f.open();
    const result = f.service.query(id, "café").results.find(hit => hit.target.tabId === "draft")!;
    expect(result.target.range.anchor.col).toBe("İ 👩🏽‍💻 ".length);
    f.service.source(id, result.id);
    expect(f.engine.getTextRange(f.engine.sel()!.anchor, f.engine.sel()!.head)).toBe("CAFÉ");
  });
  it("rejects empty, multiline and oversized queries without changing existing results", async () => {
    const f = fixture(); const id = f.open(); const before = f.service.query(id, "world");
    for (const query of ["  ", "hello\nworld", "x".repeat(257)]) {
      expect(await f.run("search query", { portalId: id, query })).toMatchObject({ ok: false });
      expect(f.service.read(id).results).toEqual(before.results);
    }
  });
  it("rejects stale result targeting while keeping the captured passage is safe", async () => {
    const f = fixture(); const id = f.open(); const hit = f.service.query(id, "world").results[0];
    f.engine.setCursor({ line: 0, col: 0 }); f.engine.insert("New ");
    for (const command of ["search source", "search review"]) expect(await f.run(command, { portalId: id, resultId: hit.id })).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
    expect(f.focusSource).not.toHaveBeenCalled(); expect(f.reviewPassage).not.toHaveBeenCalled();
    f.service.keep(id, hit.id); f.service.keep(id, hit.id);
    expect(f.createNote).toHaveBeenCalledExactlyOnceWith("Hello world.\n\nSource: Draft.md, line 1\n", f.service.portals[id].tabId);
    expect(f.engine.getText()).toBe("New Hello world.\nAnother café passage.");
    expect(f.service.read(id).results[0].stale).toBe(true);
  });
  it("returns to the original cursor only while its source revision is current", () => {
    const f = fixture(); f.engine.setCursor({ line: 1, col: 3 }); const id = f.open();
    f.engine.setCursor({ line: 0, col: 0 }); f.service.source(id); expect(f.engine.cursor()).toEqual({ line: 1, col: 3 });
    f.engine.insert("Changed"); f.engine.setCursor({ line: 0, col: 1 });
    expect(f.service.source(id).stale).toBe(true); expect(f.engine.cursor()).toEqual({ line: 0, col: 1 });
  });
  it("stable result IDs do not silently target a later query", () => {
    const f = fixture(); const id = f.open(); const hit = f.service.query(id, "world").results[0];
    f.service.query(id, "café");
    expect(() => f.service.source(id, hit.id)).toThrow("no longer in the current search");
    expect(() => f.service.keep(id, hit.id)).toThrow("no longer in the current search");
  });
  it("opens an explicit fresh AI review without running generation", () => {
    const f = fixture(); const id = f.open(); const hit = f.service.query(id, "world").results[0];
    expect(f.service.review(id, hit.id)).toEqual({ reviewId: "review" });
    expect(f.reviewPassage).toHaveBeenCalledExactlyOnceWith(hit.passage, f.service.portals[id].tabId);
  });
  it("bounds result counts and scan work and exposes truncation", () => {
    const f = fixture("match ".repeat(101)); const id = f.open();
    expect(f.service.query(id, "match")).toMatchObject({ truncated: true, results: { length: 100 } });
    const huge = fixture("x".repeat(1_000_001));
    expect(huge.service.query(huge.open(), "nomatch")).toMatchObject({ truncated: true, searchedNotes: 1, results: [] });
  });
  it("deduplicates repeated open/keep requests and focuses an existing portal", async () => {
    const f = fixture(); const args = {}; const first = await f.run("search portal open", args, "same");
    expect(await f.run("search portal open", args, "same")).toEqual(first); expect(f.openPanel).toHaveBeenCalledTimes(1);
    const id = Object.keys(f.service.portals)[0], portal = f.service.portals[id];
    f.displayPortal(portal.tabId); expect(f.service.open()).toEqual({ portalId: id, tabId: portal.tabId }); expect(f.openPanel).toHaveBeenCalledTimes(1);
    const hit = f.service.query(id, "world").results[0];
    const keep = { portalId: id, resultId: hit.id };
    await f.run("search keep", keep, "keep"); await f.run("search keep", keep, "keep"); expect(f.createNote).toHaveBeenCalledTimes(1);
  });
  it("closing and reconciliation remove temporary state without editing source notes", () => {
    const f = fixture(); const original = f.engine.getText(); const id = f.open();
    f.service.close(id); expect(f.service.portals[id]).toBeUndefined(); expect(f.focusSource).toHaveBeenCalledOnce();
    expect(f.engine.getText()).toBe(original);
    const another = f.open(); f.tabs.delete(f.service.portals[another].tabId); f.service.reconcile(); expect(f.service.portals[another]).toBeUndefined();
  });
  it("failed pane creation rolls back the portal and invalid panes have no side effects", () => {
    const f = fixture(); expect(() => f.service.open("missing")).toThrow("no longer open");
    f.openPanel.mockImplementationOnce(() => { throw new Error("Pane unavailable"); });
    expect(f.open).toThrow("Pane unavailable"); expect(Object.keys(f.service.portals)).toHaveLength(0);
  });
});
