use tauri::command;
use super::*;

#[command]
pub fn git_remote_list(workspace_root: String) -> Result<Vec<GitRemote>, String> {
    let raw = run_git(&workspace_root, &["remote", "-v"])?;
    let mut seen = HashMap::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            seen.entry(parts[0].to_string())
                .or_insert_with(|| parts[1].to_string());
        }
    }
    Ok(seen.into_iter().map(|(name, url)| GitRemote { name, url }).collect())
}

#[command]
pub fn git_remote_add(workspace_root: String, name: String, url: String) -> Result<(), String> {
    run_git(&workspace_root, &["remote", "add", &name, &url])?;
    Ok(())
}

#[command]
pub fn git_remote_remove(workspace_root: String, name: String) -> Result<(), String> {
    run_git(&workspace_root, &["remote", "remove", &name])?;
    Ok(())
}

#[command]
pub fn git_remote_rename(workspace_root: String, old_name: String, new_name: String) -> Result<(), String> {
    run_git(&workspace_root, &["remote", "rename", &old_name, &new_name])?;
    Ok(())
}

#[command]
pub fn git_remote_set_url(workspace_root: String, name: String, url: String) -> Result<(), String> {
    run_git(&workspace_root, &["remote", "set-url", &name, &url])?;
    Ok(())
}
