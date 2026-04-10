pub mod client;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use client::DapClient;
use serde::{Deserialize, Serialize};

// buster-dap integration — safe event channel, adapter registry, breakpoint persistence
// Types are namespaced to avoid collisions with locally defined StackFrame/Variable
pub mod dap_integration {
    pub use buster_dap::{
        AdapterRegistry, BreakpointStore, EventChannel, DebugEvent,
    };
}

/// Manages debug adapter processes and debug sessions.
pub struct DebugManager {
    /// Active debug session (only one at a time for now)
    session: Mutex<Option<DebugSession>>,
    /// Breakpoints per file path (legacy — being migrated to BreakpointStore)
    breakpoints: RwLock<HashMap<String, Vec<SourceBreakpoint>>>,
    /// buster-dap: persistent breakpoint store (serializable)
    pub bp_store: Mutex<dap_integration::BreakpointStore>,
    /// buster-dap: adapter registry
    pub adapter_registry: dap_integration::AdapterRegistry,
    /// buster-dap: event channel for safe DAP event forwarding
    pub events: dap_integration::EventChannel,
}

pub struct DebugSession {
    pub client: Arc<DapClient>,
    pub state: DebugState,
    pub thread_id: Option<i64>,
}

// DapClient is now naturally Send + Sync: all fields use Arc/Mutex/Atomic.

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum DebugState {
    Idle,
    Running,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceBreakpoint {
    pub line: u32,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    pub id: i64,
    pub name: String,
    pub file_path: Option<String>,
    pub line: u32,
    pub col: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    pub name: String,
    pub value: String,
    pub var_type: Option<String>,
    pub variables_reference: i64,
}

impl DebugManager {
    pub fn new() -> Self {
        DebugManager {
            session: Mutex::new(None),
            breakpoints: RwLock::new(HashMap::new()),
            bp_store: Mutex::new(dap_integration::BreakpointStore::new()),
            adapter_registry: dap_integration::AdapterRegistry::with_defaults(),
            events: dap_integration::EventChannel::new(),
        }
    }

    /// Toggle a breakpoint at a file:line. Returns true if breakpoint was added, false if removed.
    pub fn toggle_breakpoint(&self, file_path: &str, line: u32) -> bool {
        let mut bps = self.breakpoints.write().unwrap_or_else(|e| e.into_inner());
        let file_bps = bps.entry(file_path.to_string()).or_insert_with(Vec::new);
        if let Some(idx) = file_bps.iter().position(|bp| bp.line == line) {
            file_bps.remove(idx);
            false
        } else {
            file_bps.push(SourceBreakpoint { line, condition: None });
            true
        }
    }

    /// Get breakpoints for a file.
    pub fn get_breakpoints(&self, file_path: &str) -> Vec<SourceBreakpoint> {
        let bps = self.breakpoints.read().unwrap_or_else(|e| e.into_inner());
        bps.get(file_path).cloned().unwrap_or_default()
    }

    /// Get all breakpoints across all files.
    #[allow(dead_code)]
    pub fn all_breakpoints(&self) -> HashMap<String, Vec<SourceBreakpoint>> {
        let bps = self.breakpoints.read().unwrap_or_else(|e| e.into_inner());
        bps.clone()
    }

    /// Get current debug state.
    pub fn state(&self) -> DebugState {
        let session = self.session.lock().unwrap_or_else(|e| e.into_inner());
        session.as_ref().map(|s| s.state).unwrap_or(DebugState::Idle)
    }

    /// Launch a debug session with the given adapter command and launch arguments.
    pub async fn launch(
        &self,
        adapter_cmd: &str,
        adapter_args: &[&str],
        program: &str,
        workspace_root: &str,
    ) -> Result<(), String> {
        // Stop existing session
        self.stop().await;

        let client = Arc::new(DapClient::start(adapter_cmd, adapter_args).await?);

        // Initialize
        client.initialize().await?;

        // Set breakpoints for all files
        let bps_snapshot = {
            let bps = self.breakpoints.read().unwrap_or_else(|e| e.into_inner());
            bps.clone()
        };
        for (file, file_bps) in &bps_snapshot {
            let lines: Vec<u32> = file_bps.iter().map(|bp| bp.line).collect();
            client.set_breakpoints(file, &lines).await?;
        }

        // Launch
        client.launch(program, workspace_root).await?;

        {
            let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            *session = Some(DebugSession {
                client,
                state: DebugState::Running,
                thread_id: None,
            });
        }

        Ok(())
    }

    /// Get the client and thread_id from the session (short lock).
    fn get_client(&self) -> Result<(Arc<DapClient>, i64), String> {
        let session = self.session.lock().unwrap_or_else(|e| e.into_inner());
        let s = session.as_ref().ok_or("No debug session")?;
        Ok((s.client.clone(), s.thread_id.unwrap_or(1)))
    }

    fn set_state(&self, state: DebugState) {
        let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = session.as_mut() { s.state = state; }
    }

    /// Continue execution.
    pub async fn continue_execution(&self) -> Result<(), String> {
        let (client, tid) = self.get_client()?;
        client.continue_execution(tid).await?;
        self.set_state(DebugState::Running);
        Ok(())
    }

    /// Step over.
    pub async fn step_over(&self) -> Result<(), String> {
        let (client, tid) = self.get_client()?;
        client.next(tid).await?;
        self.set_state(DebugState::Running);
        Ok(())
    }

    /// Step into.
    pub async fn step_into(&self) -> Result<(), String> {
        let (client, tid) = self.get_client()?;
        client.step_in(tid).await?;
        self.set_state(DebugState::Running);
        Ok(())
    }

    /// Step out.
    pub async fn step_out(&self) -> Result<(), String> {
        let (client, tid) = self.get_client()?;
        client.step_out(tid).await?;
        self.set_state(DebugState::Running);
        Ok(())
    }

    /// Pause execution.
    pub async fn pause(&self) -> Result<(), String> {
        let (client, tid) = self.get_client()?;
        client.pause(tid).await?;
        self.set_state(DebugState::Paused);
        Ok(())
    }

    /// Get stack trace (when paused).
    pub async fn stack_trace(&self) -> Result<Vec<StackFrame>, String> {
        let (client, tid) = self.get_client()?;
        client.stack_trace(tid).await
    }

    /// Get variables for a scope.
    pub async fn variables(&self, variables_reference: i64) -> Result<Vec<Variable>, String> {
        let (client, _) = self.get_client()?;
        client.variables(variables_reference).await
    }

    /// Stop the debug session.
    pub async fn stop(&self) {
        let client = {
            let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            session.take().map(|s| s.client)
        };
        if let Some(c) = client {
            let _ = c.disconnect().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_breakpoint_adds_and_removes() {
        let mgr = DebugManager::new();
        assert!(mgr.toggle_breakpoint("test.rs", 10));
        assert_eq!(mgr.get_breakpoints("test.rs").len(), 1);
        assert!(!mgr.toggle_breakpoint("test.rs", 10));
        assert_eq!(mgr.get_breakpoints("test.rs").len(), 0);
    }

    #[test]
    fn multiple_breakpoints_per_file() {
        let mgr = DebugManager::new();
        mgr.toggle_breakpoint("test.rs", 5);
        mgr.toggle_breakpoint("test.rs", 10);
        mgr.toggle_breakpoint("test.rs", 15);
        assert_eq!(mgr.get_breakpoints("test.rs").len(), 3);
    }

    #[test]
    fn breakpoints_across_files() {
        let mgr = DebugManager::new();
        mgr.toggle_breakpoint("a.rs", 1);
        mgr.toggle_breakpoint("b.rs", 2);
        let all = mgr.all_breakpoints();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn initial_state_is_idle() {
        let mgr = DebugManager::new();
        assert_eq!(mgr.state(), DebugState::Idle);
    }
}
