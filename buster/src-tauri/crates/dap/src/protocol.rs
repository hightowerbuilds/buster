use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A DAP request message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapRequest {
    pub seq: i64,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
}

/// A DAP response message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapResponse {
    pub request_seq: i64,
    pub success: bool,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

/// A DAP event message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapEvent {
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

/// Any DAP message (request, response, or event).
#[derive(Debug, Clone)]
pub enum DapMessage {
    Request(DapRequest),
    Response(DapResponse),
    Event(DapEvent),
}

impl DapMessage {
    /// Serialize to JSON with Content-Length header.
    pub fn to_wire(&self) -> Result<Vec<u8>, serde_json::Error> {
        let json = match self {
            DapMessage::Request(r) => serde_json::json!({
                "seq": r.seq,
                "type": "request",
                "command": r.command,
                "arguments": r.arguments,
            }),
            DapMessage::Response(r) => serde_json::json!({
                "seq": 0,
                "type": "response",
                "request_seq": r.request_seq,
                "success": r.success,
                "command": r.command,
                "message": r.message,
                "body": r.body,
            }),
            DapMessage::Event(e) => serde_json::json!({
                "seq": 0,
                "type": "event",
                "event": e.event,
                "body": e.body,
            }),
        };

        let body = serde_json::to_string(&json)?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut wire = Vec::with_capacity(header.len() + body.len());
        wire.extend_from_slice(header.as_bytes());
        wire.extend_from_slice(body.as_bytes());
        Ok(wire)
    }

    /// Parse from a JSON value.
    pub fn from_json(value: Value) -> Result<Self, serde_json::Error> {
        let msg_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match msg_type {
            "request" => Ok(DapMessage::Request(serde_json::from_value(value)?)),
            "response" => Ok(DapMessage::Response(serde_json::from_value(value)?)),
            "event" => Ok(DapMessage::Event(serde_json::from_value(value)?)),
            _ => Ok(DapMessage::Event(DapEvent {
                event: "unknown".into(),
                body: Some(value),
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_serialization() {
        let req = DapRequest {
            seq: 1,
            command: "initialize".into(),
            arguments: Some(serde_json::json!({"adapterID": "codelldb"})),
        };
        let wire = DapMessage::Request(req).to_wire().unwrap();
        let wire_str = String::from_utf8(wire).unwrap();
        assert!(wire_str.starts_with("Content-Length:"));
        assert!(wire_str.contains("initialize"));
    }

    #[test]
    fn test_event_parsing() {
        let json = serde_json::json!({
            "seq": 5,
            "type": "event",
            "event": "stopped",
            "body": {"reason": "breakpoint", "threadId": 1}
        });
        let msg = DapMessage::from_json(json).unwrap();
        match msg {
            DapMessage::Event(e) => {
                assert_eq!(e.event, "stopped");
                assert!(e.body.is_some());
            }
            _ => panic!("expected event"),
        }
    }

    #[test]
    fn test_response_parsing() {
        let json = serde_json::json!({
            "seq": 0,
            "type": "response",
            "request_seq": 1,
            "success": true,
            "command": "initialize",
            "body": {"supportsConfigurationDoneRequest": true}
        });
        let msg = DapMessage::from_json(json).unwrap();
        match msg {
            DapMessage::Response(r) => {
                assert!(r.success);
                assert_eq!(r.command, "initialize");
            }
            _ => panic!("expected response"),
        }
    }
}
