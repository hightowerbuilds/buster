import { CommandFailure, FeatureCommands, emptyArgs, type CommandSchema } from "./feature-commands";
import type { Tab } from "./tab-types";

export interface WorkbenchCommandDeps {
  tabs: () => readonly Tab[];
  activeTabId: () => string | null;
  workspaceRoot: () => string | null;
  terminalId: (tabId: string) => string | undefined;
  document: (tabId: string) => { text: string; revision: number; dirty: boolean } | null;
  createTerminal: () => string;
  focusTab: (tabId: string) => void;
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
  add("panel list", "List open tabs and which one is active.", emptyArgs,
    object({ panels: array(object({ tabId: string, active: boolean })) }), "read", () => ({
      panels: deps.tabs().map(tab => ({ tabId: tab.id, active: tab.id === deps.activeTabId() })),
    }));
  add("panel focus", "Activate an open tab.",
    object({ tabId: string }), object({ tabId: string }), "write", args => {
      const tab = requireTab(args.tabId);
      deps.focusTab(tab.id);
      return { tabId: tab.id };
    }, ['panel focus {"tabId":"file_1"}']);
  add("document create", "Create a Markdown note in a new tab. Its Notes-home file is created asynchronously; inspect document list for the assigned path or a retained unsaved draft on failure.",
    emptyArgs, object({ tabId: string }), "write", () => ({ tabId: deps.createNote() }));
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
