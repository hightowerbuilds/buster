use tauri::command;
use super::*;

/// Parse `git status --porcelain -u` output into structured file statuses.
fn parse_porcelain_status(raw: &str) -> Vec<GitFileStatus> {
    let mut files = Vec::new();
    for line in raw.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line.chars().nth(0).unwrap_or(' ');
        let work_status = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].to_string();

        let conflicted = matches!(
            (index_status, work_status),
            ('U', 'U') | ('A', 'A') | ('D', 'D') |
            ('U', 'A') | ('A', 'U') | ('U', 'D') | ('D', 'U')
        );

        let (status, staged) = if conflicted {
            (format!("{}{}", index_status, work_status), false)
        } else {
            match (index_status, work_status) {
                ('?', '?') => ("??".to_string(), false),
                ('A', ' ') => ("A".to_string(), true),
                ('M', ' ') => ("M".to_string(), true),
                ('D', ' ') => ("D".to_string(), true),
                ('R', ' ') => ("R".to_string(), true),
                (' ', 'M') => ("M".to_string(), false),
                (' ', 'D') => ("D".to_string(), false),
                ('M', 'M') => ("M".to_string(), false),
                ('A', 'M') => ("M".to_string(), false),
                _ => {
                    let s = format!("{}{}", index_status, work_status).trim().to_string();
                    let is_staged = index_status != ' ' && index_status != '?';
                    (s, is_staged)
                }
            }
        };

        files.push(GitFileStatus { path, status, staged, conflicted });
    }
    files
}

#[command]
pub fn git_status(workspace_root: String) -> Result<GitStatusResult, String> {
    // Get branch name
    let branch = run_git(&workspace_root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|_| "HEAD".to_string())
        .trim()
        .to_string();

    // Get file statuses
    let raw = run_git(&workspace_root, &["status", "--porcelain", "-u"])?;
    let files = parse_porcelain_status(&raw);

    Ok(GitStatusResult { branch, files })
}

#[command]
pub fn git_is_repo(workspace_root: String) -> Result<bool, String> {
    match run_git(&workspace_root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) => Ok(out.trim() == "true"),
        Err(_) => Ok(false),
    }
}

#[command]
pub fn git_conflict_markers(workspace_root: String, file_path: String) -> Result<Vec<ConflictRegion>, String> {
    let full_path = std::path::Path::new(&workspace_root).join(&file_path);
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mut regions = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        if lines[i].starts_with("<<<<<<<") {
            let start_line = i + 1; // 1-based
            let mut ours_lines = Vec::new();
            let mut theirs_lines = Vec::new();
            let mut found_separator = false;
            let mut end_line = start_line;
            i += 1;

            while i < lines.len() {
                if lines[i].starts_with("=======") {
                    found_separator = true;
                    i += 1;
                    continue;
                }
                if lines[i].starts_with(">>>>>>>") {
                    end_line = i + 1; // 1-based
                    break;
                }
                if found_separator {
                    theirs_lines.push(lines[i]);
                } else {
                    ours_lines.push(lines[i]);
                }
                i += 1;
            }

            if found_separator && end_line > start_line {
                regions.push(ConflictRegion {
                    ours: ours_lines.join("\n"),
                    theirs: theirs_lines.join("\n"),
                    start_line,
                    end_line,
                });
            }
        }
        i += 1;
    }

    Ok(regions)
}

#[command]
pub fn git_resolve_conflict(workspace_root: String, file_path: String, resolved_content: String) -> Result<(), String> {
    let full_path = std::path::Path::new(&workspace_root).join(&file_path);
    std::fs::write(&full_path, &resolved_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    run_git(&workspace_root, &["add", "--", &file_path])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_untracked_file() {
        let raw = "?? new_file.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new_file.txt");
        assert_eq!(files[0].status, "??");
        assert!(!files[0].staged);
    }

    #[test]
    fn parses_staged_added_file() {
        let raw = "A  added.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "A");
        assert!(files[0].staged);
    }

    #[test]
    fn parses_staged_modified_file() {
        let raw = "M  modified.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "M");
        assert!(files[0].staged);
    }

    #[test]
    fn parses_unstaged_modified_file() {
        let raw = " M unstaged.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "M");
        assert!(!files[0].staged);
    }

    #[test]
    fn parses_staged_deleted_file() {
        let raw = "D  deleted.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "D");
        assert!(files[0].staged);
    }

    #[test]
    fn parses_modified_in_both() {
        let raw = "MM both.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "M");
        assert!(!files[0].staged);
    }

    #[test]
    fn parses_multiple_files() {
        let raw = "?? untracked.txt\nM  staged.txt\n M modified.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, "??");
        assert_eq!(files[1].status, "M");
        assert!(files[1].staged);
        assert_eq!(files[2].status, "M");
        assert!(!files[2].staged);
    }

    #[test]
    fn skips_short_lines() {
        let raw = "ok\n?? real.txt\n";
        let files = parse_porcelain_status(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "real.txt");
    }

    #[test]
    fn empty_input_returns_empty() {
        let files = parse_porcelain_status("");
        assert_eq!(files.len(), 0);
    }
}
