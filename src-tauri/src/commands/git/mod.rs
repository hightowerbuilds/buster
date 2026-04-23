use std::collections::HashMap;
use std::process::Command;

pub mod status;
pub mod staging;
pub mod commit;
pub mod branch;
pub mod diff;
pub mod remote;
pub mod stash;
pub mod network;

pub use status::*;
pub use staging::*;
pub use commit::*;
pub use branch::*;
pub use diff::*;
pub use remote::*;
pub use stash::*;
pub use network::*;

// ── Shared types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,      // "M", "A", "D", "??", "R", "MM", etc.
    pub staged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConflictRegion {
    pub ours: String,
    pub theirs: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiffHunk {
    pub start_line: u32,
    pub line_count: u32,
    pub kind: String, // "add", "modify", "delete"
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitBlameLine {
    pub hash: String,
    pub author: String,
    pub timestamp: i64,
    pub line: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitCommitNode {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,      // branch/tag names
    pub parents: Vec<String>,   // parent hashes
    pub is_merge: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub tracking: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStashEntry {
    pub index: u32,
    pub message: String,
    pub date: String,
}

// ── Shared helpers ───────────────────────────────────────────────────

pub fn run_git(workspace: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git error: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn parse_hunk_range(s: &str) -> (u32, u32) {
    if let Some(comma) = s.find(',') {
        let start = s[..comma].parse::<u32>().unwrap_or(0);
        let count = s[comma + 1..].parse::<u32>().unwrap_or(0);
        (start, count)
    } else {
        let start = s.parse::<u32>().unwrap_or(0);
        (start, 1)
    }
}
