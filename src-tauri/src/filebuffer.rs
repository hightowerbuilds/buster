//! Large file buffer — holds files in Rust memory and serves line ranges to the frontend.
//!
//! Files under the threshold are loaded normally (frontend holds entire string[]).
//! Files over the threshold are held here, and the frontend requests line windows on demand.

use memmap2::Mmap;
use std::collections::HashMap;
use std::fs::{self, File};
use std::sync::Mutex;
use std::time::SystemTime;

/// 1 MB threshold — files larger than this use the chunked path.
pub const LARGE_FILE_THRESHOLD: u64 = 1_024 * 1_024;

/// A memory-mapped file with precomputed line offsets for O(1) line lookup.
struct MappedFile {
    path: String,
    _mmap: Mmap,
    /// Byte offset of the start of each line (including line 0 at offset 0).
    line_offsets: Vec<usize>,
    /// Raw pointer + length for safe string slicing from the mmap.
    data: *const u8,
    data_len: usize,
    /// File metadata at map time — used to detect changes.
    mtime: SystemTime,
    file_size: u64,
}

// SAFETY: Mmap is Send+Sync, and we only read through data pointer while mmap is alive.
unsafe impl Send for MappedFile {}
unsafe impl Sync for MappedFile {}

impl MappedFile {
    fn open(path: &str) -> Result<Self, String> {
        let meta = fs::metadata(path).map_err(|e| format!("Failed to stat file: {}", e))?;
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let file_size = meta.len();

        let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
        let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("Failed to mmap: {}", e))?;

        let data = mmap.as_ptr();
        let data_len = mmap.len();
        let bytes = &mmap[..];

        // Precompute line offsets
        let mut offsets = vec![0usize];
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' && i + 1 < data_len {
                offsets.push(i + 1);
            }
        }

        Ok(MappedFile {
            path: path.to_string(),
            _mmap: mmap,
            line_offsets: offsets,
            data,
            data_len,
            mtime,
            file_size,
        })
    }

    /// Check if the file on disk has changed since we mapped it.
    fn is_stale(&self) -> bool {
        match fs::metadata(&self.path) {
            Ok(meta) => {
                let current_mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                let current_size = meta.len();
                current_mtime != self.mtime || current_size != self.file_size
            }
            Err(_) => true, // File deleted or inaccessible
        }
    }

    fn line_count(&self) -> usize {
        self.line_offsets.len()
    }

    fn get_line(&self, line_idx: usize) -> Option<&str> {
        if line_idx >= self.line_offsets.len() {
            return None;
        }

        let start = self.line_offsets[line_idx];
        let end = if line_idx + 1 < self.line_offsets.len() {
            // Next line's offset minus the newline char
            let next = self.line_offsets[line_idx + 1];
            if next > 0 && start < next { next - 1 } else { next }
        } else {
            self.data_len
        };

        // Strip trailing \r for CRLF files
        let mut actual_end = end;
        if actual_end > start {
            let bytes = unsafe { std::slice::from_raw_parts(self.data, self.data_len) };
            if bytes[actual_end - 1] == b'\r' {
                actual_end -= 1;
            }
        }

        let bytes = unsafe { std::slice::from_raw_parts(self.data.add(start), actual_end - start) };
        std::str::from_utf8(bytes).ok()
    }

    fn get_lines(&self, start_line: usize, count: usize) -> Vec<String> {
        let end = std::cmp::min(start_line + count, self.line_count());
        (start_line..end)
            .filter_map(|i| self.get_line(i).map(|s| s.to_string()))
            .collect()
    }
}

/// Manages all open large file buffers.
pub struct FileBufferManager {
    buffers: Mutex<HashMap<String, MappedFile>>,
}

impl Default for FileBufferManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FileBufferManager {
    pub fn new() -> Self {
        Self {
            buffers: Mutex::new(HashMap::new()),
        }
    }

    /// Open a large file. Returns the total line count.
    pub fn open(&self, path: &str) -> Result<usize, String> {
        let mapped = MappedFile::open(path)?;
        let count = mapped.line_count();
        self.buffers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(path.to_string(), mapped);
        Ok(count)
    }

    /// Read a range of lines from an open buffer. Re-maps if the file changed on disk.
    pub fn read_lines(&self, path: &str, start: usize, count: usize) -> Result<Vec<String>, String> {
        let mut buffers = self.buffers.lock().unwrap_or_else(|e| e.into_inner());

        // Check if file changed on disk — re-map if stale
        let needs_remap = buffers.get(path).is_some_and(|m| m.is_stale());
        if needs_remap {
            let remapped = MappedFile::open(path)?;
            buffers.insert(path.to_string(), remapped);
        }

        let mapped = buffers
            .get(path)
            .ok_or_else(|| format!("File not open: {}", path))?;
        Ok(mapped.get_lines(start, count))
    }

    /// Get total line count for an open buffer. Re-maps if the file changed on disk.
    pub fn line_count(&self, path: &str) -> Result<usize, String> {
        let mut buffers = self.buffers.lock().unwrap_or_else(|e| e.into_inner());
        let needs_remap = buffers.get(path).is_some_and(|m| m.is_stale());
        if needs_remap {
            let remapped = MappedFile::open(path)?;
            buffers.insert(path.to_string(), remapped);
        }
        let mapped = buffers
            .get(path)
            .ok_or_else(|| format!("File not open: {}", path))?;
        Ok(mapped.line_count())
    }

    /// Close a buffer and free memory.
    pub fn close(&self, path: &str) {
        self.buffers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(path);
    }

    /// Check if a path has an open buffer.
    pub fn is_open(&self, path: &str) -> bool {
        self.buffers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn create_temp_file(content: &str) -> (tempfile::NamedTempFile, String) {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f.flush().unwrap();
        let path = f.path().to_string_lossy().to_string();
        (f, path)
    }

    #[test]
    fn line_count_basic() {
        let (_f, path) = create_temp_file("line1\nline2\nline3");
        let mgr = FileBufferManager::new();
        let count = mgr.open(&path).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn read_lines_range() {
        let (_f, path) = create_temp_file("aaa\nbbb\nccc\nddd\neee");
        let mgr = FileBufferManager::new();
        mgr.open(&path).unwrap();
        let lines = mgr.read_lines(&path, 1, 3).unwrap();
        assert_eq!(lines, vec!["bbb", "ccc", "ddd"]);
    }

    #[test]
    fn read_lines_past_end() {
        let (_f, path) = create_temp_file("aaa\nbbb");
        let mgr = FileBufferManager::new();
        mgr.open(&path).unwrap();
        let lines = mgr.read_lines(&path, 0, 100).unwrap();
        assert_eq!(lines, vec!["aaa", "bbb"]);
    }

    #[test]
    fn handles_crlf() {
        let (_f, path) = create_temp_file("line1\r\nline2\r\nline3");
        let mgr = FileBufferManager::new();
        mgr.open(&path).unwrap();
        let lines = mgr.read_lines(&path, 0, 3).unwrap();
        assert_eq!(lines, vec!["line1", "line2", "line3"]);
    }

    #[test]
    fn empty_file() {
        let (_f, path) = create_temp_file("");
        let mgr = FileBufferManager::new();
        let count = mgr.open(&path).unwrap();
        assert_eq!(count, 1); // empty file has one empty line
    }

    #[test]
    fn close_frees_buffer() {
        let (_f, path) = create_temp_file("hello");
        let mgr = FileBufferManager::new();
        mgr.open(&path).unwrap();
        assert!(mgr.is_open(&path));
        mgr.close(&path);
        assert!(!mgr.is_open(&path));
    }
}
