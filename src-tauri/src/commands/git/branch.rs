use tauri::command;
use super::*;

#[command]
pub fn git_branch(workspace_root: String) -> Result<String, String> {
    let branch = run_git(&workspace_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(branch.trim().to_string())
}

#[command]
pub fn git_branch_list(workspace_root: String) -> Result<Vec<GitBranchInfo>, String> {
    let raw = run_git(&workspace_root, &["branch", "-a", "--format=%(refname:short)|%(HEAD)|%(upstream:short)"])?;
    let mut branches = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.is_empty() { continue; }
        let name = parts[0].to_string();
        let is_current = parts.get(1).map(|s| s.trim() == "*").unwrap_or(false);
        let tracking = parts.get(2).and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        });
        let is_remote = name.contains('/');
        branches.push(GitBranchInfo { name, is_current, is_remote, tracking });
    }
    Ok(branches)
}

#[command]
pub fn git_branch_create(workspace_root: String, name: String, start_point: Option<String>) -> Result<(), String> {
    let mut args = vec!["checkout", "-b"];
    args.push(&name);
    if let Some(ref sp) = start_point { args.push(sp); }
    run_git(&workspace_root, &args)?;
    Ok(())
}

#[command]
pub fn git_branch_switch(workspace_root: String, name: String) -> Result<(), String> {
    run_git(&workspace_root, &["checkout", &name])?;
    Ok(())
}

#[command]
pub fn git_branch_delete(workspace_root: String, name: String, force: Option<bool>) -> Result<(), String> {
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    run_git(&workspace_root, &["branch", flag, &name])?;
    Ok(())
}

#[command]
pub fn git_ahead_behind(workspace_root: String) -> Result<(i32, i32), String> {
    let output = run_git(&workspace_root, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    match output {
        Ok(raw) => {
            let parts: Vec<&str> = raw.trim().split_whitespace().collect();
            if parts.len() == 2 {
                let ahead = parts[0].parse::<i32>().unwrap_or(0);
                let behind = parts[1].parse::<i32>().unwrap_or(0);
                Ok((ahead, behind))
            } else {
                Ok((0, 0))
            }
        }
        Err(_) => Ok((0, 0)), // No upstream configured
    }
}
