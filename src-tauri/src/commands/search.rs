use std::path::Path;
use tauri::command;

/// Content search result for workspace-wide grep.
#[derive(serde::Serialize)]
pub struct SearchResult {
    pub path: String,
    pub relative_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub col: usize,
}

const MAX_FILE_SIZE: u64 = 1_024 * 1_024; // 1 MB
const MAX_RESULTS: usize = 50;

/// Search workspace file contents for a query string (case-insensitive).
/// Respects .gitignore. Skips binary and large files.
#[command]
pub fn workspace_search(workspace_root: String, query: String) -> Result<Vec<SearchResult>, String> {
    use ignore::WalkBuilder;

    if query.is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let root_path = Path::new(&workspace_root);
    let walker = WalkBuilder::new(&workspace_root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();

    let mut results = Vec::new();

    for entry in walker {
        if results.len() >= MAX_RESULTS {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }

        // Skip files larger than 1 MB
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }

        let file_path = entry.path();
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue, // skip binary / unreadable files
        };

        let abs_path = file_path.to_string_lossy().to_string();
        let rel_path = file_path
            .strip_prefix(root_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        for (line_idx, line) in content.lines().enumerate() {
            if results.len() >= MAX_RESULTS {
                break;
            }
            let line_lower = line.to_lowercase();
            if let Some(col) = line_lower.find(&query_lower) {
                results.push(SearchResult {
                    path: abs_path.clone(),
                    relative_path: rel_path.clone(),
                    line_number: line_idx + 1, // 1-based
                    line_content: line.to_string(),
                    col,
                });
            }
        }
    }

    Ok(results)
}

/// Walk a directory recursively and return all file paths (for command palette).
/// Respects .gitignore via the ignore crate.
#[command]
pub fn list_workspace_files(root: String) -> Result<Vec<WorkspaceFile>, String> {
    use ignore::WalkBuilder;

    let mut files = Vec::new();
    let walker = WalkBuilder::new(&root)
        .hidden(true) // skip hidden
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();

    let root_path = Path::new(&root);
    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_some_and(|ft| ft.is_file()) {
            let path = entry.path().to_string_lossy().to_string();
            let relative = entry
                .path()
                .strip_prefix(root_path)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .to_string();
            let name = entry
                .path()
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            files.push(WorkspaceFile {
                path,
                relative_path: relative,
                name,
            });
        }
    }

    Ok(files)
}

#[derive(serde::Serialize)]
pub struct WorkspaceFile {
    pub path: String,
    pub relative_path: String,
    pub name: String,
}
