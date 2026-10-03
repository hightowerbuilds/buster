use tauri::command;
use super::*;

#[command]
pub fn git_push(workspace_root: String, remote: Option<String>, branch: Option<String>, force: Option<bool>) -> Result<String, String> {
    let mut args = vec!["push"];
    if force.unwrap_or(false) { args.push("--force-with-lease"); }
    let r = remote.unwrap_or_else(|| "origin".into());
    args.push(&r);
    if let Some(ref b) = branch { args.push(b); }
    let output = run_git(&workspace_root, &args)?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_pull(workspace_root: String, remote: Option<String>, branch: Option<String>, rebase: Option<bool>) -> Result<String, String> {
    let mut args = vec!["pull"];
    if rebase.unwrap_or(false) { args.push("--rebase"); }
    let r = remote.unwrap_or_else(|| "origin".into());
    args.push(&r);
    if let Some(ref b) = branch { args.push(b); }
    let output = run_git(&workspace_root, &args)?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_fetch(workspace_root: String, remote: Option<String>, prune: Option<bool>) -> Result<String, String> {
    let mut args = vec!["fetch"];
    if prune.unwrap_or(false) { args.push("--prune"); }
    match &remote {
        Some(r) => args.push(r),
        None => args.push("--all"),
    }
    let output = run_git(&workspace_root, &args)?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_log_graph(workspace_root: String, count: Option<u32>) -> Result<Vec<GitCommitNode>, String> {
    let limit = count.unwrap_or(80).to_string();
    // Use a structured format we can parse reliably.
    // --abbrev=7 ensures %h and parent truncation lengths match.
    let raw = run_git(&workspace_root, &[
        "log",
        "--all",
        "--abbrev=7",
        &format!("-{}", limit),
        "--format=%H|%h|%s|%an|%ar|%D|%P",
    ])?;

    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(7, '|').collect();
        if parts.len() < 7 { continue; }

        let refs: Vec<String> = parts[5]
            .split(", ")
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect();

        let parents: Vec<String> = parts[6]
            .split(' ')
            .filter(|s| !s.is_empty())
            .map(|s| s[..7.min(s.len())].to_string())
            .collect();

        commits.push(GitCommitNode {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            message: parts[2].to_string(),
            author: parts[3].to_string(),
            date: parts[4].to_string(),
            is_merge: parents.len() > 1,
            refs,
            parents,
        });
    }

    Ok(commits)
}
