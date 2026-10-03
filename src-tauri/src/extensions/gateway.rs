use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

static NEXT_CONN_ID: AtomicU32 = AtomicU32::new(1);

/// Transport-agnostic gateway configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// "websocket" or "http-sse"
    pub protocol: String,
    /// Full URL (ws://... or http://...)
    pub url: String,
    #[serde(default)]
    pub auth_token: Option<String>,
    #[serde(default)]
    pub auth_header: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

/// Normalized event from any gateway transport.
#[derive(Debug, Clone, Serialize)]
pub struct GatewayEvent {
    pub connection_id: u32,
    pub extension_id: String,
    /// "connected", "text", "tool_call", "tool_result", "done", "error", "disconnected"
    pub kind: String,
    pub content: String,
    pub tool_name: Option<String>,
}

type WebSocketWriter = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, Message>;

/// Handle for an active gateway connection.
pub struct GatewayConnection {
    pub id: u32,
    pub extension_id: String,
    pub protocol: String,
    ws_write: Option<Arc<Mutex<WebSocketWriter>>>,
    sse_cancel: Option<tokio::sync::watch::Sender<bool>>,
}

impl GatewayConnection {
    /// Send a message through the connection.
    pub async fn send(&self, message: &str) -> Result<(), String> {
        match self.protocol.as_str() {
            "websocket" => {
                let write = self.ws_write.as_ref().ok_or("WebSocket not connected")?;
                write
                    .lock()
                    .await
                    .send(Message::Text(message.to_string()))
                    .await
                    .map_err(|e| format!("WebSocket send failed: {}", e))
            }
            "http-sse" => {
                // For HTTP SSE, "send" means POST to the endpoint
                // The SSE stream is receive-only; messages are sent via HTTP POST
                Err("HTTP SSE send not implemented yet — use ext_call for request/response".into())
            }
            _ => Err(format!("Unknown protocol: {}", self.protocol)),
        }
    }

    /// Disconnect the gateway.
    pub async fn disconnect(&mut self) {
        if let Some(write) = self.ws_write.take() {
            let _ = write.lock().await.close().await;
        }
        if let Some(cancel) = self.sse_cancel.take() {
            let _ = cancel.send(true);
        }
    }
}

/// Manages all active gateway connections across extensions.
pub struct GatewayManager {
    connections: Arc<Mutex<HashMap<u32, GatewayConnection>>>,
}

impl GatewayManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Open a gateway connection. Returns the connection ID.
    pub async fn connect(
        &self,
        extension_id: &str,
        config: &GatewayConfig,
        on_event: impl Fn(GatewayEvent) + Send + Sync + 'static,
    ) -> Result<u32, String> {
        let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
        let ext_id = extension_id.to_string();

        match config.protocol.as_str() {
            "websocket" => {
                self.connect_websocket(conn_id, &ext_id, config, on_event)
                    .await?;
            }
            "http-sse" => {
                self.connect_sse(conn_id, &ext_id, config, on_event).await?;
            }
            other => return Err(format!("Unsupported protocol: {}", other)),
        }

        Ok(conn_id)
    }

    async fn connect_websocket(
        &self,
        conn_id: u32,
        extension_id: &str,
        config: &GatewayConfig,
        on_event: impl Fn(GatewayEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let (ws_stream, _) = connect_async(&config.url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(write));

        let conn = GatewayConnection {
            id: conn_id,
            extension_id: extension_id.to_string(),
            protocol: "websocket".to_string(),
            ws_write: Some(write),
            sse_cancel: None,
        };

        self.connections.lock().await.insert(conn_id, conn);

        let ext_id = extension_id.to_string();
        let on_event = Arc::new(on_event);
        let connections = self.connections.clone();

        on_event(GatewayEvent {
            connection_id: conn_id,
            extension_id: ext_id.clone(),
            kind: "connected".to_string(),
            content: format!("Connected via WebSocket to {}", config.url),
            tool_name: None,
        });

        // Spawn reader
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        // Try to parse as a structured agent event
                        let event = parse_agent_event(conn_id, &ext_id, &text);
                        on_event(event);
                    }
                    Ok(Message::Close(_)) => {
                        on_event(GatewayEvent {
                            connection_id: conn_id,
                            extension_id: ext_id.clone(),
                            kind: "disconnected".to_string(),
                            content: "Connection closed".to_string(),
                            tool_name: None,
                        });
                        break;
                    }
                    Err(e) => {
                        on_event(GatewayEvent {
                            connection_id: conn_id,
                            extension_id: ext_id.clone(),
                            kind: "error".to_string(),
                            content: format!("WebSocket error: {}", e),
                            tool_name: None,
                        });
                        break;
                    }
                    _ => {}
                }
            }
            connections.lock().await.remove(&conn_id);
        });

        Ok(())
    }

    async fn connect_sse(
        &self,
        conn_id: u32,
        extension_id: &str,
        config: &GatewayConfig,
        on_event: impl Fn(GatewayEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let mut req = reqwest::Client::new().get(&config.url);

        // Add auth header
        if let Some(token) = &config.auth_token {
            let header_name = config
                .auth_header
                .as_deref()
                .unwrap_or("Authorization");
            let value = if header_name == "Authorization" {
                format!("Bearer {}", token)
            } else {
                token.clone()
            };
            req = req.header(header_name, value);
        }

        // Add custom headers
        for (k, v) in &config.headers {
            req = req.header(k.as_str(), v.as_str());
        }

        req = req.header("Accept", "text/event-stream");

        let response = req
            .send()
            .await
            .map_err(|e| format!("SSE connect failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("SSE connect returned {}", response.status()));
        }

        let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

        let conn = GatewayConnection {
            id: conn_id,
            extension_id: extension_id.to_string(),
            protocol: "http-sse".to_string(),
            ws_write: None,
            sse_cancel: Some(cancel_tx),
        };

        self.connections.lock().await.insert(conn_id, conn);

        let ext_id = extension_id.to_string();
        let on_event = Arc::new(on_event);
        let connections = self.connections.clone();

        on_event(GatewayEvent {
            connection_id: conn_id,
            extension_id: ext_id.clone(),
            kind: "connected".to_string(),
            content: format!("Connected via SSE to {}", config.url),
            tool_name: None,
        });

        // Spawn SSE reader
        tokio::spawn(async move {
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() { break; }
                    }
                    chunk = stream.next() => {
                        match chunk {
                            Some(Ok(bytes)) => {
                                buffer.push_str(&String::from_utf8_lossy(&bytes));
                                // Process complete SSE events (double newline delimited)
                                while let Some(pos) = buffer.find("\n\n") {
                                    let event_text = buffer[..pos].to_string();
                                    buffer = buffer[pos + 2..].to_string();

                                    // Parse SSE data lines
                                    let data = extract_sse_data(&event_text);
                                    if !data.is_empty() {
                                        let event = parse_agent_event(conn_id, &ext_id, &data);
                                        on_event(event);
                                    }
                                }
                            }
                            Some(Err(e)) => {
                                on_event(GatewayEvent {
                                    connection_id: conn_id,
                                    extension_id: ext_id.clone(),
                                    kind: "error".to_string(),
                                    content: format!("SSE error: {}", e),
                                    tool_name: None,
                                });
                                break;
                            }
                            None => {
                                on_event(GatewayEvent {
                                    connection_id: conn_id,
                                    extension_id: ext_id.clone(),
                                    kind: "disconnected".to_string(),
                                    content: "SSE stream ended".to_string(),
                                    tool_name: None,
                                });
                                break;
                            }
                        }
                    }
                }
            }
            connections.lock().await.remove(&conn_id);
        });

        Ok(())
    }

    /// Send a message on an existing connection.
    pub async fn send(&self, connection_id: u32, message: &str) -> Result<(), String> {
        let conns = self.connections.lock().await;
        let conn = conns
            .get(&connection_id)
            .ok_or("Connection not found")?;
        conn.send(message).await
    }

    /// Disconnect a gateway connection.
    pub async fn disconnect(&self, connection_id: u32) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if let Some(mut conn) = conns.remove(&connection_id) {
            conn.disconnect().await;
            Ok(())
        } else {
            Err("Connection not found".into())
        }
    }

    /// Disconnect all connections for an extension.
    pub async fn disconnect_all(&self, extension_id: &str) {
        let mut conns = self.connections.lock().await;
        let ids: Vec<u32> = conns
            .iter()
            .filter(|(_, c)| c.extension_id == extension_id)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            if let Some(mut conn) = conns.remove(&id) {
                conn.disconnect().await;
            }
        }
    }
}

/// Extract data from SSE event text.
/// SSE format: "data: {json}\n" lines, possibly with "event:" prefix.
fn extract_sse_data(event_text: &str) -> String {
    let mut data_parts = Vec::new();
    for line in event_text.lines() {
        if let Some(d) = line.strip_prefix("data: ") {
            if d != "[DONE]" {
                data_parts.push(d);
            }
        } else if let Some(d) = line.strip_prefix("data:") {
            if d != "[DONE]" {
                data_parts.push(d);
            }
        }
    }
    data_parts.join("\n")
}

/// Parse a raw message into a normalized GatewayEvent.
/// Supports both ZeroClaw protocol and OpenAI-compatible SSE (Hermes).
fn parse_agent_event(conn_id: u32, extension_id: &str, raw: &str) -> GatewayEvent {
    let make = |kind: &str, content: &str, tool: Option<&str>| GatewayEvent {
        connection_id: conn_id,
        extension_id: extension_id.to_string(),
        kind: kind.to_string(),
        content: content.to_string(),
        tool_name: tool.map(String::from),
    };

    // Try JSON parse
    let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) else {
        // Plain text — treat as text chunk
        return make("text", raw, None);
    };

    // --- ZeroClaw protocol ---
    if let Some(kind) = json.get("type").and_then(|v| v.as_str()) {
        return match kind {
            "chunk" => {
                let data = json["data"].as_str().unwrap_or("");
                make("text", data, None)
            }
            "tool_call" => {
                let name = json["name"].as_str().unwrap_or("");
                let input = json["input"].to_string();
                make("tool_call", &format!("{}({})", name, input), Some(name))
            }
            "tool_result" => {
                let name = json["name"].as_str().unwrap_or("");
                let output = json["output"].as_str().unwrap_or("");
                let display = if output.len() > 500 {
                    format!("{}...", &output[..500])
                } else {
                    output.to_string()
                };
                make("tool_result", &display, Some(name))
            }
            "done" => make("done", "", None),
            "error" => {
                let msg = json["message"].as_str().unwrap_or("Unknown error");
                make("error", msg, None)
            }
            _ => make("text", raw, None),
        };
    }

    // --- OpenAI-compatible SSE (Hermes, etc.) ---
    if let Some(choices) = json.get("choices").and_then(|v| v.as_array()) {
        if let Some(choice) = choices.first() {
            // Streaming delta
            if let Some(delta) = choice.get("delta") {
                // Tool calls
                if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                    if let Some(tc) = tool_calls.first() {
                        let name = tc
                            .get("function")
                            .and_then(|f| f.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let args = tc
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        return make("tool_call", args, Some(name));
                    }
                }
                // Content
                if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                    return make("text", content, None);
                }
            }
            // Finish reason
            if let Some(reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                if reason == "stop" || reason == "end_turn" {
                    return make("done", "", None);
                }
            }
        }
        return make("text", "", None);
    }

    // --- Agent Communication Protocol (ACP) ---
    if let Some(status) = json.get("status").and_then(|v| v.as_str()) {
        return match status {
            "completed" | "done" => make("done", "", None),
            "failed" => {
                let msg = json
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Task failed");
                make("error", msg, None)
            }
            _ => make("text", raw, None),
        };
    }

    // Unknown format — pass through as text
    make("text", raw, None)
}
