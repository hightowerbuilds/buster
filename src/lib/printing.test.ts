// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createPrinting, registerPrintCommands, type Printer } from "./printing";
import { printableBody } from "./print-document";
import { FeatureCommands } from "./feature-commands";
import { buildAssistantTools } from "./assistant-tools";
import type { Tab } from "./tab-types";
import { createAssistant } from "./assistant";
import type { AssistantTransport, ToolCall } from "./assistant-transport";

vi.mock("./notify", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
function fixture() {
  let text = "# Draft\n\nLive **unsaved** writing — café 👋";
  const tabs: Tab[] = [{ id: "note", name: "Draft.md", path: "/notes/Draft.md", type: "file", dirty: true },
    { id: "settings", name: "Settings", path: "", type: "settings", dirty: false }];
  const printers = vi.fn(async (): Promise<Printer[]> => [{ id: "office", name: "Office Printer", isDefault: true }]);
  const submit = vi.fn(async (_request: import("./printing").PrintRequest) => ({ status: "submitted" as const, title: "Draft.md", printer: "office" }));
  const choosePdfPath = vi.fn(async (): Promise<string | null> => "/tmp/draft.pdf");
  const printing = createPrinting({ tabs: () => tabs, text: id => id === "note" ? text : undefined, printers, submit, choosePdfPath });
  const commands = new FeatureCommands(); registerPrintCommands(commands, printing);
  return { printing, commands, printers, submit, choosePdfPath, edit: (value: string) => { text = value; } };
}

describe("confirmed printing", () => {
  it("exposes the same modal to AI without a duplicate approval card or a bypass argument", async () => {
    const f = fixture();
    const { tools, targets } = buildAssistantTools(f.commands);
    expect(tools.map(tool => tool.name)).toContain("document_print");
    expect(targets.get("document_print")).toMatchObject({ effect: "write", confirm: false });
    expect(await f.commands.dispatch({ requestId: "bad", command: "document print", args: { tabId: "note", confirmed: true } }, "ai")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    const pending = f.commands.dispatch({ requestId: "ai", command: "document print", args: { tabId: "note" } }, "ai");
    await vi.waitFor(() => expect(f.printing.state.document?.caller).toBe("ai"));
    expect(f.submit).not.toHaveBeenCalled();
    f.printing.cancel();
    expect(await pending).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("prints one captured live draft only after confirmation and keeps the selected options", async () => {
    const f = fixture(); const pending = f.printing.request("note");
    await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    f.printing.update({ copies: 2, paper: "a4", orientation: "landscape", pages: "range", firstPage: 2, lastPage: 4, duplex: "two-sided-long-edge" });
    f.edit("Changed after the print dialog opened");
    await f.printing.confirm();
    expect(f.submit).toHaveBeenCalledOnce();
    const job = f.submit.mock.calls[0]?.[0] as unknown as import("./printing").PrintRequest;
    expect(job.html).toContain("<strong>unsaved</strong>"); expect(job.html).not.toContain("Changed after");
    expect(job.options).toMatchObject({ printerId: "office", copies: 2, paper: "a4", orientation: "landscape", firstPage: 2, lastPage: 4 });
    expect(await pending).toMatchObject({ status: "submitted" }); expect(f.printing.state.document).toBeNull();
  });

  it("rejects invalid copies and page ranges without sending a print job", async () => {
    const f = fixture(); const pending = f.printing.request("note");
    await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    f.printing.update({ copies: 0 }); await f.printing.confirm(); expect(f.printing.state.error).toContain("copies");
    f.printing.update({ copies: 1, pages: "range", firstPage: 3, lastPage: 1 });
    await f.printing.confirm(); expect(f.printing.state.error).toContain("page range");
    expect(f.submit).not.toHaveBeenCalled(); f.printing.cancel(); await pending;
    expect(() => f.printing.request("settings")).toThrow("Choose an open note");
  });

  it("cancels on model interruption and releases the shared command queue", async () => {
    const f = fixture(), turn = new AbortController();
    const pending = f.commands.dispatch({ requestId: "ai", command: "document print", args: { tabId: "note" } }, "ai", turn.signal);
    await vi.waitFor(() => expect(f.printing.state.document).not.toBeNull());
    turn.abort();
    expect(await pending).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(f.submit).not.toHaveBeenCalled(); expect(f.printing.state.document).toBeNull();
    expect(await f.commands.dispatch({ requestId: "retry", command: "document print", args: { tabId: "note" } }, "ai", turn.signal)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("leaves failed jobs in the modal for an explicit retry or cancellation", async () => {
    const f = fixture(); f.submit.mockRejectedValueOnce(new Error("Printer unavailable"));
    const pending = f.printing.request("note"); await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    await f.printing.confirm();
    expect(f.printing.state.error).toBe("Printer unavailable"); expect(f.printing.state.document).not.toBeNull();
    expect(f.submit).toHaveBeenCalledOnce();
    f.printing.cancel(); expect(await pending).toMatchObject({ status: "cancelled" });
  });

  it("supports PDF without a printer and does not submit when the file picker is cancelled", async () => {
    const f = fixture(); f.printers.mockResolvedValue([]); f.choosePdfPath.mockResolvedValueOnce(null);
    const pending = f.printing.request("note"); await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    expect(f.printing.state.options.destination).toBe("pdf");
    await f.printing.confirm(); expect(f.submit).not.toHaveBeenCalled(); expect(f.printing.state.busy).toBe(false);
    await f.printing.confirm();
    const job = f.submit.mock.calls[0]?.[0] as unknown as import("./printing").PrintRequest;
    expect(job).toMatchObject({ pdfPath: "/tmp/draft.pdf", options: { destination: "pdf", copies: 1, duplex: "one-sided" } });
    await pending;
  });

  it("does not save if the model stops while the PDF picker is still open", async () => {
    const f = fixture(); f.printers.mockResolvedValue([]);
    let picked!: (path: string | null) => void;
    f.choosePdfPath.mockImplementationOnce(() => new Promise(resolve => { picked = resolve; }));
    const turn = new AbortController(), pending = f.printing.request("note", "ai", turn.signal);
    await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    const confirm = f.printing.confirm(); turn.abort(); picked("/tmp/draft.pdf"); await confirm;
    expect(await pending).toMatchObject({ status: "cancelled" }); expect(f.submit).not.toHaveBeenCalled();
  });
  it("ignores disabled copies and unused range fields when switching to PDF and all pages", async () => {
    const f = fixture(), pending = f.printing.request("note");
    await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
    f.printing.update({ copies: NaN, pages: "range", firstPage: NaN, lastPage: NaN });
    f.printing.update({ destination: "pdf", pages: "all" });
    await f.printing.confirm(); await pending;
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0][0].options).toMatchObject({ destination: "pdf", copies: 1, firstPage: 1, lastPage: 1 });
  });
});

describe("print document rendering", () => {
  it("renders headings and tables while stripping active content, style overrides and external images", () => {
    const html = printableBody("<Draft>", '# Heading\n\n**Bold**\n\n| A | B |\n| - | - |\n| one | two |\n\n<script>alert(1)</script><p onclick="bad()" style="color:red">Safe</p>\n\n![Image description](https://example.com/tracker)\n\n[Bad](javascript:alert(1))', true);
    expect(html).toContain("<h1>Heading</h1>"); expect(html).toContain("<strong>Bold</strong>"); expect(html).toContain("<table>");
    expect(html).toContain("&lt;Draft&gt;"); expect(html).toContain("Image description");
    expect(html).not.toMatch(/<script\b|onclick|style=|<img|javascript:|tracker/);
  });
  it("prints plain text literally without interpreting HTML or Markdown", () => {
    const html = printableBody("Code.txt", "<script>literal</script>\n# plain **text**", false);
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;"); expect(html).toContain("# plain **text**");
    expect(html).toContain('class="plain-text"'); expect(html).not.toContain("<script>");
  });
});

it("lets the model request printing, waits for the writer, and cancels a later request on Stop", async () => {
  const f = fixture();
  let call!: (tool: ToolCall) => void;
  const reply = vi.fn(async () => {});
  const transport: AssistantTransport = {
    status: async () => ({ installed: true, loggedIn: true, version: "test", authMethod: "test", subscription: null, detail: null }),
    subscribe: async (_event, onCall) => { call = onCall; return () => {}; },
    send: vi.fn(async () => {}), reset: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), toolResult: reply,
  };
  const model = createAssistant({ commands: f.commands, transport });
  try {
    await model.send("Print Draft.md"); call({ callId: "print-1", name: "document_print", input: { tabId: "note" } });
    await vi.waitFor(() => expect(f.printing.state.document?.caller).toBe("ai"));
    expect(reply).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
    expect(model.state.entries.some(entry => entry.kind === "tool" && entry.status === "awaiting")).toBe(false);
    await vi.waitFor(() => expect(f.printing.state.loading).toBe(false)); await f.printing.confirm();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
    expect(reply.mock.calls[0]).toEqual(["print-1", expect.stringContaining('"submitted"'), false]);
    call({ callId: "print-2", name: "document_print", input: { tabId: "note" } });
    await vi.waitFor(() => expect(f.printing.state.document).not.toBeNull()); model.stop();
    await vi.waitFor(() => expect(f.printing.state.document).toBeNull());
    expect(f.submit).toHaveBeenCalledOnce();
  } finally { await model.dispose(); f.printing.dispose(); }
});
