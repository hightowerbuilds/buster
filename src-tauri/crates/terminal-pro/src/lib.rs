//! buster-terminal-pro — Hardened terminal emulator for the Buster IDE.
//!
//! Provides:
//! - PTY crash detection and graceful restart
//! - Runtime-switchable color themes
//! - Sixel image decoding
//! - Bell notification modes
//! - CJK double-width character support

mod pty_monitor;
mod sixel;
mod theme;
mod types;

pub use pty_monitor::PtyMonitor;
pub use sixel::{SixelImage, SixelParser};
pub use theme::{TerminalTheme, ThemeColor};
