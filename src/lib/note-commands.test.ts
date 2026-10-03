import { describe, expect, it, vi } from "vitest";
import { createEditorEngine, type EditorEngine } from "../editor/engine";
import { FeatureCommands } from "./feature-commands";
import { notePath, noteFileName, registerNoteCommands } from "./note-commands";
import type { Tab } from "./tab-types";

const ROOT = "/home/writer/Notes";

function fixture(files: Record<string, string> = { "Iodine.md": "Up with it\nok it could be", "Drafts/idea.md": "a firework idea", "image.png": "x" }) {
  const disk = new Map(Object.entries(files).map(([path, text]) => [`${ROOT}/${path}`, text]));
  const tabs: Tab[] = [];
  const engines = new Map<string, EditorEngine>();
  let counter = 0;
  const openFile = vi.fn(async (path: string, _options: { activate: boolean }) => {
    const existing = tabs.find(tab => tab.path === path);
    if (existing) return existing.id;
    const id = `file_${++counter}`;
    tabs.push({ id, name: path.split("/").pop()!, path, dirty: false, type: "file" });
    engines.set(id, createEditorEngine(disk.get(path) ?? ""));
    return id;
  });
  const service = new FeatureCommands();
  registerNoteCommands(service, {
    notesRoot: () => ROOT,
    tabs: () => tabs,
    engine: id => engines.get(id),
    listFiles: async root => [...disk.keys()].filter(p => p.startsWith(`${root}/`)).map(p => ({ relative_path: p.slice(root.length + 1), name: p.split("/").pop()! })),
    searchFiles: async (root, query) => [...disk.entries()].flatMap(([p, text]) => text.split("\n").flatMap((line, i) =>
      line.toLowerCase().includes(query.toLowerCase()) ? [{ relative_path: p.slice(root.length + 1), line_number: i + 1, line_content: line }] : [])),
    readFile: async path => { if (!disk.has(path)) throw new Error("No such file"); return { content: disk.get(path)! }; },
    createFile: async path => { if (disk.has(path)) throw new Error("File already exists"); disk.set(path, ""); },
    writeFile: async (path, content) => { disk.set(path, content); },
    renameFile: async (path, name) => {
      const target = `${path.slice(0, path.lastIndexOf("/"))}/${name}`;
      if (!disk.has(path)) throw new Error("Source does not exist");
      if (disk.has(target)) throw new Error(`"${name}" already exists`);
      disk.set(target, disk.get(path)!); disk.delete(path);
      for (const tab of tabs) if (tab.path === path) { tab.path = target; tab.name = name; }
      return target;
    },
    openFile,
  });
  const run = async (command: string, args: Record<string, unknown> = {}) => {
    const result = await service.dispatch({ command, args, requestId: crypto.randomUUID() }, "ai");
    return result;
  };
  const data = async (command: string, args: Record<string, unknown> = {}) => {
    const result = await run(command, args);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.data as any;
  };
  return { service, disk, tabs, engines, openFile, run, data };
}

describe("note paths", () => {
  it("resolves Notes-relative paths and refuses escapes", () => {
    expect(notePath(ROOT, "Iodine.md")).toBe(`${ROOT}/Iodine.md`);
    expect(notePath(ROOT, "./Drafts/idea.md")).toBe(`${ROOT}/Drafts/idea.md`);
    for (const bad of ["../secret.md", "/etc/passwd", "Drafts/../../x.md", "a//b.md", "", "a\\b.md"]) {
      expect(() => notePath(ROOT, bad), bad).toThrow();
    }
  });

  it("validates names and adds an extension only when missing", () => {
    expect(noteFileName("Ideas")).toBe("Ideas.md");
    expect(noteFileName("plan.txt")).toBe("plan.txt");
    expect(noteFileName("Chapter 1", ".txt")).toBe("Chapter 1.txt");
    for (const bad of ["", "a/b", ".hidden", "..", "x".repeat(201)]) expect(() => noteFileName(bad), bad).toThrow();
  });
});

describe("note commands", () => {
  it("lists notes with open tab IDs and unsaved drafts, skipping non-notes", async () => {
    const f = fixture();
    await f.data("note open", { path: "Iodine.md" });
    f.tabs.push({ id: "file_draft", name: "Neon.md", path: "", dirty: true, type: "file" });
    const listed = await f.data("notes list");
    expect(listed.notes).toEqual([
      { path: "Drafts/idea.md", name: "idea.md", tabId: null, unsavedChanges: false },
      { path: "Iodine.md", name: "Iodine.md", tabId: "file_1", unsavedChanges: false },
    ]);
    expect(listed.drafts).toEqual([{ tabId: "file_draft", name: "Neon.md" }]);
  });

  it("reads closed notes from disk and open notes from the editor with a revision", async () => {
    const f = fixture();
    expect(await f.data("note read", { path: "Drafts/idea.md" })).toEqual({ path: "Drafts/idea.md", tabId: null, text: "a firework idea" });
    await f.data("note open", { path: "Iodine.md" });
    f.engines.get("file_1")!.setCursor({ line: 0, col: 0 });
    f.engines.get("file_1")!.insert("# ");
    const open = await f.data("note read", { path: "Iodine.md" });
    expect(open).toMatchObject({ tabId: "file_1", text: "# Up with it\nok it could be", revision: f.engines.get("file_1")!.editSeq() });
    expect(await f.run("note read", { path: "Missing.md" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("note read", { path: "../x.md" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });

  it("opens notes in the background and returns a revision for document edit", async () => {
    const f = fixture();
    const opened = await f.data("note open", { path: "Drafts/idea.md" });
    expect(opened).toEqual({ tabId: "file_1", path: "Drafts/idea.md", revision: 0 });
    expect(f.openFile).toHaveBeenCalledWith(`${ROOT}/Drafts/idea.md`, { activate: false });
    await f.data("note open", { path: "Drafts/idea.md", focus: true });
    expect(f.openFile).toHaveBeenLastCalledWith(`${ROOT}/Drafts/idea.md`, { activate: true });
    expect(f.tabs).toHaveLength(1);
    expect(await f.run("note open", { path: "Nope.md" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("note open", { path: "image.png" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });

  it("searches closed notes on disk and open notes including unsaved text", async () => {
    const f = fixture();
    await f.data("note open", { path: "Iodine.md" });
    f.engines.get("file_1")!.setCursor({ line: 1, col: 0 });
    f.engines.get("file_1")!.insert("a FIREWORK show ");
    const found = await f.data("notes search", { query: "firework" });
    expect(found.notes).toEqual([
      { path: "Drafts/idea.md", tabId: null, matches: [{ line: 1, text: "a firework idea" }], totalMatches: 1 },
      { path: "Iodine.md", tabId: "file_1", matches: [{ line: 2, text: "a FIREWORK show ok it could be" }], totalMatches: 1 },
    ]);
    expect(found.truncated).toBe(false);
  });

  it("creates named notes with text, or element-named empty notes, in background tabs", async () => {
    const f = fixture();
    const created = await f.data("note create", { name: "Ideas", text: "# Ideas\r\nfirst" });
    expect(created).toMatchObject({ path: "Ideas.md", tabId: "file_1" });
    expect(f.disk.get(`${ROOT}/Ideas.md`)).toBe("# Ideas\nfirst");
    expect(f.openFile).toHaveBeenCalledWith(`${ROOT}/Ideas.md`, { activate: false });
    expect(await f.run("note create", { name: "Ideas" })).toMatchObject({ ok: false, error: { code: "NAME_TAKEN" } });
    const unnamed = await f.data("note create");
    expect(unnamed.path).toMatch(/^[A-Z][a-z]+\.md$/);
    expect(unnamed.path).not.toBe("Iodine.md");
  });

  it("renames notes, keeping the extension and reporting conflicts", async () => {
    const f = fixture({ "Iodine.md": "x", "plan.txt": "y", "Taken.md": "z" });
    await f.data("note open", { path: "Iodine.md" });
    expect(await f.data("note rename", { path: "Iodine.md", name: "Up With It" })).toEqual({ path: "Up With It.md" });
    expect(f.tabs[0]).toMatchObject({ path: `${ROOT}/Up With It.md`, name: "Up With It.md" });
    expect(await f.data("note rename", { path: "plan.txt", name: "Plan" })).toEqual({ path: "Plan.txt" });
    expect(await f.run("note rename", { path: "Up With It.md", name: "Taken" })).toMatchObject({ ok: false, error: { code: "NAME_TAKEN" } });
    expect(await f.run("note rename", { path: "Gone.md", name: "New" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("marks opening as not needing approval, while create and rename do, and dry-runs bad names", async () => {
    const f = fixture();
    const confirm = (name: string) => { const c = f.service.describe(name)[0]; return c.confirm ?? c.effect === "write"; };
    expect(confirm("note open")).toBe(false);
    expect(confirm("note create")).toBe(true);
    expect(confirm("note rename")).toBe(true);
    expect(confirm("notes list")).toBe(false);
    expect(await f.service.check("note rename", { path: "Iodine.md", name: "a/b" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.service.check("note rename", { path: "../x.md", name: "b" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.service.check("note create", { name: ".env" })).toMatchObject({ ok: false });
    expect(await f.service.check("note create", {})).toEqual({ ok: true });
  });
});
