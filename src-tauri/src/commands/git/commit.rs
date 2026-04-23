use tauri::command;
use super::*;

#[command]
pub fn git_commit(workspace_root: String, message: String) -> Result<String, String> {
    let output = run_git(&workspace_root, &["commit", "-m", &message])?;
    Ok(output.trim().to_string())
}

#[command]
pub fn git_commit_amend(workspace_root: String, message: Option<String>) -> Result<String, String> {
    let output = match message {
        Some(ref m) => run_git(&workspace_root, &["commit", "--amend", "-m", m])?,
        None => run_git(&workspace_root, &["commit", "--amend", "--no-edit"])?,
    };
    Ok(output.trim().to_string())
}
