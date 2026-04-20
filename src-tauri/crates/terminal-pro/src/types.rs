#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("PTY crashed: {reason}")]
    PtyCrashed { reason: String },
}
