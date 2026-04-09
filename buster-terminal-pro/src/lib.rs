//! buster-terminal-pro — Hardened terminal emulator for the Buster IDE.
//!
//! Replaces `terminal/mod.rs` with:
//! - PTY crash detection and graceful restart
//! - Runtime-switchable color themes (not hardcoded Catppuccin)
//! - OSC 8 hyperlink parsing and click handling
//! - Alt-screen mode awareness (separate scrollback for vim/less)
//! - Double-width character (CJK) support
//! - Bell notification (configurable)
//! - Terminal search within scrollback
//! - Scrollback memory management

mod hyperlink;
mod scrollback;
mod search;
mod theme;
mod types;

pub use hyperlink::{Hyperlink, HyperlinkParser};
pub use scrollback::{ScrollbackBuffer, ScrollbackConfig};
pub use search::TerminalSearch;
pub use theme::{TerminalTheme, ThemeColor};
pub use types::{BellMode, CellWidth, TerminalError};
