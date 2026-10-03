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
pub mod progress;
mod registry;
pub mod requests;
mod transport;
mod types;
mod uri;

pub use document::{DocumentState, TextEdit};
pub use lifecycle::{ServerHandle, ServerStatus};
pub use progress::{parse_progress_notification, ProgressToken, ProgressTracker, WorkDoneProgress};
pub use registry::{LanguageServerConfig, ServerRegistry};
pub use requests::{
    call_hierarchy_incoming_params, call_hierarchy_outgoing_params, call_hierarchy_prepare_params,
    semantic_tokens_full_params, type_hierarchy_prepare_params, type_hierarchy_subtypes_params,
    type_hierarchy_supertypes_params, workspace_symbol_params,
};
pub use transport::{LspMessage, RequestId};
pub use types::{
    CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall,
    DecodedSemanticToken, Diagnostic, Location, LspError, Position, Range, SemanticTokens,
    SemanticTokensLegend, SemanticTokensParams, SymbolInformation, SymbolKind,
    TextDocumentIdentifier, TypeHierarchyItem, WorkspaceSymbolParams, decode_semantic_tokens,
};
pub use uri::{lsp_uri_to_path, path_to_lsp_uri};
