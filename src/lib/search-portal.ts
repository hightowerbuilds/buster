import { createStore } from "solid-js/store";
import type { EditorEngine } from "../editor/engine";
import type { PaneWorkspace } from "./writing-panes";
import { captureSelection, type SelectionTarget } from "./selection-commands";
import { CommandFailure, type FeatureCommands, type CommandSchema } from "./feature-commands";

export interface SearchHit { id: string; name: string; target: SelectionTarget; passage: SelectionTarget; keptTabId: string }
export interface SearchPortalState {
  id: string; tabId: string; source: SelectionTarget | null; query: string;
  status: "ready" | "completed"; results: SearchHit[]; searchedNotes: number; skippedNotes: number; truncated: boolean;
}
export interface SearchPortalDeps {
  workspace(): PaneWorkspace;
  notes(): Array<{ tabId: string; name: string }>;
  engine(tabId: string): EditorEngine | undefined;
  hasTab(tabId: string): boolean;
  openPanel(id: string, sourcePaneId: string): string;
  focusPanel(tabId: string): void;
  closePanel(tabId: string): void;
  focusSource(target: SelectionTarget): void;
  createNote(text: string, portalTabId: string): string;
  reviewPassage?(target: SelectionTarget, portalTabId: string): unknown;
}
const fail = (code: string, message: string): never => { throw new CommandFailure(code, message); };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_QUERY = 256, MAX_RESULTS = 100, MAX_SCAN = 1_000_000;
function queryValue(value: string, allowEmpty = false) {
  const query = value.trim();
  if (query.length > MAX_QUERY) fail("LIMIT_REACHED", "Search for a phrase up to 256 characters.");
  if (!query && !allowEmpty) fail("INVALID_ARGUMENTS", "Enter a word or phrase to search for.");
  if (/[\r\n]/.test(query)) fail("INVALID_ARGUMENTS", "Search for a word or phrase on one line.");
  return query;
}
export function createSearchPortal(deps: SearchPortalDeps) {
  const [portals, setPortals] = createStore<Record<string, SearchPortalState>>({});
  const requirePortal = (id: string) => portals[id] ?? fail("NOT_FOUND", "This search portal is closed.");
  const requireHit = (id: string, resultId: string) => requirePortal(id).results.find(hit => hit.id === resultId) ?? fail("NOT_FOUND", "This result is no longer in the current search. Search again.");
  function stale(target: SelectionTarget) {
    const engine = deps.hasTab(target.tabId) ? deps.engine(target.tabId) : undefined;
    return !engine || engine.editSeq() !== target.revision || engine.getTextRange(target.range.anchor, target.range.head) !== target.text;
  }
  function open(paneId = deps.workspace().activePaneId, initialQuery?: string) {
    const pane = deps.workspace().panes.find(item => item.id === paneId);
    if (!pane) fail("NOT_FOUND", "This writing pane is no longer open.");
    // Reopening the portal from its own toolbar focuses it and never submits a query.
    const existing = Object.values(portals).find(item => item.tabId === pane!.tabId);
    if (existing) { deps.focusPanel(existing.tabId); return { portalId: existing.id, tabId: existing.tabId }; }
    const engine = pane!.tabId ? deps.engine(pane!.tabId) : undefined;
    const selection = engine && pane!.tabId ? captureSelection(paneId, pane!.tabId, engine) : null;
    const source = selection ?? (engine && pane!.tabId ? {
      paneId, tabId: pane!.tabId, revision: engine.editSeq(),
      range: { anchor: { ...engine.cursor() }, head: { ...engine.cursor() } }, text: "",
    } : null);
    const query = initialQuery !== undefined ? queryValue(initialQuery, true) : (selection?.text.trim().split(/\r?\n/)[0].slice(0, MAX_QUERY) ?? "");
    const previous = source && Object.values(portals).find(item => item.source?.tabId === source.tabId && deps.hasTab(item.tabId));
    if (previous) {
      if (initialQuery !== undefined || JSON.stringify(previous.source) !== JSON.stringify(source))
        setPortals(previous.id, { source: copy(source), query, status: "ready", results: [], searchedNotes: 0, skippedNotes: 0, truncated: false });
      deps.focusPanel(previous.tabId);
      return { portalId: previous.id, tabId: previous.tabId };
    }
    const id = crypto.randomUUID();
    setPortals(id, { id, tabId: "", source: copy(source), query, status: "ready", results: [], searchedNotes: 0, skippedNotes: 0, truncated: false });
    try { setPortals(id, "tabId", deps.openPanel(id, paneId)); }
    catch (error) { setPortals(id, undefined!); throw error; }
    return { portalId: id, tabId: portals[id].tabId };
  }
  function query(id: string, value: string) {
    requirePortal(id);
    const query = queryValue(value);
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const results: SearchHit[] = [];
    let searchedNotes = 0, skippedNotes = 0, remaining = MAX_SCAN, truncated = false;
    const notes = deps.notes();
    for (const note of notes) {
      const engine = deps.engine(note.tabId);
      if (!engine || !deps.hasTab(note.tabId)) { skippedNotes++; continue; }
      if (!remaining || results.length >= MAX_RESULTS) { truncated = true; break; }
      searchedNotes++;
      const revision = engine.editSeq();
      const paneId = deps.workspace().panes.find(pane => pane.tabId === note.tabId)?.id ?? "";
      for (let line = 0; line < engine.lineCount(); line++) {
        const fullLine = engine.getLine(line);
        const text = fullLine.slice(0, remaining);
        remaining -= Math.max(1, text.length);
        if (text.length < fullLine.length) truncated = true;
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text))) {
          const start = match.index, end = start + match[0].length;
          const range = (a: number, b: number) => ({ anchor: { line, col: a }, head: { line, col: b } });
          const base = { paneId, tabId: note.tabId, revision };
          let a = Math.max(0, start - 90), b = Math.min(text.length, end + 90);
          // Snippets retain whole UTF-16 surrogate pairs around the matched passage.
          if (a > 0 && /[\uDC00-\uDFFF]/.test(text[a]) && /[\uD800-\uDBFF]/.test(text[a - 1])) a--;
          if (b < text.length && /[\uD800-\uDBFF]/.test(text[b - 1]) && /[\uDC00-\uDFFF]/.test(text[b])) b++;
          results.push({ id: crypto.randomUUID(), name: note.name, target: { ...base, range: range(start, end), text: match[0] },
            passage: { ...base, range: range(a, b), text: text.slice(a, b) }, keptTabId: "" });
          if (results.length >= MAX_RESULTS) { truncated = true; break; }
        }
        if (remaining <= 0 || results.length >= MAX_RESULTS) { remaining = Math.max(0, remaining); truncated = true; break; }
      }
    }
    setPortals(id, { query, status: "completed", results, searchedNotes, skippedNotes, truncated });
    return read(id);
  }
  function read(id: string) {
    const portal = requirePortal(id);
    return { ...copy(portal), scope: "open-notes", sourceStale: portal.source ? stale(portal.source) : false,
      results: portal.results.map(hit => ({ ...copy(hit), stale: stale(hit.target) })) };
  }
  function source(id: string, resultId?: string) {
    const target = resultId ? requireHit(id, resultId).target : requirePortal(id).source;
    if (!target) fail("UNAVAILABLE", "This portal was opened without a source note.");
    if (!deps.hasTab(target!.tabId)) fail("NOT_FOUND", "The source note has closed.");
    const changed = stale(target!);
    if (resultId && changed) fail("STALE_RESULT", "This note changed after the search. Search again before opening this match.");
    deps.focusSource(target!);
    if (!changed) {
      const engine = deps.engine(target!.tabId)!;
      engine.setSelection(target!.range.anchor, target!.range.head);
    }
    return { tabId: target!.tabId, stale: changed };
  }
  function keep(id: string, resultId: string) {
    const portal = requirePortal(id), hit = requireHit(id, resultId);
    if (hit.keptTabId && deps.hasTab(hit.keptTabId)) { deps.focusPanel(hit.keptTabId); return { tabId: hit.keptTabId }; }
    const tabId = deps.createNote(`${hit.passage.text}\n\nSource: ${hit.name}, line ${hit.target.range.anchor.line + 1}\n`, portal.tabId);
    setPortals(id, "results", item => item.id === resultId, "keptTabId", tabId);
    return { tabId };
  }
  function review(id: string, resultId: string) {
    const hit = requireHit(id, resultId);
    if (!deps.reviewPassage) fail("UNAVAILABLE", "AI review is unavailable.");
    if (stale(hit.passage)) fail("STALE_RESULT", "This note changed after the search. Search again before reviewing this passage.");
    // The provider focuses the note, resolves its current pane, selects this passage,
    // and opens the existing review. Opening never submits text to a model.
    return deps.reviewPassage!(copy(hit.passage), requirePortal(id).tabId);
  }
  function close(id: string) {
    const portal = requirePortal(id);
    if (portal.source && deps.hasTab(portal.source.tabId)) source(id);
    deps.closePanel(portal.tabId); setPortals(id, undefined!);
    return { portalId: id, closed: true };
  }
  function reconcile() { for (const portal of Object.values(portals)) if (portal.tabId && !deps.hasTab(portal.tabId)) setPortals(portal.id, undefined!); }
  return { portals, open, query, read, source, keep, review, close, reconcile, stale };
}
export type SearchPortalService = ReturnType<typeof createSearchPortal>;

export function registerSearchPortalCommands(commands: FeatureCommands, service: SearchPortalService) {
  const string: CommandSchema = { type: "string", minLength: 1 };
  const object = (properties: Record<string, CommandSchema>, required = Object.keys(properties)): CommandSchema => ({ type: "object", properties, required, additionalProperties: false });
  const id = object({ portalId: string }), result = object({ portalId: string, resultId: string });
  const examples: Record<string, object> = {
    "search portal open": { paneId: "<pane ID>" }, "search query": { portalId: "<portal ID>", query: "clear writing" },
    "search read": { portalId: "<portal ID>" }, "search source": { portalId: "<portal ID>", resultId: "<result ID>" },
    "search keep": { portalId: "<portal ID>", resultId: "<result ID>" }, "search review": { portalId: "<portal ID>", resultId: "<result ID>" }, "search portal close": { portalId: "<portal ID>" },
  };
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write") =>
    commands.register({ name, description, inputSchema, outputSchema: { type: "object", additionalProperties: true }, run, effect, version: 1, examples: [`${name} ${JSON.stringify(examples[name])}`] });
  add("search portal open", "Open or focus local open-note search. Captures the source and seeds an editable query from selection; never runs a search or sends to a model.",
    object({ paneId: string, query: { type: "string" } }, []), args => service.open(args.paneId, args.query));
  add("search query", "Search the current text of open notes locally (including unsaved changes). Literal case-insensitive phrase, 1–256 characters, single-line matches; at most 100 results and one million characters scanned. No network access.",
    object({ portalId: string, query: string }), args => service.query(args.portalId, args.query));
  add("search read", "Read source, query, bounded results, stale flags, and scan limits for this temporary portal.", id, args => service.read(args.portalId), "read");
  add("search source", "Return to the original note, or select a result match by stable ID. Changed result revisions are rejected; returning to an edited original never restores an old range.",
    object({ portalId: string, resultId: string }, ["portalId"]), args => service.source(args.portalId, args.resultId));
  add("search keep", "Keep a captured result passage and source label as an unsaved note. Repeated use focuses the retained note; the original is unchanged.", result, args => service.keep(args.portalId, args.resultId));
  add("search review", "Open the existing AI review for a fresh result passage. No generation or network request occurs until the user chooses Generate.", result, args => service.review(args.portalId, args.resultId));
  add("search portal close", "Close a temporary portal and return to its source when still open.", id, args => service.close(args.portalId));
}
