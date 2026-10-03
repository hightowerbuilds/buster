import { batch } from "solid-js";
import { createStore } from "solid-js/store";
import { CommandFailure, objectResult, type CommandCaller, type FeatureCommands } from "./feature-commands";
import { MAX_PRINT_TEXT, printableBody } from "./print-document";
import { isMarkdownPath } from "../editor/writing-viewport";
import type { Tab } from "./tab-types";
import { showError, showSuccess } from "./notify";

export interface Printer { id: string; name: string; isDefault: boolean }
export interface PrintOptions {
  destination: "printer" | "pdf";
  printerId: string;
  copies: number;
  paper: "letter" | "a4" | "legal";
  orientation: "portrait" | "landscape";
  pages: "all" | "range";
  firstPage: number;
  lastPage: number;
  duplex: "one-sided" | "two-sided-long-edge" | "two-sided-short-edge";
}
export interface PrintRequest { jobId: string; title: string; html: string; options: PrintOptions; pdfPath?: string }
export type PrintResult = { status: "submitted" | "saved" | "cancelled"; title: string; printer?: string; path?: string };
export interface PrintState {
  document: { tabId: string; title: string; caller: CommandCaller } | null;
  printers: Printer[];
  options: PrintOptions;
  loading: boolean;
  busy: boolean;
  error: string;
  printerError: string;
}
interface PrintDeps {
  tabs: () => readonly Tab[];
  text: (id: string) => string | undefined;
  printers: () => Promise<Printer[]>;
  submit: (request: PrintRequest) => Promise<PrintResult>;
  choosePdfPath: (title: string) => Promise<string | null>;
}
const defaults = (): PrintOptions => ({ destination: "pdf", printerId: "", copies: 1, paper: "letter",
  orientation: "portrait", pages: "all", firstPage: 1, lastPage: 1, duplex: "one-sided" });

export function printOptionsError(options: PrintOptions): string | null {
  if (options.destination === "printer" && !options.printerId) return "Choose a printer.";
  if (options.destination === "printer" && (!Number.isInteger(options.copies) || options.copies < 1 || options.copies > 99)) return "Choose between 1 and 99 copies.";
  if (options.pages === "range" && (!Number.isInteger(options.firstPage) || !Number.isInteger(options.lastPage)
    || options.firstPage < 1 || options.lastPage < options.firstPage || options.lastPage > 10000)) return "Enter a page range from 1 to 10000, with the last page after the first.";
  return null;
}

export function createPrinting(deps: PrintDeps) {
  const [state, setState] = createStore<PrintState>({ document: null, printers: [], options: defaults(), loading: false, busy: false, error: "", printerError: "" });
  let pending: { resolve: (result: PrintResult) => void; html: string; jobId: string; submitted: boolean; detach: () => void } | undefined;
  let disposed = false;
  function check(tabId: string) {
    const tab = deps.tabs().find(t => t.id === tabId);
    if (!tab || tab.type !== "file") throw new CommandFailure("UNAVAILABLE", "Choose an open note or text document to print.");
    const text = deps.text(tabId);
    if (text === undefined) throw new CommandFailure("UNAVAILABLE", "This document is still loading. Try printing again when it is ready.");
    if (new TextEncoder().encode(text).length > MAX_PRINT_TEXT) throw new CommandFailure("TOO_LARGE", "Print accepts documents up to 2 MiB.");
    if (text.includes("\0")) throw new CommandFailure("INVALID_DOCUMENT", "This document contains binary content and cannot be printed.");
    return { tab, text };
  }
  function finish(result: PrintResult) {
    const request = pending; pending = undefined;
    request?.detach();
    setState({ document: null, busy: false, loading: false });
    request?.resolve(result);
  }
  function cancel() {
    if (pending && !state.busy) finish({ status: "cancelled", title: state.document!.title });
  }
  async function refreshPrinters() {
    const request = pending; if (!request) return;
    setState({ loading: true, printerError: "" });
    try {
      const printers = await deps.printers();
      if (pending !== request) return;
      batch(() => {
        setState("printers", printers);
        if (!state.options.printerId && printers.length) {
          const selected = printers.find(printer => printer.isDefault) ?? printers[0];
          setState("options", { destination: "printer", printerId: selected.id });
        }
      });
    } catch (cause) { if (pending === request) setState("printerError", String(cause)); }
    finally { if (pending === request) setState("loading", false); }
  }
  function request(tabId: string, caller: CommandCaller = "user", signal?: AbortSignal): Promise<PrintResult> {
    if (disposed) throw new CommandFailure("UNAVAILABLE", "Printing is unavailable.");
    if (pending) throw new CommandFailure("BUSY", "Finish or cancel the open print dialog first.");
    const { tab, text } = check(tabId);
    if (signal?.aborted) return Promise.resolve({ status: "cancelled", title: tab.name });
    const html = printableBody(tab.name, text, isMarkdownPath(tab.path || tab.name));
    const result = new Promise<PrintResult>(resolve => {
      const abort = () => { if (pending && !pending.submitted) finish({ status: "cancelled", title: tab.name }); };
      pending = { resolve, html, jobId: crypto.randomUUID(), submitted: false, detach: () => signal?.removeEventListener("abort", abort) };
      signal?.addEventListener("abort", abort, { once: true });
    });
    setState({ document: { tabId, title: tab.name, caller }, options: defaults(), error: "", printerError: "", printers: [] });
    void refreshPrinters();
    return result;
  }
  async function confirm() {
    const request = pending, document = state.document;
    if (!request || !document || state.busy || state.loading) return;
    const error = printOptionsError(state.options);
    if (error) { setState("error", error); return; }
    setState({ busy: true, error: "" });
    try {
      const options = { ...state.options };
      if (options.pages === "all") { options.firstPage = 1; options.lastPage = 1; }
      let pdfPath: string | undefined;
      if (options.destination === "pdf") {
        const selected = await deps.choosePdfPath(document.title);
        if (pending !== request || disposed) return;
        if (!selected) { setState("busy", false); return; }
        pdfPath = selected;
        options.copies = 1; options.duplex = "one-sided";
      }
      request.submitted = true;
      const result = await deps.submit({ jobId: request.jobId, title: document.title, html: request.html, options, ...(pdfPath ? { pdfPath } : {}) });
      if (pending === request) finish(result);
    } catch (cause) { if (pending === request) { request.submitted = false; setState({ busy: false, error: cause instanceof Error ? cause.message : String(cause) }); } }
  }
  function dispose() {
    disposed = true;
    if (pending) finish({ status: "cancelled", title: state.document!.title });
  }
  function open(tabId: string | null) {
    try {
      if (!tabId) throw new Error("Choose a note or text document to print.");
      void request(tabId).then(result => {
        if (result.status === "submitted") showSuccess(`Sent ${result.title} to ${result.printer}`);
        else if (result.status === "saved") showSuccess(`Saved PDF: ${result.path}`);
      }).catch(cause => showError(String(cause)));
    } catch (cause) { showError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function prepareClose() {
    if (state.busy) throw new Error("Printing is still being prepared. Wait for it to finish before quitting.");
    cancel();
  }
  return { state, check, request, open, confirm, cancel, refreshPrinters, prepareClose, dispose,
    update: (options: Partial<PrintOptions>) => { if (!state.busy) { setState("options", options); setState("error", ""); } } };
}
export type PrintingService = ReturnType<typeof createPrinting>;

export function registerPrintCommands(commands: FeatureCommands, printing: PrintingService) {
  commands.register({ name: "document print", description: "Ask the writer to print an open note or text document using its current draft, including unsaved changes. Opens BusterMark's print confirmation dialog for the printer, copies, pages and layout, or Save as PDF. Nothing is sent or saved until the writer confirms. If cancelled, do not retry unless the writer asks.",
    version: 1, effect: "write", confirm: false,
    inputSchema: { type: "object", properties: { tabId: { type: "string", minLength: 1 } }, required: ["tabId"], additionalProperties: false },
    outputSchema: objectResult, examples: ['document print {"tabId":"file_1"}'],
    check: args => { printing.check(String(args.tabId)); },
    run: (args, caller, signal) => printing.request(String(args.tabId), caller, signal),
  });
}
