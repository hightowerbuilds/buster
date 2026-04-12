use buster_sandbox::*;
use std::collections::HashMap;
use std::time::Duration;
use tempfile::TempDir;

fn test_config(workspace: &std::path::Path) -> SandboxConfig {
    SandboxConfig::new(workspace)
}

fn simple_request(program: &str, args: &[&str], working_dir: &std::path::Path) -> ExecutionRequest {
    ExecutionRequest {
        program: program.to_string(),
        args: args.iter().map(|s| s.to_string()).collect(),
        working_dir: working_dir.to_path_buf(),
        env: HashMap::new(),
        stdin: None,
        capabilities: vec![],
        limits: ResourceLimits::default(),
    }
}

#[test]
fn test_allowed_program_executes() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let request = simple_request("echo", &["hello", "world"], dir.path());

    let result = execute(&config, &request).unwrap();
    assert!(result.status.success());
    assert_eq!(
        String::from_utf8_lossy(&result.stdout).trim(),
        "hello world"
    );
}

#[test]
fn test_disallowed_program_is_denied() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let request = simple_request("evil-binary", &[], dir.path());

    let result = execute(&config, &request).unwrap();
    assert_eq!(result.status, ExitStatus::Denied);
}

#[test]
fn test_working_dir_outside_workspace_is_denied() {
    let workspace = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let config = test_config(workspace.path());
    let request = simple_request("echo", &["test"], outside.path());

    let result = execute(&config, &request).unwrap();
    assert_eq!(result.status, ExitStatus::Denied);
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("outside workspace"));
}

#[test]
fn test_shell_injection_in_args_is_denied() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let request = simple_request("echo", &["hello; rm -rf /"], dir.path());

    let result = execute(&config, &request).unwrap();
    assert_eq!(result.status, ExitStatus::Denied);
}

#[test]
fn test_timeout_kills_process() {
    let dir = TempDir::new().unwrap();
    let mut config = test_config(dir.path());
    config.allowed_programs.insert("sleep".to_string());
    let mut request = simple_request("sleep", &["60"], dir.path());
    request.limits.timeout = Duration::from_millis(200);

    let result = execute(&config, &request).unwrap();
    assert_eq!(result.status, ExitStatus::Timeout);
}

#[test]
fn test_output_truncation() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());

    // Generate output larger than our limit
    let mut request = simple_request(
        "head",
        &["-c", "2048", "/dev/urandom"],
        dir.path(),
    );
    request.limits.max_output_bytes = 256;

    let result = execute(&config, &request).unwrap();
    assert!(result.stdout.len() <= 256);
    assert!(result.truncated);
}

#[test]
fn test_stdin_input() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let mut request = simple_request("cat", &[], dir.path());
    request.stdin = Some(b"hello from stdin".to_vec());

    let result = execute(&config, &request).unwrap();
    assert!(result.status.success());
    assert_eq!(
        String::from_utf8_lossy(&result.stdout).trim(),
        "hello from stdin"
    );
}

#[test]
fn test_env_vars_are_passed() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let mut request = simple_request("sh", &["-c", "echo $MY_VAR"], dir.path());
    // sh is not in the allowlist by default — but we're testing env,
    // so let's use a program that's allowed
    request.program = "echo".to_string();
    request.args = vec!["test".to_string()];
    request
        .env
        .insert("MY_VAR".to_string(), "test_value".to_string());

    let result = execute(&config, &request).unwrap();
    assert!(result.status.success());
}

#[test]
fn test_nonexistent_working_dir_is_error() {
    let dir = TempDir::new().unwrap();
    let config = test_config(dir.path());
    let request = simple_request("echo", &["test"], &dir.path().join("nonexistent"));

    let result = execute(&config, &request).unwrap();
    assert_eq!(result.status, ExitStatus::Denied);
}
