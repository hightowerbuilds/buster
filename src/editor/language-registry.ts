import { extname } from "buster-path";
import type { Pos } from "./engine";

export type LanguageId = string;

export interface LanguageBracketPair {
  open: string;
  close: string;
}

export interface LanguageCommentTokens {
  line?: string;
  block?: { open: string; close: string };
}

export interface LanguageIndentationRules {
  increaseIndentPattern?: RegExp;
  decreaseIndentPattern?: RegExp;
}

export interface BuiltInSnippet {
  prefix: string;
  label: string;
  detail: string;
  expandWhen?: "blank-document";
  body: (indentUnit: string) => { text: string; cursor: Pos };
}

export interface LanguageDefinition {
  id: LanguageId;
  name: string;
  extensions: string[];
  aliases?: string[];
  comments?: LanguageCommentTokens;
  brackets: LanguageBracketPair[];
  autoClosePairs: LanguageBracketPair[];
  surroundingPairs: LanguageBracketPair[];
  indentation?: LanguageIndentationRules;
  snippets?: BuiltInSnippet[];
}

const COMMON_BRACKETS: LanguageBracketPair[] = [
  { open: "(", close: ")" },
  { open: "[", close: "]" },
  { open: "{", close: "}" },
];

const COMMON_AUTO_CLOSE: LanguageBracketPair[] = [
  ...COMMON_BRACKETS,
  { open: '"', close: '"' },
  { open: "'", close: "'" },
  { open: "`", close: "`" },
];

const COMMON_INDENTATION: LanguageIndentationRules = {
  increaseIndentPattern: /[{[(]\s*$/,
  decreaseIndentPattern: /^\s*[}\])]/,
};

function htmlBoilerplateSnippet(): BuiltInSnippet {
  return {
    prefix: "!",
    label: "HTML document",
    detail: "HTML5 boilerplate",
    expandWhen: "blank-document",
    body: (indentUnit) => ({
      text:
`<!DOCTYPE html>
<html lang="en">
<head>
${indentUnit}<meta charset="UTF-8">
${indentUnit}<meta name="viewport" content="width=device-width, initial-scale=1.0">
${indentUnit}<title>Document</title>
</head>
<body>
${indentUnit}
</body>
</html>`,
      cursor: { line: 8, col: indentUnit.length },
    }),
  };
}

function codeLanguage(
  id: LanguageId,
  name: string,
  extensions: string[],
  lineComment: string,
  extra?: Partial<LanguageDefinition>,
): LanguageDefinition {
  return {
    id,
    name,
    extensions,
    comments: { line: lineComment, block: { open: "/*", close: "*/" } },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: COMMON_INDENTATION,
    ...extra,
  };
}

// ── Language snippets ─────────────────────────────────────────────

function jsSnippets(): BuiltInSnippet[] {
  return [
    { prefix: "cl", label: "console.log", detail: "Log to console", body: () => ({ text: "console.log($0)", cursor: { line: 0, col: 12 } }) },
    { prefix: "fn", label: "function", detail: "Function declaration", body: (u) => ({ text: `function $1($2) {\n${u}$0\n}`, cursor: { line: 0, col: 9 } }) },
    { prefix: "afn", label: "arrow function", detail: "Arrow function expression", body: (u) => ({ text: `const $1 = ($2) => {\n${u}$0\n};`, cursor: { line: 0, col: 6 } }) },
    { prefix: "for", label: "for loop", detail: "For loop", body: (u) => ({ text: `for (let i = 0; i < $1; i++) {\n${u}$0\n}`, cursor: { line: 0, col: 20 } }) },
    { prefix: "fore", label: "for...of", detail: "For...of loop", body: (u) => ({ text: `for (const $1 of $2) {\n${u}$0\n}`, cursor: { line: 0, col: 11 } }) },
    { prefix: "if", label: "if statement", detail: "If statement", body: (u) => ({ text: `if ($1) {\n${u}$0\n}`, cursor: { line: 0, col: 4 } }) },
    { prefix: "ife", label: "if/else", detail: "If/else statement", body: (u) => ({ text: `if ($1) {\n${u}$0\n} else {\n${u}\n}`, cursor: { line: 0, col: 4 } }) },
    { prefix: "try", label: "try/catch", detail: "Try/catch block", body: (u) => ({ text: `try {\n${u}$0\n} catch (err) {\n${u}\n}`, cursor: { line: 1, col: u.length } }) },
    { prefix: "imp", label: "import", detail: "Import statement", body: () => ({ text: 'import { $1 } from "$2";', cursor: { line: 0, col: 10 } }) },
  ];
}

function rustSnippets(): BuiltInSnippet[] {
  return [
    { prefix: "fn", label: "fn", detail: "Function", body: (u) => ({ text: `fn $1($2) {\n${u}$0\n}`, cursor: { line: 0, col: 3 } }) },
    { prefix: "pfn", label: "pub fn", detail: "Public function", body: (u) => ({ text: `pub fn $1($2) {\n${u}$0\n}`, cursor: { line: 0, col: 7 } }) },
    { prefix: "let", label: "let", detail: "Let binding", body: () => ({ text: "let $1 = $0;", cursor: { line: 0, col: 4 } }) },
    { prefix: "letm", label: "let mut", detail: "Mutable let binding", body: () => ({ text: "let mut $1 = $0;", cursor: { line: 0, col: 8 } }) },
    { prefix: "match", label: "match", detail: "Match expression", body: (u) => ({ text: `match $1 {\n${u}$0\n}`, cursor: { line: 0, col: 6 } }) },
    { prefix: "impl", label: "impl", detail: "Impl block", body: (u) => ({ text: `impl $1 {\n${u}$0\n}`, cursor: { line: 0, col: 5 } }) },
    { prefix: "struct", label: "struct", detail: "Struct definition", body: (u) => ({ text: `struct $1 {\n${u}$0\n}`, cursor: { line: 0, col: 7 } }) },
    { prefix: "test", label: "#[test]", detail: "Test function", body: (u) => ({ text: `#[test]\nfn $1() {\n${u}$0\n}`, cursor: { line: 1, col: 3 } }) },
  ];
}

function pythonSnippets(): BuiltInSnippet[] {
  return [
    { prefix: "def", label: "def", detail: "Function definition", body: (u) => ({ text: `def $1($2):\n${u}$0`, cursor: { line: 0, col: 4 } }) },
    { prefix: "class", label: "class", detail: "Class definition", body: (u) => ({ text: `class $1:\n${u}def __init__(self$2):\n${u}${u}$0`, cursor: { line: 0, col: 6 } }) },
    { prefix: "for", label: "for loop", detail: "For loop", body: (u) => ({ text: `for $1 in $2:\n${u}$0`, cursor: { line: 0, col: 4 } }) },
    { prefix: "if", label: "if statement", detail: "If statement", body: (u) => ({ text: `if $1:\n${u}$0`, cursor: { line: 0, col: 3 } }) },
    { prefix: "ife", label: "if/else", detail: "If/else statement", body: (u) => ({ text: `if $1:\n${u}$0\nelse:\n${u}`, cursor: { line: 0, col: 3 } }) },
    { prefix: "try", label: "try/except", detail: "Try/except block", body: (u) => ({ text: `try:\n${u}$0\nexcept Exception as e:\n${u}`, cursor: { line: 1, col: u.length } }) },
    { prefix: "with", label: "with statement", detail: "Context manager", body: (u) => ({ text: `with $1 as $2:\n${u}$0`, cursor: { line: 0, col: 5 } }) },
  ];
}

function goSnippets(): BuiltInSnippet[] {
  return [
    { prefix: "fn", label: "func", detail: "Function", body: (u) => ({ text: `func $1($2) {\n${u}$0\n}`, cursor: { line: 0, col: 5 } }) },
    { prefix: "for", label: "for loop", detail: "For loop", body: (u) => ({ text: `for $1 {\n${u}$0\n}`, cursor: { line: 0, col: 4 } }) },
    { prefix: "forr", label: "for range", detail: "For range loop", body: (u) => ({ text: `for $1, $2 := range $3 {\n${u}$0\n}`, cursor: { line: 0, col: 4 } }) },
    { prefix: "if", label: "if statement", detail: "If statement", body: (u) => ({ text: `if $1 {\n${u}$0\n}`, cursor: { line: 0, col: 3 } }) },
    { prefix: "ife", label: "if/else", detail: "If/else statement", body: (u) => ({ text: `if $1 {\n${u}$0\n} else {\n${u}\n}`, cursor: { line: 0, col: 3 } }) },
    { prefix: "iferr", label: "if err != nil", detail: "Error check", body: (u) => ({ text: `if err != nil {\n${u}return $0\n}`, cursor: { line: 1, col: u.length + 7 } }) },
    { prefix: "struct", label: "struct", detail: "Struct type", body: (u) => ({ text: `type $1 struct {\n${u}$0\n}`, cursor: { line: 0, col: 5 } }) },
  ];
}

export const LANGUAGE_DEFINITIONS: LanguageDefinition[] = [
  {
    id: "html",
    name: "HTML",
    extensions: [".html", ".htm", ".xhtml"],
    aliases: ["html"],
    comments: { block: { open: "<!--", close: "-->" } },
    brackets: [
      ...COMMON_BRACKETS,
      { open: "<", close: ">" },
    ],
    autoClosePairs: [
      ...COMMON_AUTO_CLOSE,
      { open: "<", close: ">" },
    ],
    surroundingPairs: [
      ...COMMON_AUTO_CLOSE,
      { open: "<", close: ">" },
    ],
    indentation: {
      increaseIndentPattern: /<([A-Za-z][\w:-]*)(?:(?!<\/\1>).)*?>\s*$/,
      decreaseIndentPattern: /^\s*<\/[A-Za-z][\w:-]*>/,
    },
    snippets: [htmlBoilerplateSnippet()],
  },
  codeLanguage("javascript", "JavaScript", [".js", ".jsx", ".mjs", ".cjs"], "//", {
    snippets: jsSnippets(),
  }),
  codeLanguage("typescript", "TypeScript", [".ts", ".tsx", ".mts", ".cts"], "//", {
    snippets: jsSnippets(),
  }),
  {
    id: "css",
    name: "CSS",
    extensions: [".css", ".scss", ".sass", ".less"],
    comments: { block: { open: "/*", close: "*/" } },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: COMMON_INDENTATION,
  },
  {
    id: "json",
    name: "JSON",
    extensions: [".json", ".jsonc"],
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: COMMON_INDENTATION,
  },
  codeLanguage("rust", "Rust", [".rs"], "//", {
    snippets: rustSnippets(),
  }),
  {
    id: "python",
    name: "Python",
    extensions: [".py", ".pyw"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: {
      increaseIndentPattern: /:\s*(#.*)?$/,
      decreaseIndentPattern: /^\s*(elif|else|except|finally)\b/,
    },
    snippets: pythonSnippets(),
  },
  codeLanguage("go", "Go", [".go"], "//", {
    snippets: goSnippets(),
  }),
  codeLanguage("java", "Java", [".java"], "//"),
  codeLanguage("c", "C", [".c", ".h"], "//"),
  codeLanguage("cpp", "C++", [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"], "//"),
  codeLanguage("csharp", "C#", [".cs"], "//"),
  codeLanguage("php", "PHP", [".php"], "//", {
    comments: { line: "//", block: { open: "/*", close: "*/" } },
  }),
  {
    id: "ruby",
    name: "Ruby",
    extensions: [".rb"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: { increaseIndentPattern: /\b(do|def|class|module|if|unless|case|begin)\b.*$/ },
  },
  codeLanguage("swift", "Swift", [".swift"], "//"),
  codeLanguage("kotlin", "Kotlin", [".kt", ".kts"], "//"),
  codeLanguage("scala", "Scala", [".scala", ".sc"], "//"),
  {
    id: "shellscript",
    name: "Shell Script",
    extensions: [".sh", ".bash", ".zsh", ".fish"],
    aliases: ["shell", "bash", "zsh"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: { increaseIndentPattern: /\b(then|do|case)\s*$/ },
  },
  {
    id: "yaml",
    name: "YAML",
    extensions: [".yml", ".yaml"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
  },
  {
    id: "toml",
    name: "TOML",
    extensions: [".toml"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
  },
  {
    id: "markdown",
    name: "Markdown",
    extensions: [".md", ".markdown", ".mdx"],
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
  },
  {
    id: "sql",
    name: "SQL",
    extensions: [".sql"],
    comments: { line: "--", block: { open: "/*", close: "*/" } },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
  },
  codeLanguage("lua", "Lua", [".lua"], "--", {
    comments: { line: "--", block: { open: "--[[", close: "]]" } },
  }),
  codeLanguage("dart", "Dart", [".dart"], "//"),
  {
    id: "r",
    name: "R",
    extensions: [".r", ".R"],
    comments: { line: "#" },
    brackets: COMMON_BRACKETS,
    autoClosePairs: COMMON_AUTO_CLOSE,
    surroundingPairs: COMMON_AUTO_CLOSE,
    indentation: COMMON_INDENTATION,
  },
  codeLanguage("vue", "Vue", [".vue"], "//"),
  codeLanguage("svelte", "Svelte", [".svelte"], "//"),
];

const LANGUAGE_BY_ID = new Map(LANGUAGE_DEFINITIONS.map((language) => [language.id, language]));
const LANGUAGE_BY_EXTENSION = new Map<string, LanguageDefinition>();

for (const language of LANGUAGE_DEFINITIONS) {
  for (const extension of language.extensions) {
    LANGUAGE_BY_EXTENSION.set(extension.toLowerCase(), language);
  }
}

export function getLanguageDefinition(id: LanguageId | null): LanguageDefinition | null {
  if (!id) return null;
  return LANGUAGE_BY_ID.get(id) ?? null;
}

export function getLanguageDefinitionForPath(languagePath: string | null): LanguageDefinition | null {
  if (!languagePath) return null;
  const ext = extname(languagePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION.get(ext) ?? null;
}

export function inferLanguageId(languagePath: string | null): LanguageId | null {
  return getLanguageDefinitionForPath(languagePath)?.id ?? null;
}

export function getAutoClosePairMap(languagePath: string | null): Record<string, string> {
  const language = getLanguageDefinitionForPath(languagePath);
  const pairs = language?.autoClosePairs ?? COMMON_AUTO_CLOSE;
  return Object.fromEntries(pairs.map((pair) => [pair.open, pair.close]));
}

export function getClosingPairSet(languagePath: string | null): Set<string> {
  const language = getLanguageDefinitionForPath(languagePath);
  const pairs = language?.autoClosePairs ?? COMMON_AUTO_CLOSE;
  return new Set(pairs.map((pair) => pair.close));
}
