use tauri::command;
use super::*;

#[command]
pub fn git_stage(workspace_root: String, path: String) -> Result<(), String> {
    run_git(&workspace_root, &["add", "--", &path])?;
    Ok(())
}

#[command]
pub fn git_unstage(workspace_root: String, path: String) -> Result<(), String> {
    run_git(&workspace_root, &["restore", "--staged", "--", &path])?;
    Ok(())
}
