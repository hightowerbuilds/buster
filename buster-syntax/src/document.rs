use std::sync::Arc;

use crate::grammar::GrammarConfig;
use crate::highlight::{HighlightSpan, TokenKind};
use crate::types::{EditRange, SyntaxError, ViewportRange};

/// Persistent parse state for an open document.
///
/// In the full integration, this wraps a `tree_sitter::Tree` that is
/// incrementally updated on each edit. Here we define the interface and
/// provide a line-based fallback highlighter for testing.
///
/// The key contract:
/// - `apply_edit()` records an incremental edit (what tree_sitter::Tree::edit needs)
/// - `reparse()` calls tree_sitter::Parser::parse with the old tree for incremental parsing
/// - `highlight_viewport()` returns spans only for visible lines
pub struct DocumentTree {
    /// Document URI.
    pub uri: String,
    /// Language configuration.
    grammar: Arc<GrammarConfig>,
    /// Current document content.
    content: String,
    /// Precomputed line start byte offsets.
    line_offsets: Vec<usize>,
    /// Whether the tree needs reparsing after an edit.
    dirty: bool,
}

impl DocumentTree {
    /// Create a new document tree from initial content.
    pub fn new(uri: String, grammar: Arc<GrammarConfig>, content: String) -> Self {
        let line_offsets = compute_line_offsets(&content);
        Self {
            uri,
            grammar,
            content,
            line_offsets,
            dirty: true, // needs initial parse
        }
    }

    /// Apply an incremental edit to the document.
    ///
    /// This updates the internal content and marks the tree as dirty.
    /// In the full integration, this also calls `tree.edit()` with the
    /// InputEdit so the next reparse is incremental.
    pub fn apply_edit(&mut self, edit: &EditRange, new_text: &str) {
        self.content.replace_range(
            edit.start_byte..edit.old_end_byte,
            new_text,
        );
        self.line_offsets = compute_line_offsets(&self.content);
        self.dirty = true;
    }

    /// Reparse the document.
    ///
    /// In the full integration, this calls `parser.parse(&content, Some(&old_tree))`
    /// which incrementally reparses only the changed regions. The old tree
    /// tells the parser which parts of the AST are still valid.
    pub fn reparse(&mut self) -> Result<(), SyntaxError> {
        // Full integration: parser.parse(&self.content, self.tree.as_ref())
        // For now, just clear the dirty flag
        self.dirty = false;
        Ok(())
    }

    /// Check if the tree needs reparsing.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Get highlight spans for the visible viewport only.
    ///
    /// This is a major performance optimization: instead of computing highlights
    /// for a 10,000-line file, we only compute them for the ~50 visible lines.
    ///
    /// In the full integration, this runs tree-sitter highlight queries scoped
    /// to the viewport byte range. Here we provide a keyword-based fallback.
    pub fn highlight_viewport(
        &self,
        viewport: ViewportRange,
    ) -> Vec<HighlightSpan> {
        let mut spans = Vec::new();

        for line_num in viewport.start_line..=viewport.end_line {
            if line_num >= self.line_offsets.len() {
                break;
            }

            let line_start = self.line_offsets[line_num];
            let line_end = if line_num + 1 < self.line_offsets.len() {
                self.line_offsets[line_num + 1]
            } else {
                self.content.len()
            };

            let line_text = &self.content[line_start..line_end];
            let line_spans = highlight_line_fallback(line_num, line_text);
            spans.extend(line_spans);
        }

        spans
    }

    /// Get the full document content.
    pub fn content(&self) -> &str {
        &self.content
    }

    /// Get the number of lines.
    pub fn line_count(&self) -> usize {
        self.line_offsets.len()
    }

    /// Get the grammar configuration.
    pub fn grammar(&self) -> &GrammarConfig {
        &self.grammar
    }
}

fn compute_line_offsets(text: &str) -> Vec<usize> {
    let mut offsets = vec![0];
    for (i, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

/// Simple keyword-based fallback highlighter for testing.
/// In production, tree-sitter queries replace this entirely.
fn highlight_line_fallback(line: usize, text: &str) -> Vec<HighlightSpan> {
    let mut spans = Vec::new();
    let trimmed = text.trim_end();

    // Detect line comments
    let stripped = trimmed.trim_start();
    if stripped.starts_with("//") || stripped.starts_with('#') {
        let offset = trimmed.len() - stripped.len();
        spans.push(HighlightSpan::new(line, offset, trimmed.len(), TokenKind::Comment));
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

    fn test_grammar() -> Arc<GrammarConfig> {
        Arc::new(GrammarConfig::new("rust", &[".rs"], "(identifier) @variable"))
    }

    #[test]
    fn test_new_document() {
        let doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {\n    println!(\"hello\");\n}\n".into(),
        );
        assert_eq!(doc.line_count(), 4);
        assert!(doc.is_dirty());
    }

    #[test]
    fn test_apply_edit() {
        let mut doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "hello world".into(),
        );
        doc.reparse().unwrap();
        assert!(!doc.is_dirty());

        doc.apply_edit(
            &EditRange {
                start_byte: 5,
                old_end_byte: 11,
                new_end_byte: 10,
                start_position: (0, 5),
                old_end_position: (0, 11),
                new_end_position: (0, 10),
            },
            " rust",
        );

        assert_eq!(doc.content(), "hello rust");
        assert!(doc.is_dirty());
    }

    #[test]
    fn test_viewport_highlighting() {
        let doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {\n    let x = 42;\n    // comment\n}\n".into(),
        );

        // Only highlight lines 1-2 (not the whole document)
        let spans = doc.highlight_viewport(ViewportRange::new(1, 2));

        // Should find 'let' as keyword on line 1
        let has_let = spans.iter().any(|s| s.line == 1 && s.kind == TokenKind::Keyword);
        assert!(has_let);

        // Should find comment on line 2
        let has_comment = spans.iter().any(|s| s.line == 2 && s.kind == TokenKind::Comment);
        assert!(has_comment);

        // Should NOT have spans for line 0 or line 3
        assert!(!spans.iter().any(|s| s.line == 0 || s.line == 3));
    }

    #[test]
    fn test_string_highlighting() {
        let doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "let x = \"hello\";\n".into(),
        );

        let spans = doc.highlight_viewport(ViewportRange::new(0, 0));
        let has_string = spans.iter().any(|s| s.kind == TokenKind::String);
        assert!(has_string);
    }
}
