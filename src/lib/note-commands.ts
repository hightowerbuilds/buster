import type { EditorEngine } from "../editor/engine";
import { elementNoteNames } from "./element-note-names";
import { CommandFailure, objectResult, type CommandSchema, type FeatureCommands } from "./feature-commands";
import type { Tab } from "./tab-types";

/** Paths in and out of these commands are relative to the Notes folder, e.g. "Iodine.md" or "Drafts/idea.md". */
export interface NoteCommandDeps {
  notesRoot: () => string | null;
  tabs: () => readonly Tab[];
  engine: (tabId: string) => EditorEngine | undefined;
  listFiles: (root: string) => Promise<Array<{ relative_path: string; name: string }>>;
  searchFiles: (root: string, query: string) => Promise<Array<{ relative_path: string; line_number: number; line_content: string }>>;
  readFile: (path: string) => Promise<{ content: string }>;
  createFile: (path: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  renameFile: (path: string, newName: string) => Promise<string>;
  openFile: (path: string, options: { activate: boolean }) => Promise<string | undefined>;
  /** Resolves once the tab's editor exists; engines mount just after their tab is added. */
  waitForEngine?: (tabId: string) => Promise<EditorEngine | undefined>;
}

const NOTE_EXTENSIONS = [".md", ".markdown", ".txt"];
const MAX_SEARCH_MATCHES = 60;
const isNote = (path: string) => NOTE_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));

/** Resolve a Notes-relative path, refusing anything that could leave the folder. */
export function notePath(root: string, relative: string): string {
  const clean = relative.trim().replace(/^\.\/+/, "");
  const parts = clean.split("/");
  if (!clean || clean.startsWith("/") || clean.includes("\0") || clean.includes("\\") || parts.some(p => p === ".." || p === "." || p === ""))
    throw new CommandFailure("INVALID_ARGUMENTS", "Use a path relative to the Notes folder, such as \"Iodine.md\" or \"Drafts/idea.md\".");
  return `${root.replace(/\/+$/, "")}/${clean}`;
}

/** Validate a bare file name and give it `.md` (or the fallback extension) when it has none. */
export function noteFileName(name: string, fallbackExtension = ".md"): string {
  const clean = name.trim();
  if (!clean || clean === "." || clean === ".." || /[/\\\0]/.test(clean) || clean.length > 200)
    throw new CommandFailure("INVALID_ARGUMENTS", "Give a note name of up to 200 characters without slashes.");
  if (clean.startsWith(".")) throw new CommandFailure("INVALID_ARGUMENTS", "Note names cannot start with a dot.");
  return /\.[A-Za-z0-9]{1,10}$/.test(clean) ? clean : `${clean}${fallbackExtension}`;
}

const str: CommandSchema = { type: "string" };
const pathArg: CommandSchema = { type: "string", minLength: 1 };
const obj = (properties: Record<string, CommandSchema>, required = Object.keys(properties)): CommandSchema =>
  ({ type: "object", properties, required, additionalProperties: false });

export function registerNoteCommands(commands: FeatureCommands, deps: NoteCommandDeps) {
  const root = () => {
    const value = deps.notesRoot();
    if (!value) throw new CommandFailure("UNAVAILABLE", "The Notes folder is unavailable.");
    return value;
  };
  const relative = (full: string) => full.slice(root().replace(/\/+$/, "").length + 1);
  const openTab = (full: string) => deps.tabs().find(tab => tab.type === "file" && tab.path === full);
  const ready = async (tabId: string) => deps.engine(tabId) ?? await deps.waitForEngine?.(tabId);
  async function open(full: string, focus: boolean) {
    const tabId = await deps.openFile(full, { activate: focus });
    if (!tabId) throw new CommandFailure("UNAVAILABLE", "The note could not be opened.");
    const engine = await ready(tabId);
    return { tabId, path: relative(full), ...(engine ? { revision: engine.editSeq() } : {}) };
  }
  const add = (name: string, description: string, inputSchema: CommandSchema, effect: "read" | "write",
    run: (args: any) => unknown, extra: { confirm?: boolean; check?: (args: any) => void; example?: string } = {}) =>
    commands.register({ name, description, version: 1, effect, confirm: extra.confirm, inputSchema, outputSchema: objectResult,
      examples: [extra.example ?? name], check: extra.check, run });

  add("notes list", "List every note in the Notes folder (Markdown and text files, including subfolders) with its Notes-relative path, and the tab ID of notes that are open. Also lists unsaved drafts that have no file yet.",
    obj({}), "read", async () => {
      const files = (await deps.listFiles(root())).filter(file => isNote(file.relative_path))
        .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
      const notes = files.map(file => {
        const tab = openTab(notePath(root(), file.relative_path));
        return { path: file.relative_path, name: file.name, tabId: tab?.id ?? null, unsavedChanges: !!tab?.dirty };
      });
      const drafts = deps.tabs().filter(tab => tab.type === "file" && !tab.path).map(tab => ({ tabId: tab.id, name: tab.name }));
      return { notes, drafts };
    });

  add("notes search", "Find notes whose text contains a phrase (case-insensitive), including closed notes and unsaved text in open ones. Returns matching lines grouped by note.",
    obj({ query: { type: "string", minLength: 2 } }), "read", async args => {
      const query = String(args.query);
      const needle = query.toLowerCase();
      const liveTabs = deps.tabs().filter(tab => tab.type === "file" && tab.path.startsWith(`${root().replace(/\/+$/, "")}/`) && deps.engine(tab.id));
      const live = new Set(liveTabs.map(tab => relative(tab.path)));
      const results = new Map<string, Array<{ line: number; text: string }>>();
      const push = (path: string, line: number, text: string) => {
        const list = results.get(path) ?? [];
        list.push({ line, text: text.length > 240 ? `${text.slice(0, 237)}…` : text });
        results.set(path, list);
      };
      // Open notes are searched in the editor so unsaved text is included.
      for (const tab of liveTabs) {
        deps.engine(tab.id)!.getText().split("\n").forEach((text, i) => { if (text.toLowerCase().includes(needle)) push(relative(tab.path), i + 1, text); });
      }
      for (const hit of await deps.searchFiles(root(), query)) {
        if (isNote(hit.relative_path) && !live.has(hit.relative_path)) push(hit.relative_path, hit.line_number, hit.line_content);
      }
      let remaining = MAX_SEARCH_MATCHES;
      const notes = [...results.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, matches]) => {
        const kept = matches.slice(0, Math.max(0, remaining));
        remaining -= kept.length;
        return { path, tabId: openTab(notePath(root(), path))?.id ?? null, matches: kept, totalMatches: matches.length };
      }).filter(note => note.matches.length);
      return { query, notes, truncated: remaining < 0 || [...results.values()].reduce((n, m) => n + m.length, 0) > MAX_SEARCH_MATCHES };
    }, { example: 'notes search {"query":"microscopic firework"}' });

  add("note read", "Read a note by its Notes-relative path, open or closed. For an open note this is the live text with its tab ID and revision (use those with document edit); for a closed note it is the saved file.",
    obj({ path: pathArg }), "read", async args => {
      const full = notePath(root(), String(args.path));
      if (!isNote(full)) throw new CommandFailure("INVALID_ARGUMENTS", "Only Markdown and text notes can be read.");
      const tab = openTab(full);
      const engine = tab && deps.engine(tab.id);
      if (tab && engine) return { path: relative(full), tabId: tab.id, revision: engine.editSeq(), unsavedChanges: tab.dirty, text: engine.getText() };
      try { return { path: relative(full), tabId: null, text: (await deps.readFile(full)).content }; }
      catch { throw new CommandFailure("NOT_FOUND", "No note exists at that path. Use notes list."); }
    }, { example: 'note read {"path":"Iodine.md"}' });

  add("note open", "Open a note in a tab so it can be edited with document edit. It opens in the background unless focus is true, so the writer's current tab stays in front. Returns the tab ID and revision.",
    obj({ path: pathArg, focus: { type: "boolean" } }, ["path"]), "write", async args => {
      const full = notePath(root(), String(args.path));
      if (!isNote(full)) throw new CommandFailure("INVALID_ARGUMENTS", "Only Markdown and text notes can be opened.");
      if (!openTab(full) && !(await deps.listFiles(root())).some(file => file.relative_path === relative(full)))
        throw new CommandFailure("NOT_FOUND", "No note exists at that path. Use notes list.");
      return open(full, args.focus === true);
    }, { confirm: false, example: 'note open {"path":"Iodine.md"}' });

  add("note create", "Create a new note in the Notes folder with optional initial text, and open it in a background tab. Without a name it gets an unused periodic-table element name. `.md` is added when the name has no extension.",
    obj({ name: str, text: str }, []), "write", async args => {
      let name: string;
      if (args.name !== undefined) name = noteFileName(String(args.name));
      else {
        const taken = (await deps.listFiles(root())).map(file => file.relative_path);
        name = elementNoteNames(taken).next().value!;
      }
      const full = notePath(root(), name);
      try { await deps.createFile(full); }
      catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw message === "File already exists"
          ? new CommandFailure("NAME_TAKEN", `A note named ${name} already exists. Choose another name.`)
          : new CommandFailure("UNAVAILABLE", `Could not create the note: ${message}`);
      }
      if (args.text) await deps.writeFile(full, String(args.text).replace(/\r\n?/g, "\n"));
      return open(full, false);
    }, { check: args => { if (args.name !== undefined) noteFileName(String(args.name)); }, example: 'note create {"name":"Ideas","text":"# Ideas\\n"}' });

  add("note rename", "Rename a note in the Notes folder. Its open tab follows the new name. The extension is kept when the new name has none.",
    obj({ path: pathArg, name: pathArg }), "write", async args => {
      const full = notePath(root(), String(args.path));
      const extension = full.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? ".md";
      const name = noteFileName(String(args.name), extension);
      try { return { path: relative(await deps.renameFile(full, name)) }; }
      catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/already exists/.test(message)) throw new CommandFailure("NAME_TAKEN", `A note named ${name} already exists.`);
        if (/does not exist/.test(message)) throw new CommandFailure("NOT_FOUND", "No note exists at that path. Use notes list.");
        throw new CommandFailure("UNAVAILABLE", `Could not rename the note: ${message}`);
      }
    }, { check: args => { notePath("/notes", String(args.path)); noteFileName(String(args.name)); }, example: 'note rename {"path":"Iodine.md","name":"Up With It"}' });
}
