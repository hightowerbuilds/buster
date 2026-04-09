//! buster-ext-sdk — Guest SDK for building Buster IDE extensions in Rust.
//!
//! This crate wraps the host functions imported by the WASM runtime, providing
//! a safe, ergonomic Rust API for extension authors.
//!
//! # Host Functions Available
//!
//! - `read_file(path)` — Read a file relative to the workspace root
//! - `write_file(path, content)` — Write a file (requires write capability)
//! - `list_directory(path)` — List directory contents
//! - `run_command(cmd, args)` — Execute a command (sandboxed via buster-sandbox)
//! - `log(level, message)` — Write to the extension log
//! - `notify(title, message)` — Show a notification to the user
//! - `set_return(value)` — Set the return value for the extension call

pub mod host;
pub mod manifest;

pub use host::{
    log_debug, log_error, log_info, log_warn, notify, read_file, write_file,
    list_directory, run_command, set_return,
};
pub use manifest::ExtensionManifest;

/// Re-export serde_json for extension authors.
pub use serde_json;
