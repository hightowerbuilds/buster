use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Mutex;

// buster-remote integration — connection pool, workspace sync, config
pub mod remote_pro {
    pub use buster_remote::{
        ConnectionPool, ConnectionState, WorkspaceSync, SyncState,
        RemoteHost, AuthMethod, SshConfig,
    };
}

/// Manages SSH connections to remote hosts via a ConnectionPool.
///
/// The pool tracks connection state (Connecting/Connected/Failed/etc.)
/// while `sessions` holds the live SSH handles keyed by host_key
/// (e.g. "user@host" or "user@host:port").
pub struct RemoteManager {
    /// buster-remote: connection pool for multi-host support
    pub pool: Mutex<remote_pro::ConnectionPool>,
    /// Live SSH sessions keyed by the same host_key the pool uses.
    sessions: Mutex<HashMap<String, Session>>,
    /// The currently-active host_key (used by single-connection Tauri commands).
    current: Mutex<Option<String>>,
    /// buster-remote: workspace sync state
    pub sync: Mutex<Option<remote_pro::WorkspaceSync>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileContent {
    pub path: String,
    pub content: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnectionInfo {
    pub host: String,
    pub user: String,
    pub remote_root: String,
    pub connected: bool,
}

impl RemoteManager {
    pub fn new() -> Self {
        RemoteManager {
            pool: Mutex::new(remote_pro::ConnectionPool::default()),
            sessions: Mutex::new(HashMap::new()),
            current: Mutex::new(None),
            sync: Mutex::new(None),
        }
    }

    // ── helpers ──────────────────────────────────────────────────────

    /// Build a host_key the same way `RemoteHost::display()` does.
    #[allow(dead_code)]
    fn host_key(host: &str, port: u16, user: &str) -> String {
        if port == 22 {
            format!("{}@{}", user, host)
        } else {
            format!("{}@{}:{}", user, host, port)
        }
    }

    /// Borrow the live SSH session for the current (or given) host_key.
    /// Returns an error string if nothing is connected.
    fn with_session<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Session) -> Result<T, String>,
    {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        let key = current.as_deref().ok_or("Not connected to remote host")?;

        // Verify the pool says we're connected
        {
            let pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            match pool.state(key) {
                Some(remote_pro::ConnectionState::Connected) => {}
                _ => return Err(format!("Host {} is not connected", key)),
            }
        }

        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let ssh = sessions.get(key)
            .ok_or_else(|| format!("No SSH session for {}", key))?;
        f(ssh)
    }

    // ── public API ──────────────────────────────────────────────────

    /// Connect to a remote host via SSH.
    /// Tries SSH agent first, then key file (~/.ssh/id_rsa, id_ed25519).
    pub fn connect(
        &self,
        host: &str,
        port: u16,
        user: &str,
        remote_root: &str,
        password: Option<&str>,
    ) -> Result<(), String> {
        // Build the RemoteHost and derive the pool key
        let mut remote_host = remote_pro::RemoteHost::new(host, user, remote_root);
        remote_host.port = port;
        let key = remote_host.display(); // e.g. "user@host" or "user@host:port"

        // Register in the pool (idempotent — remove first if it already exists)
        {
            let mut pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            pool.remove(&key);
            pool.add(remote_host).map_err(|e| e.to_string())?;
            pool.set_connecting(&key);
        }

        // Establish the TCP + SSH connection
        let ssh = match self.establish_ssh(host, port, user, password) {
            Ok(session) => session,
            Err(e) => {
                let mut pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
                pool.set_failed(&key, &e);
                return Err(e);
            }
        };

        // Store the session and mark connected
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            sessions.insert(key.clone(), ssh);
        }
        {
            let mut pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            pool.set_connected(&key);
        }
        {
            let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
            *current = Some(key);
        }

        Ok(())
    }

    /// Low-level SSH connection + authentication (no pool interaction).
    fn establish_ssh(
        &self,
        host: &str,
        port: u16,
        user: &str,
        password: Option<&str>,
    ) -> Result<Session, String> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .map_err(|e| e.to_string())?;

        let mut ssh = Session::new()
            .map_err(|e| format!("Failed to create SSH session: {}", e))?;
        ssh.set_tcp_stream(tcp);
        ssh.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Try authentication methods
        let authenticated = if let Some(pw) = password {
            ssh.userauth_password(user, pw).is_ok()
        } else {
            let agent_ok = ssh.userauth_agent(user).is_ok();
            if agent_ok {
                true
            } else {
                let home = dirs::home_dir().unwrap_or_default();
                let key_files = [
                    home.join(".ssh/id_ed25519"),
                    home.join(".ssh/id_rsa"),
                    home.join(".ssh/id_ecdsa"),
                ];
                let mut ok = false;
                for key in &key_files {
                    if key.exists() {
                        if ssh.userauth_pubkey_file(user, None, key, None).is_ok() {
                            ok = true;
                            break;
                        }
                    }
                }
                ok
            }
        };

        if !authenticated || !ssh.authenticated() {
            return Err("SSH authentication failed".to_string());
        }

        Ok(ssh)
    }

    /// Disconnect the current host (or all hosts if no current is set).
    pub fn disconnect(&self) {
        let key = {
            let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
            current.take()
        };

        if let Some(key) = key {
            self.disconnect_host(&key);
        }
    }

    /// Disconnect a specific host by key.
    pub fn disconnect_host(&self, host_key: &str) {
        // Remove the live SSH session and send disconnect
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ssh) = sessions.remove(host_key) {
                let _ = ssh.disconnect(None, "Buster disconnect", None);
            }
        }
        // Remove from the pool
        {
            let mut pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            pool.remove(host_key);
        }
        // Clear current if it matches
        {
            let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
            if current.as_deref() == Some(host_key) {
                *current = None;
            }
        }
    }

    /// Check if the current host is connected.
    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref key) = *current {
            let pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            matches!(pool.state(key), Some(remote_pro::ConnectionState::Connected))
        } else {
            false
        }
    }

    /// Get connection info for the current host.
    pub fn connection_info(&self) -> Option<RemoteConnectionInfo> {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        let key = current.as_ref()?;

        let pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
        let host = pool.host(key)?;
        let connected = matches!(
            pool.state(key),
            Some(remote_pro::ConnectionState::Connected)
        );

        Some(RemoteConnectionInfo {
            host: host.host.clone(),
            user: host.username.clone(),
            remote_root: host.remote_dir.clone(),
            connected,
        })
    }

    /// List all connections and their states.
    #[allow(dead_code)]
    pub fn list_connections(&self) -> Vec<(String, remote_pro::ConnectionState)> {
        let pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
        pool.list()
            .into_iter()
            .map(|(k, s)| (k.to_string(), s.clone()))
            .collect()
    }

    /// List directory contents on the remote host.
    pub fn list_directory(&self, path: &str) -> Result<Vec<RemoteFileEntry>, String> {
        self.with_session(|ssh| {
            let sftp = ssh.sftp()
                .map_err(|e| format!("SFTP failed: {}", e))?;

            let entries = sftp.readdir(Path::new(path))
                .map_err(|e| format!("Failed to list {}: {}", path, e))?;

            let mut result: Vec<RemoteFileEntry> = entries.iter()
                .filter_map(|(path, stat)| {
                    let name = path.file_name()?.to_string_lossy().to_string();
                    if name.starts_with('.') { return None; }
                    Some(RemoteFileEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        is_dir: stat.is_dir(),
                        size: stat.size.unwrap_or(0),
                    })
                })
                .collect();

            result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
            Ok(result)
        })
    }

    /// Read a file from the remote host.
    pub fn read_file(&self, path: &str) -> Result<RemoteFileContent, String> {
        self.with_session(|ssh| {
            let sftp = ssh.sftp()
                .map_err(|e| format!("SFTP failed: {}", e))?;

            let mut file = sftp.open(Path::new(path))
                .map_err(|e| format!("Failed to open {}: {}", path, e))?;

            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read {}: {}", path, e))?;

            let file_name = Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());

            Ok(RemoteFileContent {
                path: path.to_string(),
                content,
                file_name,
            })
        })
    }

    /// Write a file to the remote host.
    pub fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        self.with_session(|ssh| {
            let sftp = ssh.sftp()
                .map_err(|e| format!("SFTP failed: {}", e))?;

            let mut file = sftp.create(Path::new(path))
                .map_err(|e| format!("Failed to create {}: {}", path, e))?;

            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write {}: {}", path, e))?;

            Ok(())
        })
    }

    /// Execute a command on the remote host and return stdout.
    pub fn exec_command(&self, cmd: &str) -> Result<String, String> {
        self.with_session(|ssh| {
            let mut channel = ssh.channel_session()
                .map_err(|e| format!("Failed to open channel: {}", e))?;

            channel.exec(cmd)
                .map_err(|e| format!("Failed to exec: {}", e))?;

            let mut stdout = String::new();
            channel.read_to_string(&mut stdout)
                .map_err(|e| format!("Failed to read stdout: {}", e))?;

            channel.wait_close()
                .map_err(|e| format!("Channel close failed: {}", e))?;

            Ok(stdout)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_manager_starts_disconnected() {
        let mgr = RemoteManager::new();
        assert!(!mgr.is_connected());
        assert!(mgr.connection_info().is_none());
    }

    #[test]
    fn disconnect_when_not_connected_is_ok() {
        let mgr = RemoteManager::new();
        mgr.disconnect(); // should not panic
        assert!(!mgr.is_connected());
    }
}
