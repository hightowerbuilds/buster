use serde::{Deserialize, Serialize};

/// An edit described as a byte range in the document.
///
/// This is the shared format that both buster-syntax and buster-lsp-manager
/// need the editor engine to emit. It describes what changed:
/// "bytes [start_byte..old_end_byte] were replaced by new text, and the
/// new end is at new_end_byte."
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditRange {
    /// Byte offset where the edit starts.
    pub start_byte: usize,
    /// Byte offset where the old text ended (before the edit).
    pub old_end_byte: usize,
    /// Byte offset where the new text ends (after the edit).
    pub new_end_byte: usize,
    /// Start position as (row, column_bytes).
    pub start_position: (usize, usize),
    /// Old end position as (row, column_bytes).
    pub old_end_position: (usize, usize),
    /// New end position as (row, column_bytes).
    pub new_end_position: (usize, usize),
}

/// A viewport range for scoped highlighting.
///
/// Only lines within this range need highlight spans computed.
/// This avoids computing highlights for the entire document when
/// only 50 lines are visible on screen.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ViewportRange {
    /// First visible line (zero-based, inclusive).
    pub start_line: usize,
    /// Last visible line (zero-based, inclusive).
    pub end_line: usize,
}

impl ViewportRange {
    pub fn new(start_line: usize, end_line: usize) -> Self {
        Self {
            start_line,
            end_line,
        }
    }

    /// Check if a line falls within this viewport.
    pub fn contains_line(&self, line: usize) -> bool {
        line >= self.start_line && line <= self.end_line
    }
}

/// Errors from the syntax highlighting system.
#[derive(Debug, thiserror::Error)]
pub enum SyntaxError {
    #[error("no grammar registered for language: {language}")]
    NoGrammar { language: String },

    #[error("parse failed for document: {uri}")]
    ParseFailed { uri: String },
}
