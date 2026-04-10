use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::sync::oneshot;

use super::{StackFrame, Variable};

/// DAP client — communicates with a Debug Adapter via the Debug Adapter Protocol.
/// Uses the same content-length framing as LSP.
pub struct DapClient {
    stdin: Mutex<Box<dyn Write + Send>>,
    _child: Child,
    seq: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
}

impl DapClient {
    /// Start a debug adapter process.
    pub async fn start(cmd: &str, args: &[&str]) -> Result<Self, String> {
        let mut child = Command::new(cmd)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start debug adapter '{}': {}", cmd, e))?;

        let stdin = child.stdin.take().ok_or("No stdin")?;
        let stdout = child.stdout.take().ok_or("No stdout")?;

        let pending = Arc::new(Mutex::new(HashMap::new()));

        let client = DapClient {
            stdin: Mutex::new(Box::new(stdin)),
            _child: child,
            seq: AtomicI64::new(1),
            pending: Arc::clone(&pending),
        };

        // Spawn reader thread
        std::thread::spawn(move || {
            let pending = pending;
            let mut reader = BufReader::new(stdout);
            loop {
                // Read content-length header
                let mut header = String::new();
                if reader.read_line(&mut header).unwrap_or(0) == 0 { break; }
                let content_length = header
                    .strip_prefix("Content-Length: ")
                    .and_then(|s| s.trim().parse::<usize>().ok());
                let Some(len) = content_length else {
                    continue;
                };

                // Skip empty line
                let mut empty = String::new();
                let _ = reader.read_line(&mut empty);

                // Read body
                let mut body = vec![0u8; len];
                if std::io::Read::read_exact(&mut reader, &mut body).is_err() { break; }

                let Ok(msg) = serde_json::from_slice::<Value>(&body) else { continue };

                // Handle response
                if msg.get("type").and_then(|v| v.as_str()) == Some("response") {
                    if let Some(seq) = msg.get("request_seq").and_then(|v| v.as_i64()) {
                        let mut p = pending.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(tx) = p.remove(&seq) {
                            let _ = tx.send(msg);
                        }
                    }
                }
                // Events (stopped, terminated, etc.) are logged but not yet forwarded
                // TODO: emit events to frontend via Tauri event system
            }
        });

        Ok(client)
    }

    fn send_request(&self, command: &str, arguments: Value) -> Result<oneshot::Receiver<Value>, String> {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst);
        let msg = json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        });

        let body = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());

        let mut stdin = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        stdin.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let (tx, rx) = oneshot::channel();
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        pending.insert(seq, tx);

        Ok(rx)
    }

    async fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let rx = self.send_request(command, arguments)?;
        let resp = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            rx,
        )
        .await
        .map_err(|_| format!("DAP {} timed out", command))?
        .map_err(|_| format!("DAP {} channel closed", command))?;

        if resp.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
            return Err(format!("DAP {}: {}", command, msg));
        }

        Ok(resp)
    }

    pub async fn initialize(&self) -> Result<(), String> {
        self.request("initialize", json!({
            "clientID": "buster",
            "clientName": "Buster IDE",
            "adapterID": "generic",
            "pathFormat": "path",
            "linesStartAt1": true,
            "columnsStartAt1": true,
            "supportsVariableType": true,
        })).await?;
        Ok(())
    }

    pub async fn launch(&self, program: &str, cwd: &str) -> Result<(), String> {
        self.request("launch", json!({
            "program": program,
            "cwd": cwd,
            "stopOnEntry": false,
        })).await?;
        Ok(())
    }

    pub async fn set_breakpoints(&self, file_path: &str, lines: &[u32]) -> Result<(), String> {
        let breakpoints: Vec<Value> = lines.iter().map(|l| json!({ "line": l })).collect();
        self.request("setBreakpoints", json!({
            "source": { "path": file_path },
            "breakpoints": breakpoints,
        })).await?;
        Ok(())
    }

    pub async fn continue_execution(&self, thread_id: i64) -> Result<(), String> {
        self.request("continue", json!({ "threadId": thread_id })).await?;
        Ok(())
    }

    pub async fn next(&self, thread_id: i64) -> Result<(), String> {
        self.request("next", json!({ "threadId": thread_id })).await?;
        Ok(())
    }

    pub async fn step_in(&self, thread_id: i64) -> Result<(), String> {
        self.request("stepIn", json!({ "threadId": thread_id })).await?;
        Ok(())
    }

    pub async fn step_out(&self, thread_id: i64) -> Result<(), String> {
        self.request("stepOut", json!({ "threadId": thread_id })).await?;
        Ok(())
    }

    pub async fn pause(&self, thread_id: i64) -> Result<(), String> {
        self.request("pause", json!({ "threadId": thread_id })).await?;
        Ok(())
    }

    pub async fn stack_trace(&self, thread_id: i64) -> Result<Vec<StackFrame>, String> {
        let resp = self.request("stackTrace", json!({ "threadId": thread_id })).await?;
        let body = resp.get("body").unwrap_or(&Value::Null);
        let frames = body.get("stackFrames").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        Ok(frames.iter().map(|f| {
            let source = f.get("source");
            StackFrame {
                id: f.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
                name: f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                file_path: source.and_then(|s| s.get("path")).and_then(|v| v.as_str()).map(String::from),
                line: f.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                col: f.get("column").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            }
        }).collect())
    }

    pub async fn variables(&self, variables_reference: i64) -> Result<Vec<Variable>, String> {
        let resp = self.request("variables", json!({ "variablesReference": variables_reference })).await?;
        let body = resp.get("body").unwrap_or(&Value::Null);
        let vars = body.get("variables").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        Ok(vars.iter().map(|v| Variable {
            name: v.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            value: v.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            var_type: v.get("type").and_then(|v| v.as_str()).map(String::from),
            variables_reference: v.get("variablesReference").and_then(|v| v.as_i64()).unwrap_or(0),
        }).collect())
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        let _ = self.request("disconnect", json!({ "terminateDebuggee": true })).await;
        Ok(())
    }
}
