//! Local models through Ollama for the Language Model sidebar. The frontend runs the tool loop; this
//! module lists installed models and streams one `/api/chat` turn (with tools) at a time.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::watch;

const TURN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
// Loading a model into memory can take a while before the first token.
const IDLE_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_LINE: usize = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
/// Room for the system prompt, the tool list and a conversation; Ollama's default is smaller.
const CONTEXT_TOKENS: u32 = 16_384;

#[derive(Default)]
pub struct LocalModelState {
    active: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    name: String,
    family: Option<String>,
    parameter_size: Option<String>,
    size_bytes: u64,
    tools: bool,
    thinking: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModels {
    base_url: String,
    version: Option<String>,
    models: Vec<LocalModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalChatRequest {
    request_id: String,
    model: String,
    messages: Vec<Value>,
    tools: Vec<Value>,
    think: bool,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalChatResult {
    content: String,
    thinking: String,
    tool_calls: Vec<Value>,
    done_reason: Option<String>,
    prompt_tokens: u64,
    output_tokens: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 200 && !model.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// The configured Ollama address, refusing anything but plain HTTP(S) without embedded credentials.
async fn base_url(app: &AppHandle) -> Result<url::Url, String> {
    let settings = super::settings::load_settings(app.clone()).await;
    let raw = settings.ai_ollama_url.trim().trim_end_matches('/');
    let url = url::Url::parse(if raw.is_empty() { "http://localhost:11434" } else { raw })
        .map_err(|_| "The Ollama address in AI settings is not a valid URL.")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("The Ollama address must use HTTP or HTTPS without embedded credentials.".into());
    }
    Ok(url)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the Ollama connection".to_string())
}

fn unreachable(base: &url::Url) -> String {
    format!("Ollama is not running at {base}. Start it (for example `ollama serve`) and check again.")
}

/// Installed models with their tool and thinking support, from `/api/tags` and `/api/show`.
#[command]
pub async fn local_models(app: AppHandle) -> Result<LocalModels, String> {
    let base = base_url(&app).await?;
    let client = client()?;
    let get = |path: &str| client.get(base.join(path).expect("static path")).timeout(Duration::from_secs(10)).send();
    let version = match get("api/version").await {
        Ok(response) => response.json::<Value>().await.ok().and_then(|v| v["version"].as_str().map(str::to_owned)),
        Err(_) => return Err(unreachable(&base)),
    };
    let tags: Value = get("api/tags").await.map_err(|_| unreachable(&base))?
        .json().await.map_err(|_| "Ollama sent an unreadable model list")?;
    let mut models = Vec::new();
    for entry in tags["models"].as_array().into_iter().flatten() {
        let Some(name) = entry["name"].as_str() else { continue };
        let show: Value = match client.post(base.join("api/show").expect("static path"))
            .json(&json!({"model": name})).timeout(Duration::from_secs(10)).send().await
        {
            Ok(response) => response.json().await.unwrap_or(Value::Null),
            Err(_) => Value::Null,
        };
        let capabilities: Vec<&str> = show["capabilities"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        models.push(LocalModel {
            name: name.to_owned(),
            family: entry["details"]["family"].as_str().map(str::to_owned),
            parameter_size: entry["details"]["parameter_size"].as_str().map(str::to_owned),
            size_bytes: entry["size"].as_u64().unwrap_or(0),
            tools: capabilities.contains(&"tools"),
            thinking: capabilities.contains(&"thinking"),
        });
    }
    models.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(LocalModels { base_url: base.to_string(), version, models })
}

fn request_body(request: &LocalChatRequest) -> Value {
    let mut body = json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true,
        "think": request.think,
        "options": {"num_ctx": CONTEXT_TOKENS},
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(request.tools.clone());
    }
    body
}

/// Accumulates one streamed turn. Returns the text to forward as (kind, text) events.
#[derive(Default)]
struct Turn {
    result: LocalChatResult,
    done: bool,
}

impl Turn {
    fn apply(&mut self, line: &Value) -> Result<Vec<(&'static str, String)>, String> {
        if let Some(error) = line["error"].as_str() {
            return Err(format!("Ollama reported an error: {}", error.chars().take(300).collect::<String>()));
        }
        let message = &line["message"];
        let mut events = Vec::new();
        if let Some(thinking) = message["thinking"].as_str().filter(|t| !t.is_empty()) {
            self.result.thinking.push_str(thinking);
            events.push(("thinking", thinking.to_owned()));
        }
        if let Some(content) = message["content"].as_str().filter(|t| !t.is_empty()) {
            self.result.content.push_str(content);
            events.push(("text", content.to_owned()));
        }
        for call in message["tool_calls"].as_array().into_iter().flatten() {
            self.result.tool_calls.push(call.clone());
        }
        if line["done"].as_bool() == Some(true) {
            self.done = true;
            self.result.done_reason = line["done_reason"].as_str().map(str::to_owned);
            self.result.prompt_tokens = line["prompt_eval_count"].as_u64().unwrap_or(0);
            self.result.output_tokens = line["eval_count"].as_u64().unwrap_or(0);
        }
        Ok(events)
    }
}

#[command]
pub async fn local_chat(app: AppHandle, state: State<'_, LocalModelState>, request: LocalChatRequest) -> Result<LocalChatResult, String> {
    if !valid_id(&request.request_id) || !valid_model(&request.model) {
        return Err("Invalid local model request".into());
    }
    let size = serde_json::to_vec(&request.messages).map(|v| v.len()).unwrap_or(usize::MAX);
    if request.messages.is_empty() || size > MAX_REQUEST_BYTES || request.tools.len() > 128 {
        return Err("The conversation is too large for a local model. Start a new chat.".into());
    }
    let (tx, mut cancelled) = watch::channel(false);
    {
        let mut active = state.active.lock().map_err(|_| "Local model state unavailable")?;
        if active.contains_key(&request.request_id) { return Err("That request is already running".into()); }
        active.insert(request.request_id.clone(), tx);
    }
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => Err("Local model request cancelled".into()),
        result = tokio::time::timeout(TURN_TIMEOUT, stream_turn(&app, &request)) => {
            result.unwrap_or_else(|_| Err("The local model took longer than 15 minutes".into()))
        }
    };
    if let Ok(mut active) = state.active.lock() { active.remove(&request.request_id); }
    result
}

#[command]
pub fn local_chat_cancel(state: State<'_, LocalModelState>, request_id: String) -> Result<(), String> {
    if let Some(tx) = state.active.lock().map_err(|_| "Local model state unavailable")?.get(&request_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

async fn stream_turn(app: &AppHandle, request: &LocalChatRequest) -> Result<LocalChatResult, String> {
    let base = base_url(app).await?;
    let response = client()?.post(base.join("api/chat").map_err(|e| e.to_string())?)
        .json(&request_body(request)).send().await
        .map_err(|_| unreachable(&base))?;
    let status = response.status();
    if !status.is_success() {
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let detail = body["error"].as_str().unwrap_or("");
        return Err(if status.as_u16() == 404 {
            format!("Ollama does not have the model {}. Pull it with `ollama pull {}`.", request.model, request.model)
        } else {
            format!("Ollama returned HTTP {}{}{}", status.as_u16(), if detail.is_empty() { "" } else { ": " }, detail.chars().take(300).collect::<String>())
        });
    }
    let mut stream = response.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    let mut turn = Turn::default();
    while let Some(chunk) = tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await
        .map_err(|_| "The local model stopped responding for three minutes")?
    {
        pending.extend_from_slice(&chunk.map_err(|_| "The connection to Ollama was interrupted")?);
        while let Some(end) = pending.iter().position(|b| *b == b'\n') {
            let raw: Vec<u8> = pending.drain(..=end).collect();
            let line = std::str::from_utf8(&raw).map_err(|_| "Ollama sent invalid UTF-8")?.trim();
            if line.is_empty() { continue; }
            let value: Value = serde_json::from_str(line).map_err(|_| "Ollama sent malformed stream data")?;
            for (kind, text) in turn.apply(&value)? {
                let _ = app.emit("local-model-event", json!({"requestId": request.request_id, "kind": kind, "text": text}));
            }
            if turn.done {
                return Ok(turn.result);
            }
        }
        if pending.len() > MAX_LINE {
            return Err("Ollama sent an oversized stream line".into());
        }
    }
    Err("The local model stream ended before the response was complete".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LocalChatRequest {
        LocalChatRequest { request_id: "r1".into(), model: "qwen3.5:4b".into(), messages: vec![json!({"role": "user", "content": "hi"})], tools: vec![], think: true }
    }

    #[test]
    fn body_streams_with_thinking_context_and_optional_tools() {
        let body = request_body(&request());
        assert_eq!((body["stream"].as_bool(), body["think"].as_bool()), (Some(true), Some(true)));
        assert_eq!(body["options"]["num_ctx"], CONTEXT_TOKENS);
        assert!(body.get("tools").is_none());
        let mut with_tools = request();
        with_tools.tools = vec![json!({"type": "function", "function": {"name": "document_list"}})];
        assert_eq!(request_body(&with_tools)["tools"][0]["function"]["name"], "document_list");
    }

    #[test]
    fn assembles_thinking_text_tool_calls_and_usage() {
        let mut turn = Turn::default();
        assert_eq!(turn.apply(&json!({"message": {"thinking": "Look first."}})).unwrap(), vec![("thinking", "Look first.".to_string())]);
        assert_eq!(turn.apply(&json!({"message": {"content": "One "}})).unwrap(), vec![("text", "One ".to_string())]);
        turn.apply(&json!({"message": {"content": "note.", "tool_calls": [{"id": "call_1", "function": {"name": "document_list", "arguments": {}}}]}})).unwrap();
        assert!(!turn.done);
        turn.apply(&json!({"message": {"content": ""}, "done": true, "done_reason": "stop", "prompt_eval_count": 269, "eval_count": 87})).unwrap();
        assert!(turn.done);
        assert_eq!(turn.result, LocalChatResult {
            content: "One note.".into(), thinking: "Look first.".into(),
            tool_calls: vec![json!({"id": "call_1", "function": {"name": "document_list", "arguments": {}}})],
            done_reason: Some("stop".into()), prompt_tokens: 269, output_tokens: 87,
        });
    }

    #[test]
    fn reports_stream_errors_and_validates_ids() {
        assert!(Turn::default().apply(&json!({"error": "model not found"})).unwrap_err().contains("model not found"));
        assert!(valid_id("local-1") && !valid_id("bad id") && !valid_id(""));
        assert!(valid_model("tractor-qwen35-4b:latest") && !valid_model("qwen 3") && !valid_model(""));
    }
}
