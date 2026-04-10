use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};
use libloading;

// buster-syntax integration — grammar registry, incremental types, viewport highlighting
pub mod syntax_pro {
    pub use buster_syntax::{
        GrammarRegistry, GrammarConfig, EditRange, ViewportRange,
        HighlightSpan, HighlightTheme, TokenKind,
    };
}

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

#[derive(Debug, Clone, Serialize)]
pub struct HighlightSpan {
    pub start_byte: usize,
    pub end_byte: usize,
    pub highlight_type: String,
}

pub struct SyntaxService {
    configs: RwLock<HashMap<String, Arc<HighlightConfiguration>>>,
    /// Keep loaded libraries alive so their symbols remain valid
    _loaded_libs: RwLock<Vec<libloading::Library>>,
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

        // Rust (uses HIGHLIGHTS_QUERY)
        configs.insert(
            "rs".to_string(),
            make_config(
                tree_sitter_rust::LANGUAGE.into(),
                tree_sitter_rust::HIGHLIGHTS_QUERY,
                tree_sitter_rust::INJECTIONS_QUERY,
                "",
            ),
        );

        // Python (uses HIGHLIGHTS_QUERY)
        configs.insert(
            "py".to_string(),
            make_config(
                tree_sitter_python::LANGUAGE.into(),
                tree_sitter_python::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // JSON (uses HIGHLIGHTS_QUERY)
        configs.insert(
            "json".to_string(),
            make_config(
                tree_sitter_json::LANGUAGE.into(),
                tree_sitter_json::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        );

        // CSS (uses HIGHLIGHTS_QUERY)
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
        };

        // Auto-load any native grammar libraries from ~/.buster/grammars/
        svc.scan_runtime_grammars();

        svc
    }

    /// Scan ~/.buster/grammars/ for native grammar packages and load them.
    /// Each grammar directory should contain:
    ///   parser.dylib (or parser.so on Linux, parser.dll on Windows)
    ///   highlights.scm (required)
    ///   injections.scm (optional)
    ///   locals.scm (optional)
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

    /// Load a native shared library grammar at runtime.
    fn load_native_grammar(
        &self,
        lang_name: &str,
        lib_path: &std::path::Path,
        highlights_query: &str,
        injections_query: &str,
        locals_query: &str,
    ) -> Result<(), String> {
        // Skip if already loaded (compiled grammars take priority)
        {
            let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
            if configs.contains_key(lang_name) { return Ok(()); }
        }

        // Load the shared library
        let lib = unsafe {
            libloading::Library::new(lib_path)
                .map_err(|e| format!("Failed to load library: {}", e))?
        };

        // Look for the tree_sitter_<lang> function
        let func_name = format!("tree_sitter_{}", lang_name.replace('-', "_"));
        let language: tree_sitter::Language = unsafe {
            let func: libloading::Symbol<unsafe extern "C" fn() -> tree_sitter::Language> =
                lib.get(func_name.as_bytes())
                    .map_err(|e| format!("Symbol '{}' not found: {}", func_name, e))?;
            func()
        };

        // Create highlight config
        let config = make_config(language, highlights_query, injections_query, locals_query);

        // Register
        let mut configs = self.configs.write().map_err(|e| e.to_string())?;
        configs.insert(lang_name.to_string(), Arc::clone(&config));

        // Map common extensions
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

        // Keep library alive
        let mut libs = self._loaded_libs.write().unwrap_or_else(|e| e.into_inner());
        libs.push(lib);

        eprintln!("[syntax] Loaded runtime grammar: {}", lang_name);
        Ok(())
    }

    /// List all loaded grammars (both compiled and runtime).
    pub fn loaded_languages(&self) -> Vec<String> {
        let configs = self.configs.read().unwrap_or_else(|e| e.into_inner());
        let mut langs: Vec<String> = configs.keys().cloned().collect();
        langs.sort();
        langs.dedup();
        langs
    }

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
