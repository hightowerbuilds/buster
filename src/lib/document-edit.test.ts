import { describe, expect, it } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { applyChanges, mapOffset, planEdits } from "./document-edit";
import { registerDocumentEditCommands } from "./document-edit";
import { FeatureCommands } from "./feature-commands";

const PARAGRAPH = "ok it could be that the time has come. up like a worm, like a miracle. what is risk? what is it to ride the bull?";

function fixture(text = PARAGRAPH) {
  const engine = createEditorEngine(text);
  let open = true;
  const service = new FeatureCommands();
  registerDocumentEditCommands(service, { hasTab: id => id === "file_1" && open, engine: id => id === "file_1" ? engine : undefined });
  const run = (args: object) => service.dispatch({ command: "document edit", args: { tabId: "file_1", revision: engine.editSeq(), ...args }, requestId: crypto.randomUUID() }, "ai");
  return { engine, service, run, close: () => { open = false; } };
}

describe("planEdits", () => {
  it("resolves unique matches in document order regardless of edit order", () => {
    const changes = planEdits("one two three", [{ find: "three", replace: "3" }, { find: "one", replace: "1" }]);
    expect(changes).toEqual([{ start: 0, end: 3, replace: "1" }, { start: 8, end: 13, replace: "3" }]);
    expect(applyChanges("one two three", changes)).toBe("1 two 3");
  });

  it("rejects missing, ambiguous and overlapping edits with actionable codes", () => {
    const fail = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code: string; message: string }); } throw new Error("expected failure"); };
    expect(fail(() => planEdits("abc", [{ find: "x", replace: "y" }])).code).toBe("NO_MATCH");
    expect(fail(() => planEdits("Abc", [{ find: "abc", replace: "y" }])).code).toBe("NO_MATCH");
    const ambiguous = fail(() => planEdits("what? what!", [{ find: "what", replace: "What" }]));
    expect(ambiguous.code).toBe("AMBIGUOUS_MATCH");
    expect(ambiguous.message).toContain("2 times");
    expect(fail(() => planEdits("abcdef", [{ find: "abcd", replace: "" }, { find: "cdef", replace: "" }])).code).toBe("OVERLAPPING_EDITS");
    expect(fail(() => planEdits("a a", [{ find: "a", replace: "b", occurrence: 3 }])).code).toBe("NO_MATCH");
    expect(fail(() => planEdits("a", [{ find: "a", replace: "b", occurrence: 0 }])).code).toBe("INVALID_ARGUMENTS");
    expect(fail(() => planEdits("a", [])).code).toBe("INVALID_ARGUMENTS");
  });

  it("selects a named occurrence and normalizes Windows line endings in replacements", () => {
    const changes = planEdits("what? what!", [{ find: "what", replace: "What\r\nnow", occurrence: 2 }]);
    expect(applyChanges("what? what!", changes)).toBe("what? What\nnow!");
  });

  it("maps offsets before, after and inside replaced spans", () => {
    const changes = [{ start: 2, end: 4, replace: "XYZ" }];
    expect([1, 2, 3, 4, 6].map(o => mapOffset(o, changes))).toEqual([1, 2, 5, 5, 7]);
  });
});

describe("document edit command", () => {
  it("capitalizes several sentences as one undo step and returns the new revision", async () => {
    const f = fixture();
    const result = await f.run({ edits: [
      { find: "ok it could", replace: "Ok it could" },
      { find: ". up like", replace: ". Up like" },
      { find: ". what is risk", replace: ". What is risk" },
      { find: "? what is it", replace: "? What is it" },
    ] });
    expect(result).toMatchObject({ ok: true, data: { tabId: "file_1", applied: 4 } });
    expect(f.engine.getText()).toBe("Ok it could be that the time has come. Up like a worm, like a miracle. What is risk? What is it to ride the bull?");
    expect(result.ok && (result.data as { revision: number }).revision).toBe(f.engine.editSeq());
    expect(f.engine.dirty()).toBe(true);
    f.engine.undo();
    expect(f.engine.getText()).toBe(PARAGRAPH);
  });

  it("keeps the writer's cursor on the same text across edits before it", async () => {
    const f = fixture("alpha beta gamma");
    f.engine.setCursor({ line: 0, col: 11 }); // before "gamma"
    await f.run({ edits: [{ find: "alpha", replace: "ALPHA ALPHA" }] });
    expect(f.engine.getText()).toBe("ALPHA ALPHA beta gamma");
    expect(f.engine.cursor()).toEqual({ line: 0, col: 17 });
  });

  it("edits across lines and preserves Unicode", async () => {
    const f = fixture("# titre\n\ncafé 世界 ok\nfin");
    const result = await f.run({ edits: [{ find: "# titre", replace: "# Titre" }, { find: "世界 ok\nfin", replace: "世界 OK\nFin" }] });
    expect(result.ok).toBe(true);
    expect(f.engine.getText()).toBe("# Titre\n\ncafé 世界 OK\nFin");
  });

  it("rejects a stale revision and leaves the note untouched", async () => {
    const f = fixture();
    const revision = f.engine.editSeq();
    f.engine.setCursor({ line: 0, col: 0 });
    f.engine.insert("x");
    const result = await f.service.dispatch({ command: "document edit", args: { tabId: "file_1", revision, edits: [{ find: "ok it", replace: "Ok it" }] }, requestId: "stale" }, "ai");
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    expect(f.engine.getText()).toBe(`x${PARAGRAPH}`);
  });

  it("applies nothing when any edit fails", async () => {
    const f = fixture();
    const result = await f.run({ edits: [{ find: "ok it", replace: "Ok it" }, { find: "missing words", replace: "x" }] });
    expect(result).toMatchObject({ ok: false, error: { code: "NO_MATCH" } });
    expect(f.engine.getText()).toBe(PARAGRAPH);
  });

  it("does not create an undo step for edits that change nothing", async () => {
    const f = fixture();
    const before = f.engine.editSeq();
    expect(await f.run({ edits: [{ find: "ok it", replace: "ok it" }] })).toMatchObject({ ok: true, data: { applied: 0, revision: before } });
    expect(f.engine.editSeq()).toBe(before);
  });

  it("reports closed notes and validates arguments", async () => {
    const f = fixture();
    expect(await f.run({ edits: [{ find: "", replace: "x" }] })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.run({ edits: [{ find: "ok", replace: "Ok", extra: true }] })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    f.close();
    expect(await f.run({ edits: [{ find: "ok it", replace: "Ok it" }] })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("checks a request without applying it", async () => {
    const f = fixture();
    const args = (edits: object[]) => ({ tabId: "file_1", revision: f.engine.editSeq(), edits });
    expect(await f.service.check("document edit", args([{ find: "ok it", replace: "Ok it" }]))).toEqual({ ok: true });
    expect(await f.service.check("document edit", args([{ find: "what is", replace: "What is" }]))).toMatchObject({ ok: false, error: { code: "AMBIGUOUS_MATCH" } });
    expect(await f.service.check("document edit", { tabId: "file_1" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(f.engine.getText()).toBe(PARAGRAPH);
  });
});
