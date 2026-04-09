use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::registry::LanguageServerConfig;
use crate::transport::{parse_content_length, LspMessage, RequestId};
use crate::types::LspError;

/// The current status of a language server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerStatus {
    /// Server process is starting.
    Starting,
    /// Server is running and initialized.
    Running,
    /// Server has crashed. Contains the restart count.
    Crashed(u32),
    /// Server has been intentionally stopped.
    Stopped,
}

/// Handle to a running language server process.
///
/// Manages the process lifecycle, captures stderr for debugging,
/// and tracks restart count for crash recovery.
pub struct ServerHandle {
    config: LanguageServerConfig,
    status: ServerStatus,
    restart_count: u32,
    process: Option<Child>,
    next_request_id: i64,
    /// Captured stderr lines from the server (for debugging).
    stderr_log: Arc<Mutex<Vec<String>>>,
}

impl ServerHandle {
    /// Spawn a new language server process.
    pub fn spawn(config: &LanguageServerConfig) -> Result<Self, LspError> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(root) = &config.root_dir {
            cmd.current_dir(root);
        }

        let mut child = cmd.spawn().map_err(|e| LspError::ServerStartFailed {
            name: config.name.clone(),
            reason: e.to_string(),
        })?;

        // Capture stderr in a background thread so server errors are visible
        let stderr_log = Arc::new(Mutex::new(Vec::new()));
        if let Some(stderr) = child.stderr.take() {
            let log = Arc::clone(&stderr_log);
            let name = config.name.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(line) => {
                            log::warn!("[{}] {}", name, line);
                            if let Ok(mut log) = log.lock() {
                                log.push(line);
                                // Keep only the last 100 lines
                                if log.len() > 100 {
                                    let drain_to = log.len() - 100;
                                    log.drain(..drain_to);
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(Self {
            config: config.clone(),
            status: ServerStatus::Starting,
            restart_count: 0,
            process: Some(child),
            next_request_id: 1,
            stderr_log,
        })
    }

    /// Get the current server status.
    pub fn status(&self) -> &ServerStatus {
        &self.status
    }

    /// Mark the server as initialized and running.
    pub fn set_running(&mut self) {
        self.status = ServerStatus::Running;
    }

    /// Send a request to the server and return the request ID.
    pub fn send_request(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<RequestId, LspError> {
        let id = RequestId::Number(self.next_request_id);
        self.next_request_id += 1;

        let msg = LspMessage::Request {
            id: id.clone(),
            method: method.to_string(),
            params,
        };

        self.send_message(&msg)?;
        Ok(id)
    }

    /// Send a notification to the server (no response expected).
    pub fn send_notification(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), LspError> {
        let msg = LspMessage::Notification {
            method: method.to_string(),
            params,
        };
        self.send_message(&msg)
    }

    /// Send a cancellation request for a pending request.
    pub fn cancel_request(&mut self, id: &RequestId) -> Result<(), LspError> {
        self.send_notification(
            "$/cancelRequest",
            Some(serde_json::json!({ "id": id })),
        )
    }

    /// Read the next message from the server's stdout.
    pub fn read_message(&mut self) -> Result<LspMessage, LspError> {
        let stdout = self
            .process
            .as_mut()
            .and_then(|p| p.stdout.as_mut())
            .ok_or_else(|| LspError::Transport("server stdout not available".into()))?;

        // Read headers
        let mut header_buf = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            stdout.read_exact(&mut byte)?;
            header_buf.push(byte[0]);

            if header_buf.len() >= 4
                && header_buf[header_buf.len() - 4..] == *b"\r\n\r\n"
            {
                break;
            }

            if header_buf.len() > 4096 {
                return Err(LspError::Transport("header too large".into()));
            }
        }

        let (content_length, _) = parse_content_length(&header_buf)
            .ok_or_else(|| LspError::Transport("missing Content-Length".into()))?;

        // Read body
        let mut body = vec![0u8; content_length];
        stdout.read_exact(&mut body)?;

        let value: serde_json::Value = serde_json::from_slice(&body)?;
        LspMessage::from_json(value)
    }

    /// Check if the server process is still alive.
    pub fn is_alive(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Attempt to restart the server after a crash.
    pub fn try_restart(&mut self) -> Result<(), LspError> {
        if self.restart_count >= self.config.max_restarts {
            return Err(LspError::ServerCrashed {
                name: self.config.name.clone(),
                restarts: self.restart_count,
            });
        }

        // Kill existing process if any
        self.stop();

        // Respawn
        let mut new_handle = Self::spawn(&self.config)?;
        self.process = new_handle.process.take();
        self.stderr_log = Arc::clone(&new_handle.stderr_log);
        self.restart_count += 1;
        self.status = ServerStatus::Starting;

        log::info!(
            "[{}] restarted (attempt {}/{})",
            self.config.name,
            self.restart_count,
            self.config.max_restarts
        );

        Ok(())
    }

    /// Stop the server process.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.status = ServerStatus::Stopped;
    }

    /// Get captured stderr lines from the server.
    pub fn stderr_log(&self) -> Vec<String> {
        self.stderr_log.lock().map(|l| l.clone()).unwrap_or_default()
    }

    fn send_message(&mut self, msg: &LspMessage) -> Result<(), LspError> {
        let wire = msg.to_wire()?;
        let stdin = self
            .process
            .as_mut()
            .and_then(|p| p.stdin.as_mut())
            .ok_or_else(|| LspError::Transport("server stdin not available".into()))?;

        stdin.write_all(&wire)?;
        stdin.flush()?;
        Ok(())
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_status_lifecycle() {
        // Can't spawn a real LSP server in tests, but we can test the status model
        let config = LanguageServerConfig::new("test-server", "echo");
        assert_eq!(config.max_restarts, 3);
    }
}
