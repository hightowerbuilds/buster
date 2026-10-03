/**
 * Emmet abbreviation expansion for the canvas editor.
 *
 * Supports HTML/JSX/TSX element abbreviations and CSS property abbreviations.
 * Hooks into the Tab key flow — after ghost text, before language snippets.
 *
 * Uses the `emmet` npm package with field markers configured to output
 * standard snippet syntax ($1, $2, ${1:placeholder}) compatible with
 * the editor's existing tab-stop system.
 */

// @ts-ignore — emmet has no type declarations
import expand, { extract } from "emmet";
import type { Pos } from "./engine";
import type { SnippetReplacement } from "./language-snippets";
import { inferLanguageId } from "./language-registry";

// Languages where Emmet HTML abbreviations should be active
const MARKUP_LANGUAGES = new Set([
  "html", "javascript", "typescript", // JSX/TSX are under js/ts
]);

// Languages where Emmet CSS abbreviations should be active
const STYLESHEET_LANGUAGES = new Set([
  "css",
]);

// Abbreviations that are too short or ambiguous to expand
const BLOCKLIST = new Set([
  "a", "b", "i", "p", "q", "s", "u", // single-letter HTML tags conflict with typing
  "br", "hr", "if", "do", "in", "of", // too ambiguous
]);

/**
 * Field output function — converts Emmet's internal field markers
 * to standard snippet tab-stop syntax ($1, ${1:placeholder}).
 */
function fieldOutput(index: number, placeholder: string | undefined): string {
  if (placeholder) return `\${${index}:${placeholder}}`;
  return `\$${index}`;
}

/**
 * Attempt to expand an Emmet abbreviation before the cursor.
 * Returns a SnippetReplacement if expansion is possible, null otherwise.
 */
export function expandEmmetBeforeCursor(context: {
  languagePath: string | null;
  lines: string[];
  cursor: Pos;
  indentUnit: string;
}): SnippetReplacement | null {
  const langId = inferLanguageId(context.languagePath);
  if (!langId) return null;

  const isMarkup = MARKUP_LANGUAGES.has(langId);
  const isStylesheet = STYLESHEET_LANGUAGES.has(langId);
  if (!isMarkup && !isStylesheet) return null;

  const line = context.lines[context.cursor.line] ?? "";
  const beforeCursor = line.slice(0, context.cursor.col);

  // Don't expand inside strings or comments (basic heuristic: count quotes)
  const singleQuotes = (beforeCursor.match(/'/g) || []).length;
  const doubleQuotes = (beforeCursor.match(/"/g) || []).length;
  const backticks = (beforeCursor.match(/`/g) || []).length;
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
    return null;
  }

  // Use Emmet's extract to find the abbreviation boundary
  const type = isStylesheet ? "stylesheet" : "markup";
  let extracted;
  try {
    extracted = extract(beforeCursor, context.cursor.col, { type });
  } catch {
    return null;
  }
  if (!extracted || !extracted.abbreviation) return null;

  const abbr = extracted.abbreviation;

  // Filter out noise
  if (abbr.length < 2) return null;
  if (BLOCKLIST.has(abbr)) return null;

  // Don't expand pure numbers or simple variable names that don't look like Emmet
  if (/^\d+$/.test(abbr)) return null;
  // Must contain an Emmet-like character: . # > + * [ ] ( ) : @ ! or uppercase tag
  if (isMarkup && !/[.#>+*\[\]()!@:{}]/.test(abbr) && !/^[a-z]+\d/.test(abbr)) {
    // Plain word — could be a tag name like "div" or "span"
    // Only expand known HTML tags or tags with modifiers
    const KNOWN_TAGS = new Set([
      "div", "span", "section", "article", "aside", "header", "footer", "main", "nav",
      "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "td", "th",
      "form", "input", "button", "select", "option", "textarea", "label",
      "h1", "h2", "h3", "h4", "h5", "h6", "img", "link", "meta", "script", "style",
      "video", "audio", "canvas", "svg", "pre", "code", "blockquote", "figure",
      "figcaption", "details", "summary", "dialog", "template", "slot",
    ]);
    if (!KNOWN_TAGS.has(abbr)) return null;
  }

  // Expand the abbreviation
  let expanded: string;
  try {
    expanded = expand(abbr, {
      type,
      options: {
        "output.field": fieldOutput,
        "output.indent": context.indentUnit,
        "output.baseIndent": "",
        "output.newline": "\n",
      },
    });
  } catch {
    // Invalid abbreviation
    return null;
  }

  // Sanity check: don't expand if result is empty or same as input
  if (!expanded || expanded === abbr) return null;

  // For CSS, the expansion should end with ; and contain :
  if (isStylesheet && !expanded.includes(":")) return null;

  // Compute cursor position — place at first field marker or end
  const lines = expanded.split("\n");
  let cursorPos: Pos = { line: context.cursor.line, col: context.cursor.col };

  // If there's a $1 or ${1:...} marker, the autocomplete snippet system
  // will handle cursor placement via parseSnippet. So just set cursor to
  // the start of the expansion and let the snippet system take over.
  const hasTabStops = /\$\{?\d/.test(expanded);
  if (!hasTabStops) {
    // No tab stops — place cursor at the end of expansion
    const lastLine = lines[lines.length - 1];
    cursorPos = {
      line: context.cursor.line + lines.length - 1,
      col: lines.length === 1
        ? extracted.start + lastLine.length
        : lastLine.length,
    };
  } else {
    // Has tab stops — cursor will be set by snippet system
    // Set to first tab stop's approximate position
    cursorPos = { line: context.cursor.line, col: extracted.start };
  }

  return {
    text: expanded,
    cursor: cursorPos,
    from: { line: context.cursor.line, col: extracted.start },
    to: { line: context.cursor.line, col: extracted.end },
  };
}
