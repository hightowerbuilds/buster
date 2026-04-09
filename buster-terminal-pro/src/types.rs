use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("PTY crashed: {reason}")]
    PtyCrashed { reason: String },

    #[error("PTY spawn failed: {0}")]
    PtySpawnFailed(String),

    #[error("search pattern invalid: {0}")]
    InvalidPattern(String),
}

/// Bell notification mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BellMode {
    /// Visual flash on the terminal.
    Visual,
    /// System notification.
    Notification,
    /// No bell.
    Silent,
}

impl Default for BellMode {
    fn default() -> Self {
        BellMode::Visual
    }
}

/// Character cell width for rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellWidth {
    /// Standard single-width character (ASCII, Latin, etc.)
    Single,
    /// Double-width character (CJK ideographs, some symbols)
    Double,
    /// Zero-width (combining characters, ZWJ)
    Zero,
}

/// Determine the display width of a Unicode character.
pub fn char_width(c: char) -> CellWidth {
    let cp = c as u32;

    // Zero-width characters
    if is_zero_width(cp) {
        return CellWidth::Zero;
    }

    // CJK and wide characters
    if is_wide(cp) {
        return CellWidth::Double;
    }

    CellWidth::Single
}

fn is_zero_width(cp: u32) -> bool {
    // Combining marks, ZWJ, variation selectors, etc.
    matches!(cp,
        0x0300..=0x036F |  // Combining Diacritical Marks
        0x0483..=0x0489 |  // Cyrillic combining marks
        0x0591..=0x05BD |  // Hebrew combining marks
        0x200B..=0x200F |  // Zero-width spaces, LRM, RLM
        0x2028..=0x202E |  // Line/paragraph separators, directional
        0x2060..=0x2064 |  // Word joiner, etc.
        0xFE00..=0xFE0F |  // Variation selectors
        0xFEFF           |  // BOM / ZWNBSP
        0xE0100..=0xE01EF  // Variation selectors supplement
    )
}

fn is_wide(cp: u32) -> bool {
    matches!(cp,
        0x1100..=0x115F  |  // Hangul Jamo
        0x2329..=0x232A  |  // CJK angle brackets
        0x2E80..=0x303E  |  // CJK radicals, Kangxi, ideographic
        0x3041..=0x33BF  |  // Hiragana, Katakana, Bopomofo, Hangul compat, CJK
        0x3400..=0x4DBF  |  // CJK Unified Ideographs Extension A
        0x4E00..=0xA4CF  |  // CJK Unified Ideographs, Yi
        0xA960..=0xA97F  |  // Hangul Jamo Extended-A
        0xAC00..=0xD7FF  |  // Hangul Syllables
        0xF900..=0xFAFF  |  // CJK Compatibility Ideographs
        0xFE10..=0xFE19  |  // Vertical forms
        0xFE30..=0xFE6F  |  // CJK Compatibility Forms
        0xFF01..=0xFF60  |  // Fullwidth forms
        0xFFE0..=0xFFE6  |  // Fullwidth signs
        0x1F300..=0x1F9FF | // Emoji & pictographs
        0x20000..=0x2FFFF | // CJK Extension B+
        0x30000..=0x3FFFF   // CJK Extension G+
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ascii_is_single() {
        assert_eq!(char_width('a'), CellWidth::Single);
        assert_eq!(char_width('Z'), CellWidth::Single);
        assert_eq!(char_width('0'), CellWidth::Single);
    }

    #[test]
    fn test_cjk_is_double() {
        assert_eq!(char_width('中'), CellWidth::Double);
        assert_eq!(char_width('日'), CellWidth::Double);
        assert_eq!(char_width('한'), CellWidth::Double);
    }

    #[test]
    fn test_combining_is_zero() {
        assert_eq!(char_width('\u{0301}'), CellWidth::Zero); // combining acute
        assert_eq!(char_width('\u{200B}'), CellWidth::Zero); // zero-width space
    }

    #[test]
    fn test_emoji_is_double() {
        assert_eq!(char_width('🎉'), CellWidth::Double);
    }
}
