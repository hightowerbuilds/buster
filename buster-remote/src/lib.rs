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
mod sync;
mod types;

pub use config::{RemoteHost, AuthMethod, SshConfig};
pub use connection::{ConnectionPool, ConnectionState};
pub use sync::{FileChange, SyncState, WorkspaceSync};
pub use types::RemoteError;
