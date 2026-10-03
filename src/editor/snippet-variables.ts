/**
 * Snippet variable resolver.
 *
 * Replaces standard snippet variables ($TM_FILENAME, $CLIPBOARD, etc.)
 * with their runtime values before tab-stop parsing.
 */

import { basename } from "buster-path";

export interface SnippetVariableContext {
  filePath?: string | null;
  selectedText?: string;
  clipboard?: string;
  lineText?: string;
  lineNumber?: number;
}

const VARIABLE_PATTERN = /\$\{([A-Z_]+)(?::([^}]*))?\}|\$([A-Z_]+)/g;

/**
 * Resolve snippet variables in text.
 * Supports: $VAR and ${VAR} and ${VAR:default}
 */
export function resolveSnippetVariables(text: string, ctx: SnippetVariableContext): string {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");

  const vars: Record<string, string> = {
    // File
    TM_FILENAME: ctx.filePath ? basename(ctx.filePath) : "untitled",
    TM_FILENAME_BASE: ctx.filePath ? basename(ctx.filePath).replace(/\.[^.]+$/, "") : "untitled",
    TM_FILEPATH: ctx.filePath ?? "",
    TM_DIRECTORY: ctx.filePath ? ctx.filePath.replace(/\/[^/]+$/, "") : "",

    // Selection & clipboard
    TM_SELECTED_TEXT: ctx.selectedText ?? "",
    CLIPBOARD: ctx.clipboard ?? "",
    TM_CURRENT_LINE: ctx.lineText ?? "",
    TM_LINE_NUMBER: ctx.lineNumber != null ? String(ctx.lineNumber + 1) : "1",
    TM_LINE_INDEX: ctx.lineNumber != null ? String(ctx.lineNumber) : "0",

    // Date/time
    CURRENT_YEAR: String(now.getFullYear()),
    CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(2),
    CURRENT_MONTH: pad2(now.getMonth() + 1),
    CURRENT_MONTH_NAME: now.toLocaleString("en", { month: "long" }),
    CURRENT_MONTH_NAME_SHORT: now.toLocaleString("en", { month: "short" }),
    CURRENT_DATE: pad2(now.getDate()),
    CURRENT_DAY_NAME: now.toLocaleString("en", { weekday: "long" }),
    CURRENT_DAY_NAME_SHORT: now.toLocaleString("en", { weekday: "short" }),
    CURRENT_HOUR: pad2(now.getHours()),
    CURRENT_MINUTE: pad2(now.getMinutes()),
    CURRENT_SECOND: pad2(now.getSeconds()),

    // Random
    RANDOM: Math.random().toString().slice(2, 8),
    RANDOM_HEX: Math.random().toString(16).slice(2, 8),
    UUID: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
  };

  return text.replace(VARIABLE_PATTERN, (_match, bracedName, defaultVal, bareName) => {
    const name = bracedName ?? bareName;
    if (name in vars) {
      const val = vars[name];
      return val || defaultVal || "";
    }
    // Unknown variable — use default or leave as-is
    return defaultVal ?? "";
  });
}
