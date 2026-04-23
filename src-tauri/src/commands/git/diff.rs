use tauri::command;
use super::*;

#[command]
pub fn git_diff_file(workspace_root: String, path: String) -> Result<String, String> {
    // Returns unified diff for a file (working tree vs HEAD)
    let diff = run_git(&workspace_root, &["diff", "--", &path])
        .unwrap_or_default();
    Ok(diff)
}

#[command]
pub fn git_diff_staged(workspace_root: String, path: String) -> Result<String, String> {
    let diff = run_git(&workspace_root, &["diff", "--cached", "--", &path])
        .unwrap_or_default();
    Ok(diff)
}

#[command]
pub fn git_diff_hunks(workspace_root: String, path: String) -> Result<Vec<DiffHunk>, String> {
    let raw = run_git(&workspace_root, &["diff", "--unified=0", "HEAD", "--", &path])
        .unwrap_or_default();

    let mut hunks = Vec::new();
    for line in raw.lines() {
        if !line.starts_with("@@") {
            continue;
        }
        // Parse @@ -old_start[,old_count] +new_start[,new_count] @@
        let parts: Vec<&str> = line.splitn(4, ' ').collect();
        if parts.len() < 3 {
            continue;
        }

        let old_part = parts[1].trim_start_matches('-');
        let new_part = parts[2].trim_start_matches('+');

        let old_count = parse_hunk_range(old_part).1;
        let (new_start, new_count) = parse_hunk_range(new_part);

        let kind = if old_count == 0 && new_count > 0 {
            "add"
        } else if old_count > 0 && new_count == 0 {
            "delete"
        } else {
            "modify"
        };

        hunks.push(DiffHunk {
            start_line: new_start,
            line_count: new_count,
            kind: kind.to_string(),
        });
    }

    Ok(hunks)
}

#[command]
pub fn git_blame(workspace_root: String, path: String) -> Result<Vec<GitBlameLine>, String> {
    let raw = run_git(&workspace_root, &["blame", "--porcelain", &path])?;
    let mut result: Vec<GitBlameLine> = Vec::new();

    // Cache commit metadata -- porcelain only emits author/author-time on the
    // FIRST occurrence of each commit hash. Subsequent lines reuse the hash
    // with a short header (no metadata lines). Without this cache, repeated
    // commits would inherit stale author/timestamp from the previous entry.
    let mut commit_cache: HashMap<String, (String, i64)> = HashMap::new();

    let mut current_hash = String::new();
    let mut current_final_line: usize = 0;
    let mut current_author = String::new();
    let mut current_timestamp: i64 = 0;

    for line in raw.lines() {
        if line.starts_with('\t') {
            // Content line marks the end of an entry.
            // If we didn't see author/author-time lines (repeated commit),
            // look up from the cache.
            if let Some((cached_author, cached_ts)) = commit_cache.get(&current_hash) {
                if current_author.is_empty() {
                    current_author = cached_author.clone();
                    current_timestamp = *cached_ts;
                }
            }
            // Store in cache for future lookups
            if !current_author.is_empty() {
                commit_cache.entry(current_hash.clone())
                    .or_insert_with(|| (current_author.clone(), current_timestamp));
            }

            result.push(GitBlameLine {
                hash: current_hash.clone(),
                author: current_author.clone(),
                timestamp: current_timestamp,
                line: current_final_line,
            });
            // Reset per-entry state for next block
            current_author = String::new();
            current_timestamp = 0;
        } else if line.starts_with("author ") {
            current_author = line[7..].to_string();
        } else if line.starts_with("author-time ") {
            current_timestamp = line[12..].parse::<i64>().unwrap_or(0);
        } else {
            // Commit header: <40-char-hash> <orig> <final> [<count>]
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && parts[0].len() == 40 && parts[0].chars().all(|c| c.is_ascii_hexdigit()) {
                current_hash = parts[0].to_string();
                current_final_line = parts[2].parse::<usize>().unwrap_or(1);
            }
        }
    }

    Ok(result)
}

#[command]
pub fn git_show_file(workspace_root: String, path: String) -> Result<String, String> {
    // Get the HEAD version of a file
    let ref_path = format!("HEAD:{}", path);
    let content = run_git(&workspace_root, &["show", &ref_path])
        .unwrap_or_default();
    Ok(content)
}
