use serde::{Deserialize, Serialize};

/// A syntax token kind, mapped to theme colors by the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TokenKind {
    Keyword,
    Type,
    Function,
    Variable,
    Parameter,
    Property,
    String,
    Number,
    Boolean,
    Comment,
    Operator,
    Punctuation,
    Tag,
    Attribute,
    Namespace,
    Macro,
    Label,
    Escape,
    RegExp,
    /// Text that doesn't match any highlight query.
    Plain,
}

/// A highlighted span within a line.
///
/// The frontend canvas renderer reads these to apply colors.
/// Spans are relative to a single line and sorted by start column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightSpan {
    /// Zero-based line number.
    pub line: usize,
    /// Start column (byte offset within the line).
    pub start_col: usize,
    /// End column (byte offset within the line, exclusive).
    pub end_col: usize,
    /// The kind of token for theme coloring.
    pub kind: TokenKind,
}

impl HighlightSpan {
    pub fn new(line: usize, start_col: usize, end_col: usize, kind: TokenKind) -> Self {
        Self {
            line,
            start_col,
            end_col,
            kind,
        }
    }

    /// Length of this span in bytes.
    pub fn len(&self) -> usize {
        self.end_col - self.start_col
    }

    pub fn is_empty(&self) -> bool {
        self.start_col == self.end_col
    }
}

/// Maps TokenKind to CSS color strings. The frontend populates this from
/// the active theme (currently Catppuccin Mocha).
#[derive(Debug, Clone)]
pub struct HighlightTheme {
    colors: std::collections::HashMap<TokenKind, String>,
}

impl HighlightTheme {
    pub fn new() -> Self {
        Self {
            colors: std::collections::HashMap::new(),
        }
    }

    /// Create a theme with Catppuccin Mocha colors (Buster's default).
    pub fn catppuccin_mocha() -> Self {
        use TokenKind::*;
        let mut theme = Self::new();
        theme.set(Keyword, "#cba6f7");     // Mauve
        theme.set(Type, "#f9e2af");        // Yellow
        theme.set(Function, "#89b4fa");    // Blue
        theme.set(Variable, "#cdd6f4");    // Text
        theme.set(Parameter, "#fab387");   // Peach
        theme.set(Property, "#89dceb");    // Sky
        theme.set(String, "#a6e3a1");      // Green
        theme.set(Number, "#fab387");      // Peach
        theme.set(Boolean, "#fab387");     // Peach
        theme.set(Comment, "#6c7086");     // Overlay0
        theme.set(Operator, "#89dceb");    // Sky
        theme.set(Punctuation, "#9399b2"); // Overlay2
        theme.set(Tag, "#cba6f7");         // Mauve
        theme.set(Attribute, "#f9e2af");   // Yellow
        theme.set(Namespace, "#f9e2af");   // Yellow
        theme.set(Macro, "#f38ba8");       // Red
        theme.set(Label, "#74c7ec");       // Sapphire
        theme.set(Escape, "#f2cdcd");      // Flamingo
        theme.set(RegExp, "#f5c2e7");      // Pink
        theme.set(Plain, "#cdd6f4");       // Text
        theme
    }

    pub fn set(&mut self, kind: TokenKind, color: &str) {
        self.colors.insert(kind, color.to_string());
    }

    pub fn get(&self, kind: TokenKind) -> &str {
        self.colors
            .get(&kind)
            .map(|s| s.as_str())
            .unwrap_or("#cdd6f4")
    }
}

impl Default for HighlightTheme {
    fn default() -> Self {
        Self::catppuccin_mocha()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_highlight_span() {
        let span = HighlightSpan::new(0, 4, 12, TokenKind::Keyword);
        assert_eq!(span.len(), 8);
        assert!(!span.is_empty());
    }

    #[test]
    fn test_catppuccin_theme() {
        let theme = HighlightTheme::catppuccin_mocha();
        assert_eq!(theme.get(TokenKind::Keyword), "#cba6f7");
        assert_eq!(theme.get(TokenKind::String), "#a6e3a1");
        assert_eq!(theme.get(TokenKind::Comment), "#6c7086");
    }

    #[test]
    fn test_empty_span() {
        let span = HighlightSpan::new(0, 5, 5, TokenKind::Plain);
        assert!(span.is_empty());
        assert_eq!(span.len(), 0);
    }
}
