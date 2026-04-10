use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Configuration for a remote terminal (PTY).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteTerminalConfig {
    /// Number of columns.
    pub cols: u32,
    /// Number of rows.
    pub rows: u32,
    /// Environment variables to set on the remote shell.
    pub env: HashMap<String, String>,
}

impl RemoteTerminalConfig {
    /// Create a config with the given dimensions and no extra env vars.
    pub fn new(cols: u32, rows: u32) -> Self {
        Self {
            cols,
            rows,
            env: HashMap::new(),
        }
    }
}

/// State of a remote terminal session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemoteTerminalState {
    /// The terminal is connecting (SSH channel being set up).
    Connecting,
    /// The terminal is connected and has a live PTY.
    Connected,
    /// The terminal has been disconnected.
    Disconnected,
}

/// Manages the state for a single remote terminal PTY session.
///
/// The actual SSH channel and PTY allocation is handled by the consumer.
/// This struct tracks identity, configuration, dimensions, and state.
pub struct RemoteTerminal {
    /// Unique identifier for this terminal session.
    pub id: String,
    /// Configuration (dimensions, env).
    pub config: RemoteTerminalConfig,
    /// The host key (connection pool key) this terminal belongs to.
    pub host_key: String,
    /// Current state.
    pub state: RemoteTerminalState,
}

impl RemoteTerminal {
    /// Create a new remote terminal in `Disconnected` state.
    pub fn new(id: &str, host_key: &str, config: RemoteTerminalConfig) -> Self {
        Self {
            id: id.to_string(),
            config,
            host_key: host_key.to_string(),
            state: RemoteTerminalState::Disconnected,
        }
    }

    /// Begin connecting. The consumer should allocate the SSH channel and PTY,
    /// then call the appropriate state transition.
    pub fn connect(&mut self) {
        self.state = RemoteTerminalState::Connecting;
    }

    /// Mark as connected. Call after the SSH PTY channel is established.
    pub fn on_connected(&mut self) {
        self.state = RemoteTerminalState::Connected;
    }

    /// Mark as disconnected. Cleans up logical state; the consumer should
    /// close the SSH channel separately.
    pub fn disconnect(&mut self) {
        self.state = RemoteTerminalState::Disconnected;
    }

    /// Resize the terminal dimensions. This updates the stored config;
    /// the consumer should send the PTY resize to the remote host.
    /// Returns `true` if the terminal is connected and the resize was recorded.
    pub fn resize(&mut self, cols: u32, rows: u32) -> bool {
        if self.state != RemoteTerminalState::Connected {
            return false;
        }
        self.config.cols = cols;
        self.config.rows = rows;
        true
    }

    /// Returns `true` if the terminal is currently connected.
    pub fn is_connected(&self) -> bool {
        self.state == RemoteTerminalState::Connected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> RemoteTerminalConfig {
        RemoteTerminalConfig::new(80, 24)
    }

    #[test]
    fn test_initial_state() {
        let term = RemoteTerminal::new("term-1", "user@host", test_config());
        assert_eq!(term.state, RemoteTerminalState::Disconnected);
        assert_eq!(term.id, "term-1");
        assert_eq!(term.host_key, "user@host");
        assert!(!term.is_connected());
    }

    #[test]
    fn test_connect_lifecycle() {
        let mut term = RemoteTerminal::new("term-1", "user@host", test_config());

        term.connect();
        assert_eq!(term.state, RemoteTerminalState::Connecting);

        term.on_connected();
        assert_eq!(term.state, RemoteTerminalState::Connected);
        assert!(term.is_connected());

        term.disconnect();
        assert_eq!(term.state, RemoteTerminalState::Disconnected);
        assert!(!term.is_connected());
    }

    #[test]
    fn test_resize_when_connected() {
        let mut term = RemoteTerminal::new("term-1", "user@host", test_config());
        term.connect();
        term.on_connected();

        assert!(term.resize(120, 40));
        assert_eq!(term.config.cols, 120);
        assert_eq!(term.config.rows, 40);
    }

    #[test]
    fn test_resize_when_not_connected() {
        let mut term = RemoteTerminal::new("term-1", "user@host", test_config());
        // Disconnected -- resize should fail.
        assert!(!term.resize(120, 40));
        assert_eq!(term.config.cols, 80);
        assert_eq!(term.config.rows, 24);
    }

    #[test]
    fn test_env_vars() {
        let mut config = RemoteTerminalConfig::new(80, 24);
        config.env.insert("TERM".to_string(), "xterm-256color".to_string());
        config.env.insert("LANG".to_string(), "en_US.UTF-8".to_string());

        let term = RemoteTerminal::new("term-2", "user@host", config);
        assert_eq!(term.config.env.len(), 2);
        assert_eq!(term.config.env.get("TERM").unwrap(), "xterm-256color");
    }

    #[test]
    fn test_reconnect_cycle() {
        let mut term = RemoteTerminal::new("term-1", "user@host", test_config());

        // First connection
        term.connect();
        term.on_connected();
        assert!(term.is_connected());

        // Disconnect
        term.disconnect();
        assert!(!term.is_connected());

        // Reconnect
        term.connect();
        term.on_connected();
        assert!(term.is_connected());
    }
}
