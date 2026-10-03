import type { CommandSchema, FeatureCommands } from "./feature-commands";

/** Anthropic tool definition. `eager_input_streaming` is added by the Rust transport. */
export interface AssistantTool {
  name: string;
  description: string;
  input_schema: CommandSchema;
}

export interface ToolTarget { command: string; effect: "read" | "write"; confirm: boolean }

// Commands that drive human-facing panels (review, search portal, clipboard), change the app's look, or
// duplicate tool schemas are left out so Claude sees a small, writing-focused tool set.
// `note create` supersedes `document create` for Claude: it takes a name and initial text.
const EXCLUDED = new Set(["commands list", "commands describe", "history list", "selection copy", "selection paste", "selection ai", "document create"]);
const EXCLUDED_PREFIXES = ["review ", "search ", "appearance ", "effects ", "speech "];
export const isAssistantTool = (command: string) => !EXCLUDED.has(command) && !EXCLUDED_PREFIXES.some(prefix => command.startsWith(prefix));

export function toolName(command: string): string {
  return command.trim().replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
}

/** Snapshot the available command catalog as tools. Order follows registration, so it is stable for caching. */
export function buildAssistantTools(commands: Pick<FeatureCommands, "describe">) {
  const tools: AssistantTool[] = [];
  const targets = new Map<string, ToolTarget>();
  for (const command of commands.describe()) {
    if (!command.available || !isAssistantTool(command.name)) continue;
    const name = toolName(command.name);
    if (targets.has(name)) continue;
    const confirm = command.confirm ?? command.effect === "write";
    const approval = confirm ? " Changes the app, so the user must approve each call." : "";
    const example = command.examples[0] ? ` Example command line: ${command.examples[0]}` : "";
    tools.push({ name, description: `${command.description}${approval}${example}`, input_schema: command.inputSchema });
    targets.set(name, { command: command.name, effect: command.effect, confirm });
  }
  return { tools, targets };
}
