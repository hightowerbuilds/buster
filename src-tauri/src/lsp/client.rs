use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

/// A running LSP client connected to a language server process.
#[allow(dead_code)]
pub struct LspClient {
    stdin: Mutex<ChildStdin>,
    _child: Child,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    next_id: AtomicI64,
    pub language: String,
    pub root_uri: String,
    pub crashed: Arc<AtomicBool>,
    /// Number of times this server has been restarted after crashes.
    pub restart_count: u32,
}

/// Diagnostic from the language server
#[derive(Debug, Clone, serde::Serialize)]
pub struct LspDiagnostic {
    pub file_path: String,
    pub line: u32,
    pub col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub severity: u32, // 1=error, 2=warning, 3=info, 4=hint
    pub message: String,
}

#[allow(dead_code)]
impl LspClient {
    /// Spawn a language server and perform the initialize handshake.
    pub async fn start(
        command: &str,
        args: &[&str],
        root_path: &str,
        language: &str,
        diagnostics_tx: std::sync::mpsc::Sender<(String, Vec<LspDiagnostic>)>,
    ) -> Result<Self, String> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .current_dir(root_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn {}: {}", command, e))?;

        let stdin = child.stdin.take().ok_or("No stdin")?;
        let stdout = child.stdout.take().ok_or("No stdout")?;

        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let root_uri = buster_lsp_manager::path_to_lsp_uri(std::path::Path::new(root_path))
            .unwrap_or_else(|_| format!("file://{}", root_path));

        let crashed = Arc::new(AtomicBool::new(false));
        let crashed_flag = crashed.clone();

        // Spawn reader thread
        let pending_clone = pending.clone();
        let diag_tx = diagnostics_tx;
        thread::spawn(move || {
            Self::reader_loop(stdout, pending_clone, diag_tx);
            crashed_flag.store(true, Ordering::SeqCst);
        });

        let client = LspClient {
            stdin: Mutex::new(stdin),
            _child: child,
            pending,
            next_id: AtomicI64::new(1),
            language: language.to_string(),
            root_uri: root_uri.clone(),
            crashed,
            restart_count: 0,
        };

        // Send initialize
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": false
                        }
                    },
                    "hover": {
                        "contentFormat": ["plaintext", "markdown"]
                    },
                    "publishDiagnostics": {
                        "relatedInformation": false
                    },
                    "definition": {},
                    "typeDefinition": {},
                    "documentSymbol": {
                        "symbolKind": {
                            "valueSet": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]
                        },
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "signatureHelp": {
                        "signatureInformation": {
                            "parameterInformation": { "labelOffsetSupport": true }
                        }
                    },
                    "inlayHint": {},
                    "codeAction": {
                        "codeActionLiteralSupport": {
                            "codeActionKind": { "valueSet": ["quickfix", "refactor", "source"] }
                        }
                    },
                    "synchronization": {
                        "didSave": true,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "dynamicRegistration": false
                    }
                }
            },
            "initializationOptions": {}
        });

        // Send initialize request with a 30-second timeout
        let rx = client.send_request("initialize", init_params)?;
        let _resp = timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "LSP initialize timed out after 30s".to_string())?
            .map_err(|_| "LSP server closed before responding to initialize".to_string())?;

        // Send initialized notification
        client.send_notification("initialized", serde_json::json!({}))?;

        Ok(client)
    }

    fn reader_loop(
        stdout: ChildStdout,
        pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
        diag_tx: std::sync::mpsc::Sender<(String, Vec<LspDiagnostic>)>,
    ) {
        let mut reader = BufReader::new(stdout);
        loop {
            // Read headers
            let mut content_length: usize = 0;
            loop {
                let mut header = String::new();
                match reader.read_line(&mut header) {
                    Ok(0) => return, // EOF
                    Ok(_) => {
                        let header = header.trim();
                        if header.is_empty() {
                            break; // End of headers
                        }
                        if let Some(len_str) = header.strip_prefix("Content-Length: ") {
                            content_length = len_str.parse().unwrap_or(0);
                        }
                    }
                    Err(_) => return,
                }
            }

            if content_length == 0 {
                continue;
            }

            // Read body
            let mut body = vec![0u8; content_length];
            if std::io::Read::read_exact(&mut reader, &mut body).is_err() {
                return;
            }

            let msg: Value = match serde_json::from_slice(&body) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Response (has "id" and "result" or "error")
            if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
                if msg.get("result").is_some() || msg.get("error").is_some() {
                    if let Ok(mut map) = pending.lock() {
                        if let Some(tx) = map.remove(&id) {
                            let _ = tx.send(msg);
                        }
                    }
                    continue;
                }
            }

            // Notification (has "method" but no "id")
            if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                if method == "textDocument/publishDiagnostics" {
                    if let Some(params) = msg.get("params") {
                        let (file_path, diags) = Self::parse_diagnostics(params);
                        let _ = diag_tx.send((file_path, diags));
                    }
                }
            }
        }
    }

    fn parse_diagnostics(params: &Value) -> (String, Vec<LspDiagnostic>) {
        let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
        let file_path = buster_lsp_manager::lsp_uri_to_path(uri)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| uri.strip_prefix("file://").unwrap_or(uri).to_string());

        let mut result = Vec::new();
        if let Some(diags) = params.get("diagnostics").and_then(|v| v.as_array()) {
            for d in diags {
                let range = d.get("range").unwrap_or(&Value::Null);
                let start = range.get("start").unwrap_or(&Value::Null);
                let end = range.get("end").unwrap_or(&Value::Null);

                result.push(LspDiagnostic {
                    file_path: file_path.clone(),
                    line: start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    col: start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    end_line: end.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    end_col: end.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    severity: d.get("severity").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                    message: d.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                });
            }
        }
        (file_path, result)
    }

    fn send_raw(&self, msg: &Value) -> Result<(), String> {
        let body = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        stdin.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.send_raw(&msg)
    }

    pub fn send_request(&self, method: &str, params: Value) -> Result<oneshot::Receiver<Value>, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().map_err(|e| e.to_string())?.insert(id, tx);

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.send_raw(&msg)?;
        Ok(rx)
    }

    // --- Document lifecycle ---

    pub fn did_open(&self, uri: &str, language_id: &str, text: &str) -> Result<(), String> {
        self.send_notification("textDocument/didOpen", serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": 1,
                "text": text,
            }
        }))
    }

    pub fn did_change(&self, uri: &str, version: i32, text: &str) -> Result<(), String> {
        self.send_notification("textDocument/didChange", serde_json::json!({
            "textDocument": { "uri": uri, "version": version },
            "contentChanges": [{ "text": text }]
        }))
    }

    pub fn did_change_incremental(
        &self,
        uri: &str,
        version: i32,
        edits: &[crate::commands::lsp::EditDelta],
    ) -> Result<(), String> {
        let content_changes: Vec<serde_json::Value> = edits
            .iter()
            .map(|e| {
                serde_json::json!({
                    "range": {
                        "start": { "line": e.start_line, "character": e.start_col },
                        "end": { "line": e.end_line, "character": e.end_col }
                    },
                    "text": e.new_text
                })
            })
            .collect();
        self.send_notification("textDocument/didChange", serde_json::json!({
            "textDocument": { "uri": uri, "version": version },
            "contentChanges": content_changes
        }))
    }

    pub fn did_save(&self, uri: &str) -> Result<(), String> {
        self.send_notification("textDocument/didSave", serde_json::json!({
            "textDocument": { "uri": uri }
        }))
    }

    pub fn did_close(&self, uri: &str) -> Result<(), String> {
        self.send_notification("textDocument/didClose", serde_json::json!({
            "textDocument": { "uri": uri }
        }))
    }

    // --- Requests ---

    pub fn completion(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/completion", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col }
        }))
    }

    pub fn hover(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/hover", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col }
        }))
    }

    pub fn definition(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/definition", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col }
        }))
    }

    pub fn type_definition(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/typeDefinition", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col }
        }))
    }

    pub fn signature_help(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/signatureHelp", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col }
        }))
    }

    pub fn inlay_hint(&self, uri: &str, start_line: u32, start_col: u32, end_line: u32, end_col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/inlayHint", serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": start_line, "character": start_col },
                "end": { "line": end_line, "character": end_col }
            }
        }))
    }

    pub fn code_action(&self, uri: &str, start_line: u32, start_col: u32, end_line: u32, end_col: u32, diagnostics: &[serde_json::Value]) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/codeAction", serde_json::json!({
            "textDocument": { "uri": uri },
            "range": {
                "start": { "line": start_line, "character": start_col },
                "end": { "line": end_line, "character": end_col }
            },
            "context": {
                "diagnostics": diagnostics
            }
        }))
    }

    pub fn document_symbol(&self, uri: &str) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/documentSymbol", serde_json::json!({
            "textDocument": { "uri": uri }
        }))
    }

    pub fn rename(&self, uri: &str, line: u32, col: u32, new_name: &str) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/rename", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col },
            "newName": new_name
        }))
    }

    pub fn references(&self, uri: &str, line: u32, col: u32) -> Result<oneshot::Receiver<Value>, String> {
        self.send_request("textDocument/references", serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": col },
            "context": { "includeDeclaration": true }
        }))
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let _ = self.send_request("shutdown", Value::Null);
        self.send_notification("exit", Value::Null)
    }
}
