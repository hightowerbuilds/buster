import { invoke } from "@tauri-apps/api/core";
import { type ThemePalette, CATPPUCCIN } from "../lib/theme";

// ── New per-line highlight span format (from buster-syntax) ──────────

export interface HighlightSpan {
  line: number;
  start_col: number;  // byte offset within line
  end_col: number;    // byte offset within line (exclusive)
  kind: string;       // TokenKind name: "Keyword", "String", etc.
}

// ── Syntax palette ───────────────────────────────────────────────────

let activeSyntax: Record<string, string> = { ...CATPPUCCIN.syntax };
let activeDefault: string = CATPPUCCIN.syntaxDefault;

export function setSyntaxPalette(p: ThemePalette) {
  activeSyntax = p.syntax;
  activeDefault = p.syntaxDefault;
}

/** Map TokenKind name to theme syntax key. */
const KIND_TO_SYNTAX: Record<string, string> = {
  Keyword: "keyword",
  Type: "type",
  Function: "function",
  Variable: "variable",
  Parameter: "variable.parameter",
  Property: "property",
  String: "string",
  Number: "number",
  Boolean: "constant.builtin",
  Comment: "comment",
  Operator: "operator",
  Punctuation: "punctuation",
  Tag: "tag",
  Attribute: "attribute",
  Namespace: "module",
  Macro: "function.macro",
  Label: "variable",
  Escape: "string.escape",
  RegExp: "string.special",
  Plain: "",
};

function getColorForKind(kind: string): string {
  const syntaxKey = KIND_TO_SYNTAX[kind];
  if (!syntaxKey) return activeDefault;
  return activeSyntax[syntaxKey]
    || activeSyntax[syntaxKey.split(".")[0]]
    || activeDefault;
}

// ── LineToken (what the canvas renderer consumes) ────────────────────

export interface LineToken {
  start: number; // char offset within line
  end: number;   // char offset within line
  color: string;
}

// ── IPC: document lifecycle ──────────────────────────────────────────

export async function syntaxOpen(filePath: string, content: string): Promise<void> {
  try {
    await invoke<void>("syntax_open", { filePath, content });
  } catch (err) {
    console.error("syntax_open error:", err);
  }
}

export async function syntaxClose(filePath: string): Promise<void> {
  try {
    await invoke<void>("syntax_close", { filePath });
  } catch (err) {
    console.error("syntax_close error:", err);
  }
}

export async function syntaxEdit(
  filePath: string,
  startByte: number,
  oldEndByte: number,
  newEndByte: number,
  startRow: number,
  startCol: number,
  oldEndRow: number,
  oldEndCol: number,
  newEndRow: number,
  newEndCol: number,
  newText: string,
): Promise<void> {
  try {
    await invoke<void>("syntax_edit", {
      filePath, startByte, oldEndByte, newEndByte,
      startRow, startCol, oldEndRow, oldEndCol, newEndRow, newEndCol,
      newText,
    });
  } catch (err) {
    console.error("syntax_edit error:", err);
  }
}

// ── IPC: highlight request ───────────────────────────────────────────

let cachedSpans: HighlightSpan[] = [];
let cachedFilePath: string | null = null;
let cachedStartLine = -1;
let cachedEndLine = -1;

/**
 * Request viewport-scoped highlights from Rust backend.
 * Returns per-line spans for the visible viewport.
 */
export async function requestHighlights(
  filePath: string,
  source: string,
  startLine: number,
  endLine: number,
): Promise<HighlightSpan[]> {
  // Cache check — skip if viewport hasn't changed
  if (
    filePath === cachedFilePath &&
    startLine === cachedStartLine &&
    endLine === cachedEndLine
  ) {
    return cachedSpans;
  }

  try {
    const spans = await invoke<HighlightSpan[]>("highlight_code", {
      filePath,
      source,
      startLine,
      endLine,
    });
    cachedSpans = spans;
    cachedFilePath = filePath;
    cachedStartLine = startLine;
    cachedEndLine = endLine;
    return spans;
  } catch (err) {
    console.error("highlight_code error:", err);
    return [];
  }
}

/**
 * Convert per-line highlight spans to LineToken[][] for the canvas renderer.
 *
 * The new format is already per-line with byte-offset columns.
 * We still need to convert byte offsets → char offsets for Unicode correctness.
 */
export function spansToLineTokens(
  spans: HighlightSpan[],
  lines: string[],
): LineToken[][] {
  const result: LineToken[][] = lines.map(() => []);

  for (const span of spans) {
    if (span.line < 0 || span.line >= lines.length) continue;

    const line = lines[span.line];
    const lineBytes = new TextEncoder().encode(line);
    const decoder = new TextDecoder();

    const startChar = decoder.decode(lineBytes.slice(0, span.start_col)).length;
    const endChar = decoder.decode(lineBytes.slice(0, Math.min(span.end_col, lineBytes.length))).length;

    if (startChar >= endChar) continue;

    result[span.line].push({
      start: startChar,
      end: endChar,
      color: getColorForKind(span.kind),
    });
  }

  return result;
}
