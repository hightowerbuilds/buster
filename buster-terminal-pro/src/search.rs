use crate::scrollback::ScrollbackBuffer;

/// Search result within the terminal scrollback.
#[derive(Debug, Clone)]
pub struct SearchMatch {
    pub line: usize,
    pub start_col: usize,
    pub end_col: usize,
}

/// Terminal search within scrollback buffer.
pub struct TerminalSearch;

impl TerminalSearch {
    /// Search the scrollback buffer for a pattern (case-insensitive).
    pub fn find(buffer: &ScrollbackBuffer, pattern: &str) -> Vec<SearchMatch> {
        if pattern.is_empty() {
            return Vec::new();
        }

        let pattern_lower = pattern.to_lowercase();
        let mut matches = Vec::new();

        for i in 0..buffer.len() {
            if let Some(line_text) = buffer.get(i) {
                let line_lower = line_text.to_lowercase();
                let mut start = 0;
                while let Some(pos) = line_lower[start..].find(&pattern_lower) {
                    let abs_pos = start + pos;
                    matches.push(SearchMatch {
                        line: i,
                        start_col: abs_pos,
                        end_col: abs_pos + pattern.len(),
                    });
                    start = abs_pos + 1;
                    if start >= line_lower.len() {
                        break;
                    }
                }
            }
        }

        matches
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrollback::ScrollbackConfig;

    #[test]
    fn test_find_matches() {
        let mut buf = ScrollbackBuffer::new(ScrollbackConfig::default());
        buf.push("hello world".into());
        buf.push("Hello again".into());
        buf.push("nothing here".into());

        let matches = TerminalSearch::find(&buf, "hello");
        assert_eq!(matches.len(), 2); // case-insensitive
        assert_eq!(matches[0].line, 0);
        assert_eq!(matches[1].line, 1);
    }

    #[test]
    fn test_multiple_matches_per_line() {
        let mut buf = ScrollbackBuffer::new(ScrollbackConfig::default());
        buf.push("abc abc abc".into());

        let matches = TerminalSearch::find(&buf, "abc");
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn test_empty_pattern() {
        let mut buf = ScrollbackBuffer::new(ScrollbackConfig::default());
        buf.push("hello".into());
        assert!(TerminalSearch::find(&buf, "").is_empty());
    }
}
