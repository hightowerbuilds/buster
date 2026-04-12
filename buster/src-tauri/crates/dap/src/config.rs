use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::types::DapError;

/// A launch configuration for a debug session (launch.json-style).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub adapter_type: String,
    pub request: LaunchRequest,
    pub program: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    /// Additional adapter-specific settings passed as-is.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LaunchRequest {
    Launch,
    Attach,
}

/// Parses launch configurations with variable substitution.
pub struct LaunchConfigParser {
    variables: HashMap<String, String>,
}

impl LaunchConfigParser {
    pub fn new(workspace_root: &str) -> Self {
        let mut vars = HashMap::new();
        vars.insert("workspaceFolder".to_string(), workspace_root.to_string());
        vars.insert(
            "workspaceFolderBasename".to_string(),
            std::path::Path::new(workspace_root)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
        );
        Self { variables: vars }
    }

    /// Set a custom variable for substitution.
    pub fn set_variable(&mut self, key: &str, value: &str) {
        self.variables.insert(key.to_string(), value.to_string());
    }

    /// Parse a launch config JSON string, applying variable substitution.
    pub fn parse(&self, json: &str) -> Result<LaunchConfig, DapError> {
        let substituted = self.substitute(json);
        serde_json::from_str(&substituted).map_err(|e| DapError::ConfigError(e.to_string()))
    }

    /// Replace `${variableName}` with values from the variable map.
    fn substitute(&self, input: &str) -> String {
        let mut result = input.to_string();
        for (key, value) in &self.variables {
            let pattern = format!("${{{}}}", key);
            result = result.replace(&pattern, value);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_launch_config() {
        let parser = LaunchConfigParser::new("/home/user/project");
        let config = parser
            .parse(r#"{
                "name": "Debug",
                "type": "codelldb",
                "request": "launch",
                "program": "${workspaceFolder}/target/debug/myapp",
                "cwd": "${workspaceFolder}"
            }"#)
            .unwrap();

        assert_eq!(config.name, "Debug");
        assert_eq!(config.request, LaunchRequest::Launch);
        assert_eq!(
            config.program.as_deref(),
            Some("/home/user/project/target/debug/myapp")
        );
        assert_eq!(config.cwd.as_deref(), Some("/home/user/project"));
    }

    #[test]
    fn test_workspace_basename_variable() {
        let parser = LaunchConfigParser::new("/home/user/my-project");
        let config = parser
            .parse(r#"{
                "name": "${workspaceFolderBasename}",
                "type": "debugpy",
                "request": "launch"
            }"#)
            .unwrap();

        assert_eq!(config.name, "my-project");
    }

    #[test]
    fn test_invalid_json() {
        let parser = LaunchConfigParser::new("/tmp");
        assert!(parser.parse("not json").is_err());
    }
}
