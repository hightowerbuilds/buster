use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::config::RemoteHost;
use crate::types::RemoteError;

/// State of a remote connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting { attempt: u32 },
    Failed { reason: String },
}

/// Manages multiple SSH connections with pooling.
pub struct ConnectionPool {
    connections: HashMap<String, ConnectionEntry>,
    max_connections: usize,
}

struct ConnectionEntry {
    host: RemoteHost,
    state: ConnectionState,
    reconnect_count: u32,
    max_reconnects: u32,
}

impl ConnectionPool {
    pub fn new(max_connections: usize) -> Self {
        Self {
            connections: HashMap::new(),
            max_connections,
        }
    }

    /// Register a connection (doesn't connect yet).
    pub fn add(&mut self, host: RemoteHost) -> Result<(), RemoteError> {
        if self.connections.len() >= self.max_connections {
            return Err(RemoteError::Config(format!(
                "maximum connections ({}) reached",
                self.max_connections
            )));
        }

        let key = host.display();
        self.connections.insert(
            key,
            ConnectionEntry {
                host,
                state: ConnectionState::Disconnected,
                reconnect_count: 0,
                max_reconnects: 5,
            },
        );
        Ok(())
    }

    /// Mark a connection as connecting.
    pub fn set_connecting(&mut self, host_key: &str) {
        if let Some(entry) = self.connections.get_mut(host_key) {
            entry.state = ConnectionState::Connecting;
        }
    }

    /// Mark a connection as connected.
    pub fn set_connected(&mut self, host_key: &str) {
        if let Some(entry) = self.connections.get_mut(host_key) {
            entry.state = ConnectionState::Connected;
            entry.reconnect_count = 0;
        }
    }

    /// Mark a connection as failed and attempt reconnection.
    pub fn set_failed(&mut self, host_key: &str, reason: &str) -> bool {
        if let Some(entry) = self.connections.get_mut(host_key) {
            entry.reconnect_count += 1;
            if entry.reconnect_count <= entry.max_reconnects {
                entry.state = ConnectionState::Reconnecting {
                    attempt: entry.reconnect_count,
                };
                true // should retry
            } else {
                entry.state = ConnectionState::Failed {
                    reason: reason.to_string(),
                };
                false // give up
            }
        } else {
            false
        }
    }

    /// Get the state of a connection.
    pub fn state(&self, host_key: &str) -> Option<&ConnectionState> {
        self.connections.get(host_key).map(|e| &e.state)
    }

    /// Get the host config for a connection.
    pub fn host(&self, host_key: &str) -> Option<&RemoteHost> {
        self.connections.get(host_key).map(|e| &e.host)
    }

    /// Remove a connection.
    pub fn remove(&mut self, host_key: &str) {
        self.connections.remove(host_key);
    }

    /// List all connection keys.
    pub fn list(&self) -> Vec<(&str, &ConnectionState)> {
        self.connections
            .iter()
            .map(|(k, v)| (k.as_str(), &v.state))
            .collect()
    }
}

impl Default for ConnectionPool {
    fn default() -> Self {
        Self::new(5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_host() -> RemoteHost {
        RemoteHost::new("dev.example.com", "luke", "/home/luke")
    }

    #[test]
    fn test_add_and_state() {
        let mut pool = ConnectionPool::default();
        pool.add(test_host()).unwrap();
        let key = "luke@dev.example.com";
        assert_eq!(pool.state(key), Some(&ConnectionState::Disconnected));
    }

    #[test]
    fn test_connection_lifecycle() {
        let mut pool = ConnectionPool::default();
        pool.add(test_host()).unwrap();
        let key = "luke@dev.example.com";

        pool.set_connecting(key);
        assert_eq!(pool.state(key), Some(&ConnectionState::Connecting));

        pool.set_connected(key);
        assert_eq!(pool.state(key), Some(&ConnectionState::Connected));
    }

    #[test]
    fn test_reconnection() {
        let mut pool = ConnectionPool::default();
        pool.add(test_host()).unwrap();
        let key = "luke@dev.example.com";

        // First failure — should retry
        assert!(pool.set_failed(key, "timeout"));
        assert_eq!(
            pool.state(key),
            Some(&ConnectionState::Reconnecting { attempt: 1 })
        );

        // Exhaust retries (max_reconnects = 5, already at 1)
        for _ in 0..4 {
            assert!(pool.set_failed(key, "timeout")); // attempts 2-5 should retry
        }
        pool.set_failed(key, "timeout"); // attempt 6 should give up
        assert!(matches!(
            pool.state(key),
            Some(&ConnectionState::Failed { .. })
        ));
    }

    #[test]
    fn test_max_connections() {
        let mut pool = ConnectionPool::new(1);
        pool.add(RemoteHost::new("host1", "user", "/tmp")).unwrap();
        assert!(pool.add(RemoteHost::new("host2", "user", "/tmp")).is_err());
    }
}
