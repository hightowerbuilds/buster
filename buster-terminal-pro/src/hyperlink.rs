use serde::{Deserialize, Serialize};

/// An OSC 8 hyperlink parsed from terminal output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hyperlink {
    pub url: String,
    pub start_col: usize,
    pub end_col: usize,
    pub line: usize,
}

/// Parses OSC 8 hyperlink sequences from terminal output.
///
/// OSC 8 format: \x1b]8;params;url\x1b\\text\x1b]8;;\x1b\\
pub struct HyperlinkParser;

impl HyperlinkParser {
    /// Extract hyperlinks from a line of terminal output.
    pub fn parse_line(line: usize, text: &str) -> Vec<Hyperlink> {
        let mut links = Vec::new();
        let mut remaining = text;
        let mut col_offset = 0;

        // Look for OSC 8 sequences: \x1b]8;params;url\x07 or \x1b]8;params;url\x1b\\
        while let Some(start) = remaining.find("\x1b]8;") {
            let after_osc = &remaining[start + 4..];

            // Find the URL (after the params semicolon)
            if let Some(semi) = after_osc.find(';') {
                let url_start = semi + 1;
                let url_and_rest = &after_osc[url_start..];

                // Find the ST (string terminator): \x07 or \x1b\\
                let url_end = url_and_rest
                    .find('\x07')
                    .or_else(|| url_and_rest.find("\x1b\\"))
                    .unwrap_or(url_and_rest.len());

                let url = &url_and_rest[..url_end];

                if !url.is_empty() {
                    // Find the closing OSC 8 (empty URL = end of link)
                    let text_start_pos = start + 4 + url_start + url_end + 1;
                    let link_text_remaining = if text_start_pos < remaining.len() {
                        &remaining[text_start_pos..]
                    } else {
                        ""
                    };

                    // Find the end tag
                    let text_end = link_text_remaining
                        .find("\x1b]8;")
                        .unwrap_or(link_text_remaining.len());

                    let display_start = col_offset + start;
                    let display_end = display_start + text_end;

                    links.push(Hyperlink {
                        url: url.to_string(),
                        start_col: display_start,
                        end_col: display_end,
                        line,
                    });
                }
            }

            // Advance past this sequence
            let advance = start + 4;
            if advance >= remaining.len() {
                break;
            }
            col_offset += advance;
            remaining = &remaining[advance..];
        }

        links
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_links() {
        let links = HyperlinkParser::parse_line(0, "plain text with no links");
        assert!(links.is_empty());
    }

    #[test]
    fn test_parse_osc8_link() {
        let text = "\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07";
        let links = HyperlinkParser::parse_line(5, text);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com");
        assert_eq!(links[0].line, 5);
    }
}
