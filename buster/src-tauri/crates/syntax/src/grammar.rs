use std::collections::HashMap;
use std::sync::Arc;

use crate::types::SyntaxError;

/// Configuration for a language grammar.
///
/// In the full integration, this holds a reference to the tree-sitter
/// Language and highlight query. Here we define the config structure;
/// actual tree-sitter types are bound during Buster integration.
#[derive(Debug, Clone)]
pub struct GrammarConfig {
    /// Language identifier (e.g., "rust", "typescript").
    pub language_id: String,
    /// File extensions this grammar handles.
    pub file_extensions: Vec<String>,
    /// The highlight query source (tree-sitter SCM query).
    pub highlight_query: String,
    /// Optional injections query for embedded languages.
    pub injections_query: Option<String>,
}

impl GrammarConfig {
    pub fn new(language_id: &str, extensions: &[&str], highlight_query: &str) -> Self {
        Self {
            language_id: language_id.to_string(),
            file_extensions: extensions.iter().map(|s| s.to_string()).collect(),
            highlight_query: highlight_query.to_string(),
            injections_query: None,
        }
    }
}

/// Registry of language grammars.
///
/// Uses Arc for configurations so they can be shared across documents
/// without leaking memory (replaces the Box::leak pattern in the current code).
pub struct GrammarRegistry {
    /// Grammar configs by language ID.
    by_language: HashMap<String, Arc<GrammarConfig>>,
    /// Index: file extension → language ID.
    extension_map: HashMap<String, String>,
}

impl GrammarRegistry {
    pub fn new() -> Self {
        Self {
            by_language: HashMap::new(),
            extension_map: HashMap::new(),
        }
    }

    /// Register a grammar configuration.
    pub fn register(&mut self, config: GrammarConfig) {
        let language_id = config.language_id.clone();
        for ext in &config.file_extensions {
            self.extension_map.insert(ext.clone(), language_id.clone());
        }
        self.by_language.insert(language_id, Arc::new(config));
    }

    /// Hot-reload a grammar (replaces existing config for that language).
    /// Existing documents using this grammar will pick up the new config
    /// on their next reparse.
    pub fn reload(&mut self, config: GrammarConfig) {
        log::info!("hot-reloading grammar for {}", config.language_id);
        self.register(config);
    }

    /// Look up a grammar by language ID.
    pub fn get(&self, language_id: &str) -> Result<Arc<GrammarConfig>, SyntaxError> {
        self.by_language
            .get(language_id)
            .cloned()
            .ok_or_else(|| SyntaxError::NoGrammar {
                language: language_id.to_string(),
            })
    }

    /// Look up a grammar by file extension.
    pub fn get_by_extension(&self, ext: &str) -> Result<Arc<GrammarConfig>, SyntaxError> {
        let lang = self
            .extension_map
            .get(ext)
            .ok_or_else(|| SyntaxError::NoGrammar {
                language: format!("extension {}", ext),
            })?;
        self.get(lang)
    }

    /// List all registered language IDs.
    pub fn languages(&self) -> Vec<&str> {
        self.by_language.keys().map(|s| s.as_str()).collect()
    }
}

impl Default for GrammarRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_lookup() {
        let mut reg = GrammarRegistry::new();
        reg.register(GrammarConfig::new(
            "rust",
            &[".rs"],
            "(identifier) @variable",
        ));

        let config = reg.get("rust").unwrap();
        assert_eq!(config.language_id, "rust");
        assert_eq!(config.highlight_query, "(identifier) @variable");
    }

    #[test]
    fn test_lookup_by_extension() {
        let mut reg = GrammarRegistry::new();
        reg.register(GrammarConfig::new(
            "typescript",
            &[".ts", ".tsx"],
            "(string) @string",
        ));

        let config = reg.get_by_extension(".tsx").unwrap();
        assert_eq!(config.language_id, "typescript");
    }

    #[test]
    fn test_unknown_language_error() {
        let reg = GrammarRegistry::new();
        assert!(reg.get("cobol").is_err());
    }

    #[test]
    fn test_hot_reload() {
        let mut reg = GrammarRegistry::new();
        reg.register(GrammarConfig::new("rust", &[".rs"], "old query"));

        let old = reg.get("rust").unwrap();
        assert_eq!(old.highlight_query, "old query");

        reg.reload(GrammarConfig::new("rust", &[".rs"], "new query"));

        let new = reg.get("rust").unwrap();
        assert_eq!(new.highlight_query, "new query");
    }

    #[test]
    fn test_arc_sharing() {
        let mut reg = GrammarRegistry::new();
        reg.register(GrammarConfig::new("rust", &[".rs"], "query"));

        let a = reg.get("rust").unwrap();
        let b = reg.get("rust").unwrap();
        assert!(Arc::ptr_eq(&a, &b)); // same Arc, not cloned data
    }
}
