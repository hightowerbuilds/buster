use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::config::SandboxConfig;
use crate::error::SandboxError;
use crate::os_sandbox::OsSandbox;
use crate::policy::{ExecutionPolicy, PolicyVerdict};
use crate::types::{ExecutionRequest, ExecutionResult, ExitStatus};

/// Execute a command inside the sandbox.
///
/// This is the main entry point. It:
/// 1. Evaluates the request against the policy (allowlist, workspace bounds)
/// 2. Resolves the program to an absolute path
/// 3. Spawns the process directly (no sh -c)
/// 4. Enforces resource limits (timeout, output size)
/// 5. Captures and returns output
pub fn execute(
    config: &SandboxConfig,
    request: &ExecutionRequest,
) -> Result<ExecutionResult, SandboxError> {
    // Step 1: Policy check
    let policy = ExecutionPolicy::new(config.clone());
    match policy.evaluate(request) {
        PolicyVerdict::Allow => {}
        PolicyVerdict::Deny(reason) => {
            return Ok(ExecutionResult {
                status: ExitStatus::Denied,
                stdout: Vec::new(),
                stderr: reason.into_bytes(),
                truncated: false,
            });
        }
    }

    // Step 2: Resolve program path
    let program_path = config.resolve_program(&request.program)?;

    // Step 3: Build the command — direct exec, no shell
    let mut cmd = Command::new(&program_path);
    cmd.args(&request.args)
        .current_dir(&request.working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Set stdin
    if request.stdin.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }

    // Apply environment: start clean, add only what's specified
    cmd.env_clear();
    cmd.env(
        "PATH",
        config
            .program_search_paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(":"),
    );
    cmd.env("HOME", std::env::var("HOME").unwrap_or_default());
    cmd.env("LANG", "en_US.UTF-8");

    for (key, value) in &request.env {
        cmd.env(key, value);
    }

    // Step 3b: Apply OS-level sandbox (Seatbelt on macOS, seccomp on Linux)
    let os_sandbox = OsSandbox::from_capabilities(
        config.workspace_root.clone(),
        &request.capabilities,
    );
    os_sandbox.apply(&mut cmd)?;

    // Step 4: Spawn
    let mut child = cmd.spawn()?;

    // Write stdin if provided
    if let Some(stdin_data) = &request.stdin {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(stdin_data);
        }
    }

    // Step 5: Capture output and enforce timeout using threads.
    //
    // Pipe reads block until the process closes its stdout/stderr (i.e., exits).
    // We read in background threads so the main thread can enforce the timeout.
    let max_output = request.limits.max_output_bytes as usize;
    let timeout = request.limits.timeout;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let max_out = max_output;
    let stdout_handle = std::thread::spawn(move || read_pipe(stdout_pipe, max_out));

    let max_err = max_output;
    let stderr_handle = std::thread::spawn(move || read_pipe(stderr_pipe, max_err));

    // Poll for exit with timeout
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let (stdout_buf, trunc_out) = stdout_handle.join().unwrap_or_default();
            let (stderr_buf, trunc_err) = stderr_handle.join().unwrap_or_default();
            return Ok(ExecutionResult {
                status: ExitStatus::Timeout,
                stdout: stdout_buf,
                stderr: stderr_buf,
                truncated: trunc_out || trunc_err,
            });
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let (stdout_buf, trunc_out) = stdout_handle.join().unwrap_or_default();
                let (stderr_buf, trunc_err) = stderr_handle.join().unwrap_or_default();
                return Ok(ExecutionResult {
                    status: match status.code() {
                        Some(code) => ExitStatus::Code(code),
                        None => ExitStatus::Code(-1),
                    },
                    stdout: stdout_buf,
                    stderr: stderr_buf,
                    truncated: trunc_out || trunc_err,
                });
            }
            Ok(None) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(SandboxError::SpawnFailed(e)),
        }
    }
}

/// Read from a pipe into a buffer, respecting a size limit.
fn read_pipe(
    pipe: Option<impl Read>,
    max_bytes: usize,
) -> (Vec<u8>, bool) {
    let Some(mut pipe) = pipe else {
        return (Vec::new(), false);
    };

    let mut buf = vec![0u8; 8192];
    let mut output = Vec::new();
    let mut truncated = false;

    loop {
        match pipe.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let remaining = max_bytes.saturating_sub(output.len());
                if remaining == 0 {
                    truncated = true;
                    break;
                }
                let take = n.min(remaining);
                output.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }

    (output, truncated)
}
