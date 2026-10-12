//! The Assistant runs through the writer's locally installed, logged-in AI CLI — Claude Code, Codex,
//! or OpenCode — so it uses their subscription rather than an API key. BusterMark serves its own
//! command catalog to the CLI as an MCP server on 127.0.0.1, with every built-in tool disabled. Tool
//! calls are forwarded to the frontend, which asks the writer before any change.
//!
//! Claude Code keeps one process per chat in streaming JSON mode. Codex (`codex exec --json`) and
//! OpenCode (`opencode run --format json`) start one process per message and resume the chat's
//! session; their events are translated into the same frontend events as Claude Code's.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{command, AppHandle, Emitter, Manager, State};
use super::ai_cli::{Provider, CODEX_EFFORTS};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    process::{Child, ChildStdin, Command},
    sync::oneshot,
};

const SERVER_NAME: &str = "bustermark";
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const MAX_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_HTTP_BODY: usize = 4 * 1024 * 1024;
/// Codex reads the MCP server's bearer token from this variable.
const CODEX_TOKEN_ENV: &str = "BUSTERMARK_MCP_TOKEN";
// Approvals wait on the writer, so tool calls may take a while.
const TOOL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendRequest {
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    channel_id: Option<String>,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    system: String,
    tools: Vec<Value>,
    resume: Option<String>,
    /// The CLI to run; Claude Code when absent.
    #[serde(default)]
    provider: Option<Provider>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    installed: bool,
    logged_in: bool,
    version: Option<String>,
    auth_method: Option<String>,
    subscription: Option<String>,
    detail: Option<String>,
}

/// The settings a running process was started with. A change means restarting it with `--resume`.
#[derive(Clone, PartialEq, Debug)]
struct SessionConfig {
    provider: Provider,
    channel_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    system: String,
    tools: Vec<Value>,
}

struct Session {
    generation: u64,
    config: SessionConfig,
    /// Claude Code's input; Codex and OpenCode take one message per process.
    stdin: Option<ChildStdin>,
    pid: Option<u32>,
}

struct McpServer {
    port: u16,
    token: String,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
pub struct AssistantState {
    conversations: Mutex<HashMap<String, Arc<Shared>>>,
}

#[derive(Default)]
struct Shared {
    conversation_id: String,
    channel_id: Mutex<Option<String>>,
    session: tokio::sync::Mutex<Option<Session>>,
    generation: AtomicU64,
    server: tokio::sync::Mutex<Option<McpServer>>,
    tools: Mutex<Vec<Value>>,
    pending: Mutex<HashMap<String, oneshot::Sender<ToolReply>>>,
    next_call: AtomicU64,
}

fn conversation(state: &AssistantState, id: Option<&str>) -> Result<Arc<Shared>, String> {
    let id = id.unwrap_or("default");
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("Invalid chat ID".into());
    }
    let mut conversations = state.conversations.lock().map_err(|_| "Assistant state unavailable")?;
    Ok(conversations.entry(id.into()).or_insert_with(|| Arc::new(Shared { conversation_id: id.into(), ..Default::default() })).clone())
}

struct ToolReply {
    content: String,
    is_error: bool,
}

fn valid_model(model: &str) -> bool {
    // OpenCode names models provider/model.
    !model.is_empty() && model.len() <= 100 && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.[]/:".contains(&c))
}

fn validate(request: &SendRequest) -> Result<(), String> {
    if request.channel_id.as_deref().is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')) {
        return Err("Invalid chat channel".into());
    }
    if request.text.trim().is_empty() || request.text.len() > MAX_MESSAGE_BYTES {
        return Err("Messages must contain between 1 byte and 256 KiB of text".into());
    }
    if request.model.as_deref().is_some_and(|m| !valid_model(m)) {
        return Err("Choose a valid Claude model".into());
    }
    match request.provider.unwrap_or(Provider::Claude) {
        Provider::Claude if request.effort.as_deref().is_some_and(|e| !EFFORTS.contains(&e)) =>
            return Err("Effort must be low, medium, high, xhigh or max".into()),
        Provider::Codex if request.effort.as_deref().is_some_and(|e| !CODEX_EFFORTS.contains(&e)) =>
            return Err("Codex effort must be minimal, low, medium or high".into()),
        Provider::Opencode if request.effort.is_some() => return Err("OpenCode has no effort setting".into()),
        _ => {}
    }
    // OpenCode session IDs use underscores ("ses_…").
    if request.resume.as_deref().is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')) {
        return Err("Invalid conversation ID".into());
    }
    if request.tools.len() > 128 || request.system.len() > 64 * 1024 {
        return Err("Too many tools or an oversized system prompt".into());
    }
    Ok(())
}

async fn find_claude() -> Option<PathBuf> {
    super::ai_cli::find_cli("claude").await
}

/// The Assistant's connection for `provider`: Claude Code's sign-in in detail, or Codex/OpenCode's
/// status from the writing-actions check.
#[command]
pub async fn assistant_status(provider: Option<Provider>) -> CliStatus {
    match provider.unwrap_or(Provider::Claude) {
        Provider::Claude => claude_status().await,
        other => {
            let found = super::ai_cli::ai_providers_status().await.into_iter().find(|s| s.provider() == other);
            let (installed, signed_in, detail) = found.map(|s| s.parts()).unwrap_or((false, false, Some(other.install_hint().into())));
            CliStatus { installed, logged_in: signed_in, version: None, auth_method: None, subscription: None, detail }
        }
    }
}

async fn claude_status() -> CliStatus {
    let mut status = CliStatus { installed: false, logged_in: false, version: None, auth_method: None, subscription: None, detail: None };
    let Some(claude) = find_claude().await else {
        status.detail = Some("Claude Code is not installed. Install it from claude.com/claude-code, then sign in by running `claude` in a terminal.".into());
        return status;
    };
    status.installed = true;
    if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(10), Command::new(&claude).arg("--version").output()).await {
        status.version = String::from_utf8_lossy(&output.stdout).split_whitespace().next().map(str::to_owned);
    }
    match tokio::time::timeout(Duration::from_secs(15), Command::new(&claude).args(["auth", "status"]).stdin(Stdio::null()).output()).await {
        Ok(Ok(output)) => {
            let value: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
            status.logged_in = value["loggedIn"].as_bool().unwrap_or(false);
            status.auth_method = value["authMethod"].as_str().map(str::to_owned);
            status.subscription = value["subscriptionType"].as_str().map(str::to_owned);
            if !status.logged_in {
                status.detail = Some("Claude Code is not signed in. Run `claude` in a terminal and sign in with your Claude account.".into());
            } else if status.auth_method.as_deref() != Some("claude.ai") {
                status.detail = Some("Claude Code is signed in with an API key or another provider, not a Claude subscription.".into());
            }
        }
        _ => status.detail = Some("Could not read Claude Code's sign-in status.".into()),
    }
    status
}

fn session_args(config: &SessionConfig, mcp_config: &str, resume: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        // Only BusterMark's tools: no built-in tools, no user MCP servers, no user/project settings or hooks.
        "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--permission-mode", "dontAsk",
    ].iter().map(|s| s.to_string()).collect();
    args.extend(["--mcp-config".into(), mcp_config.into(), "--allowedTools".into(), format!("mcp__{SERVER_NAME}")]);
    args.extend(["--system-prompt".into(), config.system.clone()]);
    if let Some(model) = &config.model { args.extend(["--model".into(), model.clone()]); }
    if let Some(effort) = &config.effort { args.extend(["--effort".into(), effort.clone()]); }
    if let Some(id) = resume { args.extend(["--resume".into(), id.into()]); }
    args
}

fn emit(app: &AppHandle, shared: &Shared, generation: u64, mut payload: Value) {
    // Output from a replaced or stopped process must not reach the new conversation state.
    if shared.generation.load(Ordering::SeqCst) == generation {
        payload["conversationId"] = json!(shared.conversation_id);
        payload["channelId"] = json!(*shared.channel_id.lock().unwrap());
        let _ = app.emit("assistant-event", payload);
    }
}

/// Emits an event and remembers when it was the turn's result.
fn report(app: &AppHandle, shared: &Shared, generation: u64, event: Value, answered: &std::sync::atomic::AtomicBool) {
    if event["kind"] == "result" { answered.store(true, Ordering::SeqCst); }
    emit(app, shared, generation, event);
}

/// Maps one line of Claude Code's stream-json output to a frontend event.
fn translate(line: &Value) -> Option<Value> {
    match (line["type"].as_str()?, line["subtype"].as_str()) {
        ("system", Some("init")) => Some(json!({"kind": "session", "sessionId": line["session_id"], "model": line["model"]})),
        ("system", Some("api_retry")) => Some(json!({"kind": "retry", "detail": line["error"]})),
        ("stream_event", _) => {
            let event = &line["event"];
            match event["type"].as_str()? {
                "message_start" => Some(json!({"kind": "message_start"})),
                "content_block_start" => Some(json!({"kind": "block_start", "blockType": event["content_block"]["type"], "name": event["content_block"]["name"]})),
                "content_block_delta" => match event["delta"]["type"].as_str()? {
                    "text_delta" => Some(json!({"kind": "text", "text": event["delta"]["text"]})),
                    "thinking_delta" => Some(json!({"kind": "thinking", "text": event["delta"]["thinking"]})),
                    _ => None,
                },
                _ => None,
            }
        }
        ("result", subtype) => Some(json!({
            "kind": "result", "subtype": subtype, "isError": line["is_error"], "text": line["result"],
            "usage": line["usage"], "durationMs": line["duration_ms"], "sessionId": line["session_id"],
        })),
        ("rate_limit_event", _) if line["rate_limit_info"]["status"] != "allowed" =>
            Some(json!({"kind": "rate_limit", "info": line["rate_limit_info"]})),
        _ => None,
    }
}

/// Turns one CLI's JSON lines into frontend events. Codex and OpenCode report whole messages, not
/// deltas; each becomes its own reply. OpenCode has no closing event, so the result is sent at the end.
enum Translator {
    Claude,
    Codex,
    Opencode { session: Option<String>, usage: (u64, u64, u64), failed: bool },
}

impl Translator {
    fn for_provider(provider: Provider) -> Self {
        match provider {
            Provider::Claude => Translator::Claude,
            Provider::Codex => Translator::Codex,
            Provider::Opencode => Translator::Opencode { session: None, usage: (0, 0, 0), failed: false },
        }
    }

    fn line(&mut self, line: &Value) -> Vec<Value> {
        let reply = |text: &Value| vec![json!({"kind": "message_start"}), json!({"kind": "text", "text": text})];
        match self {
            Translator::Claude => translate(line).into_iter().collect(),
            Translator::Codex => match line["type"].as_str().unwrap_or_default() {
                "thread.started" => vec![json!({"kind": "session", "sessionId": line["thread_id"]})],
                "item.completed" => match line["item"]["type"].as_str() {
                    Some("agent_message") => reply(&line["item"]["text"]),
                    Some("reasoning") => vec![json!({"kind": "thinking", "text": line["item"]["text"]})],
                    _ => vec![],
                },
                "turn.completed" => {
                    let usage = &line["usage"];
                    let cached = usage["cached_input_tokens"].as_u64().unwrap_or(0);
                    vec![json!({"kind": "result", "isError": false, "usage": {
                        "input_tokens": usage["input_tokens"].as_u64().unwrap_or(0).saturating_sub(cached),
                        "output_tokens": usage["output_tokens"], "cache_read_input_tokens": cached,
                    }})]
                }
                "turn.failed" => vec![json!({"kind": "result", "isError": true, "text": line["error"]["message"]})],
                "error" => vec![json!({"kind": "result", "isError": true, "text": line["message"]})],
                _ => vec![],
            },
            Translator::Opencode { session, usage, failed } => {
                let mut events = Vec::new();
                if session.is_none() {
                    if let Some(id) = line["sessionID"].as_str() {
                        *session = Some(id.to_owned());
                        events.push(json!({"kind": "session", "sessionId": id}));
                    }
                }
                let part = &line["part"];
                match line["type"].as_str().unwrap_or_default() {
                    "text" if part["text"].as_str().is_some_and(|t| !t.trim().is_empty()) => events.extend(reply(&part["text"])),
                    "reasoning" => events.push(json!({"kind": "thinking", "text": part["text"]})),
                    "step_finish" => {
                        let tokens = &part["tokens"];
                        usage.0 += tokens["input"].as_u64().unwrap_or(0);
                        usage.1 += tokens["output"].as_u64().unwrap_or(0);
                        usage.2 += tokens["cache"]["read"].as_u64().unwrap_or(0);
                    }
                    "error" => {
                        *failed = true;
                        let error = &line["error"];
                        let detail = error["data"]["message"].as_str().or_else(|| error["message"].as_str()).or_else(|| error["name"].as_str());
                        events.push(json!({"kind": "result", "isError": true, "text": detail.unwrap_or("OpenCode reported an error")}));
                    }
                    _ => {}
                }
                events
            }
        }
    }

    /// Events once the output ends: OpenCode's result.
    fn end(&mut self, exit_ok: bool) -> Vec<Value> {
        match self {
            Translator::Opencode { session, usage, failed: false } if exit_ok => vec![json!({"kind": "result", "isError": false, "sessionId": session,
                "usage": {"input_tokens": usage.0, "output_tokens": usage.1, "cache_read_input_tokens": usage.2}})],
            _ => vec![],
        }
    }
}

/// `codex exec --json`: only BusterMark's tools (pre-approved here; the writer approves changes in
/// the app), no shell, apps, plugins, web search, or user config. The prompt is read from stdin.
fn codex_turn_args(config: &SessionConfig, port: u16, resume: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["exec".into()];
    if resume.is_some() { args.push("resume".into()); }
    args.extend(["--json", "--skip-git-repo-check", "--ignore-user-config"].map(String::from));
    for feature in ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "image_generation", "browser_use", "computer_use", "view_image", "hooks"] {
        args.extend(["--disable".into(), feature.into()]);
    }
    let server = format!("mcp_servers.{SERVER_NAME}");
    for setting in [
        r#"sandbox_mode="read-only""#.to_string(), r#"web_search="disabled""#.to_string(),
        format!("developer_instructions={}", serde_json::to_string(&config.system).unwrap_or_default()),
        format!(r#"{server}.url="http://127.0.0.1:{port}/mcp""#),
        format!(r#"{server}.bearer_token_env_var="{CODEX_TOKEN_ENV}""#),
        format!(r#"{server}.default_tools_approval_mode="approve""#),
        format!("{server}.tool_timeout_sec={}", TOOL_TIMEOUT.as_secs()),
    ] {
        args.extend(["-c".into(), setting]);
    }
    if let Some(effort) = &config.effort { args.extend(["-c".into(), format!(r#"model_reasoning_effort="{effort}""#)]); }
    if let Some(model) = &config.model { args.extend(["--model".into(), model.clone()]); }
    if let Some(id) = resume { args.push(id.into()); }
    args.push("-".into());
    args
}

/// OpenCode's config for the Assistant: a `bustermark` agent with the system prompt and only
/// BusterMark's MCP tools; editing, shell, and web fetch are denied.
fn opencode_config(config: &SessionConfig, port: u16, token: &str) -> String {
    let tools = json!({"*": false, format!("{SERVER_NAME}_*"): true});
    json!({
        "$schema": "https://opencode.ai/config.json",
        "tools": tools,
        "permission": {"edit": "deny", "bash": "deny", "webfetch": "deny"},
        "mcp": {SERVER_NAME: {"type": "remote", "url": format!("http://127.0.0.1:{port}/mcp"),
            "headers": {"Authorization": format!("Bearer {token}")}, "enabled": true, "timeout": TOOL_TIMEOUT.as_millis() as u64}},
        "agent": {SERVER_NAME: {"mode": "primary", "prompt": config.system, "tools": tools}},
    }).to_string()
}

fn opencode_turn_args(config: &SessionConfig, resume: Option<&str>, text: &str) -> Vec<String> {
    let mut args: Vec<String> = ["run", "--pure", "--format", "json", "--agent", SERVER_NAME, "--title", "BusterMark Assistant"].map(String::from).to_vec();
    if let Some(model) = &config.model { args.extend(["--model".into(), model.clone()]); }
    if let Some(id) = resume { args.extend(["--session".into(), id.into()]); }
    args.extend(["--".into(), text.into()]);
    args
}

/// Starts the CLI for a chat: Claude Code for the whole conversation (messages go to its stdin), or
/// Codex/OpenCode for one message (`text`), continuing `resume`.
async fn spawn_session(app: &AppHandle, shared: &Arc<Shared>, config: SessionConfig, resume: Option<&str>, text: &str) -> Result<Session, String> {
    let provider = config.provider;
    let cli = super::ai_cli::find_cli(provider.binary()).await
        .ok_or_else(|| format!("{} is not installed. {}", provider.name(), provider.install_hint()))?;
    let (port, token) = ensure_server(app, shared).await?;
    // Sessions live in their own directory so they never mix with the writer's coding projects.
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assistant");
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Could not create the assistant folder: {e}"))?;
    let mut command = Command::new(cli);
    command.current_dir(&cwd)
        // An API key in the environment would take precedence over the subscription login.
        .env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN")
        .env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true);
    match provider {
        Provider::Claude => {
            let mcp_config = json!({"mcpServers": {SERVER_NAME: {
                "type": "http", "url": format!("http://127.0.0.1:{port}/mcp"),
                "headers": {"Authorization": format!("Bearer {token}")},
            }}}).to_string();
            command.args(session_args(&config, &mcp_config, resume)).env("MCP_TOOL_TIMEOUT", TOOL_TIMEOUT.as_millis().to_string());
        }
        Provider::Codex => { command.args(codex_turn_args(&config, port, resume)).env(CODEX_TOKEN_ENV, &token); }
        Provider::Opencode => {
            command.args(opencode_turn_args(&config, resume, text)).env("OPENCODE_CONFIG_CONTENT", opencode_config(&config, port, &token));
        }
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child: Child = command.spawn().map_err(|e| format!("Could not start {}: {e}", provider.name()))?;
    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut stdin = child.stdin.take().ok_or("The assistant's input is unavailable")?;
    let stdout = child.stdout.take().ok_or("The assistant's output is unavailable")?;
    let mut stderr = child.stderr.take().ok_or("The assistant's errors are unavailable")?;
    let pid = child.id();
    let stdin = match provider {
        Provider::Claude => Some(stdin),
        // Codex reads the message from stdin; closing it starts the turn.
        Provider::Codex => {
            stdin.write_all(text.as_bytes()).await.map_err(|_| "Codex stopped accepting the message")?;
            drop(stdin);
            None
        }
        Provider::Opencode => { drop(stdin); None }
    };

    let (done_tx, done_rx) = oneshot::channel::<bool>();
    // Whether the turn reported its result; a per-message process that did needs no exit event.
    let answered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (app_out, shared_out, answered_out) = (app.clone(), shared.clone(), answered.clone());
    tokio::spawn(async move {
        let mut translator = Translator::for_provider(provider);
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                for event in translator.line(&value) { report(&app_out, &shared_out, generation, event, &answered_out); }
            }
        }
        // The result follows the exit status, so a failed run is reported by the exit event instead.
        let exit_ok = done_rx.await.unwrap_or(false);
        for event in translator.end(exit_ok) { report(&app_out, &shared_out, generation, event, &answered_out); }
    });
    let (app_exit, shared_exit) = (app.clone(), shared.clone());
    tokio::spawn(async move {
        let mut tail = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut tail).await;
        let status = child.wait().await.ok();
        let success = status.is_some_and(|s| s.success());
        let _ = done_tx.send(success);
        // Let the output reader send its last events first.
        tokio::time::sleep(Duration::from_millis(50)).await;
        let detail = String::from_utf8_lossy(&tail);
        let detail: String = detail.trim().chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        // A Codex or OpenCode turn ends its process: that is only news when the turn did not finish.
        let quiet = provider != Provider::Claude && success && answered.load(Ordering::SeqCst);
        if !quiet {
            emit(&app_exit, &shared_exit, generation, json!({"kind": "exit", "code": status.and_then(|s| s.code()), "detail": detail}));
        }
        let mut session = shared_exit.session.lock().await;
        if session.as_ref().is_some_and(|s| s.generation == generation) {
            *session = None;
        }
    });
    Ok(Session { generation, config, stdin, pid })
}

#[command]
pub async fn assistant_send(app: AppHandle, state: State<'_, AssistantState>, request: SendRequest) -> Result<(), String> {
    validate(&request)?;
    let shared = conversation(&state, request.conversation_id.as_deref())?;
    let provider = request.provider.unwrap_or(Provider::Claude);
    let config = SessionConfig { provider, channel_id: request.channel_id, model: request.model, effort: request.effort, system: request.system, tools: request.tools };
    *shared.tools.lock().map_err(|_| "Assistant state unavailable")? = config.tools.clone();
    let mut guard = shared.session.lock().await;
    // Codex and OpenCode run one process per message; Claude Code restarts only when its settings change.
    if guard.as_ref().is_some_and(|s| s.config != config || provider != Provider::Claude) {
        stop_session(&shared, guard.take());
    }
    *shared.channel_id.lock().map_err(|_| "Assistant state unavailable")? = config.channel_id.clone();
    if guard.is_none() {
        *guard = Some(spawn_session(&app, &shared, config, request.resume.as_deref(), &request.text).await?);
    }
    if provider != Provider::Claude { return Ok(()); }
    let line = json!({"type": "user", "message": {"role": "user", "content": request.text}}).to_string() + "\n";
    let stdin = guard.as_mut().and_then(|s| s.stdin.as_mut()).ok_or("Claude Code is not running")?;
    stdin.write_all(line.as_bytes()).await.map_err(|_| "Claude Code stopped accepting messages")?;
    stdin.flush().await.map_err(|_| "Claude Code stopped accepting messages")?;
    Ok(())
}

/// Interrupts the current turn in place; the process and conversation stay alive.
#[command]
pub async fn assistant_interrupt(app: AppHandle, state: State<'_, AssistantState>, conversation_id: Option<String>) -> Result<(), String> {
    let shared = conversation(&state, conversation_id.as_deref())?;
    fail_pending(&shared);
    let mut guard = shared.session.lock().await;
    // A Codex or OpenCode turn is its own process: end it; the next message resumes the session.
    if let Some(session) = guard.as_ref().filter(|s| s.config.provider != Provider::Claude) {
        emit(&app, &shared, session.generation, json!({"kind": "result", "subtype": "interrupted", "isError": true}));
        stop_session(&shared, guard.take());
        return Ok(());
    }
    if let Some(session) = guard.as_mut() {
        let request = json!({"type": "control_request", "request_id": format!("interrupt-{}", shared.next_call.fetch_add(1, Ordering::SeqCst)), "request": {"subtype": "interrupt"}});
        let written = match session.stdin.as_mut() {
            Some(stdin) => stdin.write_all(format!("{request}\n").as_bytes()).await.is_ok(),
            None => false,
        };
        if !written {
            stop_session(&shared, guard.take());
        }
    }
    Ok(())
}

/// Ends the Claude Code process, for a new conversation or app shutdown.
#[command]
pub async fn assistant_reset(state: State<'_, AssistantState>, conversation_id: Option<String>) -> Result<(), String> {
    let shared = conversation(&state, conversation_id.as_deref())?;
    let session = shared.session.lock().await.take();
    stop_session(&shared, session);
    if let Some(server) = shared.server.lock().await.take() { server.task.abort(); }
    state.conversations.lock().map_err(|_| "Assistant state unavailable")?.remove(&shared.conversation_id);
    Ok(())
}

#[command]
pub fn assistant_tool_result(state: State<'_, AssistantState>, conversation_id: Option<String>, call_id: String, content: String, is_error: bool) -> Result<(), String> {
    let shared = conversation(&state, conversation_id.as_deref())?;
    let sender = shared.pending.lock().map_err(|_| "Assistant state unavailable")?.remove(&call_id);
    sender.ok_or("That tool call is no longer waiting")?.send(ToolReply { content, is_error })
        .map_err(|_| "Claude Code stopped waiting for that tool call".into())
}

fn stop_session(shared: &Shared, session: Option<Session>) {
    shared.generation.fetch_add(1, Ordering::SeqCst);
    fail_pending(shared);
    if let Some(session) = session {
        #[cfg(unix)]
        if let Some(pid) = session.pid {
            unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
        }
        drop(session);
    }
}

fn fail_pending(shared: &Shared) {
    if let Ok(mut pending) = shared.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(ToolReply { content: "Cancelled by the user before this ran.".into(), is_error: true });
        }
    }
}

// ── MCP server ────────────────────────────────────────────────────────────────

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))
        .map_err(|_| "Could not create an assistant access token")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

async fn ensure_server(app: &AppHandle, shared: &Arc<Shared>) -> Result<(u16, String), String> {
    let mut server = shared.server.lock().await;
    if let Some(s) = server.as_ref() {
        return Ok((s.port, s.token.clone()));
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("Could not start the assistant tool server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token()?;
    let (app, shared_accept, expected) = (app.clone(), shared.clone(), format!("Bearer {token}"));
    let task = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (app, shared, expected) = (app.clone(), shared_accept.clone(), expected.clone());
            tokio::spawn(async move { let _ = serve_connection(stream, &app, &shared, &expected).await; });
        }
    });
    *server = Some(McpServer { port, token: token.clone(), task });
    Ok((port, token))
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

async fn read_request(reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>) -> Result<Option<HttpRequest>, String> {
    let mut line = String::new();
    if reader.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or_default().to_owned(), parts.next().unwrap_or_default().to_owned());
    let mut headers = HashMap::new();
    let mut head_len = line.len();
    loop {
        let mut header = String::new();
        let n = reader.read_line(&mut header).await.map_err(|e| e.to_string())?;
        head_len += n;
        if n == 0 || head_len > 32 * 1024 { return Err("bad request head".into()); }
        let header = header.trim_end();
        if header.is_empty() { break; }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if length > MAX_HTTP_BODY || headers.contains_key("transfer-encoding") {
        return Err("unsupported body".into());
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    Ok(Some(HttpRequest { method, path, headers, body }))
}

async fn serve_connection(stream: TcpStream, app: &AppHandle, shared: &Arc<Shared>, expected_auth: &str) -> Result<(), String> {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    while let Some(request) = read_request(&mut reader).await? {
        // Browsers always send Origin; the MCP client does not. Rejecting it blocks DNS-rebinding pages.
        let (status, body) = if request.headers.contains_key("origin") {
            (403, None)
        } else if request.headers.get("authorization").map(String::as_str) != Some(expected_auth) {
            (401, None)
        } else if request.path != "/mcp" {
            (404, None)
        } else if request.method != "POST" {
            (405, None)
        } else {
            match serde_json::from_slice::<Value>(&request.body) {
                Ok(message) => match handle_rpc(app, shared, &message).await {
                    Some(reply) => (200, Some(reply)),
                    None => (202, None),
                },
                Err(_) => (400, None),
            }
        };
        let body = body.map(|v| v.to_string()).unwrap_or_default();
        let reason = match status { 200 => "OK", 202 => "Accepted", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", _ => "Method Not Allowed" };
        let head = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n", body.len());
        write.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;
        write.write_all(body.as_bytes()).await.map_err(|e| e.to_string())?;
        if request.headers.get("connection").is_some_and(|v| v.eq_ignore_ascii_case("close")) {
            break;
        }
    }
    Ok(())
}

async fn handle_rpc(app: &AppHandle, shared: &Arc<Shared>, message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone(); // Notifications get no response.
    let reply = |result: Value| json!({"jsonrpc": "2.0", "id": id, "result": result});
    let error = |code: i64, text: &str| json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": text}});
    Some(match message["method"].as_str().unwrap_or_default() {
        "initialize" => reply(json!({
            "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION")},
        })),
        "ping" => reply(json!({})),
        "tools/list" => reply(json!({"tools": shared.tools.lock().map(|tools| tools.iter().map(|t| json!({
            "name": t["name"], "description": t["description"], "inputSchema": t["input_schema"],
        })).collect::<Vec<_>>()).unwrap_or_default()})),
        "tools/call" => {
            let params = &message["params"];
            let call_id = format!("call-{}", shared.next_call.fetch_add(1, Ordering::SeqCst));
            let (tx, rx) = oneshot::channel();
            if let Ok(mut pending) = shared.pending.lock() { pending.insert(call_id.clone(), tx); }
            let _ = app.emit("assistant-tool-call", json!({
                "conversationId": shared.conversation_id, "channelId": *shared.channel_id.lock().unwrap(), "callId": call_id, "name": params["name"], "input": params["arguments"],
                "toolUseId": params["_meta"]["claudecode/toolUseId"],
            }));
            let result = tokio::time::timeout(TOOL_TIMEOUT, rx).await;
            if let Ok(mut pending) = shared.pending.lock() { pending.remove(&call_id); }
            let reply_value = match result {
                Ok(Ok(r)) => r,
                _ => ToolReply { content: "The tool call was cancelled or timed out.".into(), is_error: true },
            };
            reply(json!({"content": [{"type": "text", "text": reply_value.content}], "isError": reply_value.is_error}))
        }
        _ => error(-32601, "Method not found"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> SendRequest {
        SendRequest { conversation_id: None, channel_id: None, text: "Hi".into(), model: Some("claude-opus-5".into()), effort: Some("high".into()), system: "Be brief.".into(), tools: vec![], resume: None, provider: None }
    }

    #[test]
    fn validates_messages_models_efforts_and_resume_ids() {
        assert!(validate(&request()).is_ok());
        let mut r = request(); r.text = "  ".into(); assert!(validate(&r).is_err());
        let mut r = request(); r.model = Some("opus; rm".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.effort = Some("extreme".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.resume = Some("../x".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.resume = Some("cd801306-20df-4307-b2e7-ca37c34dd0a3".into()); assert!(validate(&r).is_ok());
        let mut r = request(); r.resume = Some("ses_eceed0abcffeGKyRiBU1Wpfdax".into()); assert!(validate(&r).is_ok());
        let mut r = request(); r.model = None; r.effort = None; assert!(validate(&r).is_ok());
        let mut r = request(); r.model = Some("claude-haiku-5-5".into()); r.effort = Some("low".into()); assert!(validate(&r).is_ok());
    }

    #[test]
    fn session_args_confine_claude_to_bustermark_tools() {
        let config = SessionConfig { provider: Provider::Claude, channel_id: None, model: Some("claude-opus-5".into()), effort: Some("max".into()), system: "Sys".into(), tools: vec![] };
        let args = session_args(&config, "{}", Some("abc-123"));
        let pair = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].as_str());
        assert_eq!(pair("--tools"), Some(""));
        assert_eq!(pair("--setting-sources"), Some(""));
        assert_eq!(pair("--allowedTools"), Some("mcp__bustermark"));
        assert_eq!(pair("--permission-mode"), Some("dontAsk"));
        assert_eq!(pair("--model"), Some("claude-opus-5"));
        assert_eq!(pair("--effort"), Some("max"));
        assert_eq!(pair("--resume"), Some("abc-123"));
        assert!(args.contains(&"--strict-mcp-config".to_string()) && !args.contains(&"--bare".to_string()));
        let default = session_args(&SessionConfig { provider: Provider::Claude, channel_id: None, model: None, effort: None, system: "Sys".into(), tools: vec![] }, "{}", None);
        assert!(!default.contains(&"--model".to_string()) && !default.contains(&"--effort".to_string()) && !default.contains(&"--resume".to_string()));
    }

    #[test]
    fn translates_stream_json_lines() {
        let t = |v: Value| translate(&v);
        assert_eq!(t(json!({"type": "system", "subtype": "init", "session_id": "s1", "model": "m"})).unwrap()["sessionId"], "s1");
        assert_eq!(t(json!({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}}})).unwrap(), json!({"kind": "text", "text": "Hi"}));
        assert_eq!(t(json!({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "Hm"}}})).unwrap()["kind"], "thinking");
        assert_eq!(t(json!({"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": "tool_use", "name": "mcp__bustermark__document_list"}}})).unwrap()["name"], "mcp__bustermark__document_list");
        let result = t(json!({"type": "result", "subtype": "error_during_execution", "is_error": true, "result": "", "usage": {"output_tokens": 3}})).unwrap();
        assert_eq!((result["kind"].as_str(), result["subtype"].as_str(), result["isError"].as_bool()), (Some("result"), Some("error_during_execution"), Some(true)));
        assert!(t(json!({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}})).is_none());
        assert_eq!(t(json!({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected"}})).unwrap()["kind"], "rate_limit");
        assert!(t(json!({"type": "assistant", "message": {}})).is_none());
        assert!(t(json!({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "signature_delta"}}})).is_none());
    }

    #[test]
    fn validates_efforts_per_provider() {
        let mut r = request(); r.provider = Some(Provider::Codex); r.effort = Some("max".into()); assert!(validate(&r).is_err());
        r.effort = Some("medium".into()); r.model = None; assert!(validate(&r).is_ok());
        let mut r = request(); r.provider = Some(Provider::Opencode); r.effort = Some("low".into()); assert!(validate(&r).is_err());
        r.effort = None; r.model = Some("anthropic/claude-sonnet-5-5".into()); assert!(validate(&r).is_ok());
    }

    #[test]
    fn codex_turns_use_only_bustermark_tools() {
        let config = SessionConfig { provider: Provider::Codex, channel_id: None, model: None, effort: Some("low".into()), system: "Say \"hi\".\nThen stop.".into(), tools: vec![] };
        let args = codex_turn_args(&config, 4242, None);
        assert_eq!(&args[..2], ["exec", "--json"]);
        assert!(args.contains(&"--ignore-user-config".to_string()) && args.contains(&"shell_tool".to_string()));
        assert!(args.contains(&r#"mcp_servers.bustermark.url="http://127.0.0.1:4242/mcp""#.to_string()));
        assert!(args.contains(&r#"mcp_servers.bustermark.default_tools_approval_mode="approve""#.to_string()));
        assert!(args.contains(&r#"developer_instructions="Say \"hi\".\nThen stop.""#.to_string()));
        assert!(args.contains(&r#"model_reasoning_effort="low""#.to_string()) && args.last().unwrap() == "-");
        let resumed = codex_turn_args(&config, 4242, Some("01a1-thread"));
        assert_eq!(&resumed[..2], ["exec", "resume"]);
        assert_eq!(&resumed[resumed.len() - 2..], ["01a1-thread", "-"]);
    }

    #[test]
    fn opencode_turns_use_a_bustermark_agent() {
        let config = SessionConfig { provider: Provider::Opencode, channel_id: None, model: None, effort: None, system: "Sys".into(), tools: vec![] };
        let args = opencode_turn_args(&config, Some("ses_1"), "-rf hello");
        assert_eq!(&args[args.len() - 2..], ["--", "-rf hello"]);
        assert!(args.windows(2).any(|w| w == ["--session", "ses_1"]) && args.windows(2).any(|w| w == ["--agent", "bustermark"]));
        let content: Value = serde_json::from_str(&opencode_config(&config, 4242, "tok")).unwrap();
        assert_eq!(content["tools"], json!({"*": false, "bustermark_*": true}));
        assert_eq!(content["mcp"]["bustermark"]["headers"]["Authorization"], "Bearer tok");
        assert_eq!(content["agent"]["bustermark"]["prompt"], "Sys");
    }

    #[test]
    fn translates_codex_and_opencode_events() {
        let mut codex = Translator::for_provider(Provider::Codex);
        assert_eq!(codex.line(&json!({"type": "thread.started", "thread_id": "t1"}))[0]["sessionId"], "t1");
        let reply = codex.line(&json!({"type": "item.completed", "item": {"type": "agent_message", "text": "Hi"}}));
        assert_eq!((reply[0]["kind"].as_str(), reply[1]["text"].as_str()), (Some("message_start"), Some("Hi")));
        let done = codex.line(&json!({"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 60, "output_tokens": 5}}));
        assert_eq!(done[0]["usage"], json!({"input_tokens": 40, "output_tokens": 5, "cache_read_input_tokens": 60}));
        assert_eq!(codex.line(&json!({"type": "turn.failed", "error": {"message": "Usage limit"}}))[0]["text"], "Usage limit");
        assert!(codex.line(&json!({"type": "item.started", "item": {"type": "mcp_tool_call"}})).is_empty());

        let mut open = Translator::for_provider(Provider::Opencode);
        let first = open.line(&json!({"type": "step_start", "sessionID": "ses_1"}));
        assert_eq!(first[0]["sessionId"], "ses_1");
        assert_eq!(open.line(&json!({"type": "text", "sessionID": "ses_1", "part": {"text": "Hello"}}))[1]["text"], "Hello");
        open.line(&json!({"type": "step_finish", "sessionID": "ses_1", "part": {"tokens": {"input": 10, "output": 3, "cache": {"read": 7}}}}));
        let end = open.end(true);
        assert_eq!((end[0]["isError"].as_bool(), end[0]["sessionId"].as_str()), (Some(false), Some("ses_1")));
        assert_eq!(end[0]["usage"]["cache_read_input_tokens"], 7);
        assert!(open.end(false).is_empty());
        let mut failed = Translator::for_provider(Provider::Opencode);
        assert_eq!(failed.line(&json!({"type": "error", "error": {"data": {"message": "Sign in"}}}))[0]["text"], "Sign in");
        assert!(failed.end(true).is_empty());
    }

    #[test]
    fn tokens_are_random_hex() {
        let (a, b) = (random_token().unwrap(), random_token().unwrap());
        assert_eq!(a.len(), 64);
        assert!(a != b && a.bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
