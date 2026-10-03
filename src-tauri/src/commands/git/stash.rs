use tauri::command;
use super::*;

#[command]
pub fn git_stash_save(workspace_root: String, message: Option<String>, include_untracked: Option<bool>) -> Result<String, String> {
    let mut args = vec!["stash", "push"];
    if include_untracked.unwrap_or(false) { args.push("-u"); }
    if let Some(ref m) = message { args.push("-m"); args.push(m); }
    let output = run_git(&workspace_root, &args)?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_stash_pop(workspace_root: String, index: Option<u32>) -> Result<String, String> {
    let stash_ref = index.map(|i| format!("stash@{{{}}}", i));
    let mut args = vec!["stash", "pop"];
    if let Some(ref r) = stash_ref { args.push(r); }
    let output = run_git(&workspace_root, &args)?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_stash_list(workspace_root: String) -> Result<Vec<GitStashEntry>, String> {
    let raw = run_git(&workspace_root, &["stash", "list", "--format=%gd|%gs|%ar"]);
    match raw {
        Ok(output) => {
            let mut entries = Vec::new();
            for line in output.lines() {
                let parts: Vec<&str> = line.splitn(3, '|').collect();
                if parts.len() < 3 { continue; }
                let idx_str = parts[0].trim_start_matches("stash@{").trim_end_matches('}');
                let index = idx_str.parse::<u32>().unwrap_or(0);
                entries.push(GitStashEntry {
                    index,
                    message: parts[1].to_string(),
                    date: parts[2].to_string(),
                });
            }
            Ok(entries)
        }
        Err(_) => Ok(Vec::new()), // No stashes
    }
}

#[command]
pub fn git_stash_drop(workspace_root: String, index: u32) -> Result<(), String> {
    let stash_ref = format!("stash@{{{}}}", index);
    run_git(&workspace_root, &["stash", "drop", &stash_ref])?;
    Ok(())
}
