use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::LspError;

/// A unique identifier for a JSON-RPC request.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    String(String),
}

impl std::fmt::Display for RequestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RequestId::Number(n) => write!(f, "{}", n),
            RequestId::String(s) => write!(f, "{}", s),
        }
    }
}

/// An LSP message (request, response, or notification).
#[derive(Debug, Clone)]
pub enum LspMessage {
    /// A request from client to server (or server to client).
    Request {
        id: RequestId,
        method: String,
        params: Option<Value>,
    },
    /// A response to a request.
    Response {
        id: RequestId,
        result: Option<Value>,
        error: Option<ResponseError>,
    },
    /// A notification (no response expected).
    Notification {
        method: String,
        params: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseError {
    pub code: i32,
    pub message: String,
    pub data: Option<Value>,
}

impl LspMessage {
    /// Serialize this message to a JSON-RPC string with Content-Length header.
    pub fn to_wire(&self) -> Result<Vec<u8>, LspError> {
        let json = match self {
            LspMessage::Request { id, method, params } => {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "method": method,
                    "params": params,
                })
            }
            LspMessage::Response { id, result, error } => {
                let mut msg = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                });
                if let Some(r) = result {
                    msg["result"] = r.clone();
                }
                if let Some(e) = error {
                    msg["error"] = serde_json::to_value(e)?;
                }
                msg
            }
            LspMessage::Notification { method, params } => {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": method,
                    "params": params,
                })
            }
        };

        let body = serde_json::to_string(&json)?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());

        let mut wire = Vec::with_capacity(header.len() + body.len());
        wire.extend_from_slice(header.as_bytes());
        wire.extend_from_slice(body.as_bytes());
        Ok(wire)
    }

    /// Parse a JSON-RPC message from a JSON value (after Content-Length framing is stripped).
    pub fn from_json(value: Value) -> Result<Self, LspError> {
        let obj = value
            .as_object()
            .ok_or_else(|| LspError::Transport("expected JSON object".into()))?;

        // Has "id" → request or response
        if let Some(id_val) = obj.get("id") {
            let id = match id_val {
                Value::Number(n) => RequestId::Number(n.as_i64().unwrap_or(0)),
                Value::String(s) => RequestId::String(s.clone()),
                _ => return Err(LspError::Transport("invalid request id".into())),
            };

            // Has "method" → request; otherwise → response
            if let Some(method) = obj.get("method").and_then(|m| m.as_str()) {
                Ok(LspMessage::Request {
                    id,
                    method: method.to_string(),
                    params: obj.get("params").cloned(),
                })
            } else {
                Ok(LspMessage::Response {
                    id,
                    result: obj.get("result").cloned(),
                    error: obj
                        .get("error")
                        .map(|e| serde_json::from_value(e.clone()))
                        .transpose()?,
                })
            }
        } else {
            // No "id" → notification
            let method = obj
                .get("method")
                .and_then(|m| m.as_str())
                .ok_or_else(|| LspError::Transport("notification missing method".into()))?;

            Ok(LspMessage::Notification {
                method: method.to_string(),
                params: obj.get("params").cloned(),
            })
        }
    }
}

/// Parse the Content-Length header from a byte stream.
///
/// Returns the content length and the number of header bytes consumed.
pub fn parse_content_length(data: &[u8]) -> Option<(usize, usize)> {
    let header_str = std::str::from_utf8(data).ok()?;
    let header_end = header_str.find("\r\n\r\n")?;
    let header = &header_str[..header_end];

    for line in header.split("\r\n") {
        if let Some(value) = line.strip_prefix("Content-Length: ") {
            let len: usize = value.trim().parse().ok()?;
            return Some((len, header_end + 4));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_to_wire_and_back() {
        let msg = LspMessage::Request {
            id: RequestId::Number(1),
            method: "textDocument/completion".into(),
            params: Some(serde_json::json!({"textDocument": {"uri": "file:///test.ts"}})),
        };

        let wire = msg.to_wire().unwrap();
        let wire_str = String::from_utf8(wire).unwrap();

        assert!(wire_str.starts_with("Content-Length: "));
        assert!(wire_str.contains("textDocument/completion"));
    }

    #[test]
    fn test_parse_notification() {
        let json = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {}
        });

        let msg = LspMessage::from_json(json).unwrap();
        match msg {
            LspMessage::Notification { method, .. } => {
                assert_eq!(method, "textDocument/didOpen");
            }
            _ => panic!("expected notification"),
        }
    }

    #[test]
    fn test_parse_response() {
        let json = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} }
        });

        let msg = LspMessage::from_json(json).unwrap();
        match msg {
            LspMessage::Response { id, result, .. } => {
                assert_eq!(id, RequestId::Number(1));
                assert!(result.is_some());
            }
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn test_parse_content_length() {
        let data = b"Content-Length: 42\r\n\r\n{...}";
        let (len, consumed) = parse_content_length(data).unwrap();
        assert_eq!(len, 42);
        assert_eq!(consumed, 22); // "Content-Length: 42\r\n\r\n".len()
    }
}
