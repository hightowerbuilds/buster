import { CommandFailure, FeatureCommands, emptyArgs, type CommandSchema } from "./feature-commands";
import { requirePane, type PaneDirection, type PaneWorkspace } from "./writing-panes";
import type { PaneActions } from "./actions-panes";
import type { Tab } from "./tab-types";

export interface WorkbenchCommandDeps {
  tabs: () => readonly Tab[];
  activeTabId: () => string | null;
  workspaceRoot: () => string | null;
  terminalId: (tabId: string) => string | undefined;
  document: (tabId: string) => { text: string; revision: number; dirty: boolean } | null;
  createTerminal: () => string;
  focusTab: (tabId: string) => void;
  paneWorkspace: () => PaneWorkspace;
  panes: PaneActions;
  createNote: () => string;
}

const string: CommandSchema = { type: "string" };
const boolean: CommandSchema = { type: "boolean" };
const number: CommandSchema = { type: "number" };
const object = (properties: Record<string, CommandSchema>, required = Object.keys(properties)): CommandSchema => ({
  type: "object", properties, required, additionalProperties: false,
});
const array = (items: CommandSchema): CommandSchema => ({ type: "array", items });
const target = object({ tabId: { type: "string", minLength: 1 } });
const tabSchema = object({ id: string, name: string, type: string, path: string, dirty: boolean });
const tabData = (tab: Tab) => ({ id: tab.id, name: tab.name, type: tab.type, path: tab.path, dirty: tab.dirty });

/** This catalog owns help, validation, and the tool descriptions presented to AI. */
export function createWorkbenchCommands(deps: WorkbenchCommandDeps): FeatureCommands {
  const service = new FeatureCommands();
  const add = (
    name: string, description: string, inputSchema: CommandSchema, outputSchema: CommandSchema,
    effect: "read" | "write", run: (args: Record<string, unknown>) => unknown, examples: string[] = [name],
  ) => service.register({ name, description, inputSchema, outputSchema, effect, run, examples, version: 1 });
  const requireTab = (id: unknown, type?: Tab["type"]) => {
    const tab = deps.tabs().find(item => item.id === id && (!type || item.type === type));
    if (!tab) throw new CommandFailure("NOT_FOUND", type ? `No ${type} tab exists with that ID.` : "No tab exists with that ID.");
    return tab;
  };
  const descriptionSchema = object({
    name: string, description: string, version: number, effect: string,
    inputSchema: { type: "object", additionalProperties: true },
    outputSchema: { type: "object", additionalProperties: true },
    examples: array(string), available: boolean,
  });
  add("commands list", "List available commands and their input/result schemas.", emptyArgs,
    object({ commands: array(descriptionSchema) }), "read", () => ({ commands: service.describe() }));
  add("commands describe", "Describe a command, its effects, arguments, and examples.",
    object({ name: { type: "string", minLength: 1 } }), object({ command: descriptionSchema }), "read", args => {
      const command = service.describe(args.name as string)[0];
      if (!command) throw new CommandFailure("UNKNOWN_COMMAND", "No command exists with that name.");
      return { command };
    }, ['commands describe {"name":"terminal create"}']);
  add("app status", "Inspect the live workbench without exposing settings or credentials.", emptyArgs,
    object({ product: string, workspaceRoot: string, activeTabId: string, tabCount: number, terminalCount: number }), "read", () => ({
      product: "BusterMark", workspaceRoot: deps.workspaceRoot() ?? "", activeTabId: deps.activeTabId() ?? "",
      tabCount: deps.tabs().length, terminalCount: deps.tabs().filter(tab => tab.type === "terminal").length,
    }));
  add("workspace inspect", "Inspect the current workspace root and open tabs.", emptyArgs,
    object({ root: string, tabs: array(tabSchema) }), "read", () => ({ root: deps.workspaceRoot() ?? "", tabs: deps.tabs().map(tabData) }));
  const paneTarget = object({ paneId: { type: "string", minLength: 1 } });
  const paneResult = object({ paneId: string });
  const directionSchema: CommandSchema = { type: "string", enum: ["left", "right", "up", "down"] };
  const ensurePane = (paneId: unknown) => {
    if (!deps.paneWorkspace().panes.some(p => p.id === paneId)) throw new CommandFailure("NOT_FOUND", "No pane exists with that ID.");
    return paneId as string;
  };
  add("panel list", "List stable pane identities and their current note/tool references.", emptyArgs,
    object({ panels: array(object({ paneId: string, tabId: string, active: boolean, maximized: boolean })) }), "read", () => ({
      panels: deps.paneWorkspace().panes.map(p => ({ paneId: p.id, tabId: p.tabId ?? "", active: p.id === deps.paneWorkspace().activePaneId,
        maximized: p.id === deps.paneWorkspace().zoomedPaneId })),
    }));
  add("panel focus", "Focus a stable pane, or activate a tab using the legacy tabId argument.",
    object({ paneId: string, tabId: string }, []), object({ paneId: string, tabId: string }), "write", args => {
      if (!!args.paneId === !!args.tabId) throw new CommandFailure("INVALID_ARGUMENTS", "Supply exactly one of paneId or tabId.");
      if (args.paneId) deps.panes.focusPane(ensurePane(args.paneId));
      else deps.focusTab(requireTab(args.tabId).id);
      const p = requirePane(deps.paneWorkspace(), deps.paneWorkspace().activePaneId);
      return { paneId: p.id, tabId: p.tabId ?? "" };
    }, ['panel focus {"paneId":"<pane ID>"}']);
  add("document create", "Create an untitled Markdown note in the chosen pane, keeping replaced content open.",
    object({ paneId: string }, []), object({ tabId: string, paneId: string }), "write", args => {
      if (args.paneId) deps.panes.focusPane(ensurePane(args.paneId));
      return { tabId: deps.createNote(), paneId: deps.paneWorkspace().activePaneId };
    });
  add("panel split", "Split a pane beside a new note, terminal, or empty view. Limited to six panes.",
    object({ paneId: string, direction: directionSchema, content: { type: "string", enum: ["note", "terminal", "empty"] } }, ["direction"]),
    paneResult, "write", args => {
      const paneId = args.paneId ? ensurePane(args.paneId) : deps.paneWorkspace().activePaneId;
      if (deps.paneWorkspace().panes.length >= 6) throw new CommandFailure("LIMIT_REACHED", "The workspace supports up to six panes.");
      return { paneId: deps.panes.splitPane(args.direction as PaneDirection, (args.content ?? "note") as "note" | "terminal" | "empty", paneId) };
    }, ['panel split {"direction":"right","content":"note"}']);
  add("panel close", "Close a view, keeping its note or running terminal in the tab bar. Does not delete content or stop a shell.",
    paneTarget, paneResult, "write", args => { const paneId = ensurePane(args.paneId); deps.panes.closePane(paneId); return { paneId }; });
  add("panel zoom", "Toggle maximization of a pane, preserving the split arrangement.", paneTarget,
    object({ paneId: string, maximized: boolean }), "write", args => {
      const paneId = ensurePane(args.paneId); deps.panes.zoomPane(paneId);
      return { paneId, maximized: deps.paneWorkspace().zoomedPaneId === paneId };
    });
  add("panel swap", "Swap two pane contents without recreating their editors or shells.",
    object({ first: string, second: string }), object({ first: string, second: string }), "write", args => {
      const first = ensurePane(args.first), second = ensurePane(args.second); deps.panes.swapPanes(first, second); return { first, second };
    });
  add("panel resize", "Move a split divider to a ratio between 0.1 and 0.9; pane minimum dimensions still apply.",
    object({ splitId: string, ratio: number }), object({ splitId: string, ratio: number }), "write", args => {
      const ratio = args.ratio as number;
      if (ratio < 0.1 || ratio > 0.9) throw new CommandFailure("INVALID_ARGUMENTS", "ratio must be between 0.1 and 0.9.");
      try { deps.panes.resizeSplit(args.splitId as string, ratio); }
      catch { throw new CommandFailure("NOT_FOUND", "No split exists with that ID."); }
      return { splitId: args.splitId, ratio };
    });
  add("layout inspect", "Inspect stable pane IDs, split ratios, active pane, and zoom state.", emptyArgs,
    object({ workspace: { type: "object", additionalProperties: true } }), "read", () => ({ workspace: JSON.parse(JSON.stringify(deps.paneWorkspace())) }));
  add("document list", "List open writing documents, including untitled drafts.", emptyArgs,
    object({ documents: array(tabSchema) }), "read", () => ({ documents: deps.tabs().filter(tab => tab.type === "file").map(tabData) }));
  add("document read", "Read a live editor buffer, including unsaved changes and its revision.", target,
    object({ tabId: string, path: string, text: string, revision: number, dirty: boolean }), "read", args => {
      const tab = requireTab(args.tabId, "file");
      const document = deps.document(tab.id);
      if (!document) throw new CommandFailure("NOT_READY", "The document editor is not ready. Focus the document and retry with a new requestId.");
      return { tabId: tab.id, path: tab.path, ...document };
    }, ['document read {"tabId":"file_1"}']);
  add("terminal list", "List terminal tabs and whether their PTYs have initialized.", emptyArgs,
    object({ terminals: array(object({ tabId: string, name: string, cwd: string, ptyId: string, state: string })) }), "read", () => ({
      terminals: deps.tabs().filter(tab => tab.type === "terminal").map(tab => ({
        tabId: tab.id, name: tab.name, cwd: tab.path, ptyId: deps.terminalId(tab.id) ?? "",
        state: deps.terminalId(tab.id) ? "initialized" : "pending",
      })),
    }));
  add("terminal create", "Create and activate a terminal in the current workspace. PTY initialization follows asynchronously.", emptyArgs,
    object({ tabId: string, state: string }), "write", () => ({ tabId: deps.createTerminal(), state: "created" }));
  add("terminal focus", "Activate an existing terminal tab and focus its input.", target,
    object({ tabId: string }), "write", args => {
      const tab = requireTab(args.tabId, "terminal");
      deps.focusTab(tab.id);
      return { tabId: tab.id };
    }, ['terminal focus {"tabId":"term_tab_1"}']);
  add("history list", "List recent command outcomes. Arguments and document contents are not retained in history.", emptyArgs,
    object({ entries: array(object({ requestId: string, command: string, caller: string, ok: boolean, code: string }, ["requestId", "command", "caller", "ok"])) }),
    "read", () => ({ entries: service.history() }));
  return service;
}
