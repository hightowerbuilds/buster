use std::path::PathBuf;

/// Errors that can occur during sandboxed execution.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("program not in allowlist: {program}")]
    ProgramNotAllowed { program: String },

    #[error("working directory {path} is outside workspace root {root}")]
    WorkingDirOutsideWorkspace { path: PathBuf, root: PathBuf },

    #[error("working directory does not exist: {0}")]
    WorkingDirNotFound(PathBuf),

    #[error("program not found: {0}")]
    ProgramNotFound(String),

    #[error("process spawn failed: {0}")]
    SpawnFailed(#[from] std::io::Error),

    #[error("sandbox configuration error: {0}")]
    Config(String),

    #[error("OS-level sandbox error: {0}")]
    OsSandbox(String),
}
