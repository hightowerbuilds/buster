use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum DapError {
    #[error("adapter not found: {name}")]
    AdapterNotFound { name: String },

    #[error("adapter failed to start: {name}: {reason}")]
    AdapterStartFailed { name: String, reason: String },

    #[error("debug session not active")]
    NoActiveSession,

    #[error("request failed: {method}: {message}")]
    RequestFailed { method: String, message: String },

    #[error("launch config error: {0}")]
    ConfigError(String),

    #[error("transport error: {0}")]
    Transport(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// A stack frame from a stopped thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    pub id: i64,
    pub name: String,
    pub source_path: Option<String>,
    pub line: u32,
    pub column: u32,
}

/// A variable in a scope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    pub name: String,
    pub value: String,
    pub var_type: Option<String>,
    /// Reference for lazy child expansion (0 = no children).
    pub variables_reference: i64,
}

/// A thread in the debuggee.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: i64,
    pub name: String,
}
