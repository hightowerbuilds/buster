use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::watch;

// ── Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct CompletionRequest {
    pub request_id: u64,
    pub file_path: String,
    pub language: String,
    pub prefix: String,
    pub suffix: String,
    pub cursor_line: u32,
    pub cursor_col: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletionToken {
    pub request_id: u64,
    pub token: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletionError {
    pub request_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiProviderValidationRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub ollama_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiProviderValidation {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiCompletionUsage {
    pub estimated_tokens: u64,
    pub monthly_budget: u32,
}

// ── State ──────────────────────────────────────────────────────

pub struct AiCompletionState {
    cancel_tx: watch::Sender<bool>,
    cancel_rx: watch::Receiver<bool>,
    active_request: AtomicU64,
    estimated_tokens_used: Arc<AtomicU64>,
}

impl AiCompletionState {
    pub fn new() -> Self {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        Self {
            cancel_tx,
            cancel_rx,
            active_request: AtomicU64::new(0),
            estimated_tokens_used: Arc::new(AtomicU64::new(0)),
        }
    }
}

// ── Commands ───────────────────────────────────────────────────

#[command]
pub async fn ai_completion_request(
    app: AppHandle,
    state: State<'_, AiCompletionState>,
    request: CompletionRequest,
) -> Result<(), String> {
    let settings = super::settings::load_settings(app.clone()).await;
    if !settings.ai_completion_enabled {
        return Ok(());
    }
    if settings.ai_token_budget_monthly > 0 {
        let used = state.estimated_tokens_used.load(Ordering::Relaxed);
        if used >= settings.ai_token_budget_monthly as u64 {
            return Ok(());
        }
    }

    // Cancel any existing request, then reset
    let _ = state.cancel_tx.send(true);
    let _ = state.cancel_tx.send(false);

    state
        .active_request
        .store(request.request_id, Ordering::Relaxed);

    let mut cancel_rx = state.cancel_rx.clone();
    let request_id = request.request_id;
    let app_handle = app.clone();
    let estimated_tokens_used = state.estimated_tokens_used.clone();

    tokio::spawn(async move {
        let result = match settings.ai_provider.as_str() {
            "ollama" => stream_ollama(&app_handle, &settings, &request, &mut cancel_rx).await,
            "anthropic" => stream_anthropic(&app_handle, &settings, &request, &mut cancel_rx).await,
            "openai" => stream_openai(&app_handle, &settings, &request, &mut cancel_rx).await,
            _ => Err("Unknown AI provider".to_string()),
        };

        match result {
            Ok(estimated_tokens) => {
                estimated_tokens_used.fetch_add(estimated_tokens, Ordering::Relaxed);
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "ai-completion-error",
                    CompletionError {
                        request_id,
                        message: e,
                    },
                );
            }
        }
    });

    Ok(())
}

#[command]
pub fn ai_completion_cancel(state: State<'_, AiCompletionState>) {
    let _ = state.cancel_tx.send(true);
}

#[command]
pub async fn ai_completion_ollama_models(ollama_url: String) -> Result<Vec<String>, String> {
    fetch_ollama_models(&ollama_url).await
}

#[command]
pub async fn ai_completion_validate_provider(
    request: AiProviderValidationRequest,
) -> Result<AiProviderValidation, String> {
    validate_provider(request).await
}

#[command]
pub async fn ai_completion_usage(
    app: AppHandle,
    state: State<'_, AiCompletionState>,
) -> Result<AiCompletionUsage, String> {
    let settings = super::settings::load_settings(app).await;
    Ok(AiCompletionUsage {
        estimated_tokens: state.estimated_tokens_used.load(Ordering::Relaxed),
        monthly_budget: settings.ai_token_budget_monthly,
    })
}

// ── Prompt Building ────────────────────────────────────────────

fn build_chat_prompt(request: &CompletionRequest) -> String {
    let language = language_name(&request.language);
    let comment_prefix = line_comment_prefix(&request.language);
    format!(
        "Complete the {language} code at the cursor position marked with <CURSOR>. Output ONLY the code that continues from the cursor. No markdown, no explanation, no backticks. Match the file style and indentation. Stop after the current statement or a few lines.\n\nFile: {file}\nCursor: line {line}, column {col}\nLine comments use: {comment}\n```{language}\n{prefix}<CURSOR>{suffix}\n```",
        language = language,
        file = request.file_path,
        line = request.cursor_line + 1,
        col = request.cursor_col + 1,
        comment = comment_prefix,
        prefix = request.prefix,
        suffix = request.suffix,
    )
}

fn build_ollama_prompt(request: &CompletionRequest) -> String {
    let language = language_name(&request.language);
    let comment_prefix = line_comment_prefix(&request.language);
    format!(
        "{comment} File: {file}\n{comment} Complete the {language} code after <CURSOR>. Output only the continuation.\n{prefix}<CURSOR>{suffix}",
        comment = comment_prefix,
        file = request.file_path,
        language = language,
        prefix = request.prefix,
        suffix = request.suffix,
    )
}

fn language_name(language: &str) -> &str {
    match language {
        "js" | "jsx" | "javascript" => "javascript",
        "ts" | "tsx" | "typescript" => "typescript",
        "rs" | "rust" => "rust",
        "py" | "python" => "python",
        "go" => "go",
        "html" => "html",
        "css" | "scss" => "css",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "sh" | "bash" => "shell",
        other => other,
    }
}

fn line_comment_prefix(language: &str) -> &'static str {
    match language_name(language) {
        "python" | "shell" => "#",
        "html" => "<!--",
        _ => "//",
    }
}

fn estimate_tokens(text: &str) -> u64 {
    let chars = text.chars().count() as u64;
    if chars == 0 {
        0
    } else {
        chars.div_ceil(4)
    }
}

fn emit_completion_token(
    app: &AppHandle,
    request_id: u64,
    token: &str,
    done: bool,
    stop_on_newline: bool,
    stopped: &mut bool,
) -> u64 {
    if *stopped {
        return 0;
    }

    let mut out = token;
    let mut final_done = done;
    if stop_on_newline {
        if let Some(newline_idx) = token.find('\n') {
            out = &token[..newline_idx];
            final_done = true;
            *stopped = true;
        }
    }

    if !out.is_empty() || final_done {
        let _ = app.emit(
            "ai-completion-token",
            CompletionToken {
                request_id,
                token: out.to_string(),
                done: final_done,
            },
        );
    }

    estimate_tokens(out)
}

fn parse_ollama_line(line: &str) -> Option<(String, bool)> {
    let json = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let token = json
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let done = json.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
    Some((token, done))
}

fn parse_anthropic_data(data: &str) -> Option<(String, bool)> {
    if data.trim() == "[DONE]" {
        return Some((String::new(), true));
    }
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    if json.get("type").and_then(|v| v.as_str()) == Some("content_block_delta") {
        let text = json
            .pointer("/delta/text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Some((text.to_string(), false));
    }
    if json.get("type").and_then(|v| v.as_str()) == Some("message_stop") {
        return Some((String::new(), true));
    }
    None
}

fn parse_openai_data(data: &str) -> Option<(String, bool)> {
    if data.trim() == "[DONE]" {
        return Some((String::new(), true));
    }
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    if let Some(content) = json
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
    {
        return Some((content.to_string(), false));
    }
    if json
        .pointer("/choices/0/finish_reason")
        .and_then(|v| v.as_str())
        .is_some()
    {
        return Some((String::new(), true));
    }
    None
}

async fn fetch_ollama_models(ollama_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", ollama_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned status {}", response.status()));
    }

    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Ollama response parse failed: {}", e))?;
    let models = json
        .get("models")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("name")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(models)
}

async fn validate_provider(
    request: AiProviderValidationRequest,
) -> Result<AiProviderValidation, String> {
    match request.provider.as_str() {
        "ollama" => {
            let models = fetch_ollama_models(&request.ollama_url).await?;
            let ok = request.model.is_empty() || models.iter().any(|model| model == &request.model);
            Ok(AiProviderValidation {
                ok,
                message: if ok {
                    format!(
                        "Connected to Ollama ({} model{})",
                        models.len(),
                        if models.len() == 1 { "" } else { "s" }
                    )
                } else {
                    format!("Connected, but model '{}' was not found", request.model)
                },
            })
        }
        "anthropic" => {
            if request.api_key.trim().is_empty() {
                return Ok(AiProviderValidation {
                    ok: false,
                    message: "Anthropic API key is missing".to_string(),
                });
            }
            let response = reqwest::Client::new()
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", request.api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": request.model,
                    "max_tokens": 1,
                    "messages": [{ "role": "user", "content": "Reply with ok." }]
                }))
                .send()
                .await
                .map_err(|e| format!("Anthropic validation failed: {}", e))?;
            Ok(AiProviderValidation {
                ok: response.status().is_success(),
                message: if response.status().is_success() {
                    "Anthropic key validated".to_string()
                } else {
                    format!("Anthropic returned {}", response.status())
                },
            })
        }
        "openai" => {
            if request.api_key.trim().is_empty() {
                return Ok(AiProviderValidation {
                    ok: false,
                    message: "OpenAI API key is missing".to_string(),
                });
            }
            let response = reqwest::Client::new()
                .get("https://api.openai.com/v1/models")
                .header("Authorization", format!("Bearer {}", request.api_key))
                .send()
                .await
                .map_err(|e| format!("OpenAI validation failed: {}", e))?;
            Ok(AiProviderValidation {
                ok: response.status().is_success(),
                message: if response.status().is_success() {
                    "OpenAI key validated".to_string()
                } else {
                    format!("OpenAI returned {}", response.status())
                },
            })
        }
        _ => Ok(AiProviderValidation {
            ok: false,
            message: "Unknown AI provider".to_string(),
        }),
    }
}

// ── Ollama Provider ────────────────────────────────────────────

async fn stream_ollama(
    app: &AppHandle,
    settings: &super::settings::AppSettings,
    request: &CompletionRequest,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<u64, String> {
    let url = format!(
        "{}/api/generate",
        settings.ai_ollama_url.trim_end_matches('/')
    );
    let prompt = build_ollama_prompt(request);

    let body = serde_json::json!({
        "model": settings.ai_local_model,
        "prompt": prompt,
        "stream": true,
        "options": {
            "num_predict": 20,
            "num_ctx": 512,
            "temperature": 0.2,
            "stop": ["\n\n", "```"]
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned status {}", response.status()));
    }

    let request_id = request.request_id;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut estimated_tokens = 0;
    let mut stopped = false;

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() { break; }
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        // Parse complete NDJSON lines
                        while let Some(newline_pos) = buffer.find('\n') {
                            let line = buffer[..newline_pos].trim().to_string();
                            buffer.drain(..newline_pos + 1);

                            if line.is_empty() { continue; }

                            if let Some((token, done)) = parse_ollama_line(&line) {
                                estimated_tokens += emit_completion_token(
                                    app,
                                    request_id,
                                    &token,
                                    done,
                                    settings.ai_stop_on_newline,
                                    &mut stopped,
                                );

                                if done || stopped { return Ok(estimated_tokens); }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        return Err(format!("Ollama stream error: {}", e));
                    }
                    None => {
                        // Stream ended
                        estimated_tokens += emit_completion_token(app, request_id, "", true, false, &mut stopped);
                        return Ok(estimated_tokens);
                    }
                }
            }
        }
    }

    Ok(estimated_tokens)
}

// ── Anthropic Provider ─────────────────────────────────────────

async fn stream_anthropic(
    app: &AppHandle,
    settings: &super::settings::AppSettings,
    request: &CompletionRequest,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<u64, String> {
    if settings.ai_api_key.is_empty() {
        return Err("Anthropic API key not configured".to_string());
    }

    let prompt = build_chat_prompt(request);

    let body = serde_json::json!({
        "model": settings.ai_model,
        "max_tokens": 60,
        "stream": true,
        "system": "You are a code completion engine. Output ONLY the code that continues from the cursor position. No explanation, no markdown.",
        "messages": [{ "role": "user", "content": prompt }]
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &settings.ai_api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic returned {} — {}", status, body));
    }

    let request_id = request.request_id;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut estimated_tokens = 0;
    let mut stopped = false;

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() { break; }
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        // Parse SSE events (data: lines separated by \n\n)
                        while let Some(block_end) = buffer.find("\n\n") {
                            let block = buffer[..block_end].to_string();
                            buffer.drain(..block_end + 2);

                            for line in block.lines() {
                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Some((token, done)) = parse_anthropic_data(data) {
                                        estimated_tokens += emit_completion_token(
                                            app,
                                            request_id,
                                            &token,
                                            done,
                                            settings.ai_stop_on_newline,
                                            &mut stopped,
                                        );
                                        if done || stopped { return Ok(estimated_tokens); }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(format!("Anthropic stream error: {}", e)),
                    None => {
                        estimated_tokens += emit_completion_token(app, request_id, "", true, false, &mut stopped);
                        return Ok(estimated_tokens);
                    }
                }
            }
        }
    }

    Ok(estimated_tokens)
}

// ── OpenAI Provider ────────────────────────────────────────────

async fn stream_openai(
    app: &AppHandle,
    settings: &super::settings::AppSettings,
    request: &CompletionRequest,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<u64, String> {
    if settings.ai_api_key.is_empty() {
        return Err("OpenAI API key not configured".to_string());
    }

    let prompt = build_chat_prompt(request);

    let body = serde_json::json!({
        "model": settings.ai_model,
        "max_tokens": 60,
        "stream": true,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": "You are a code completion engine. Output ONLY the code that continues from the cursor position. No explanation, no markdown." },
            { "role": "user", "content": prompt }
        ]
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", settings.ai_api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI returned {} — {}", status, body));
    }

    let request_id = request.request_id;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut estimated_tokens = 0;
    let mut stopped = false;

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() { break; }
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        while let Some(block_end) = buffer.find("\n\n") {
                            let block = buffer[..block_end].to_string();
                            buffer.drain(..block_end + 2);

                            for line in block.lines() {
                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Some((token, done)) = parse_openai_data(data) {
                                        estimated_tokens += emit_completion_token(
                                            app,
                                            request_id,
                                            &token,
                                            done,
                                            settings.ai_stop_on_newline,
                                            &mut stopped,
                                        );
                                        if done || stopped { return Ok(estimated_tokens); }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(format!("OpenAI stream error: {}", e)),
                    None => {
                        estimated_tokens += emit_completion_token(app, request_id, "", true, false, &mut stopped);
                        return Ok(estimated_tokens);
                    }
                }
            }
        }
    }

    Ok(estimated_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(language: &str) -> CompletionRequest {
        CompletionRequest {
            request_id: 7,
            file_path: "/tmp/app.ts".to_string(),
            language: language.to_string(),
            prefix: "function add(a: number, b: number) {".to_string(),
            suffix: "\n}".to_string(),
            cursor_line: 0,
            cursor_col: 37,
        }
    }

    #[test]
    fn chat_prompt_includes_suffix_cursor_and_language_context() {
        let prompt = build_chat_prompt(&request("ts"));

        assert!(prompt.contains("typescript code"));
        assert!(prompt.contains("<CURSOR>"));
        assert!(prompt.contains("function add"));
        assert!(prompt.contains("Line comments use: //"));
        assert!(prompt.contains("column 38"));
    }

    #[test]
    fn ollama_prompt_uses_language_specific_comment_prefix() {
        let prompt = build_ollama_prompt(&CompletionRequest {
            language: "py".to_string(),
            file_path: "/tmp/app.py".to_string(),
            ..request("py")
        });

        assert!(prompt.starts_with("# File: /tmp/app.py"));
        assert!(prompt.contains("<CURSOR>"));
    }

    #[test]
    fn parses_ollama_ndjson_line() {
        let parsed = parse_ollama_line(r#"{"response":"let x = 1;","done":false}"#).unwrap();

        assert_eq!(parsed, ("let x = 1;".to_string(), false));
    }

    #[test]
    fn parses_anthropic_text_and_stop_events() {
        let text = parse_anthropic_data(r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"return value;"}}"#).unwrap();
        let stop = parse_anthropic_data(r#"{"type":"message_stop"}"#).unwrap();

        assert_eq!(text, ("return value;".to_string(), false));
        assert_eq!(stop, (String::new(), true));
    }

    #[test]
    fn parses_openai_delta_and_done_events() {
        let text =
            parse_openai_data(r#"{"choices":[{"delta":{"content":"return value;"}}]}"#).unwrap();
        let stop = parse_openai_data("[DONE]").unwrap();

        assert_eq!(text, ("return value;".to_string(), false));
        assert_eq!(stop, (String::new(), true));
    }

    #[test]
    fn estimates_tokens_conservatively() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens(""), 0);
    }
}
