//! libsecret's CLI keeps credentials out of arguments and settings files.
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};

const HELP: &str = "Install libsecret (secret-tool) and unlock your desktop Secret Service, then retry saving the API key.";

async fn run(program: &str, args: &[&str], input: Option<&str>, timeout: Duration) -> Result<Option<String>, String> {
    let mut child = Command::new(program).args(args).kill_on_drop(true)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|_| format!("Secure credential storage is unavailable. {HELP}"))?;
    let operation = async move {
        if let Some(input) = input {
            let mut stdin = child.stdin.take().ok_or("Credential input unavailable")?;
            stdin.write_all(input.as_bytes()).await.map_err(|_| "Could not send credential to keyring")?;
            drop(stdin);
        }
        let output = child.wait_with_output().await.map_err(|_| "Credential service failed")?;
        if output.status.success() {
            String::from_utf8(output.stdout).map(|s| Some(s.trim_end_matches('\n').to_owned()))
                .map_err(|_| "Credential service returned invalid text".to_owned())
        } else if input.is_none() && output.status.code() == Some(1) && output.stderr.is_empty() {
            Ok(None) // No saved key is distinct from a locked or absent service.
        } else {
            Err(format!("The desktop keyring could not complete the request. {HELP}"))
        }
    };
    tokio::time::timeout(timeout, operation).await
        .map_err(|_| format!("The desktop keyring did not respond within 10 seconds. {HELP}"))?
}

pub async fn store(service: &str, provider: &str, key: &str) -> Result<(), String> {
    if key.len() > 16_384 { return Err("API key is too long".into()); }
    run("secret-tool", &["store", "--label=BusterMark AI", "service", service, "provider", provider],
        Some(key), Duration::from_secs(10)).await.map(|_| ())
}

pub async fn lookup(service: &str, provider: &str) -> Result<String, String> {
    run("secret-tool", &["lookup", "service", service, "provider", provider], None,
        Duration::from_secs(10)).await.map(|key| key.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires an isolated, unlocked desktop Secret Service"]
    async fn isolated_keyring_roundtrip() {
        let service = format!("com.hightowerbuilds.bustermark.test.{}", std::process::id());
        store(&service, "test-provider", "synthetic-test-key").await.unwrap();
        assert_eq!(lookup(&service, "test-provider").await.unwrap(), "synthetic-test-key");
        run("secret-tool", &["clear", "service", &service, "provider", "test-provider"],
            None, Duration::from_secs(10)).await.unwrap();
        assert_eq!(lookup(&service, "test-provider").await.unwrap(), "");
    }

    #[tokio::test]
    async fn secret_uses_stdin_and_missing_service_and_timeout_are_errors() {
        let timeout = Duration::from_secs(1);
        assert_eq!(run("/bin/cat", &[], Some("test-secret"), timeout).await.unwrap().unwrap(), "test-secret");
        assert!(run("/nonexistent/buster-secret-tool", &[], None, timeout).await.unwrap_err().contains("Install libsecret"));
        assert!(run("/bin/sleep", &["10"], None, Duration::from_millis(10)).await.unwrap_err().contains("did not respond"));
        assert!(run("/bin/false", &[], Some("test-secret"), timeout).await.is_err());
    }
}
