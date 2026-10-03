use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::SandboxError;

/// Sandbox configuration — defines what is allowed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// The workspace root. All filesystem access is restricted to this tree
    /// unless explicit capabilities grant access elsewhere.
    pub workspace_root: PathBuf,

    /// Programs that are allowed to execute. Each entry is either:
    /// - A bare name (e.g., "git") resolved via a restricted PATH
    /// - An absolute path (e.g., "/usr/bin/git")
    pub allowed_programs: HashSet<String>,

    /// Directories to search for allowed programs (restricted PATH).
    /// Defaults to common safe locations if not set.
    pub program_search_paths: Vec<PathBuf>,
}

impl SandboxConfig {
    /// Create a new config for a given workspace root with sensible defaults.
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            allowed_programs: default_allowed_programs(),
            program_search_paths: default_search_paths(),
        }
    }

    /// Validate this configuration.
    pub fn validate(&self) -> Result<(), SandboxError> {
        if !self.workspace_root.exists() {
            return Err(SandboxError::WorkingDirNotFound(
                self.workspace_root.clone(),
            ));
        }
        Ok(())
    }

    /// Resolve a program name to an absolute path using the restricted search paths.
    pub fn resolve_program(&self, name: &str) -> Result<PathBuf, SandboxError> {
        // If it's already absolute, verify it's in the allowlist
        let path = Path::new(name);
        if path.is_absolute() {
            if !self.is_program_allowed(name) {
                return Err(SandboxError::ProgramNotAllowed {
                    program: name.to_string(),
                });
            }
            if !path.exists() {
                return Err(SandboxError::ProgramNotFound(name.to_string()));
            }
            return Ok(path.to_path_buf());
        }

        // Bare name — check allowlist, then search
        if !self.is_program_allowed(name) {
            return Err(SandboxError::ProgramNotAllowed {
                program: name.to_string(),
            });
        }

        for dir in &self.program_search_paths {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        Err(SandboxError::ProgramNotFound(name.to_string()))
    }

    fn is_program_allowed(&self, name: &str) -> bool {
        // Check bare name
        if self.allowed_programs.contains(name) {
            return true;
        }
        // Check if an absolute path's filename matches an allowed name
        if let Some(file_name) = Path::new(name).file_name() {
            if let Some(s) = file_name.to_str() {
                return self.allowed_programs.contains(s);
            }
        }
        false
    }
}

fn default_allowed_programs() -> HashSet<String> {
    [
        "git", "ls", "cat", "head", "tail", "wc", "find", "grep", "rg", "fd", "echo", "printf",
        "mkdir", "cp", "mv", "rm", "touch", "chmod", "diff", "patch", "tar", "gzip", "gunzip",
        "zip", "unzip", "curl", "node", "bun", "deno", "npm", "npx", "bunx", "cargo", "rustc",
        "python", "python3", "pip", "pip3", "go", "make", "cmake", "gcc", "g++", "clang",
        "clang++", "tsc", "eslint", "prettier", "jest", "vitest",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_search_paths() -> Vec<PathBuf> {
    ["/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]
        .into_iter()
        .map(PathBuf::from)
        .collect()
}
