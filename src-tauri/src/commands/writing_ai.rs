//! Explicit, selection-only writing requests. Never shares completion cancellation or context.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::watch;

const MAX_TEXT: usize = 32 * 1024;
const MAX_OUTPUT: usize = 64 * 1024;
const MAX_FRAME: usize = 256 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingRequest {
    request_id: String,
    provider: String,
    model: String,
    instruction: String,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritingToken<'a> {
    request_id: &'a str,
    token: &'a str,
}

#[derive(Default)]
pub struct WritingAiState {
    requests: Mutex<RequestRegistry>,
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, watch::Sender<bool>>,
    // Handles cancellation arriving before the request command is scheduled.
    cancelled: HashMap<String, Instant>,
}

impl RequestRegistry {
    fn start(&mut self, id: &str) -> Result<watch::Receiver<bool>, String> {
        self.cancelled
            .retain(|_, at| at.elapsed() < REQUEST_TIMEOUT);
        if self.cancelled.contains_key(id) {
            return Err("Writing request cancelled".into());
        }
        if self.active.contains_key(id) {
            return Err("Writing request ID is already active".into());
        }
        if self.active.len() >= 4 {
            return Err("Four writing requests are already running".into());
        }
        let (tx, rx) = watch::channel(false);
        self.active.insert(id.to_owned(), tx);
        Ok(rx)
    }

    fn cancel(&mut self, id: &str) {
        if let Some(tx) = self.active.get(id) {
            let _ = tx.send(true);
        }
        self.cancelled
            .retain(|_, at| at.elapsed() < REQUEST_TIMEOUT);
        if self.cancelled.len() < 256 {
            self.cancelled.insert(id.to_owned(), Instant::now());
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}

fn validate(request: &WritingRequest, configured_provider: &str) -> Result<(), String> {
    if !valid_id(&request.request_id) {
        return Err("Invalid writing request ID".into());
    }
    if !matches!(request.provider.as_str(), "ollama" | "anthropic" | "openai") {
        return Err("Unsupported writing provider".into());
    }
    if request.provider != configured_provider {
        return Err(
            "Writing provider changed. Select the configured provider and try again.".into(),
        );
    }
    if request.model.trim().is_empty()
        || request.model.len() > 200
        || request.model.chars().any(char::is_control)
    {
        return Err("Choose a valid writing model in AI settings".into());
    }
    if request.text.trim().is_empty() || request.text.len() > MAX_TEXT {
        return Err("Select nonempty text up to 32 KiB for a writing request".into());
    }
    if request.instruction.trim().is_empty() || request.instruction.len() > 4096 {
        return Err("Writing instructions must contain between 1 and 4096 bytes".into());
    }
    Ok(())
}

#[command]
pub async fn writing_ai_generate(
    app: AppHandle,
    state: State<'_, WritingAiState>,
    request: WritingRequest,
) -> Result<String, String> {
    let settings = super::settings::load_settings(app.clone());
    validate(&request, &settings.ai_provider)?;
    let mut cancelled = state
        .requests
        .lock()
        .map_err(|_| "Writing request state unavailable")?
        .start(&request.request_id)?;
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => Err("Writing request cancelled".into()),
        result = tokio::time::timeout(REQUEST_TIMEOUT, generate(&app, &settings, &request)) => {
            result.unwrap_or_else(|_| Err("Writing request timed out after 120 seconds".into()))
        }
    };
    if let Ok(mut registry) = state.requests.lock() {
        registry.active.remove(&request.request_id);
    }
    result
}

#[command]
pub fn writing_ai_cancel(
    state: State<'_, WritingAiState>,
    request_id: String,
) -> Result<(), String> {
    if !valid_id(&request_id) {
        return Err("Invalid writing request ID".into());
    }
    state
        .requests
        .lock()
        .map_err(|_| "Writing request state unavailable")?
        .cancel(&request_id);
    Ok(())
}

fn request_body(request: &WritingRequest) -> Value {
    // Only these two explicit inputs enter the model context. No paths, notes, terminal or history.
    let messages = json!([
        {"role": "system", "content": request.instruction},
        {"role": "user", "content": request.text}
    ]);
    match request.provider.as_str() {
        "ollama" => {
            json!({"model":request.model, "messages":messages, "stream":true, "options":{"num_predict":2048}})
        }
        "anthropic" => {
            json!({"model":request.model, "system":request.instruction, "messages":[{"role":"user", "content":request.text}], "stream":true, "max_tokens":2048})
        }
        _ => {
            json!({"model":request.model, "messages":messages, "stream":true, "max_completion_tokens":2048, "store":false})
        }
    }
}

async fn generate(
    app: &AppHandle,
    settings: &super::settings::AppSettings,
    request: &WritingRequest,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize writing connection")?;
    let mut outgoing = match request.provider.as_str() {
        "ollama" => {
            let base = settings.ai_ollama_url.trim_end_matches('/');
            let url = url::Url::parse(&format!("{base}/api/chat"))
                .map_err(|_| "Invalid Ollama address in AI settings")?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(
                    "Ollama address must use HTTP or HTTPS without embedded credentials".into(),
                );
            }
            client.post(url)
        }
        "anthropic" => client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &settings.ai_api_key)
            .header("anthropic-version", "2023-06-01"),
        _ => client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&settings.ai_api_key),
    };
    if request.provider != "ollama" && settings.ai_api_key.trim().is_empty() {
        return Err("API key is missing. Configure this provider in AI settings.".into());
    }
    outgoing = outgoing.json(&request_body(request));
    let response = outgoing.send().await.map_err(|_| {
        "Could not connect to writing provider. Check its address, connection and availability."
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "Writing provider returned HTTP {}. Check your model, credentials and provider limits.",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut decoder = StreamDecoder::new(&request.provider);
    let mut output = String::new();
    let mut wire_len = 0;
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(30), stream.next())
        .await
        .map_err(|_| "Writing provider stopped responding for 30 seconds")?
    {
        let chunk = chunk
            .map_err(|_| "Writing connection interrupted; partial output has not been applied")?;
        wire_len += chunk.len();
        if wire_len > 2 * 1024 * 1024 {
            return Err("Writing response exceeded its data limit".into());
        }
        for (token, done) in decoder.push(&chunk)? {
            if output.len() + token.len() > MAX_OUTPUT {
                return Err("Writing output exceeded 64 KiB; use a shorter selection".into());
            }
            if !token.is_empty() {
                output.push_str(&token);
                app.emit(
                    "writing-ai-token",
                    WritingToken {
                        request_id: &request.request_id,
                        token: &token,
                    },
                )
                .map_err(|_| "Could not deliver writing output")?;
            }
            if done {
                return if output.is_empty() {
                    Err("Writing provider returned no text".into())
                } else {
                    Ok(output)
                };
            }
        }
    }
    Err("Writing stream ended before completion; partial output has not been applied".into())
}

/// Byte buffering preserves Unicode split across network chunks. SSE CRLF and multi-line data
/// fields are framed before JSON parsing; Ollama uses one JSON object per line.
struct StreamDecoder {
    provider: String,
    pending: Vec<u8>,
    data: String,
}
impl StreamDecoder {
    fn new(provider: &str) -> Self {
        Self {
            provider: provider.into(),
            pending: Vec::new(),
            data: String::new(),
        }
    }
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<(String, bool)>, String> {
        self.pending.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            if end > MAX_FRAME {
                return Err("Writing stream frame exceeded its limit".into());
            }
            let raw: Vec<u8> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&raw)
                .map_err(|_| "Writing provider sent invalid UTF-8")?
                .trim_end_matches(['\r', '\n']);
            if self.provider == "ollama" {
                if !line.is_empty() {
                    events.push(parse_data(&self.provider, line)?);
                }
            } else if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(parse_data(
                        &self.provider,
                        self.data.trim_end_matches('\n'),
                    )?);
                    self.data.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                self.data.push('\n');
            }
            if self.data.len() > MAX_FRAME {
                return Err("Writing stream frame exceeded its limit".into());
            }
        }
        if self.pending.len() > MAX_FRAME {
            return Err("Writing stream frame exceeded its limit".into());
        }
        Ok(events)
    }
}

fn parse_data(provider: &str, data: &str) -> Result<(String, bool), String> {
    if provider == "openai" && data == "[DONE]" {
        return Ok((String::new(), true));
    }
    let value: Value =
        serde_json::from_str(data).map_err(|_| "Writing provider sent malformed stream data")?;
    if value.get("error").is_some() || value["type"] == "error" {
        return Err("Writing provider reported an error. Check your model, credentials and provider limits.".into());
    }
    let (token, done, reason) = match provider {
        "ollama" => (
            value["message"]["content"].as_str(),
            value["done"].as_bool().unwrap_or(false),
            value["done_reason"].as_str(),
        ),
        "anthropic" => (
            if value["delta"]["type"] == "text_delta" {
                value["delta"]["text"].as_str()
            } else {
                None
            },
            value["type"] == "message_stop",
            value["delta"]["stop_reason"].as_str(),
        ),
        _ => {
            let choice = &value["choices"][0];
            if choice["delta"]["refusal"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            {
                return Err("The writing provider declined this request".into());
            }
            (
                choice["delta"]["content"].as_str(),
                choice["finish_reason"] == "stop",
                choice["finish_reason"].as_str(),
            )
        }
    };
    if let Some(reason) = reason {
        if !matches!(reason, "stop" | "end_turn" | "stop_sequence") {
            return Err("Writing provider stopped before a complete text response; try a shorter selection or different model.".into());
        }
    }
    Ok((token.unwrap_or_default().to_owned(), done))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(provider: &str) -> WritingRequest {
        WritingRequest {
            request_id: "writing-1".into(),
            provider: provider.into(),
            model: "my-model".into(),
            instruction: "Rewrite clearly".into(),
            text: "Only selected text".into(),
        }
    }
    #[test]
    fn validates_explicit_context_and_provider() {
        let mut r = request("ollama");
        assert!(validate(&r, "ollama").is_ok());
        assert!(validate(&r, "openai").is_err());
        r.text = "x".repeat(MAX_TEXT + 1);
        assert!(validate(&r, "ollama").is_err());
        r.text = "selected".into();
        r.instruction.clear();
        assert!(validate(&r, "ollama").is_err());
    }
    #[test]
    fn bodies_include_only_explicit_instruction_and_selection() {
        for provider in ["ollama", "anthropic", "openai"] {
            let body = request_body(&request(provider));
            assert_eq!(body["model"], "my-model");
            let messages = body["messages"].as_array().unwrap();
            assert_eq!(messages.last().unwrap()["content"], "Only selected text");
            assert_eq!(messages.len(), if provider == "anthropic" { 1 } else { 2 });
            assert!(body.get("tools").is_none());
        }
    }
    #[test]
    fn independent_cancellation_and_early_cancel() {
        let mut state = RequestRegistry::default();
        let a = state.start("a").unwrap();
        let b = state.start("b").unwrap();
        assert!(state.start("a").is_err());
        state.cancel("a");
        assert!(*a.borrow());
        assert!(!*b.borrow());
        state.cancel("early");
        assert!(state.start("early").is_err());
        state.start("c").unwrap();
        state.start("d").unwrap();
        assert!(state.start("e").is_err());
    }
    #[test]
    fn sse_preserves_fragmented_unicode_and_crlf() {
        let stream = "event: content_block_delta\r\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"café 📝\"}}\r\n\r\ndata:{\"type\":\"message_stop\"}\r\n\r\n";
        let mut decoder = StreamDecoder::new("anthropic");
        let mut result = Vec::new();
        for byte in stream.as_bytes() {
            result.extend(decoder.push(&[*byte]).unwrap());
        }
        assert_eq!(result, vec![("café 📝".into(), false), ("".into(), true)]);
    }
    #[test]
    fn handles_ollama_and_openai_completion() {
        let mut d = StreamDecoder::new("ollama");
        assert_eq!(d.push(b"{\"message\":{\"content\":\"hello\"},\"done\":false}\n{\"done\":true,\"done_reason\":\"stop\"}\n").unwrap(), vec![("hello".into(), false), ("".into(), true)]);
        let mut d = StreamDecoder::new("openai");
        assert_eq!(
            d.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n")
                .unwrap(),
            vec![("Hi".into(), false), ("".into(), true)]
        );
    }
    #[test]
    fn rejects_truncated_refused_malformed_and_oversized_streams() {
        assert!(parse_data("openai", r#"{"choices":[{"finish_reason":"length"}]}"#).is_err());
        assert!(parse_data("anthropic", r#"{"delta":{"stop_reason":"max_tokens"}}"#).is_err());
        assert!(parse_data("ollama", r#"{"error":"secret echo"}"#)
            .unwrap_err()
            .find("secret echo")
            .is_none());
        assert!(parse_data("openai", r#"{"choices":[{"delta":{"refusal":"No"}}]}"#).is_err());
        assert!(parse_data("openai", "invalid").is_err());
        assert!(StreamDecoder::new("ollama")
            .push(&vec![b'x'; MAX_FRAME + 1])
            .is_err());
    }
}
