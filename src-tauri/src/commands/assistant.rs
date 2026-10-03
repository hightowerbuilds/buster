//! The Assistant runs through the writer's locally installed, logged-in Claude Code CLI, so it uses
//! their Claude subscription rather than an API key. BusterMark starts `claude -p` in streaming JSON
//! mode with every built-in tool disabled, and serves its own command catalog to it as an MCP server
//! on 127.0.0.1. Tool calls are forwarded to the frontend, which asks the writer before any change.
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
    channel_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    system: String,
    tools: Vec<Value>,
}

struct Session {
    generation: u64,
    config: SessionConfig,
    stdin: ChildStdin,
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
    !model.is_empty() && model.len() <= 100 && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.[]".contains(&c))
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
    if request.effort.as_deref().is_some_and(|e| !EFFORTS.contains(&e)) {
        return Err("Effort must be low, medium, high, xhigh or max".into());
    }
    if request.resume.as_deref().is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')) {
        return Err("Invalid conversation ID".into());
    }
    if request.tools.len() > 128 || request.system.len() > 64 * 1024 {
        return Err("Too many tools or an oversized system prompt".into());
    }
    Ok(())
}

/// A GUI launch may not inherit the shell PATH that finds `claude`, so fall back to a login shell
/// and the usual install locations.
async fn find_claude() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).map(|dir| dir.join("claude")).find(|p| p.is_file())
    }) {
        return Some(path);
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(5),
        Command::new(&shell).args(["-lc", "command -v claude"]).stdin(Stdio::null()).output()).await
    {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if output.status.success() && found.starts_with('/') {
            return Some(PathBuf::from(found));
        }
    }
    let home = dirs::home_dir()?;
    [".local/bin/claude", ".claude/local/claude", ".local/share/mise/shims/claude", ".npm-global/bin/claude"]
        .iter().map(|p| home.join(p)).find(|p| p.is_file())
}

#[command]
pub async fn assistant_status() -> CliStatus {
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

async fn spawn_session(app: &AppHandle, shared: &Arc<Shared>, config: SessionConfig, resume: Option<&str>) -> Result<Session, String> {
    let claude = find_claude().await.ok_or("Claude Code is not installed")?;
    let mcp = ensure_server(app, shared).await?;
    let mcp_config = json!({"mcpServers": {SERVER_NAME: {
        "type": "http", "url": format!("http://127.0.0.1:{}/mcp", mcp.0),
        "headers": {"Authorization": format!("Bearer {}", mcp.1)},
    }}}).to_string();
    // Sessions live in their own directory so they never mix with the writer's coding projects.
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assistant");
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Could not create the assistant folder: {e}"))?;
    let mut command = Command::new(claude);
    command.args(session_args(&config, &mcp_config, resume))
        .current_dir(&cwd)
        // An API key in the environment would take precedence over the subscription login.
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .env("MCP_TOOL_TIMEOUT", TOOL_TIMEOUT.as_millis().to_string())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child: Child = command.spawn().map_err(|e| format!("Could not start Claude Code: {e}"))?;
    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let stdin = child.stdin.take().ok_or("Claude Code input unavailable")?;
    let stdout = child.stdout.take().ok_or("Claude Code output unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Claude Code errors unavailable")?;
    let pid = child.id();

    let (app_out, shared_out) = (app.clone(), shared.clone());
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = serde_json::from_str::<Value>(&line).ok().as_ref().and_then(translate) {
                emit(&app_out, &shared_out, generation, event);
            }
        }
    });
    let (app_exit, shared_exit) = (app.clone(), shared.clone());
    tokio::spawn(async move {
        let mut tail = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut tail).await;
        let status = child.wait().await.ok();
        let detail = String::from_utf8_lossy(&tail);
        let detail: String = detail.trim().chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        emit(&app_exit, &shared_exit, generation, json!({"kind": "exit", "code": status.and_then(|s| s.code()), "detail": detail}));
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
    let config = SessionConfig { channel_id: request.channel_id, model: request.model, effort: request.effort, system: request.system, tools: request.tools };
    *shared.tools.lock().map_err(|_| "Assistant state unavailable")? = config.tools.clone();
    let mut guard = shared.session.lock().await;
    if guard.as_ref().is_some_and(|s| s.config != config) {
        stop_session(&shared, guard.take());
    }
    *shared.channel_id.lock().map_err(|_| "Assistant state unavailable")? = config.channel_id.clone();
    if guard.is_none() {
        *guard = Some(spawn_session(&app, &shared, config, request.resume.as_deref()).await?);
    }
    let line = json!({"type": "user", "message": {"role": "user", "content": request.text}}).to_string() + "\n";
    let session = guard.as_mut().ok_or("Claude Code is not running")?;
    session.stdin.write_all(line.as_bytes()).await.map_err(|_| "Claude Code stopped accepting messages")?;
    session.stdin.flush().await.map_err(|_| "Claude Code stopped accepting messages")?;
    Ok(())
}

/// Interrupts the current turn in place; the process and conversation stay alive.
#[command]
pub async fn assistant_interrupt(state: State<'_, AssistantState>, conversation_id: Option<String>) -> Result<(), String> {
    let shared = conversation(&state, conversation_id.as_deref())?;
    fail_pending(&shared);
    let mut guard = shared.session.lock().await;
    if let Some(session) = guard.as_mut() {
        let request = json!({"type": "control_request", "request_id": format!("interrupt-{}", shared.next_call.fetch_add(1, Ordering::SeqCst)), "request": {"subtype": "interrupt"}});
        if session.stdin.write_all(format!("{request}\n").as_bytes()).await.is_err() {
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
        SendRequest { conversation_id: None, channel_id: None, text: "Hi".into(), model: Some("claude-opus-5".into()), effort: Some("high".into()), system: "Be brief.".into(), tools: vec![], resume: None }
    }

    #[test]
    fn validates_messages_models_efforts_and_resume_ids() {
        assert!(validate(&request()).is_ok());
        let mut r = request(); r.text = "  ".into(); assert!(validate(&r).is_err());
        let mut r = request(); r.model = Some("opus; rm".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.effort = Some("extreme".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.resume = Some("../x".into()); assert!(validate(&r).is_err());
        let mut r = request(); r.resume = Some("cd801306-20df-4307-b2e7-ca37c34dd0a3".into()); assert!(validate(&r).is_ok());
        let mut r = request(); r.model = None; r.effort = None; assert!(validate(&r).is_ok());
    }

    #[test]
    fn session_args_confine_claude_to_bustermark_tools() {
        let config = SessionConfig { channel_id: None, model: Some("claude-opus-5".into()), effort: Some("max".into()), system: "Sys".into(), tools: vec![] };
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
        let default = session_args(&SessionConfig { channel_id: None, model: None, effort: None, system: "Sys".into(), tools: vec![] }, "{}", None);
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
    fn tokens_are_random_hex() {
        let (a, b) = (random_token().unwrap(), random_token().unwrap());
        assert_eq!(a.len(), 64);
        assert!(a != b && a.bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
