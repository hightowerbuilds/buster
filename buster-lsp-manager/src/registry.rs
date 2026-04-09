use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::types::LspError;

/// Configuration for a single language server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageServerConfig {
    /// Display name (e.g., "rust-analyzer").
    pub name: String,
    /// Executable path or command name.
    pub command: String,
    /// Command-line arguments.
    pub args: Vec<String>,
    /// Language identifiers this server handles (e.g., ["rust"]).
    pub language_ids: Vec<String>,
    /// File extensions this server handles (e.g., [".rs"]).
    pub file_extensions: Vec<String>,
    /// Initialization options to send to the server.
    pub init_options: Option<serde_json::Value>,
    /// Working directory for the server process.
    pub root_dir: Option<PathBuf>,
    /// Maximum number of automatic restarts before giving up.
    pub max_restarts: u32,
}

impl LanguageServerConfig {
    pub fn new(name: &str, command: &str) -> Self {
        Self {
            name: name.to_string(),
            command: command.to_string(),
            args: Vec::new(),
            language_ids: Vec::new(),
            file_extensions: Vec::new(),
            init_options: None,
            root_dir: None,
            max_restarts: 3,
        }
    }

    pub fn with_args(mut self, args: &[&str]) -> Self {
        self.args = args.iter().map(|s| s.to_string()).collect();
        self
    }

    pub fn with_languages(mut self, ids: &[&str], extensions: &[&str]) -> Self {
        self.language_ids = ids.iter().map(|s| s.to_string()).collect();
        self.file_extensions = extensions.iter().map(|s| s.to_string()).collect();
        self
    }
}

/// Registry of language server configurations.
///
/// Built once at startup. Provides O(1) lookup by language ID or file extension.
/// Replaces the current pattern of rebuilding a HashMap on every call.
pub struct ServerRegistry {
    configs: Vec<LanguageServerConfig>,
    /// Index: language ID → config index
    by_language: HashMap<String, usize>,
    /// Index: file extension → config index
    by_extension: HashMap<String, usize>,
}

impl ServerRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            configs: Vec::new(),
            by_language: HashMap::new(),
            by_extension: HashMap::new(),
        }
    }

    /// Create a registry with Buster's default server configurations.
    pub fn with_defaults() -> Self {
        let mut reg = Self::new();

        reg.register(
            LanguageServerConfig::new("rust-analyzer", "rust-analyzer")
                .with_languages(&["rust"], &[".rs"]),
        );

        reg.register(
            LanguageServerConfig::new("typescript-language-server", "typescript-language-server")
                .with_args(&["--stdio"])
                .with_languages(
                    &["typescript", "typescriptreact", "javascript", "javascriptreact"],
                    &[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
                ),
        );

        reg.register(
            LanguageServerConfig::new("pylsp", "pylsp")
                .with_languages(&["python"], &[".py", ".pyi"]),
        );

        reg.register(
            LanguageServerConfig::new("gopls", "gopls")
                .with_args(&["serve"])
                .with_languages(&["go"], &[".go"]),
        );

        reg
    }

    /// Register a language server configuration.
    pub fn register(&mut self, config: LanguageServerConfig) {
        let idx = self.configs.len();

        for lang in &config.language_ids {
            self.by_language.insert(lang.clone(), idx);
        }
        for ext in &config.file_extensions {
            self.by_extension.insert(ext.clone(), idx);
        }

        self.configs.push(config);
    }

    /// Look up a server config by language ID.
    pub fn find_by_language(&self, language_id: &str) -> Result<&LanguageServerConfig, LspError> {
        self.by_language
            .get(language_id)
            .map(|&idx| &self.configs[idx])
            .ok_or_else(|| LspError::ServerNotFound {
                language: language_id.to_string(),
            })
    }

    /// Look up a server config by file extension (including the dot).
    pub fn find_by_extension(&self, ext: &str) -> Result<&LanguageServerConfig, LspError> {
        self.by_extension
            .get(ext)
            .map(|&idx| &self.configs[idx])
            .ok_or_else(|| LspError::ServerNotFound {
                language: format!("extension {}", ext),
            })
    }

    /// Get all registered configurations.
    pub fn configs(&self) -> &[LanguageServerConfig] {
        &self.configs
    }
}

impl Default for ServerRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_by_language() {
        let reg = ServerRegistry::with_defaults();
        let config = reg.find_by_language("rust").unwrap();
        assert_eq!(config.name, "rust-analyzer");
    }

    #[test]
    fn test_find_by_extension() {
        let reg = ServerRegistry::with_defaults();
        let config = reg.find_by_extension(".ts").unwrap();
        assert_eq!(config.name, "typescript-language-server");
    }

    #[test]
    fn test_tsx_maps_to_typescript_server() {
        let reg = ServerRegistry::with_defaults();
        let config = reg.find_by_extension(".tsx").unwrap();
        assert_eq!(config.name, "typescript-language-server");
    }

    #[test]
    fn test_unknown_language_returns_error() {
        let reg = ServerRegistry::with_defaults();
        assert!(reg.find_by_language("cobol").is_err());
    }

    #[test]
    fn test_custom_registration() {
        let mut reg = ServerRegistry::new();
        reg.register(
            LanguageServerConfig::new("clangd", "clangd")
                .with_languages(&["c", "cpp"], &[".c", ".cpp", ".h"]),
        );
        assert!(reg.find_by_language("cpp").is_ok());
        assert!(reg.find_by_extension(".h").is_ok());
    }
}
