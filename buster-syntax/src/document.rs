use std::sync::Arc;

use crate::grammar::GrammarConfig;
use crate::highlight::{HighlightSpan, TokenKind};
use crate::parser::{FallbackParser, ParseProvider};
use crate::types::{EditRange, SyntaxError, ViewportRange};

/// Persistent parse state for an open document.
///
/// `DocumentTree` owns the document text, a set of precomputed highlight
/// spans produced by a [`ParseProvider`], and the bookkeeping needed for
/// incremental edits.
///
/// The [`ParseProvider`] is injected at construction time:
///
/// * **Without tree-sitter** — pass nothing; the built-in
///   [`FallbackParser`] (keyword heuristics) is used automatically.
/// * **With tree-sitter** — the consuming crate (e.g. Buster IDE) builds a
///   struct that wraps `tree_sitter::Parser` + `tree_sitter::Tree`,
///   implements `ParseProvider`, and passes it via
///   [`DocumentTree::with_provider`].
///
/// The key contract:
/// - `apply_edit()` records an incremental edit and marks the tree dirty
/// - `reparse()` asks the provider to produce new highlight spans
/// - `highlight_viewport()` returns only the spans that fall within the
///   visible viewport — a major perf win for large files
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
    /// The most recent edit (kept so we can forward it to
    /// `parse_incremental` on the next `reparse()` call).
    last_edit: Option<EditRange>,
    /// Cached highlight spans for the whole document, produced by the
    /// provider on the last successful `reparse()`.
    cached_spans: Vec<HighlightSpan>,
    /// The parser back-end.  Trait-object so `DocumentTree` is not generic
    /// (keeps the public API simple and avoids monomorphisation bloat).
    provider: Box<dyn ParseProvider>,
}

impl DocumentTree {
    /// Create a new document tree with the default fallback parser.
    pub fn new(uri: String, grammar: Arc<GrammarConfig>, content: String) -> Self {
        Self::with_provider(uri, grammar, content, Box::new(FallbackParser))
    }

    /// Create a new document tree with a custom [`ParseProvider`].
    ///
    /// Use this when integrating a real parser such as tree-sitter.
    pub fn with_provider(
        uri: String,
        grammar: Arc<GrammarConfig>,
        content: String,
        provider: Box<dyn ParseProvider>,
    ) -> Self {
        let line_offsets = compute_line_offsets(&content);
        Self {
            uri,
            grammar,
            content,
            line_offsets,
            dirty: true, // needs initial parse
            last_edit: None,
            cached_spans: Vec::new(),
            provider,
        }
    }

    /// Apply an incremental edit to the document.
    ///
    /// This updates the internal content, recomputes line offsets, and
    /// stashes the edit so that the next `reparse()` can forward it to
    /// `ParseProvider::parse_incremental`.
    pub fn apply_edit(&mut self, edit: &EditRange, new_text: &str) {
        self.content
            .replace_range(edit.start_byte..edit.old_end_byte, new_text);
        self.line_offsets = compute_line_offsets(&self.content);
        self.last_edit = Some(edit.clone());
        self.dirty = true;
    }

    /// Reparse the document using the attached [`ParseProvider`].
    ///
    /// If a previous edit was recorded via `apply_edit`, we attempt an
    /// incremental parse first.  If the provider returns `None` (e.g.
    /// unsupported language) we fall through to a full parse.  If that
    /// also fails we report `SyntaxError::ParseFailed`.
    pub fn reparse(&mut self) -> Result<(), SyntaxError> {
        let language = &self.grammar.language_id;

        let maybe_spans = if let Some(ref edit) = self.last_edit {
            self.provider
                .parse_incremental(&self.content, language, edit)
                .or_else(|| self.provider.parse(&self.content, language))
        } else {
            self.provider.parse(&self.content, language)
        };

        match maybe_spans {
            Some(spans) => {
                self.cached_spans = spans;
                self.dirty = false;
                self.last_edit = None;
                Ok(())
            }
            None => Err(SyntaxError::ParseFailed {
                uri: self.uri.clone(),
            }),
        }
    }

    /// Check if the tree needs reparsing.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Get highlight spans for the visible viewport only.
    ///
    /// This is a major performance optimisation: instead of shipping
    /// 10 000 spans to the renderer, we only return the ~50-line slice
    /// that is actually on screen.
    ///
    /// If the document is dirty (no `reparse()` since the last edit) we
    /// fall back to the keyword highlighter for the requested lines so
    /// the user never sees un-highlighted text.
    pub fn highlight_viewport(&self, viewport: ViewportRange) -> Vec<HighlightSpan> {
        if !self.cached_spans.is_empty() {
            // Fast path: filter the cached full-document spans to the
            // viewport.
            return self
                .cached_spans
                .iter()
                .filter(|s| viewport.contains_line(s.line))
                .cloned()
                .collect();
        }

        // Slow path / first paint before reparse: per-line fallback.
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
            let line_spans = highlight_line_inline(line_num, line_text);
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

    /// Replace the [`ParseProvider`] at runtime.
    ///
    /// Marks the document dirty so the next `reparse()` uses the new
    /// provider.
    pub fn set_provider(&mut self, provider: Box<dyn ParseProvider>) {
        self.provider = provider;
        self.dirty = true;
        self.cached_spans.clear();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn compute_line_offsets(text: &str) -> Vec<usize> {
    let mut offsets = vec![0];
    for (i, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

/// Tiny inline keyword highlighter used only when we have no cached spans
/// (i.e. before the first `reparse()`).  This is intentionally duplicated
/// from `FallbackParser` so `highlight_viewport` can work without needing
/// a mutable borrow (the provider parse methods need `&self` only, but
/// we want this path to work even without calling reparse at all).
fn highlight_line_inline(line: usize, text: &str) -> Vec<HighlightSpan> {
    let mut spans = Vec::new();
    let trimmed = text.trim_end();

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

    let keywords = [
        "fn", "let", "mut", "const", "pub", "use", "mod", "struct", "enum",
        "impl", "trait", "for", "while", "loop", "if", "else", "match",
        "return", "async", "await", "function", "var", "class", "import",
        "export", "from", "def", "self", "type", "interface",
    ];

    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }

        if bytes[i] == b'"' || bytes[i] == b'\'' || bytes[i] == b'`' {
            let quote = bytes[i];
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i] != quote {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
            spans.push(HighlightSpan::new(line, start, i, TokenKind::String));
            continue;
        }

        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.') {
                i += 1;
            }
            spans.push(HighlightSpan::new(line, start, i, TokenKind::Number));
            continue;
        }

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
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_grammar() -> Arc<GrammarConfig> {
        Arc::new(GrammarConfig::new(
            "rust",
            &[".rs"],
            "(identifier) @variable",
        ))
    }

    // ------------------------------------------------------------------
    // Basic construction
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // apply_edit + reparse round-trip
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // Viewport highlighting (fallback inline path, before reparse)
    // ------------------------------------------------------------------

    #[test]
    fn test_viewport_highlighting_inline() {
        let doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {\n    let x = 42;\n    // comment\n}\n".into(),
        );

        // Before reparse — uses the inline fallback
        let spans = doc.highlight_viewport(ViewportRange::new(1, 2));

        let has_let = spans
            .iter()
            .any(|s| s.line == 1 && s.kind == TokenKind::Keyword);
        assert!(has_let);

        let has_comment = spans
            .iter()
            .any(|s| s.line == 2 && s.kind == TokenKind::Comment);
        assert!(has_comment);

        assert!(!spans.iter().any(|s| s.line == 0 || s.line == 3));
    }

    // ------------------------------------------------------------------
    // Viewport highlighting (cached path, after reparse)
    // ------------------------------------------------------------------

    #[test]
    fn test_viewport_highlighting_cached() {
        let mut doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {\n    let x = 42;\n    // comment\n}\n".into(),
        );

        doc.reparse().unwrap();
        let spans = doc.highlight_viewport(ViewportRange::new(1, 2));

        let has_let = spans
            .iter()
            .any(|s| s.line == 1 && s.kind == TokenKind::Keyword);
        assert!(has_let);

        assert!(!spans.iter().any(|s| s.line == 0 || s.line == 3));
    }

    // ------------------------------------------------------------------
    // String highlighting
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // Custom ParseProvider
    // ------------------------------------------------------------------

    /// A trivial custom provider for testing the injection API.
    struct ConstantProvider {
        spans: Vec<HighlightSpan>,
        call_count: Arc<AtomicUsize>,
    }

    impl ParseProvider for ConstantProvider {
        fn parse(&self, _source: &str, _language: &str) -> Option<Vec<HighlightSpan>> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            Some(self.spans.clone())
        }

        fn parse_incremental(
            &self,
            _source: &str,
            _language: &str,
            _edit: &EditRange,
        ) -> Option<Vec<HighlightSpan>> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            Some(self.spans.clone())
        }
    }

    #[test]
    fn test_with_custom_provider() {
        let call_count = Arc::new(AtomicUsize::new(0));
        let provider = ConstantProvider {
            spans: vec![
                HighlightSpan::new(0, 0, 2, TokenKind::Keyword),
                HighlightSpan::new(1, 0, 5, TokenKind::Function),
            ],
            call_count: call_count.clone(),
        };

        let mut doc = DocumentTree::with_provider(
            "file:///test.rs".into(),
            test_grammar(),
            "fn\nmain()\n".into(),
            Box::new(provider),
        );

        doc.reparse().unwrap();
        assert_eq!(call_count.load(Ordering::SeqCst), 1);

        // Viewport scoping should filter
        let spans = doc.highlight_viewport(ViewportRange::new(0, 0));
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].kind, TokenKind::Keyword);

        let spans = doc.highlight_viewport(ViewportRange::new(1, 1));
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].kind, TokenKind::Function);
    }

    #[test]
    fn test_incremental_reparse_uses_edit() {
        let call_count = Arc::new(AtomicUsize::new(0));
        let provider = ConstantProvider {
            spans: vec![HighlightSpan::new(0, 0, 5, TokenKind::Variable)],
            call_count: call_count.clone(),
        };

        let mut doc = DocumentTree::with_provider(
            "file:///test.rs".into(),
            test_grammar(),
            "hello".into(),
            Box::new(provider),
        );

        // Full parse on first reparse
        doc.reparse().unwrap();
        assert_eq!(call_count.load(Ordering::SeqCst), 1);

        // Apply edit, then reparse — should call the provider again
        doc.apply_edit(
            &EditRange {
                start_byte: 0,
                old_end_byte: 5,
                new_end_byte: 5,
                start_position: (0, 0),
                old_end_position: (0, 5),
                new_end_position: (0, 5),
            },
            "world",
        );
        doc.reparse().unwrap();
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn test_set_provider_marks_dirty() {
        let mut doc = DocumentTree::new(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {}".into(),
        );
        doc.reparse().unwrap();
        assert!(!doc.is_dirty());

        let call_count = Arc::new(AtomicUsize::new(0));
        doc.set_provider(Box::new(ConstantProvider {
            spans: vec![],
            call_count,
        }));
        assert!(doc.is_dirty());
    }

    /// Provider that always fails (returns None).
    struct FailingProvider;
    impl ParseProvider for FailingProvider {
        fn parse(&self, _: &str, _: &str) -> Option<Vec<HighlightSpan>> {
            None
        }
        fn parse_incremental(
            &self,
            _: &str,
            _: &str,
            _: &EditRange,
        ) -> Option<Vec<HighlightSpan>> {
            None
        }
    }

    #[test]
    fn test_failing_provider_returns_error() {
        let mut doc = DocumentTree::with_provider(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {}".into(),
            Box::new(FailingProvider),
        );
        let result = doc.reparse();
        assert!(result.is_err());
        assert!(doc.is_dirty());
    }

    #[test]
    fn test_viewport_before_reparse_still_works() {
        // Even with a custom provider, before reparse() the inline
        // fallback path should produce spans.
        let doc = DocumentTree::with_provider(
            "file:///test.rs".into(),
            test_grammar(),
            "fn main() {\n    let x = 1;\n}\n".into(),
            Box::new(FailingProvider),
        );
        // No reparse — cached_spans is empty.
        let spans = doc.highlight_viewport(ViewportRange::new(0, 0));
        assert!(!spans.is_empty());
        let has_fn = spans
            .iter()
            .any(|s| s.kind == TokenKind::Keyword);
        assert!(has_fn);
    }
}
