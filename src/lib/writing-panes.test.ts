import { describe, expect, it } from "vitest";
import { adjacentPane, closeWritingPane, newPaneWorkspace, paneGeometry, resizeActivePane, resizePaneSplit, restorePaneWorkspace, showTabInPane, splitWritingPane } from "./writing-panes";

describe("writing pane layout", () => {
  it("preserves note identity through nested splits and focuses existing views", () => {
    let w = newPaneWorkspace("note-a");
    const first = w.activePaneId;
    w = splitWritingPane(w, "right");
    w = showTabInPane(w, "note-b");
    const second = w.activePaneId;
    w = splitWritingPane(w, "down");
    w = showTabInPane(w, "note-c");
    expect(adjacentPane(w, "up")).toBe(second);
    w = showTabInPane(w, "note-a");
    expect(w.activePaneId).toBe(first);
    expect(w.panes.map(p => p.tabId)).toEqual(["note-a", "note-b", "note-c"]);
    expect(adjacentPane(w, "right")).toBe(second);
  });

  it("closes the intended pane and preserves unrelated split ratios", () => {
    let w = splitWritingPane(newPaneWorkspace("note-a"), "right");
    const second = w.activePaneId;
    const rootId = w.layout.id;
    w = resizePaneSplit(w, rootId, 0.65);
    w = splitWritingPane(w, "down");
    w = closeWritingPane(w, w.activePaneId);
    expect(w.layout).toMatchObject({ kind: "split", ratio: 0.65 });
    expect(w.panes.some(p => p.id === second)).toBe(true);
    expect(w.panes).toHaveLength(2);
    w = closeWritingPane(w, second);
    expect(w.layout.kind).toBe("pane");
    w = closeWritingPane(w, w.activePaneId);
    expect(w.panes).toHaveLength(1);
    expect(w.panes[0].tabId).toBeNull();
  });

  it("resizes the nearest matching boundary and maintains usable geometry", () => {
    let w = splitWritingPane(newPaneWorkspace("a"), "right");
    w = resizeActivePane(w, "left", 0.1);
    expect(w.layout).toMatchObject({ ratio: 0.4 });
    w = splitWritingPane(w, "down");
    const geometry = paneGeometry(w.layout, 300, 200);
    expect(geometry.panes).toHaveLength(3);
    for (const p of geometry.panes) {
      expect(p.width).toBeGreaterThanOrEqual(239.99);
      expect(p.height).toBeGreaterThanOrEqual(179.99);
    }
    expect(geometry.dividers).toHaveLength(2);
  });

  it("round trips layout, active pane and maximization with missing-file recovery", () => {
    let w = splitWritingPane(newPaneWorkspace("a"), "left");
    w = showTabInPane(w, "b");
    w.zoomedPaneId = w.activePaneId;
    expect(restorePaneWorkspace(JSON.parse(JSON.stringify(w)), new Set(["a", "b"]), "a")).toEqual(w);
    const restored = restorePaneWorkspace(w, new Set(["a"]), "a");
    expect(restored.panes.find(p => p.id === restored.activePaneId)?.tabId).toBeNull();
    expect(restored.panes.find(p => p.tabId === "a")).toBeDefined();
  });

  it("rejects corrupt or duplicate identities and stops at six panes", () => {
    let w = newPaneWorkspace("a");
    for (let n = 0; n < 5; n++) w = splitWritingPane(w, "right");
    expect(() => splitWritingPane(w, "right")).toThrow("6");
    expect(() => restorePaneWorkspace({ ...w, activePaneId: "missing" }, new Set(["a"]), "a")).toThrow("Invalid");
    expect(() => restorePaneWorkspace({ ...w, layout: { kind: "split", id: "x", axis: "row", ratio: 0.5, first: w.layout, second: w.layout } }, new Set(["a"]), "a")).toThrow("Invalid");
    expect(restorePaneWorkspace(null, new Set(["a"]), "a").panes[0].tabId).toBe("a");
  });
});
