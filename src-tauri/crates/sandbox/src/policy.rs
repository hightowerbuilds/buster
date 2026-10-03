use std::path::Path;

use crate::config::SandboxConfig;
use crate::error::SandboxError;
use crate::types::ExecutionRequest;

/// The result of a policy check.
#[derive(Debug, Clone)]
pub enum PolicyVerdict {
    /// Execution is allowed.
    Allow,
    /// Execution is denied with a reason.
    Deny(String),
}

/// Evaluates execution requests against the sandbox policy.
#[derive(Debug)]
pub struct ExecutionPolicy {
    config: SandboxConfig,
}

impl ExecutionPolicy {
    pub fn new(config: SandboxConfig) -> Self {
        Self { config }
    }

    /// Check whether a request should be allowed to execute.
    pub fn evaluate(&self, request: &ExecutionRequest) -> PolicyVerdict {
        // 1. Program must be in the allowlist
        if let Err(e) = self.config.resolve_program(&request.program) {
            return PolicyVerdict::Deny(e.to_string());
        }

        // 2. Working directory must be within workspace root
        if let Err(e) = self.check_working_dir(&request.working_dir) {
            return PolicyVerdict::Deny(e.to_string());
        }

        // 3. Arguments must not contain shell injection attempts
        if let Some(reason) = self.check_args(&request.args) {
            return PolicyVerdict::Deny(reason);
        }

        PolicyVerdict::Allow
    }

    fn check_working_dir(&self, dir: &Path) -> Result<(), SandboxError> {
        let canonical_root = self
            .config
            .workspace_root
            .canonicalize()
            .map_err(|_| SandboxError::WorkingDirNotFound(self.config.workspace_root.clone()))?;

        let canonical_dir = dir
            .canonicalize()
            .map_err(|_| SandboxError::WorkingDirNotFound(dir.to_path_buf()))?;

        if !canonical_dir.starts_with(&canonical_root) {
            return Err(SandboxError::WorkingDirOutsideWorkspace {
                path: dir.to_path_buf(),
                root: self.config.workspace_root.clone(),
            });
        }

        Ok(())
    }

    fn check_args(&self, args: &[String]) -> Option<String> {
        // Block common shell injection patterns in arguments.
        // Since we don't use sh -c, most injection is neutralized, but
        // we still catch attempts to chain commands via argument values.
        let dangerous_patterns = ["; ", " && ", " || ", "$(", "`", " | "];

        for arg in args {
            for pattern in &dangerous_patterns {
                if arg.contains(pattern) {
                    return Some(format!(
                        "argument contains potentially dangerous pattern '{pattern}': {arg}"
                    ));
                }
            }
        }
        None
    }
}
