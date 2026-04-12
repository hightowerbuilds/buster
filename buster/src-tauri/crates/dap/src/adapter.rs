use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::types::DapError;

/// Configuration for a debug adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterConfig {
    /// Adapter identifier (e.g., "codelldb", "debugpy").
    pub id: String,
    /// Display name.
    pub name: String,
    /// Executable command.
    pub command: String,
    /// Command-line arguments.
    pub args: Vec<String>,
    /// Languages this adapter supports.
    pub languages: Vec<String>,
    /// Runtime type (e.g., "executable", "node").
    pub runtime: AdapterRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdapterRuntime {
    Executable,
    Node,
}

/// Registry of debug adapters.
pub struct AdapterRegistry {
    adapters: HashMap<String, AdapterConfig>,
    by_language: HashMap<String, String>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: HashMap::new(),
            by_language: HashMap::new(),
        }
    }

    pub fn with_defaults() -> Self {
        let mut reg = Self::new();

        reg.register(AdapterConfig {
            id: "codelldb".into(),
            name: "CodeLLDB".into(),
            command: "codelldb".into(),
            args: vec!["--port".into(), "0".into()],
            languages: vec!["rust".into(), "c".into(), "cpp".into()],
            runtime: AdapterRuntime::Executable,
        });

        reg.register(AdapterConfig {
            id: "debugpy".into(),
            name: "debugpy".into(),
            command: "python".into(),
            args: vec!["-m".into(), "debugpy.adapter".into()],
            languages: vec!["python".into()],
            runtime: AdapterRuntime::Executable,
        });

        reg.register(AdapterConfig {
            id: "delve".into(),
            name: "Delve".into(),
            command: "dlv".into(),
            args: vec!["dap".into()],
            languages: vec!["go".into()],
            runtime: AdapterRuntime::Executable,
        });

        reg.register(AdapterConfig {
            id: "js-debug".into(),
            name: "JavaScript Debug".into(),
            command: "js-debug-adapter".into(),
            args: vec![],
            languages: vec!["javascript".into(), "typescript".into()],
            runtime: AdapterRuntime::Node,
        });

        reg
    }

    pub fn register(&mut self, config: AdapterConfig) {
        for lang in &config.languages {
            self.by_language.insert(lang.clone(), config.id.clone());
        }
        self.adapters.insert(config.id.clone(), config);
    }

    pub fn find_by_id(&self, id: &str) -> Result<&AdapterConfig, DapError> {
        self.adapters.get(id).ok_or(DapError::AdapterNotFound {
            name: id.to_string(),
        })
    }

    pub fn find_by_language(&self, language: &str) -> Result<&AdapterConfig, DapError> {
        let id = self
            .by_language
            .get(language)
            .ok_or(DapError::AdapterNotFound {
                name: format!("language: {}", language),
            })?;
        self.find_by_id(id)
    }

    pub fn list(&self) -> Vec<&AdapterConfig> {
        self.adapters.values().collect()
    }
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_by_language() {
        let reg = AdapterRegistry::with_defaults();
        let adapter = reg.find_by_language("rust").unwrap();
        assert_eq!(adapter.id, "codelldb");
    }

    #[test]
    fn test_find_by_id() {
        let reg = AdapterRegistry::with_defaults();
        let adapter = reg.find_by_id("debugpy").unwrap();
        assert_eq!(adapter.languages, vec!["python"]);
    }

    #[test]
    fn test_unknown_language() {
        let reg = AdapterRegistry::with_defaults();
        assert!(reg.find_by_language("cobol").is_err());
    }
}
