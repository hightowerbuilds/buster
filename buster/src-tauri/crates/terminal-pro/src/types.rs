use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("PTY crashed: {reason}")]
    PtyCrashed { reason: String },
}

/// Bell notification mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BellMode {
    /// Visual flash on the terminal.
    Visual,
    /// System notification.
    Notification,
    /// No bell.
    Silent,
}

impl Default for BellMode {
    fn default() -> Self {
        BellMode::Visual
    }
}

/// Character cell width for rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellWidth {
    /// Standard single-width character (ASCII, Latin, etc.)
    Single,
    /// Double-width character (CJK ideographs, some symbols)
    Double,
    /// Zero-width (combining characters, ZWJ)
    Zero,
}
