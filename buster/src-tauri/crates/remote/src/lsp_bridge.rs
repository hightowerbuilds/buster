use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Configuration for a remote LSP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspBridgeConfig {
    /// Language identifier (e.g. "rust", "typescript").
    pub language_id: String,
    /// Command to start the LSP server on the remote host.
    pub server_command: String,
    /// Arguments passed to the server command.
    pub server_args: Vec<String>,
    /// Root path of the project on the remote host.
    pub root_path: String,
}

/// State of the LSP bridge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LspBridgeState {
    /// The bridge is starting (SSH channel creation pending).
    Starting,
    /// The bridge is running and forwarding LSP messages.
    Running,
    /// The bridge has been stopped.
    Stopped,
    /// The bridge encountered an error.
    Failed(String),
}

/// Manages the state and request tracking for a remote LSP server.
///
/// The actual SSH channel creation and I/O is handled by the consumer.
/// This struct tracks the logical state and pending request/response pairs.
pub struct LspBridge {
    /// Configuration for this LSP bridge.
    pub config: LspBridgeConfig,
    /// Current state of the bridge.
    pub state: LspBridgeState,
    /// Maps request IDs to their method names, for correlating responses.
    pub pending_requests: HashMap<i64, String>,
}

impl LspBridge {
    /// Create a new LSP bridge with the given configuration.
    pub fn new(config: LspBridgeConfig) -> Self {
        Self {
            config,
            state: LspBridgeState::Stopped,
            pending_requests: HashMap::new(),
        }
    }

    /// Begin starting the bridge. The consumer should create the SSH channel
    /// and spawn the LSP server, then call `on_started()` when ready.
    pub fn start(&mut self) {
        self.state = LspBridgeState::Starting;
        self.pending_requests.clear();
    }

    /// Mark the bridge as running. Call this after the SSH channel is
    /// established and the LSP server has been spawned.
    pub fn on_started(&mut self) {
        self.state = LspBridgeState::Running;
    }

    /// Mark the bridge as stopped.
    pub fn on_stopped(&mut self) {
        self.state = LspBridgeState::Stopped;
        self.pending_requests.clear();
    }

    /// Mark the bridge as failed with a reason.
    pub fn on_failed(&mut self, reason: &str) {
        self.state = LspBridgeState::Failed(reason.to_string());
        self.pending_requests.clear();
    }

    /// Track an outgoing request so we can correlate the response.
    /// Returns `false` if the bridge is not in the `Running` state.
    pub fn track_request(&mut self, id: i64, method: &str) -> bool {
        if self.state != LspBridgeState::Running {
            return false;
        }
        self.pending_requests.insert(id, method.to_string());
        true
    }

    /// Complete (remove) a tracked request and return its method name.
    pub fn complete_request(&mut self, id: i64) -> Option<String> {
        self.pending_requests.remove(&id)
    }

    /// Returns `true` if the bridge is currently running.
    pub fn is_running(&self) -> bool {
        self.state == LspBridgeState::Running
    }

    /// Returns the number of in-flight requests.
    pub fn pending_count(&self) -> usize {
        self.pending_requests.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> LspBridgeConfig {
        LspBridgeConfig {
            language_id: "rust".to_string(),
            server_command: "rust-analyzer".to_string(),
            server_args: vec![],
            root_path: "/home/user/project".to_string(),
        }
    }

    #[test]
    fn test_initial_state() {
        let bridge = LspBridge::new(test_config());
        assert_eq!(bridge.state, LspBridgeState::Stopped);
        assert!(bridge.pending_requests.is_empty());
    }

    #[test]
    fn test_start_lifecycle() {
        let mut bridge = LspBridge::new(test_config());

        bridge.start();
        assert_eq!(bridge.state, LspBridgeState::Starting);

        bridge.on_started();
        assert_eq!(bridge.state, LspBridgeState::Running);
        assert!(bridge.is_running());

        bridge.on_stopped();
        assert_eq!(bridge.state, LspBridgeState::Stopped);
        assert!(!bridge.is_running());
    }

    #[test]
    fn test_failed_state() {
        let mut bridge = LspBridge::new(test_config());
        bridge.start();
        bridge.on_failed("server crashed");
        assert_eq!(
            bridge.state,
            LspBridgeState::Failed("server crashed".to_string())
        );
    }

    #[test]
    fn test_request_tracking() {
        let mut bridge = LspBridge::new(test_config());
        bridge.start();
        bridge.on_started();

        assert!(bridge.track_request(1, "textDocument/completion"));
        assert!(bridge.track_request(2, "textDocument/hover"));
        assert_eq!(bridge.pending_count(), 2);

        let method = bridge.complete_request(1);
        assert_eq!(method.as_deref(), Some("textDocument/completion"));
        assert_eq!(bridge.pending_count(), 1);

        // Completing a non-existent request returns None.
        assert!(bridge.complete_request(99).is_none());
    }

    #[test]
    fn test_track_request_not_running() {
        let mut bridge = LspBridge::new(test_config());
        // Bridge is Stopped; tracking should fail.
        assert!(!bridge.track_request(1, "textDocument/completion"));
    }

    #[test]
    fn test_stop_clears_pending() {
        let mut bridge = LspBridge::new(test_config());
        bridge.start();
        bridge.on_started();
        bridge.track_request(1, "textDocument/definition");
        bridge.track_request(2, "textDocument/references");

        bridge.on_stopped();
        assert!(bridge.pending_requests.is_empty());
    }

    #[test]
    fn test_failed_clears_pending() {
        let mut bridge = LspBridge::new(test_config());
        bridge.start();
        bridge.on_started();
        bridge.track_request(1, "textDocument/definition");

        bridge.on_failed("connection lost");
        assert!(bridge.pending_requests.is_empty());
    }
}
