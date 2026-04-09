use serde::{Deserialize, Serialize};

/// LSP errors with clear context for debugging.
#[derive(Debug, thiserror::Error)]
pub enum LspError {
    #[error("server not found for language: {language}")]
    ServerNotFound { language: String },

    #[error("server crashed: {name} (restarts: {restarts})")]
    ServerCrashed { name: String, restarts: u32 },

    #[error("server failed to start: {name}: {reason}")]
    ServerStartFailed { name: String, reason: String },

    #[error("request timed out: method={method}, id={id}")]
    RequestTimeout { method: String, id: String },

    #[error("transport error: {0}")]
    Transport(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// A position in a text document.
///
/// LSP uses zero-based line and character offsets.
/// Many servers expect UTF-16 character offsets, but editors work in UTF-8.
/// This type carries both to avoid conversion bugs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    /// Zero-based line number.
    pub line: u32,
    /// Zero-based character offset (UTF-8 byte offset within the line).
    pub character_utf8: u32,
    /// Zero-based character offset (UTF-16 code unit offset within the line).
    /// Computed from UTF-8 offset when needed. Differs from UTF-8 for characters
    /// outside the Basic Multilingual Plane (emoji, some CJK).
    pub character_utf16: u32,
}

impl Position {
    pub fn new(line: u32, character_utf8: u32) -> Self {
        Self {
            line,
            character_utf8,
            character_utf16: character_utf8, // caller should compute if needed
        }
    }

    /// Create a position with explicit UTF-16 offset.
    pub fn with_utf16(line: u32, character_utf8: u32, character_utf16: u32) -> Self {
        Self {
            line,
            character_utf8,
            character_utf16,
        }
    }
}

/// A range in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

impl Range {
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }
}

/// A diagnostic (error, warning, etc.) reported by a language server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub range: Range,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}
