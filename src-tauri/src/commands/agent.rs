//! Headless assistant connections.
//!
//! BusterMark drives the Claude Code and Codex command-line tools in their
//! non-interactive modes. Each CLI owns its own sign-in, so no assistant
//! credential is stored, read, or forwarded by this app.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, State};

use crate::mcp::{self, McpEndpoint, McpState, McpTool, McpToolResult};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

const MAX_PROMPT: usize = 32 * 1024;
const MAX_OUTPUT: usize = 256 * 1024;
const MAX_LINE: usize = 512 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const DETECT_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CONCURRENT: usize = 2;
/// Codex reads the bearer token from the environment rather than its config.
const MCP_TOKEN_ENV: &str = "BUSTERMARK_MCP_TOKEN";

/// Directories a CLI may live in when the app is launched from Finder, which
/// does not inherit a login shell's PATH.
const EXTRA_BIN_DIRS: [&str; 6] = [
    ".local/bin",
    ".bun/bin",
    ".npm-global/bin",
    ".volta/bin",
    ".cargo/bin",
    "bin",
];
const SYSTEM_BIN_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProvider {
    ClaudeCode,
    Codex,
}

impl AgentProvider {
    fn binary(self) -> &'static str {
        match self {
            AgentProvider::ClaudeCode => "claude",
            AgentProvider::Codex => "codex",
        }
    }

    fn label(self) -> &'static str {
        match self {
            AgentProvider::ClaudeCode => "Claude Code",
            AgentProvider::Codex => "Codex",
        }
    }
}

/// What is known about one assistant without making a model request.
#[derive(Debug, Clone, Serialize)]
pub struct AgentStatus {
    pub provider: AgentProvider,
    pub label: String,
    /// Absolute path to the CLI, when one was found.
    pub binary_path: Option<String>,
    pub version: Option<String>,
    /// True only when the CLI reports an authenticated account.
    pub signed_in: bool,
    /// How the CLI describes its sign-in, for display only.
    pub account: Option<String>,
    /// Set when detection could not complete; shown to the writer verbatim.
    pub problem: Option<String>,
}

impl AgentStatus {
    fn missing(provider: AgentProvider, problem: String) -> Self {
        Self {
            provider,
            label: provider.label().to_string(),
            binary_path: None,
            version: None,
            signed_in: false,
            account: None,
            problem: Some(problem),
        }
    }
}

/// One streamed update from a running assistant request.
#[derive(Debug, Clone, Serialize)]
pub struct AgentEvent {
    pub request_id: String,
    pub provider: AgentProvider,
    /// "delta" | "message" | "tool" | "done" | "error"
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRequest {
    pub request_id: String,
    pub provider: AgentProvider,
    pub prompt: String,
    /// Optional model override; the CLI's own default is used when absent.
    #[serde(default)]
    pub model: Option<String>,
    /// Working directory for the assistant. Defaults to the Notes home.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Default)]
pub struct AgentState {
    requests: Mutex<RequestRegistry>,
}

impl AgentState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, watch::Sender<bool>>,
    // Cancellation can arrive before the spawn command is scheduled.
    cancelled: HashMap<String, Instant>,
}

impl RequestRegistry {
    fn start(&mut self, id: &str) -> Result<watch::Receiver<bool>, String> {
        self.cancelled.retain(|_, at| at.elapsed() < REQUEST_TIMEOUT);
        if self.cancelled.contains_key(id) {
            return Err("Assistant request was cancelled".into());
        }
        if self.active.contains_key(id) {
            return Err("Assistant request ID is already active".into());
        }
        if self.active.len() >= MAX_CONCURRENT {
            return Err(format!(
                "{MAX_CONCURRENT} assistant requests are already running"
            ));
        }
        let (tx, rx) = watch::channel(false);
        self.active.insert(id.to_owned(), tx);
        Ok(rx)
    }

    fn cancel(&mut self, id: &str) {
        if let Some(tx) = self.active.get(id) {
            let _ = tx.send(true);
        }
        self.cancelled.retain(|_, at| at.elapsed() < REQUEST_TIMEOUT);
        if self.cancelled.len() < 256 {
            self.cancelled.insert(id.to_owned(), Instant::now());
        }
    }
}

/// Request IDs are echoed back to the frontend, so keep them boring.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Model names reach a command line, so allow only plain identifiers.
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 64
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// Find a CLI without a login shell. Returns the first executable match.
pub fn resolve_binary(name: &str) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        for dir in EXTRA_BIN_DIRS {
            let candidate = home.join(dir).join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for dir in SYSTEM_BIN_DIRS {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

async fn run_capture(binary: &PathBuf, args: &[&str]) -> Result<(bool, String), String> {
    let output = tokio::time::timeout(
        DETECT_TIMEOUT,
        Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "The assistant CLI did not respond".to_string())?
    .map_err(|e| format!("Could not run the assistant CLI: {e}"))?;

    let mut text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    }
    Ok((output.status.success(), text))
}

/// Parse `claude auth status`, which prints a JSON object.
fn parse_claude_auth(raw: &str) -> (bool, Option<String>) {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(value) => {
            let signed_in = value.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false);
            let account = value
                .get("authMethod")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (signed_in, account)
        }
        Err(_) => (false, None),
    }
}

/// Parse `codex login status`, which prints a human-readable line.
fn parse_codex_auth(success: bool, raw: &str) -> (bool, Option<String>) {
    let lowered = raw.to_ascii_lowercase();
    let signed_in = success && lowered.contains("logged in") && !lowered.contains("not logged in");
    // Codex prints a whole sentence; keep only how the account signed in.
    let account = signed_in.then(|| {
        let line = raw.lines().next().unwrap_or(raw).trim();
        line.strip_prefix("Logged in using ").unwrap_or(line).trim().to_string()
    });
    (signed_in, account)
}

async fn detect_one(provider: AgentProvider) -> AgentStatus {
    let Some(binary) = resolve_binary(provider.binary()) else {
        return AgentStatus::missing(
            provider,
            format!(
                "{} is not installed, or it is not on this app's PATH.",
                provider.label()
            ),
        );
    };

    let version = match run_capture(&binary, &["--version"]).await {
        Ok((true, text)) => Some(text.lines().next().unwrap_or(&text).trim().to_string()),
        Ok((false, text)) => {
            return AgentStatus::missing(
                provider,
                format!("{} could not report its version: {text}", provider.label()),
            )
        }
        Err(problem) => return AgentStatus::missing(provider, problem),
    };

    let auth_args: &[&str] = match provider {
        AgentProvider::ClaudeCode => &["auth", "status"],
        AgentProvider::Codex => &["login", "status"],
    };

    let (signed_in, account, problem) = match run_capture(&binary, auth_args).await {
        Ok((success, text)) => {
            let (signed_in, account) = match provider {
                AgentProvider::ClaudeCode => parse_claude_auth(&text),
                AgentProvider::Codex => parse_codex_auth(success, &text),
            };
            let problem = (!signed_in).then(|| {
                format!(
                    "Not signed in. Run `{} {}` in a terminal.",
                    provider.binary(),
                    match provider {
                        AgentProvider::ClaudeCode => "auth login",
                        AgentProvider::Codex => "login",
                    }
                )
            });
            (signed_in, account, problem)
        }
        Err(problem) => (false, None, Some(problem)),
    };

    AgentStatus {
        provider,
        label: provider.label().to_string(),
        binary_path: Some(binary.to_string_lossy().to_string()),
        version,
        signed_in,
        account,
        problem,
    }
}

/// Report what each assistant CLI can do right now. Makes no model request.
#[command]
pub async fn agent_detect() -> Result<Vec<AgentStatus>, String> {
    Ok(vec![
        detect_one(AgentProvider::ClaudeCode).await,
        detect_one(AgentProvider::Codex).await,
    ])
}

fn build_command(
    binary: &PathBuf,
    request: &AgentRequest,
    cwd: Option<&str>,
    mcp: Option<&McpEndpoint>,
) -> Result<Command, String> {
    let mut command = Command::new(binary);
    match request.provider {
        AgentProvider::ClaudeCode => {
            command.args(["--print", "--output-format", "stream-json", "--verbose"]);
            if let Some(model) = &request.model {
                command.args(["--model", model]);
            }
            if let Some(dir) = cwd {
                command.args(["--add-dir", dir]);
            }
            // The assistant may read and write notes; it may not run commands.
            command.arg("--restricted");
            if let Some(endpoint) = mcp {
                // Only this server: the assistant gets BusterMark's catalog and
                // nothing the writer configured elsewhere.
                let config = serde_json::json!({
                    "mcpServers": {
                        "bustermark": {
                            "type": "http",
                            "url": endpoint.url,
                            "headers": { "Authorization": format!("Bearer {}", endpoint.token) }
                        }
                    }
                });
                command.args(["--mcp-config", &config.to_string(), "--strict-mcp-config"]);
                // Headless runs cannot answer a permission prompt. Allow this
                // server's tools — every one is a command the writer's own
                // controls can already run — and nothing else.
                command.args(["--allowedTools", "mcp__bustermark"]);
            }
        }
        AgentProvider::Codex => {
            command.args(["exec", "--json", "--skip-git-repo-check"]);
            if let Some(model) = &request.model {
                command.args(["--model", model]);
            }
            if let Some(dir) = cwd {
                command.args(["--cd", dir]);
            }
            command.args(["--sandbox", "read-only"]);
            if let Some(endpoint) = mcp {
                command.args([
                    "-c",
                    &format!("mcp_servers.bustermark.url=\"{}\"", endpoint.url),
                    "-c",
                    &format!(
                        "mcp_servers.bustermark.bearer_token_env_var=\"{}\"",
                        MCP_TOKEN_ENV
                    ),
                ]);
                command.env(MCP_TOKEN_ENV, &endpoint.token);
            }
        }
    }
    // The prompt is passed on stdin so its content is never part of argv.
    command.arg("-");
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(command)
}

/// Pull the human-readable text out of one streamed CLI event.
pub fn extract_event(provider: AgentProvider, line: &str) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let field = |name: &str| value.get(name).and_then(|v| v.as_str()).unwrap_or("");

    match provider {
        AgentProvider::ClaudeCode => match field("type") {
            "assistant" => {
                let content = value.get("message")?.get("content")?.as_array()?;
                let mut text = String::new();
                for part in content {
                    if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                        text.push_str(part.get("text").and_then(|v| v.as_str()).unwrap_or(""));
                    }
                    if part.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                        let name = part.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                        return Some(("tool".into(), name.to_string()));
                    }
                }
                (!text.is_empty()).then_some(("message".into(), text))
            }
            "result" => {
                let text = value
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(("done".into(), text))
            }
            _ => None,
        },
        AgentProvider::Codex => {
            // Codex emits thread/turn lifecycle events plus one event per item.
            match field("type") {
                "item.completed" | "item.updated" => {
                    let item = value.get("item")?;
                    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match item_type {
                        "agent_message" => {
                            let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                            (!text.is_empty()).then_some(("message".into(), text.to_string()))
                        }
                        // Reasoning is the assistant thinking aloud, not a reply.
                        "reasoning" => None,
                        other => Some(("tool".into(), other.to_string())),
                    }
                }
                "turn.completed" => Some(("done".into(), String::new())),
                "turn.failed" | "error" => {
                    let message = value
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .or_else(|| value.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("The assistant reported an error");
                    Some(("error".into(), message.to_string()))
                }
                _ => None,
            }
        }
    }
}

fn validate(request: &AgentRequest) -> Result<(), String> {
    if !valid_id(&request.request_id) {
        return Err("Invalid assistant request ID".into());
    }
    if request.prompt.trim().is_empty() {
        return Err("Enter something for the assistant to do".into());
    }
    if request.prompt.len() > MAX_PROMPT {
        return Err("That request is too long to send".into());
    }
    if let Some(model) = &request.model {
        if !valid_model(model) {
            return Err("Invalid model name".into());
        }
    }
    Ok(())
}

async fn pump(
    app: &AppHandle,
    request: &AgentRequest,
    child: &mut Child,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<String, String> {
    let stdout = child.stdout.take().ok_or("No assistant output stream")?;
    let mut reader = BufReader::new(stdout).lines();
    let mut transcript = String::new();

    loop {
        tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("Assistant request cancelled".into()),
            line = reader.next_line() => {
                let Some(line) = line.map_err(|e| format!("Assistant output failed: {e}"))? else {
                    break;
                };
                if line.len() > MAX_LINE {
                    return Err("The assistant sent an oversized response".into());
                }
                let Some((kind, text)) = extract_event(request.provider, &line) else { continue };
                if transcript.len() + text.len() <= MAX_OUTPUT && (kind == "message" || kind == "delta") {
                    transcript.push_str(&text);
                }
                let _ = app.emit(
                    "agent-event",
                    AgentEvent {
                        request_id: request.request_id.clone(),
                        provider: request.provider,
                        kind,
                        text,
                    },
                );
            }
        }
    }
    Ok(transcript)
}

/// Send one request to a connected assistant and stream its reply.
///
/// Returns the assistant's text. Streamed `agent-event` payloads carry the
/// same content as it arrives; the return value is authoritative.
#[command]
pub async fn agent_send(
    app: AppHandle,
    state: State<'_, AgentState>,
    mcp_state: State<'_, Arc<McpState>>,
    request: AgentRequest,
) -> Result<String, String> {
    validate(&request)?;

    let binary = resolve_binary(request.provider.binary()).ok_or_else(|| {
        format!(
            "{} is not installed, or it is not on this app's PATH.",
            request.provider.label()
        )
    })?;

    let mut cancelled = state
        .requests
        .lock()
        .map_err(|_| "Assistant state unavailable")?
        .start(&request.request_id)?;

    let cwd = request.cwd.clone();
    let endpoint = mcp_state.endpoint().await;
    let mut command = build_command(&binary, &request, cwd.as_deref(), endpoint.as_ref())?;
    let spawned = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", request.provider.label()));

    let result = match spawned {
        Err(problem) => Err(problem),
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(request.prompt.as_bytes()).await;
                let _ = stdin.shutdown().await;
            }
            // pump() watches the same cancellation channel, so one select is enough.
            let outcome = tokio::time::timeout(
                REQUEST_TIMEOUT,
                pump(&app, &request, &mut child, &mut cancelled),
            )
            .await
            .unwrap_or_else(|_| Err("The assistant timed out".into()));
            let _ = child.start_kill();
            outcome
        }
    };

    if let Ok(mut registry) = state.requests.lock() {
        registry.active.remove(&request.request_id);
    }

    let kind = if result.is_ok() { "done" } else { "error" };
    let _ = app.emit(
        "agent-event",
        AgentEvent {
            request_id: request.request_id.clone(),
            provider: request.provider,
            kind: kind.into(),
            text: result.clone().unwrap_or_else(|e| e),
        },
    );

    result
}

/// Stop a running assistant request. Late output is ignored.
#[command]
pub fn agent_cancel(state: State<'_, AgentState>, request_id: String) -> Result<(), String> {
    if !valid_id(&request_id) {
        return Err("Invalid assistant request ID".into());
    }
    state
        .requests
        .lock()
        .map_err(|_| "Assistant state unavailable")?
        .cancel(&request_id);
    Ok(())
}

/// Start the local MCP server and return where an assistant should connect.
#[command]
pub async fn mcp_start(app: AppHandle, state: State<'_, Arc<McpState>>) -> Result<McpEndpoint, String> {
    mcp::start(app, state.inner().clone()).await
}

/// Stop publishing the command catalog. Connected assistants lose their tools.
#[command]
pub async fn mcp_stop(state: State<'_, Arc<McpState>>) -> Result<(), String> {
    mcp::stop(state.inner()).await;
    Ok(())
}

/// Publish the catalog the assistant may call. Replaces any previous list.
#[command]
pub async fn mcp_set_tools(state: State<'_, Arc<McpState>>, tools: Vec<McpTool>) -> Result<usize, String> {
    let count = tools.len();
    state.replace_tools(tools).await;
    Ok(count)
}

/// Return the frontend's answer for one forwarded tool call.
#[command]
pub async fn mcp_tool_result(state: State<'_, Arc<McpState>>, result: McpToolResult) -> Result<(), String> {
    state.complete_call(result).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unusable_request_ids_and_models() {
        assert!(valid_id("abc-123_ID"));
        for id in ["", "has space", "semi;colon", &"a".repeat(129)] {
            assert!(!valid_id(id), "{id:?} should be rejected");
        }
        assert!(valid_model("claude-haiku-4-5-20251001"));
        assert!(valid_model("gpt-5.1-codex"));
        for model in ["", "rm -rf /", "a$(b)", &"m".repeat(65)] {
            assert!(!valid_model(model), "{model:?} should be rejected");
        }
    }

    #[test]
    fn validates_prompt_bounds() {
        let base = AgentRequest {
            request_id: "req-1".into(),
            provider: AgentProvider::ClaudeCode,
            prompt: "Tidy this sentence.".into(),
            model: None,
            cwd: None,
        };
        assert!(validate(&base).is_ok());

        let mut empty = base.clone();
        empty.prompt = "   ".into();
        assert!(validate(&empty).is_err());

        let mut huge = base.clone();
        huge.prompt = "x".repeat(MAX_PROMPT + 1);
        assert!(validate(&huge).is_err());

        let mut bad_model = base.clone();
        bad_model.model = Some("oops; rm -rf /".into());
        assert!(validate(&bad_model).is_err());
    }

    #[test]
    fn reads_claude_stream_events() {
        let assistant = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#;
        assert_eq!(
            extract_event(AgentProvider::ClaudeCode, assistant),
            Some(("message".into(), "Hello".into()))
        );

        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#;
        assert_eq!(
            extract_event(AgentProvider::ClaudeCode, tool),
            Some(("tool".into(), "Read".into()))
        );

        let result = r#"{"type":"result","result":"All done"}"#;
        assert_eq!(
            extract_event(AgentProvider::ClaudeCode, result),
            Some(("done".into(), "All done".into()))
        );

        assert_eq!(extract_event(AgentProvider::ClaudeCode, "not json"), None);
        assert_eq!(
            extract_event(AgentProvider::ClaudeCode, r#"{"type":"system"}"#),
            None
        );
    }

    #[test]
    fn reads_codex_stream_events() {
        let message = r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ready"}}"#;
        assert_eq!(
            extract_event(AgentProvider::Codex, message),
            Some(("message".into(), "ready".into()))
        );

        let tool = r#"{"type":"item.completed","item":{"id":"i1","type":"command_execution"}}"#;
        assert_eq!(
            extract_event(AgentProvider::Codex, tool),
            Some(("tool".into(), "command_execution".into()))
        );

        let done = r#"{"type":"turn.completed","usage":{"output_tokens":5}}"#;
        assert_eq!(
            extract_event(AgentProvider::Codex, done),
            Some(("done".into(), String::new()))
        );

        let failed = r#"{"type":"turn.failed","error":{"message":"nope"}}"#;
        assert_eq!(
            extract_event(AgentProvider::Codex, failed),
            Some(("error".into(), "nope".into()))
        );

        // Lifecycle and thinking events carry no reply text.
        for quiet in [
            r#"{"type":"thread.started","thread_id":"t1"}"#,
            r#"{"type":"turn.started"}"#,
            r#"{"type":"item.completed","item":{"type":"reasoning"}}"#,
        ] {
            assert_eq!(extract_event(AgentProvider::Codex, quiet), None, "{quiet}");
        }
    }

    #[test]
    fn reads_auth_status_output() {
        let (signed_in, account) = parse_claude_auth(r#"{"loggedIn":true,"authMethod":"claude.ai"}"#);
        assert!(signed_in);
        assert_eq!(account.as_deref(), Some("claude.ai"));

        let (signed_out, _) = parse_claude_auth(r#"{"loggedIn":false}"#);
        assert!(!signed_out);
        assert!(!parse_claude_auth("garbage").0);

        let (codex_in, codex_account) = parse_codex_auth(true, "Logged in using ChatGPT");
        assert!(codex_in);
        assert_eq!(codex_account.as_deref(), Some("ChatGPT"));
        assert!(!parse_codex_auth(true, "Not logged in").0);
        assert!(!parse_codex_auth(false, "Logged in using ChatGPT").0);
    }

    #[test]
    fn caps_concurrent_requests_and_honours_early_cancel() {
        let mut registry = RequestRegistry::default();
        assert!(registry.start("one").is_ok());
        assert!(registry.start("two").is_ok());
        assert!(registry.start("three").is_err(), "third request must be refused");
        assert!(registry.start("one").is_err(), "duplicate ID must be refused");

        registry.cancel("later");
        assert!(registry.start("later").is_err(), "pre-cancelled ID must not start");
    }
}
