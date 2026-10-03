import type { Pos } from "./engine";
import {
  getLanguageDefinitionForPath,
  inferLanguageId,
  type BuiltInSnippet,
} from "./language-registry";

export { inferLanguageId } from "./language-registry";

export interface SnippetExpansion {
  text: string;
  cursor: Pos;
}

export interface SnippetReplacement extends SnippetExpansion {
  from: Pos;
  to: Pos;
}

interface SnippetContext {
  languagePath: string | null;
  lines: string[];
  cursor: Pos;
  indentUnit: string;
}

function documentIsBlank(lines: string[]): boolean {
  return lines.every((line) => line.trim() === "");
}

function documentIsBlankAfterRemovingTrigger(
  lines: string[],
  cursor: Pos,
  trigger: string,
): boolean {
  return lines.every((line, index) => {
    if (index !== cursor.line) return line.trim() === "";
    const before = line.slice(0, cursor.col - trigger.length);
    const after = line.slice(cursor.col);
    return (before + after).trim() === "";
  });
}

export function listLanguageSnippets(languagePath: string | null): BuiltInSnippet[] {
  return getLanguageDefinitionForPath(languagePath)?.snippets ?? [];
}

export function expandTypedLanguageSnippet(
  trigger: string,
  context: SnippetContext,
): SnippetExpansion | null {
  const snippet = listLanguageSnippets(context.languagePath)
    .find((item) => item.prefix === trigger);
  if (!snippet) return null;
  if (snippet.expandWhen === "blank-document" && !documentIsBlank(context.lines)) return null;
  return snippet.body(context.indentUnit);
}

export function expandLanguageSnippetBeforeCursor(
  context: SnippetContext,
): SnippetReplacement | null {
  const line = context.lines[context.cursor.line] ?? "";
  const beforeCursor = line.slice(0, context.cursor.col);
  const snippet = listLanguageSnippets(context.languagePath)
    .find((item) => beforeCursor.endsWith(item.prefix));

  if (!snippet) return null;
  if (
    snippet.expandWhen === "blank-document" &&
    !documentIsBlankAfterRemovingTrigger(context.lines, context.cursor, snippet.prefix)
  ) {
    return null;
  }

  const expansion = snippet.body(context.indentUnit);
  return {
    ...expansion,
    from: { line: context.cursor.line, col: context.cursor.col - snippet.prefix.length },
    to: context.cursor,
  };
}

export function inferSnippetLanguageId(languagePath: string | null) {
  return inferLanguageId(languagePath);
}
