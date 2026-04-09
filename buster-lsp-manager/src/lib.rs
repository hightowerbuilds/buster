//! buster-lsp-manager — Production LSP client library for the Buster IDE.
//!
//! Replaces `lsp/client.rs` and `lsp/mod.rs` with:
//! - Incremental text sync (send only changed ranges, not the full document)
//! - Server lifecycle management (auto-spawn, health monitoring, restart-on-crash)
//! - Configurable server registry (built once, not a new HashMap per lookup)
//! - stderr capture and surfacing (no more silenced server errors)
//! - Request cancellation, progress reporting, and UTF-16 offset mapping

mod document;
mod lifecycle;
mod registry;
mod transport;
mod types;
mod uri;

pub use document::{DocumentState, TextEdit};
pub use lifecycle::{ServerHandle, ServerStatus};
pub use registry::{LanguageServerConfig, ServerRegistry};
pub use transport::{LspMessage, RequestId};
pub use types::{Diagnostic, LspError, Position, Range};
pub use uri::{path_to_lsp_uri, lsp_uri_to_path};
