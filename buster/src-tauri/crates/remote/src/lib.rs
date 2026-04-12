//! buster-remote — Remote development bridge for the Buster IDE.
//!
//! Replaces `remote/mod.rs` with:
//! - Connection configuration and management (multi-connection with pooling)
//! - Host key verification (known_hosts integration)
//! - Workspace mirroring with file change tracking
//! - Auth method chaining (agent → key files → password)
//! - Reconnection with session recovery
//!
//! Note: The actual SSH transport (ssh2/libssh) is bound during Buster integration.
//! This crate defines the connection model, configuration, and workspace sync logic.

mod config;
mod connection;
mod host_keys;
mod lsp_bridge;
mod sync;
mod terminal;
mod types;
mod watcher;

pub use config::{RemoteHost, AuthMethod, SshConfig};
pub use connection::{ConnectionPool, ConnectionState};
pub use host_keys::{HostKeyResult, HostKeyVerifier, KnownHost};
pub use lsp_bridge::{LspBridge, LspBridgeConfig, LspBridgeState};
pub use sync::{FileChange, SyncState, WorkspaceSync};
pub use terminal::{RemoteTerminal, RemoteTerminalConfig, RemoteTerminalState};
pub use types::RemoteError;
pub use watcher::{FileSnapshot, RemoteWatcher, WatchEvent, WatchStrategy};
