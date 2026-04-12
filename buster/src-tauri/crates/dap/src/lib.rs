//! buster-dap — Debug Adapter Protocol manager for the Buster IDE.
//!
//! Replaces `debugger/client.rs` and `debugger/mod.rs` with:
//! - Safe threading (Arc instead of raw pointer cast — fixes the UB)
//! - Event forwarding from DAP reader thread to the frontend
//! - Debug adapter registry (discover and manage adapters)
//! - Launch configuration system (launch.json-style with variable substitution)
//! - Multi-session support
//! - Breakpoint persistence across restarts

mod adapter;
mod breakpoint;
mod cleanup;
mod config;
mod events;
mod protocol;
mod types;
mod watchpoint;

pub use adapter::{AdapterConfig, AdapterRegistry};
pub use breakpoint::{Breakpoint, BreakpointStore};
pub use cleanup::{ProcessTracker, TrackedProcess};
pub use config::{LaunchConfig, LaunchConfigParser};
pub use events::{DebugEvent, EventChannel};
pub use protocol::{DapMessage, DapRequest, DapResponse, DapEvent};
pub use types::{DapError, StackFrame, Variable, Thread};
pub use watchpoint::{Watchpoint, WatchpointStore, WatchpointType};
