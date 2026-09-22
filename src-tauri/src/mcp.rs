//! A local MCP server that publishes BusterMark's command catalog.
//!
//! A connected assistant reaches this over loopback HTTP with a bearer token
//! minted for one app session. Tool calls are forwarded to the frontend, which
//! runs them through the same dispatcher the writer's controls use, so an
//! assistant cannot reach behaviour the UI does not already have.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

/// MCP clients may hold a connection open; keep request bodies bounded anyway.
const MAX_BODY: usize = 1024 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const PROTOCOL_VERSION: &str = "2024-11-05";

/// One catalog command, described for an assistant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    /// The catalog name, e.g. "panel split".
    pub command: String,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

/// MCP tool names allow no spaces, so the catalog name is underscored.
pub fn tool_name(command: &str) -> String {
    command.replace(' ', "_")
}

/// Recover the catalog name from a tool name the assistant called.
pub fn command_for(tools: &[McpTool], name: &str) -> Option<String> {
    tools
        .iter()
        .find(|tool| tool_name(&tool.command) == name)
        .map(|tool| tool.command.clone())
}

#[derive(Debug, Clone, Serialize)]
pub struct McpToolCall {
    pub call_id: String,
    pub command: String,
    pub args: Value,
}

/// The result the frontend returns for one forwarded tool call.
#[derive(Debug, Clone, Deserialize)]
pub struct McpToolResult {
    pub call_id: String,
    pub ok: bool,
    /// Serialized command result, or an error message when `ok` is false.
    pub payload: String,
}

#[derive(Default)]
struct Pending {
    waiting: HashMap<String, oneshot::Sender<McpToolResult>>,
    next_id: u64,
}

#[derive(Default)]
pub struct McpState {
    inner: Mutex<Option<Running>>,
    tools: Mutex<Vec<McpTool>>,
    pending: Mutex<Pending>,
}

struct Running {
    url: String,
    token: String,
    shutdown: Option<oneshot::Sender<()>>,
}

/// Where a connected assistant should point, and the secret it must present.
#[derive(Debug, Clone, Serialize)]
pub struct McpEndpoint {
    pub url: String,
    pub token: String,
}

impl McpState {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn replace_tools(&self, tools: Vec<McpTool>) {
        *self.tools.lock().await = tools;
    }

    pub async fn tools(&self) -> Vec<McpTool> {
        self.tools.lock().await.clone()
    }

    pub async fn endpoint(&self) -> Option<McpEndpoint> {
        self.inner.lock().await.as_ref().map(|running| McpEndpoint {
            url: running.url.clone(),
            token: running.token.clone(),
        })
    }

    async fn register_call(&self) -> (String, oneshot::Receiver<McpToolResult>) {
        let mut pending = self.pending.lock().await;
        pending.next_id += 1;
        let id = format!("mcp-{}", pending.next_id);
        let (tx, rx) = oneshot::channel();
        pending.waiting.insert(id.clone(), tx);
        (id, rx)
    }

    /// Hand a frontend result to whichever call is waiting for it.
    pub async fn complete_call(&self, result: McpToolResult) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .await
            .waiting
            .remove(&result.call_id)
            .ok_or("No assistant tool call is waiting for that result")?;
        sender
            .send(result)
            .map_err(|_| "The assistant tool call is no longer waiting".to_string())
    }

    async fn forget_call(&self, call_id: &str) {
        self.pending.lock().await.waiting.remove(call_id);
    }
}

fn random_token() -> String {
    // Two UUIDs give 256 bits from the OS random source.
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Start the loopback MCP server, or return the running endpoint.
pub async fn start(app: AppHandle, state: Arc<McpState>) -> Result<McpEndpoint, String> {
    if let Some(endpoint) = state.endpoint().await {
        return Ok(endpoint);
    }

    // Port 0 asks the OS for a free port; loopback keeps it off the network.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not start the assistant tool server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read the tool server address: {e}"))?
        .port();

    let token = random_token();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

    {
        let mut inner = state.inner.lock().await;
        *inner = Some(Running {
            url: url.clone(),
            token: token.clone(),
            shutdown: Some(shutdown_tx),
        });
    }

    let serve_state = state.clone();
    let serve_token = token.clone();
    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                biased;
                _ = &mut shutdown_rx => break,
                accepted = listener.accept() => accepted,
            };
            let Ok((stream, _)) = accepted else { continue };
            let conn_state = serve_state.clone();
            let conn_token = serve_token.clone();
            let conn_app = app.clone();
            tokio::spawn(async move {
                let _ = serve_connection(stream, conn_app, conn_state, conn_token).await;
            });
        }
    });

    Ok(McpEndpoint { url, token })
}

pub async fn stop(state: &McpState) {
    if let Some(mut running) = state.inner.lock().await.take() {
        if let Some(shutdown) = running.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

/// Split an HTTP/1.1 request into its headers and body.
pub fn parse_request(raw: &str) -> Option<(String, HashMap<String, String>, usize)> {
    let (head, _) = raw.split_once("\r\n\r\n")?;
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?.to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let length = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    Some((request_line, headers, length))
}

/// True when the request carries exactly the session's bearer token.
pub fn authorized(headers: &HashMap<String, String>, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|presented| presented == token)
}

fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn serve_connection(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    state: Arc<McpState>,
    token: String,
) -> Result<(), String> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];

    // Read until the headers are complete, then until the body is complete.
    let (request_line, headers, length) = loop {
        let read = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(());
        }
        raw.extend_from_slice(&buf[..read]);
        if raw.len() > MAX_BODY {
            let _ = stream
                .write_all(http_response("413 Payload Too Large", "{}").as_bytes())
                .await;
            return Ok(());
        }
        let text = String::from_utf8_lossy(&raw).to_string();
        if let Some(parsed) = parse_request(&text) {
            break parsed;
        }
    };

    let header_end = String::from_utf8_lossy(&raw)
        .find("\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(raw.len());
    while raw.len() < header_end + length {
        let read = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..read]);
        if raw.len() > MAX_BODY {
            let _ = stream
                .write_all(http_response("413 Payload Too Large", "{}").as_bytes())
                .await;
            return Ok(());
        }
    }

    if !authorized(&headers, &token) {
        let _ = stream
            .write_all(http_response("401 Unauthorized", r#"{"error":"unauthorized"}"#).as_bytes())
            .await;
        return Ok(());
    }

    if !request_line.starts_with("POST") {
        let _ = stream
            .write_all(http_response("405 Method Not Allowed", "{}").as_bytes())
            .await;
        return Ok(());
    }

    let body = String::from_utf8_lossy(&raw[header_end.min(raw.len())..]).to_string();
    let response = match serde_json::from_str::<Value>(&body) {
        Ok(message) => handle_message(&app, &state, message).await,
        Err(_) => Some(json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": { "code": -32700, "message": "Parse error" }
        })),
    };

    // Notifications have no reply; MCP expects 202 with an empty body.
    let payload = match response {
        Some(value) => http_response("200 OK", &value.to_string()),
        None => http_response("202 Accepted", "{}"),
    };
    let _ = stream.write_all(payload.as_bytes()).await;
    let _ = stream.flush().await;
    Ok(())
}

/// Handle one JSON-RPC message. Returns None for notifications.
async fn handle_message(app: &AppHandle, state: &Arc<McpState>, message: Value) -> Option<Value> {
    let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
    // A message without an id is a notification; acknowledge without replying.
    let id = message.get("id").cloned()?;

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": true } },
            "serverInfo": { "name": "bustermark", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            let tools = state.tools().await;
            Ok(json!({
                "tools": tools.iter().map(|tool| json!({
                    "name": tool_name(&tool.command),
                    "description": tool.description,
                    "inputSchema": if tool.input_schema.is_null() {
                        json!({ "type": "object" })
                    } else {
                        tool.input_schema.clone()
                    },
                })).collect::<Vec<_>>()
            }))
        }
        "tools/call" => call_tool(app, state, &message).await,
        other => Err(format!("Unsupported method: {other}")),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err(message) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32603, "message": message }
        }),
    })
}

async fn call_tool(app: &AppHandle, state: &Arc<McpState>, message: &Value) -> Result<Value, String> {
    let params = message.get("params").ok_or("Missing tool call parameters")?;
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("Missing tool name")?;
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    let tools = state.tools().await;
    let command = command_for(&tools, name).ok_or_else(|| format!("Unknown tool: {name}"))?;

    let (call_id, receiver) = state.register_call().await;
    app.emit(
        "mcp-tool-call",
        McpToolCall {
            call_id: call_id.clone(),
            command,
            args,
        },
    )
    .map_err(|e| format!("Could not reach the writing app: {e}"))?;

    let outcome = tokio::time::timeout(CALL_TIMEOUT, receiver).await;
    match outcome {
        Ok(Ok(result)) => Ok(json!({
            "content": [{ "type": "text", "text": result.payload }],
            "isError": !result.ok,
        })),
        Ok(Err(_)) => {
            state.forget_call(&call_id).await;
            Err("The writing app stopped before answering".into())
        }
        Err(_) => {
            state.forget_call(&call_id).await;
            Err("The writing app did not answer in time".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<McpTool> {
        vec![
            McpTool {
                command: "panel split".into(),
                description: "Split a pane".into(),
                input_schema: json!({ "type": "object" }),
            },
            McpTool {
                command: "document list".into(),
                description: "List notes".into(),
                input_schema: Value::Null,
            },
        ]
    }

    #[test]
    fn maps_catalog_names_to_tool_names_and_back() {
        assert_eq!(tool_name("panel split"), "panel_split");
        assert_eq!(tool_name("appearance preview cancel"), "appearance_preview_cancel");

        let catalog = tools();
        assert_eq!(command_for(&catalog, "panel_split").as_deref(), Some("panel split"));
        assert_eq!(command_for(&catalog, "document_list").as_deref(), Some("document list"));
        assert_eq!(command_for(&catalog, "not_a_tool"), None);
        // A raw catalog name is not a valid tool name, so it must not resolve.
        assert_eq!(command_for(&catalog, "panel split"), None);
    }

    #[test]
    fn requires_the_session_bearer_token() {
        let mut headers = HashMap::new();
        assert!(!authorized(&headers, "secret"), "missing header must be refused");

        headers.insert("authorization".into(), "Bearer secret".into());
        assert!(authorized(&headers, "secret"));

        headers.insert("authorization".into(), "Bearer wrong".into());
        assert!(!authorized(&headers, "secret"));

        headers.insert("authorization".into(), "secret".into());
        assert!(!authorized(&headers, "secret"), "bare token must be refused");
    }

    #[test]
    fn parses_http_requests_and_waits_for_a_full_body() {
        assert!(parse_request("POST /mcp HTTP/1.1\r\nHost: x\r\n").is_none());

        let raw = "POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 7\r\nAuthorization: Bearer t\r\n\r\n{\"a\":1}";
        let (line, headers, length) = parse_request(raw).expect("complete request parses");
        assert_eq!(line, "POST /mcp HTTP/1.1");
        assert_eq!(length, 7);
        assert_eq!(headers.get("authorization").map(String::as_str), Some("Bearer t"));
        // Header names are matched case-insensitively.
        assert!(headers.contains_key("content-length"));
    }

    #[test]
    fn mints_distinct_session_tokens() {
        let first = random_token();
        assert_eq!(first.len(), 64);
        assert_ne!(first, random_token());
    }
}
