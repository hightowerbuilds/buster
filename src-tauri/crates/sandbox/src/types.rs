use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

/// What a sandboxed command is allowed to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Capability {
    /// Access the filesystem at a specific path with given permissions.
    Filesystem(FsAccess),
    /// Allow outbound network access (denied by default).
    Network,
}

/// Filesystem access scope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsAccess {
    /// The directory tree this access applies to.
    pub path: PathBuf,
    /// Whether write access is granted (false = read-only).
    pub writable: bool,
}

/// Resource limits for a sandboxed process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Maximum wall-clock time before the process is killed.
    #[serde(with = "duration_secs")]
    pub timeout: Duration,
    /// Maximum memory in bytes (0 = no limit).
    pub max_memory_bytes: u64,
    /// Maximum combined stdout+stderr output in bytes.
    pub max_output_bytes: u64,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
            max_memory_bytes: 512 * 1024 * 1024, // 512 MB
            max_output_bytes: 1024 * 1024,        // 1 MB
        }
    }
}

/// A request to execute a command inside the sandbox.
#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    /// The executable to run. Must be an absolute path or match an allowlisted name.
    pub program: String,
    /// Command-line arguments.
    pub args: Vec<String>,
    /// Working directory. Must be within the workspace root.
    pub working_dir: PathBuf,
    /// Environment variables to set.
    pub env: HashMap<String, String>,
    /// Optional stdin input.
    pub stdin: Option<Vec<u8>>,
    /// Capabilities granted to this execution.
    pub capabilities: Vec<Capability>,
    /// Resource limits.
    pub limits: ResourceLimits,
}

/// The result of a sandboxed execution.
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    /// How the process exited.
    pub status: ExitStatus,
    /// Captured stdout (truncated to max_output_bytes).
    pub stdout: Vec<u8>,
    /// Captured stderr (truncated to max_output_bytes).
    pub stderr: Vec<u8>,
    /// Whether output was truncated due to size limits.
    pub truncated: bool,
}

/// How a sandboxed process exited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExitStatus {
    /// Normal exit with a code.
    Code(i32),
    /// Killed due to timeout.
    Timeout,
    /// Killed due to resource limits (memory, output).
    ResourceLimit,
    /// Blocked by policy before execution started.
    Denied,
}

impl ExitStatus {
    pub fn success(&self) -> bool {
        matches!(self, ExitStatus::Code(0))
    }
}

mod duration_secs {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub fn serialize<S: Serializer>(d: &Duration, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u64(d.as_secs())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Duration, D::Error> {
        let secs = u64::deserialize(d)?;
        Ok(Duration::from_secs(secs))
    }
}
