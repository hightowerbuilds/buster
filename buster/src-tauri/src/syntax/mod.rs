use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};
use libloading;

use buster_syntax::{
    DocumentTree, GrammarConfig, EditRange, ViewportRange,
    HighlightSpan as BusterSpan, TokenKind, ParseProvider,
};

// Highlight names that map to our theme colors
const HIGHLIGHT_NAMES: &[&str] = &[
    "attribute",
    "comment",
    "constant",
    "constant.builtin",
    "constructor",
    "embedded",
    "function",
    "function.builtin",
    "function.macro",
    "keyword",
    "module",
    "number",
    "operator",
    "property",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "string",
    "string.escape",
    "string.special",
    "tag",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.parameter",
];

/// Map HIGHLIGHT_NAMES index to TokenKind.
fn highlight_index_to_token_kind(idx: usize) -> TokenKind {
    match idx {
        0  => TokenKind::Attribute,     // attribute
        1  => TokenKind::Comment,       // comment
        2  => TokenKind::Variable,      // constant
        3  => TokenKind::Variable,      // constant.builtin
        4  => TokenKind::Function,      // constructor
        5  => TokenKind::Plain,         // embedded
        6  => TokenKind::Function,      // function
        7  => TokenKind::Function,      // function.builtin
        8  => TokenKind::Macro,         // function.macro
        9  => TokenKind::Keyword,       // keyword
        10 => TokenKind::Namespace,     // module
        11 => TokenKind::Number,        // number
        12 => TokenKind::Operator,      // operator
        13 => TokenKind::Property,      // property
        14 => TokenKind::Punctuation,   // punctuation
        15 => TokenKind::Punctuation,   // punctuation.bracket
        16 => TokenKind::Punctuation,   // punctuation.delimiter
        17 => TokenKind::Punctuation,   // punctuation.special
        18 => TokenKind::String,        // string
        19 => TokenKind::Escape,        // string.escape
        20 => TokenKind::String,        // string.special
        21 => TokenKind::Tag,           // tag
        22 => TokenKind::Type,          // type
        23 => TokenKind::Type,          // type.builtin
        24 => TokenKind::Variable,      // variable
        25 => TokenKind::Variable,      // variable.builtin
        26 => TokenKind::Parameter,     // variable.parameter
        _  => TokenKind::Plain,
    }
}

// ── Legacy HighlightSpan (old byte-offset format, kept for backward compat) ──

#[derive(Debug, Clone, Serialize)]
pub struct HighlightSpan {
    pub start_byte: usize,
    pub end_byte: usize,
    pub highlight_type: String,
}

// ── TreeSitterProvider ───────────────────────────────────────────────

/// Implements `ParseProvider` by wrapping tree-sitter-highlight.
/// Converts byte-offset highlight events into per-line `BusterSpan`.
struct TreeSitterProvider {
    config: Arc<HighlightConfiguration>,
}

impl TreeSitterProvider {
    fn highlight_to_buster_spans(&self, source: &str) -> Option<Vec<BusterSpan>> {
        let mut highlighter = Highlighter::new();
        let source_bytes = source.as_bytes();

        let events = highlighter
            .highlight(&self.config, source_bytes, None, |_| None)
            .ok()?;

        // Precompute line start byte offsets
        let line_starts = compute_line_starts(source_bytes);

        // Collect byte-offset spans with TokenKind
        let mut byte_spans: Vec<(usize, usize, TokenKind)> = Vec::new();
        let mut current_highlight: Option<usize> = None;

        for event in events {
            match event {
                Ok(HighlightEvent::Source { start, end }) => {
                    if let Some(idx) = current_highlight {
                        if idx < HIGHLIGHT_NAMES.len() {
                            byte_spans.push((start, end, highlight_index_to_token_kind(idx)));
                        }
                    }
                }
                Ok(HighlightEvent::HighlightStart(h)) => {
                    current_highlight = Some(h.0);
                }
                Ok(HighlightEvent::HighlightEnd) => {
                    current_highlight = None;
                }
                Err(_) => break,
            }
        }

        // Convert byte-offset spans to per-line BusterSpan
        let mut result: Vec<BusterSpan> = Vec::with_capacity(byte_spans.len());

        for (start_byte, end_byte, kind) in byte_spans {
            // Find which line(s) this span covers
            let start_line = line_for_byte(&line_starts, start_byte);
            let end_line = line_for_byte(&line_starts, end_byte.saturating_sub(1).max(start_byte));

            for line in start_line..=end_line {
                if line >= line_starts.len() { break; }
                let line_start = line_starts[line];
                let line_end = if line + 1 < line_starts.len() {
                    line_starts[line + 1]
                } else {
                    source_bytes.len()
                };

                let col_start = if start_byte > line_start { start_byte - line_start } else { 0 };
                let col_end = if end_byte < line_end { end_byte - line_start } else { line_end - line_start };

                if col_start < col_end {
                    result.push(BusterSpan::new(line, col_start, col_end, kind));
                }
            }
        }

        Some(result)
    }
}

impl ParseProvider for TreeSitterProvider {
    fn parse(&self, source: &str, _language: &str) -> Option<Vec<BusterSpan>> {
        self.highlight_to_buster_spans(source)
    }

    fn parse_incremental(
        &self,
        source: &str,
        language: &str,
        _edit: &EditRange,
    ) -> Option<Vec<BusterSpan>> {
        // tree-sitter-highlight doesn't expose incremental parsing.
        // DocumentTree caches spans and scopes to viewport, so the full
        // reparse here is acceptable.
        self.parse(source, language)
    }
}

/// Compute byte offset of each line start.
fn compute_line_starts(bytes: &[u8]) -> Vec<usize> {
    let mut starts = vec![0];
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

/// Binary search for which line a byte offset falls on.
fn line_for_byte(line_starts: &[usize], byte: usize) -> usize {
    match line_starts.binary_search(&byte) {
        Ok(line) => line,
        Err(line) => line.saturating_sub(1),
    }
}

// ── SyntaxService ────────────────────────────────────────────────────

pub struct SyntaxService {
    configs: RwLock<HashMap<String, Arc<HighlightConfiguration>>>,
    /// Keep loaded libraries alive so their symbols remain valid
    _loaded_libs: RwLock<Vec<libloading::Library>>,
    /// Persistent per-document parse trees for incremental highlighting
    documents: RwLock<HashMap<String, Mutex<DocumentTree>>>,
}

fn make_config(
    language: tree_sitter::Language,
    highlights_query: &str,
    injections_query: &str,
    locals_query: &str,
) -> Arc<HighlightConfiguration> {
    let mut config =
        HighlightConfiguration::new(language, "source", highlights_query, injections_query, locals_query)
            .expect("Failed to create highlight config");
    config.configure(HIGHLIGHT_NAMES);
    Arc::new(config)
}

impl SyntaxService {
    pub fn new() -> Self {
        let mut configs: HashMap<String, Arc<HighlightConfiguration>> = HashMap::new();

        // JavaScript (uses HIGHLIGHT_QUERY)
        let js_config = make_config(
            tree_sitter_javascript::LANGUAGE.into(),
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY,
        );
        configs.insert("js".to_string(), Arc::clone(&js_config));
        configs.insert("jsx".to_string(), Arc::clone(&js_config));
        configs.insert("mjs".to_string(), js_config);

        // TypeScript (uses HIGHLIGHTS_QUERY)
        let ts_highlights = format!(
            "{}\n{}",
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_typescript::HIGHLIGHTS_QUERY,
        );
        configs.insert(
            "ts".to_string(),
            make_config(
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                &ts_highlights,
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_typescript::LOCALS_QUERY,
            ),
        );

        // TSX
        configs.insert(
            "tsx".to_string(),
            make_config(
                tree_sitter_typescript::LANGUAGE_TSX.into(),
                &ts_highlights,
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_typescript::LOCALS_QUERY,
            ),
        );

        // Rust
        configs.insert(
            "rs".to_string(),
            make_config(
                tree_sitter_rust::LANGUAGE.into(),
                tree_sitter_rust::HIGHLIGHTS_QUERY,
                tree_sitter_rust::INJECTIONS_QUERY,
                "",
            ),
        );

        // Python
        configs.insert(
            "py".to_string(),
            make_config(
                tree_sitter_python::LANGUAGE.into(),
                tree_sitter_python::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // JSON
        configs.insert(
            "json".to_string(),
            make_config(
                tree_sitter_json::LANGUAGE.into(),
                tree_sitter_json::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // CSS
        configs.insert(
            "css".to_string(),
            make_config(
                tree_sitter_css::LANGUAGE.into(),
                tree_sitter_css::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // HTML
        let html_config = make_config(
            tree_sitter_html::LANGUAGE.into(),
            tree_sitter_html::HIGHLIGHTS_QUERY,
            tree_sitter_html::INJECTIONS_QUERY,
            "",
        );
        configs.insert("html".to_string(), Arc::clone(&html_config));
        configs.insert("htm".to_string(), html_config);

        // Go
        configs.insert(
            "go".to_string(),
            make_config(
                tree_sitter_go::LANGUAGE.into(),
                tree_sitter_go::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // C
        let c_config = make_config(
            tree_sitter_c::LANGUAGE.into(),
            tree_sitter_c::HIGHLIGHT_QUERY,
            "",
            "",
        );
        configs.insert("c".to_string(), Arc::clone(&c_config));
        configs.insert("h".to_string(), c_config);

        // C++
        let cpp_highlights = format!(
            "{}\n{}",
            tree_sitter_c::HIGHLIGHT_QUERY,
            tree_sitter_cpp::HIGHLIGHT_QUERY,
        );
        let cpp_config = make_config(
            tree_sitter_cpp::LANGUAGE.into(),
            &cpp_highlights,
            "",
            "",
        );
        configs.insert("cpp".to_string(), Arc::clone(&cpp_config));
        configs.insert("cc".to_string(), Arc::clone(&cpp_config));
        configs.insert("cxx".to_string(), Arc::clone(&cpp_config));
        configs.insert("hpp".to_string(), Arc::clone(&cpp_config));
        configs.insert("hh".to_string(), cpp_config);

        // Bash / Shell
        let bash_config = make_config(
            tree_sitter_bash::LANGUAGE.into(),
            tree_sitter_bash::HIGHLIGHT_QUERY,
            "",
            "",
        );
        configs.insert("sh".to_string(), Arc::clone(&bash_config));
        configs.insert("bash".to_string(), Arc::clone(&bash_config));
        configs.insert("zsh".to_string(), bash_config);

        // YAML
        let yaml_config = make_config(
            tree_sitter_yaml::LANGUAGE.into(),
            tree_sitter_yaml::HIGHLIGHTS_QUERY,
            "",
            "",
        );
        configs.insert("yaml".to_string(), Arc::clone(&yaml_config));
        configs.insert("yml".to_string(), yaml_config);

        // TOML
        configs.insert(
            "toml".to_string(),
            make_config(
                tree_sitter_toml_ng::LANGUAGE.into(),
                tree_sitter_toml_ng::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // Ruby
        let rb_config = make_config(
            tree_sitter_ruby::LANGUAGE.into(),
            tree_sitter_ruby::HIGHLIGHTS_QUERY,
            "",
            tree_sitter_ruby::LOCALS_QUERY,
        );
        configs.insert("rb".to_string(), Arc::clone(&rb_config));
        configs.insert("ruby".to_string(), rb_config);

        // Java
        configs.insert(
            "java".to_string(),
            make_config(
                tree_sitter_java::LANGUAGE.into(),
                tree_sitter_java::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // Lua
        configs.insert(
            "lua".to_string(),
            make_config(
                tree_sitter_lua::LANGUAGE.into(),
                tree_sitter_lua::HIGHLIGHTS_QUERY,
                tree_sitter_lua::INJECTIONS_QUERY,
                "",
            ),
        );

        // Regex
        configs.insert(
            "regex".to_string(),
            make_config(
                tree_sitter_regex::LANGUAGE.into(),
                tree_sitter_regex::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // XML
        let xml_config = make_config(
            tree_sitter_xml::LANGUAGE_XML.into(),
            tree_sitter_xml::XML_HIGHLIGHT_QUERY,
            "",
            "",
        );
        configs.insert("xml".to_string(), Arc::clone(&xml_config));
        configs.insert("svg".to_string(), Arc::clone(&xml_config));
        configs.insert("xsl".to_string(), xml_config);

        // SCSS
        configs.insert(
            "scss".to_string(),
            make_config(
                tree_sitter_scss::language().into(),
                tree_sitter_scss::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // PHP
        configs.insert(
            "php".to_string(),
            make_config(
                tree_sitter_php::LANGUAGE_PHP.into(),
                tree_sitter_php::HIGHLIGHTS_QUERY,
                tree_sitter_php::INJECTIONS_QUERY,
                "",
            ),
        );

        let svc = Self {
            configs: RwLock::new(configs),
            _loaded_libs: RwLock::new(Vec::new()),
            documents: RwLock::new(HashMap::new()),
        };

        svc.scan_runtime_grammars();
        svc
    }

    // ── Document lifecycle ───────────────────────────────────────────

    /// Open a document for incremental highlighting.
    pub fn open_document(&self, file_path: &str, content: String) {
        let ext = Self::get_extension(file_path);
        let config = {
            let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
            configs.get(&ext).cloned()
        };

        let grammar = Arc::new(GrammarConfig::new(&ext, &[&format!(".{}", ext)], ""));

        let mut doc = if let Some(config) = config {
            let provider = Box::new(TreeSitterProvider { config });
            DocumentTree::with_provider(file_path.to_string(), grammar, content, provider)
        } else {
            DocumentTree::new(file_path.to_string(), grammar, content)
        };

        // Initial parse
        let _ = doc.reparse();

        let mut docs = self.documents.write().unwrap_or_else(|e| e.into_inner());
        docs.insert(file_path.to_string(), Mutex::new(doc));
    }

    /// Close a document, freeing its parse tree.
    pub fn close_document(&self, file_path: &str) {
        let mut docs = self.documents.write().unwrap_or_else(|e| e.into_inner());
        docs.remove(file_path);
    }

    /// Apply an incremental edit and reparse.
    pub fn edit_document(&self, file_path: &str, edit: EditRange, new_text: &str) {
        let docs = self.documents.read().unwrap_or_else(|e| e.into_inner());
        if let Some(doc_mutex) = docs.get(file_path) {
            let mut doc = doc_mutex.lock().unwrap_or_else(|e| e.into_inner());
            doc.apply_edit(&edit, new_text);
            let _ = doc.reparse();
        }
    }

    /// Get viewport-scoped highlights for an open document.
    pub fn highlight_viewport(&self, file_path: &str, start_line: usize, end_line: usize) -> Vec<BusterSpan> {
        let docs = self.documents.read().unwrap_or_else(|e| e.into_inner());
        if let Some(doc_mutex) = docs.get(file_path) {
            let doc = doc_mutex.lock().unwrap_or_else(|e| e.into_inner());
            doc.highlight_viewport(ViewportRange::new(start_line, end_line))
        } else {
            Vec::new()
        }
    }

    /// Highlight using the new per-line format (stateless fallback for
    /// files that weren't opened via `open_document`).
    pub fn highlight_viewport_stateless(
        &self,
        source: &str,
        extension: &str,
        start_line: usize,
        end_line: usize,
    ) -> Vec<BusterSpan> {
        let config = {
            let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
            configs.get(extension).cloned()
        };

        let grammar = Arc::new(GrammarConfig::new(extension, &[&format!(".{}", extension)], ""));

        let mut doc = if let Some(config) = config {
            let provider = Box::new(TreeSitterProvider { config });
            DocumentTree::with_provider("_temp".to_string(), grammar, source.to_string(), provider)
        } else {
            DocumentTree::new("_temp".to_string(), grammar, source.to_string())
        };

        let _ = doc.reparse();
        doc.highlight_viewport(ViewportRange::new(start_line, end_line))
    }

    // ── Existing methods (unchanged) ─────────────────────────────────

    fn scan_runtime_grammars(&self) {
        let grammars_dir = dirs::home_dir()
            .map(|h| h.join(".buster").join("grammars"))
            .unwrap_or_else(|| PathBuf::from(".buster/grammars"));

        if !grammars_dir.exists() { return; }

        let entries = match std::fs::read_dir(&grammars_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        #[cfg(target_os = "macos")]
        let lib_ext = "dylib";
        #[cfg(target_os = "linux")]
        let lib_ext = "so";
        #[cfg(target_os = "windows")]
        let lib_ext = "dll";

        for entry in entries.flatten() {
            if !entry.path().is_dir() { continue; }
            let lang_name = entry.file_name().to_string_lossy().to_string();
            let dir = entry.path();

            let lib_path = dir.join(format!("parser.{}", lib_ext));
            if !lib_path.exists() { continue; }

            let highlights_path = dir.join("highlights.scm");
            let highlights = match std::fs::read_to_string(&highlights_path) {
                Ok(q) => q,
                Err(_) => continue,
            };
            let injections = std::fs::read_to_string(dir.join("injections.scm")).unwrap_or_default();
            let locals = std::fs::read_to_string(dir.join("locals.scm")).unwrap_or_default();

            if let Err(e) = self.load_native_grammar(&lang_name, &lib_path, &highlights, &injections, &locals) {
                eprintln!("[syntax] Failed to load grammar '{}': {}", lang_name, e);
            }
        }
    }

    fn load_native_grammar(
        &self,
        lang_name: &str,
        lib_path: &std::path::Path,
        highlights_query: &str,
        injections_query: &str,
        locals_query: &str,
    ) -> Result<(), String> {
        {
            let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
            if configs.contains_key(lang_name) { return Ok(()); }
        }

        let lib = unsafe {
            libloading::Library::new(lib_path)
                .map_err(|e| format!("Failed to load library: {}", e))?
        };

        let func_name = format!("tree_sitter_{}", lang_name.replace('-', "_"));
        let language: tree_sitter::Language = unsafe {
            let func: libloading::Symbol<unsafe extern "C" fn() -> tree_sitter::Language> =
                lib.get(func_name.as_bytes())
                    .map_err(|e| format!("Symbol '{}' not found: {}", func_name, e))?;
            func()
        };

        let config = make_config(language, highlights_query, injections_query, locals_query);

        let mut configs = self.configs.write().map_err(|e| e.to_string())?;
        configs.insert(lang_name.to_string(), Arc::clone(&config));

        let ext_map: &[(&str, &[&str])] = &[
            ("kotlin", &["kt", "kts"]),
            ("swift", &["swift"]),
            ("dart", &["dart"]),
            ("zig", &["zig"]),
            ("elixir", &["ex", "exs"]),
            ("haskell", &["hs"]),
            ("ocaml", &["ml", "mli"]),
            ("scala", &["scala", "sc"]),
            ("perl", &["pl", "pm"]),
            ("r", &["r", "R"]),
            ("julia", &["jl"]),
            ("markdown", &["md", "markdown"]),
            ("sql", &["sql"]),
        ];
        for (name, exts) in ext_map {
            if *name == lang_name {
                for ext in *exts {
                    configs.insert(ext.to_string(), Arc::clone(&config));
                }
            }
        }

        let mut libs = self._loaded_libs.write().unwrap_or_else(|e| e.into_inner());
        libs.push(lib);

        eprintln!("[syntax] Loaded runtime grammar: {}", lang_name);
        Ok(())
    }

    pub fn loaded_languages(&self) -> Vec<String> {
        let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
        let mut langs: Vec<String> = configs.keys().cloned().collect();
        langs.sort();
        langs.dedup();
        langs
    }

    /// Legacy highlight method (byte-offset format).
    /// Kept for backward compatibility during migration.
    pub fn highlight(&self, source: &str, extension: &str) -> Vec<HighlightSpan> {
        let config = {
            let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
            match configs.get(extension) {
                Some(c) => Arc::clone(c),
                None => return Vec::new(),
            }
        };

        let mut highlighter = Highlighter::new();
        let source_bytes = source.as_bytes();

        let events = match highlighter.highlight(&config, source_bytes, None, |_| None) {
            Ok(events) => events,
            Err(_) => return Vec::new(),
        };

        let mut spans = Vec::new();
        let mut current_highlight: Option<usize> = None;

        for event in events {
            match event {
                Ok(HighlightEvent::Source { start, end }) => {
                    if let Some(idx) = current_highlight {
                        if idx < HIGHLIGHT_NAMES.len() {
                            spans.push(HighlightSpan {
                                start_byte: start,
                                end_byte: end,
                                highlight_type: HIGHLIGHT_NAMES[idx].to_string(),
                            });
                        }
                    }
                }
                Ok(HighlightEvent::HighlightStart(highlight)) => {
                    current_highlight = Some(highlight.0);
                }
                Ok(HighlightEvent::HighlightEnd) => {
                    current_highlight = None;
                }
                Err(_) => break,
            }
        }

        spans
    }

    pub fn get_extension(file_path: &str) -> String {
        file_path
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase()
    }
}
