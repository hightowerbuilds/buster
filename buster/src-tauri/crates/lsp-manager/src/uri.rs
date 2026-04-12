use std::path::{Path, PathBuf};

use crate::types::LspError;

/// Characters that must be percent-encoded in a file URI path segment.
fn should_encode(b: u8) -> bool {
    matches!(b, b' ' | b'%' | b'#' | b'?' | b'&' | b'=' | b'+' | b'['
        | b']' | b'{' | b'}' | b'|' | b'^' | b'`' | b'<' | b'>' | b'"')
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for b in segment.bytes() {
        if should_encode(b) {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        } else {
            out.push(b as char);
        }
    }
    out
}

/// Convert an absolute file path to a properly encoded `file://` URI.
///
/// This is the Rust equivalent of `buster-path`'s `pathToUri()`.
/// Used when sending document URIs to language servers.
pub fn path_to_lsp_uri(path: &Path) -> Result<String, LspError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| LspError::Transport("path contains invalid UTF-8".into()))?;

    if !path.is_absolute() {
        return Err(LspError::Transport(format!(
            "cannot convert relative path to URI: {}",
            path_str
        )));
    }

    // Normalize to forward slashes
    let normalized = path_str.replace('\\', "/");

    // Windows drive path: file:///C:/...
    if normalized.len() >= 3 && normalized.as_bytes()[1] == b':' {
        let segments: Vec<&str> = normalized.split('/').collect();
        let encoded: Vec<String> = segments.iter().map(|s| encode_segment(s)).collect();
        return Ok(format!("file:///{}", encoded.join("/")));
    }

    // UNC path: file://server/share/...
    if normalized.starts_with("//") {
        let segments: Vec<&str> = normalized[2..].split('/').collect();
        let encoded: Vec<String> = segments.iter().map(|s| encode_segment(s)).collect();
        return Ok(format!("file://{}", encoded.join("/")));
    }

    // Unix path: file:///path/...
    let segments: Vec<&str> = normalized[1..].split('/').collect();
    let encoded: Vec<String> = segments.iter().map(|s| encode_segment(s)).collect();
    Ok(format!("file:///{}", encoded.join("/")))
}

/// Convert a `file://` URI back to a native file path.
///
/// Used when receiving document URIs from language servers.
pub fn lsp_uri_to_path(uri: &str) -> Result<PathBuf, LspError> {
    if !uri.starts_with("file://") {
        return Err(LspError::Transport(format!("not a file URI: {}", uri)));
    }

    let path = &uri["file://".len()..];

    // Decode percent-encoded characters
    let decoded = percent_decode(path);

    // file:///C:/... → C:/...
    if decoded.len() >= 4 && &decoded[0..1] == "/" && decoded.as_bytes()[2] == b':' {
        return Ok(PathBuf::from(&decoded[1..]));
    }

    // file://server/share/... → //server/share/...  (UNC)
    if !decoded.starts_with('/') {
        return Ok(PathBuf::from(format!("//{}", decoded)));
    }

    Ok(PathBuf::from(decoded))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unix_path_to_uri() {
        let uri = path_to_lsp_uri(Path::new("/home/user/file.ts")).unwrap();
        assert_eq!(uri, "file:///home/user/file.ts");
    }

    #[test]
    fn test_path_with_spaces() {
        let uri = path_to_lsp_uri(Path::new("/home/user/my project/file.ts")).unwrap();
        assert_eq!(uri, "file:///home/user/my%20project/file.ts");
    }

    #[test]
    fn test_roundtrip() {
        let original = Path::new("/home/user/my project/file#1.ts");
        let uri = path_to_lsp_uri(original).unwrap();
        let back = lsp_uri_to_path(&uri).unwrap();
        assert_eq!(back, original);
    }

    #[test]
    fn test_uri_to_unix_path() {
        let path = lsp_uri_to_path("file:///home/user/file.ts").unwrap();
        assert_eq!(path, PathBuf::from("/home/user/file.ts"));
    }

    #[test]
    fn test_rejects_non_file_uri() {
        assert!(lsp_uri_to_path("https://example.com").is_err());
    }

    #[test]
    fn test_rejects_relative_path() {
        assert!(path_to_lsp_uri(Path::new("src/file.ts")).is_err());
    }
}
