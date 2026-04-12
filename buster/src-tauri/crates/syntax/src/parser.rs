use crate::highlight::HighlightSpan;
use crate::types::EditRange;

/// Abstraction over a concrete parser (e.g. tree-sitter).
///
/// `buster-syntax` defines the document lifecycle — edits, reparsing,
/// viewport-scoped highlighting — but does **not** depend on tree-sitter
/// directly.  The consuming crate (Buster IDE) provides a concrete
/// `ParseProvider` that wraps `tree_sitter::Parser` + `tree_sitter::Tree`.
///
/// # Contract
///
/// * `parse` — full parse from scratch.  Returns highlight spans for the
///   entire document; the caller will scope them to the viewport.
/// * `parse_incremental` — reparse after an edit.  The implementation is
///   free to use tree-sitter's incremental mode (`parser.parse(src,
///   Some(&old_tree))`) under the hood.  The `edit` describes what changed
///   so the implementation can call `tree.edit()` before reparsing.
///
/// Both methods return `None` to signal a parse failure (e.g. unknown
/// language, missing grammar).
pub trait ParseProvider: Send + Sync {
    /// Full (cold) parse of `source` for the given `language`.
    ///
    /// Returns highlight spans covering the whole document, or `None` on
    /// failure.
    fn parse(&self, source: &str, language: &str) -> Option<Vec<HighlightSpan>>;

    /// Incremental reparse after an edit.
    ///
    /// `edit` mirrors the fields of `tree_sitter::InputEdit` so a
    /// tree-sitter-backed implementation can convert directly.
    /// Returns highlight spans covering the whole document, or `None` on
    /// failure.
    fn parse_incremental(
        &self,
        source: &str,
        language: &str,
        edit: &EditRange,
    ) -> Option<Vec<HighlightSpan>>;
}

/// Fallback `ParseProvider` using simple keyword / regex heuristics.
///
/// This is what `DocumentTree` uses when no real parser is supplied.  It
/// gives basic syntax colouring (keywords, strings, numbers, comments)
/// without needing any native grammar libraries.
#[derive(Debug, Clone, Default)]
pub struct FallbackParser;

impl ParseProvider for FallbackParser {
    fn parse(&self, source: &str, _language: &str) -> Option<Vec<HighlightSpan>> {
        Some(highlight_source_fallback(source))
    }

    fn parse_incremental(
        &self,
        source: &str,
        _language: &str,
        _edit: &EditRange,
    ) -> Option<Vec<HighlightSpan>> {
        // The fallback parser has no incremental state — just reparse
        // the whole thing.  This is fine for the keyword highlighter
        // because it is fast enough that the overhead is negligible.
        Some(highlight_source_fallback(source))
    }
}

// ---------------------------------------------------------------------------
// Fallback highlighting logic (moved from document.rs)
// ---------------------------------------------------------------------------

use crate::highlight::TokenKind;

/// Highlight an entire source string using keyword heuristics.
fn highlight_source_fallback(source: &str) -> Vec<HighlightSpan> {
    let mut spans = Vec::new();
    for (line_num, line_text) in source.split('\n').enumerate() {
        let line_spans = highlight_line_fallback(line_num, line_text);
        spans.extend(line_spans);
    }
    spans
}

/// Simple keyword-based fallback highlighter for a single line.
/// In production, tree-sitter queries replace this entirely.
fn highlight_line_fallback(line: usize, text: &str) -> Vec<HighlightSpan> {
    let mut spans = Vec::new();
    let trimmed = text.trim_end();

    // Detect line comments
    let stripped = trimmed.trim_start();
    if stripped.starts_with("//") || stripped.starts_with('#') {
        let offset = trimmed.len() - stripped.len();
        spans.push(HighlightSpan::new(
            line,
            offset,
            trimmed.len(),
            TokenKind::Comment,
        ));
        return spans;
    }

    // Simple keyword detection
    let keywords = [
        "fn", "let", "mut", "const", "pub", "use", "mod", "struct", "enum",
        "impl", "trait", "for", "while", "loop", "if", "else", "match",
        "return", "async", "await", "function", "var", "class", "import",
        "export", "from", "def", "self", "type", "interface",
    ];

    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Skip whitespace
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }

        // Check for string literals
        if bytes[i] == b'"' || bytes[i] == b'\'' || bytes[i] == b'`' {
            let quote = bytes[i];
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i] != quote {
                if bytes[i] == b'\\' {
                    i += 1; // skip escaped char
                }
                i += 1;
            }
            if i < bytes.len() {
                i += 1; // closing quote
            }
            spans.push(HighlightSpan::new(line, start, i, TokenKind::String));
            continue;
        }

        // Check for numbers
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.') {
                i += 1;
            }
            spans.push(HighlightSpan::new(line, start, i, TokenKind::Number));
            continue;
        }

        // Check for identifiers/keywords
        if bytes[i].is_ascii_alphabetic() || bytes[i] == b'_' {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let word = &trimmed[start..i];
            let kind = if keywords.contains(&word) {
                TokenKind::Keyword
            } else if word.chars().next().map_or(false, |c| c.is_uppercase()) {
                TokenKind::Type
            } else {
                TokenKind::Variable
            };
            spans.push(HighlightSpan::new(line, start, i, kind));
            continue;
        }

        i += 1;
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_parser_parses() {
        let parser = FallbackParser;
        let spans = parser
            .parse("fn main() { let x = 42; }", "rust")
            .expect("fallback should always succeed");
        assert!(!spans.is_empty());
        assert!(spans.iter().any(|s| s.kind == TokenKind::Keyword));
        assert!(spans.iter().any(|s| s.kind == TokenKind::Number));
    }

    #[test]
    fn test_fallback_parser_incremental_same_as_full() {
        let parser = FallbackParser;
        let source = "let x = 10;\n";
        let edit = EditRange {
            start_byte: 8,
            old_end_byte: 10,
            new_end_byte: 10,
            start_position: (0, 8),
            old_end_position: (0, 10),
            new_end_position: (0, 10),
        };
        let full = parser.parse(source, "rust").unwrap();
        let inc = parser.parse_incremental(source, "rust", &edit).unwrap();
        assert_eq!(full.len(), inc.len());
    }

    #[test]
    fn test_fallback_multiline() {
        let parser = FallbackParser;
        let source = "fn main() {\n    let x = 42;\n}\n";
        let spans = parser.parse(source, "rust").unwrap();
        // Should have spans on multiple lines
        let lines: std::collections::HashSet<usize> = spans.iter().map(|s| s.line).collect();
        assert!(lines.contains(&0));
        assert!(lines.contains(&1));
    }

    #[test]
    fn test_fallback_comments() {
        let parser = FallbackParser;
        let spans = parser.parse("// this is a comment", "rust").unwrap();
        assert!(spans.iter().all(|s| s.kind == TokenKind::Comment));
    }

    #[test]
    fn test_fallback_strings() {
        let parser = FallbackParser;
        let spans = parser
            .parse("let s = \"hello world\";", "rust")
            .unwrap();
        assert!(spans.iter().any(|s| s.kind == TokenKind::String));
    }
}
