//! Extension manifest parsing and validation.

use serde::{Deserialize, Serialize};

/// The extension manifest, parsed from `extension.toml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    /// Unique extension identifier (e.g., "buster-format").
    /// Must be lowercase alphanumeric + hyphens only. No path traversal characters.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Version string (semver).
    pub version: String,
    /// Short description.
    pub description: Option<String>,
    /// Author name or org.
    pub author: Option<String>,
    /// The WASM entry point file (relative to extension root).
    pub entry: String,
    /// Capabilities this extension requests.
    #[serde(default)]
    pub capabilities: Vec<Capability>,
}

/// A capability an extension can request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    /// Read files in the workspace.
    ReadFiles,
    /// Write files in the workspace.
    WriteFiles,
    /// List directories in the workspace.
    ListDirectories,
    /// Run commands (via buster-sandbox).
    RunCommands,
    /// Access the network.
    Network,
}

impl ExtensionManifest {
    /// Validate the manifest for correctness and safety.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        // ID must be safe — no path traversal
        if self.id.is_empty() {
            errors.push("id is required".into());
        } else if !is_safe_id(&self.id) {
            errors.push(format!(
                "id '{}' contains invalid characters — must be lowercase alphanumeric and hyphens only",
                self.id
            ));
        }

        if self.name.is_empty() {
            errors.push("name is required".into());
        }

        if self.version.is_empty() {
            errors.push("version is required".into());
        }

        if self.entry.is_empty() {
            errors.push("entry is required".into());
        } else if self.entry.contains("..") || self.entry.starts_with('/') {
            errors.push(format!(
                "entry '{}' must be a relative path without '..'",
                self.entry
            ));
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

/// Check if an extension ID is safe (no path traversal characters).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_manifest() {
        let manifest = ExtensionManifest {
            id: "buster-format".into(),
            name: "Buster Format".into(),
            version: "0.1.0".into(),
            description: Some("Code formatter".into()),
            author: Some("Buster Team".into()),
            entry: "buster_format.wasm".into(),
            capabilities: vec![Capability::ReadFiles, Capability::WriteFiles],
        };

        assert!(manifest.validate().is_ok());
    }

    #[test]
    fn test_path_traversal_in_id() {
        let manifest = ExtensionManifest {
            id: "../malicious".into(),
            name: "Bad".into(),
            version: "0.1.0".into(),
            description: None,
            author: None,
            entry: "bad.wasm".into(),
            capabilities: vec![],
        };

        assert!(manifest.validate().is_err());
    }

    #[test]
    fn test_path_traversal_in_entry() {
        let manifest = ExtensionManifest {
            id: "legit-ext".into(),
            name: "Legit".into(),
            version: "0.1.0".into(),
            description: None,
            author: None,
            entry: "../../etc/passwd".into(),
            capabilities: vec![],
        };

        let err = manifest.validate().unwrap_err();
        assert!(err.iter().any(|e| e.contains("entry")));
    }

    #[test]
    fn test_empty_id() {
        let manifest = ExtensionManifest {
            id: "".into(),
            name: "No ID".into(),
            version: "0.1.0".into(),
            description: None,
            author: None,
            entry: "ext.wasm".into(),
            capabilities: vec![],
        };

        assert!(manifest.validate().is_err());
    }

    #[test]
    fn test_safe_id_validation() {
        assert!(is_safe_id("buster-format"));
        assert!(is_safe_id("my-extension-123"));
        assert!(!is_safe_id("../bad"));
        assert!(!is_safe_id("Bad_Name"));
        assert!(!is_safe_id("-starts-with-dash"));
        assert!(!is_safe_id("ends-with-dash-"));
        assert!(!is_safe_id("double--dash"));
        assert!(!is_safe_id(""));
    }
}
