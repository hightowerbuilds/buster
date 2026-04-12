//! buster-sandbox — Allowlist-based command execution sandbox for the Buster IDE.
//!
//! Replaces the blocklist-based `execute_command()` in `ai/tools.rs` and
//! `host_run_command` in `extensions/runtime.rs` with a secure, capability-based
//! execution model.
//!
//! # Design
//!
//! Nothing runs unless explicitly allowed. Each execution request must specify:
//! - The executable to run (resolved against an allowlist, not a PATH search)
//! - The working directory (must be within the workspace root)
//! - Filesystem capabilities (read-only or read-write, scoped to specific paths)
//! - Network access (denied by default)
//! - Resource limits (CPU time, memory, output size)

mod config;
mod error;
mod executor;
pub mod os_sandbox;
mod policy;
mod types;

pub use config::SandboxConfig;
pub use error::SandboxError;
pub use executor::execute;
pub use os_sandbox::OsSandbox;
pub use policy::{ExecutionPolicy, PolicyVerdict};
pub use types::{
    Capability, ExecutionRequest, ExecutionResult, ExitStatus, FsAccess, ResourceLimits,
};
