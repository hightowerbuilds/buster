import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createLspActions } from "./actions-lsp";
import type { BusterStoreState } from "./store-types";
import { lspStart, lspStatus } from "./ipc";
import { showError } from "./notify";
vi.mock("./ipc", () => ({ lspStart: vi.fn(), lspStatus: vi.fn() }));
vi.mock("./notify", () => ({ showError: vi.fn(), logWarn: vi.fn() }));
function fixture(paths = ["/notes/draft.md", "/code/app.ts", "/code/main.rs"]) {
  const [store, setStore] = createStore({ lspState: "inactive", lspLanguages: [], workspaceRoot: "/code",
    tabs: paths.map(path => ({ id: path, type: "file", path })),
  } as unknown as BusterStoreState);
  return { store, setStore, ...createLspActions(store, setStore) };
}
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(lspStart).mockResolvedValue(true); vi.mocked(lspStatus).mockResolvedValue(["typescript"]); });
afterEach(() => vi.useRealTimers());
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
describe("language server startup", () => {
  it("does not start or retry servers for writing documents", async () => {
    const f = fixture();
    for (const ext of ["md", "MARKDOWN", "txt", "text", "mdown", "mkd"]) f.attemptLspStart(`/notes/draft.${ext}`, "/notes");
    f.restartLsp(); // Chooses code, skipping the first Markdown tab.
    expect(lspStart).toHaveBeenCalledExactlyOnceWith("/code/app.ts", "/code");
    await settle();
    expect(showError).not.toHaveBeenCalled();
    const onlyNotes = fixture(["/notes/draft.md"]); onlyNotes.restartLsp();
    expect(lspStart).toHaveBeenCalledTimes(1);
    expect(onlyNotes.store.lspState).toBe("inactive");
  });
  it("treats an unconfigured server as inactive without retries", async () => {
    vi.mocked(lspStart).mockResolvedValue(false);
    const f = fixture(); f.attemptLspStart("/code/data.json", "/code");
    await vi.runAllTimersAsync();
    expect(f.store.lspState).toBe("inactive");
    expect(lspStart).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalled();
    expect(lspStatus).not.toHaveBeenCalled();
  });
  it("retains active code servers when opening an unsupported file", async () => {
    vi.mocked(lspStart).mockResolvedValue(false);
    const f = fixture(); f.setStore("lspLanguages", ["typescript"]);
    f.attemptLspStart("/code/data.json", "/code"); await settle();
    expect(f.store.lspState).toBe("active");
  });
  it("starts supported code servers and deduplicates pending startup", async () => {
    vi.mocked(lspStart).mockResolvedValue(true);
    const f = fixture();
    f.attemptLspStart("/code/app.ts", "/code"); f.attemptLspStart("/code/app.ts", "/code");
    await settle();
    expect(lspStart).toHaveBeenCalledTimes(1);
    expect(f.store.lspState).toBe("active");
    expect(f.store.lspLanguages).toEqual(["typescript"]);
  });
  it("retries real failures per file without notes consuming retry budget", async () => {
    vi.mocked(lspStart).mockRejectedValue(new Error("missing executable"));
    const f = fixture(); f.attemptLspStart("/code/app.ts", "/code"); f.attemptLspStart("/notes/draft.md", "/notes");
    await vi.runAllTimersAsync();
    expect(lspStart).toHaveBeenCalledTimes(3);
    expect(f.store.lspState).toBe("crashed");
    expect(showError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("missing executable"));
    vi.mocked(lspStart).mockResolvedValue(true);
    f.attemptLspStart("/code/main.rs", "/code"); await settle();
    expect(lspStart).toHaveBeenCalledTimes(4);
    expect(f.store.lspState).toBe("active");
  });
  it("cancels scheduled retries on restart and ignores late prior responses", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(lspStart).mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; })).mockResolvedValue(true);
    const f = fixture(); f.attemptLspStart("/code/app.ts", "/code");
    f.restartLsp(); await settle();
    reject(new Error("old failure")); await vi.runAllTimersAsync();
    expect(lspStart).toHaveBeenCalledTimes(2);
    expect(f.store.lspState).toBe("active");
    expect(showError).not.toHaveBeenCalled();
  });
  it("drops queued retries when a document closes or a restart replaces them", async () => {
    vi.mocked(lspStart).mockRejectedValue(new Error("startup failed"));
    const f = fixture(); f.attemptLspStart("/code/app.ts", "/code"); await settle();
    f.setStore("tabs", tabs => tabs.filter(tab => tab.path !== "/code/app.ts"));
    await vi.runAllTimersAsync();
    expect(lspStart).toHaveBeenCalledTimes(1);
    f.attemptLspStart("/code/main.rs", "/code"); await settle();
    vi.mocked(lspStart).mockResolvedValue(true);
    f.restartLsp(); await vi.runAllTimersAsync();
    expect(lspStart).toHaveBeenCalledTimes(3);
    expect(f.store.lspState).toBe("active");
    expect(showError).not.toHaveBeenCalled();
  });
});
