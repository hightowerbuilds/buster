use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Authentication method for SSH connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthMethod {
    /// SSH agent authentication.
    Agent,
    /// Key file authentication.
    KeyFile {
        path: PathBuf,
        passphrase: Option<String>,
    },
    /// Password authentication.
    Password { password: String },
}

/// Configuration for a remote host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHost {
    /// Display name for this connection.
    pub name: String,
    /// Hostname or IP address.
    pub host: String,
    /// SSH port (default: 22).
    pub port: u16,
    /// Username.
    pub username: String,
    /// Remote working directory.
    pub remote_dir: String,
    /// Authentication methods to try in order.
    pub auth_methods: Vec<AuthMethod>,
    /// Whether to verify host key against known_hosts.
    pub verify_host_key: bool,
}

impl RemoteHost {
    pub fn new(host: &str, username: &str, remote_dir: &str) -> Self {
        Self {
            name: format!("{}@{}", username, host),
            host: host.to_string(),
            port: 22,
            username: username.to_string(),
            remote_dir: remote_dir.to_string(),
            auth_methods: vec![
                AuthMethod::Agent,
                AuthMethod::KeyFile {
                    path: dirs_default_ssh_key(),
                    passphrase: None,
                },
            ],
            verify_host_key: true,
        }
    }

    /// Connection string for display.
    pub fn display(&self) -> String {
        if self.port == 22 {
            format!("{}@{}", self.username, self.host)
        } else {
            format!("{}@{}:{}", self.username, self.host, self.port)
        }
    }
}

fn dirs_default_ssh_key() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    PathBuf::from(home).join(".ssh").join("id_ed25519")
}

/// Parsed SSH config (from ~/.ssh/config).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub hosts: Vec<RemoteHost>,
}

impl SshConfig {
    pub fn new() -> Self {
        Self { hosts: Vec::new() }
    }

    pub fn add_host(&mut self, host: RemoteHost) {
        self.hosts.push(host);
    }

    pub fn find_host(&self, name: &str) -> Option<&RemoteHost> {
        self.hosts.iter().find(|h| h.name == name || h.host == name)
    }
}

impl Default for SshConfig {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remote_host_defaults() {
        let host = RemoteHost::new("dev.example.com", "luke", "/home/luke/project");
        assert_eq!(host.port, 22);
        assert_eq!(host.display(), "luke@dev.example.com");
        assert!(host.verify_host_key);
        assert_eq!(host.auth_methods.len(), 2);
    }

    #[test]
    fn test_ssh_config() {
        let mut config = SshConfig::new();
        config.add_host(RemoteHost::new("server1", "user", "/home/user"));
        config.add_host(RemoteHost::new("server2", "user", "/home/user"));

        assert!(config.find_host("server1").is_some());
        assert!(config.find_host("server3").is_none());
    }
}
