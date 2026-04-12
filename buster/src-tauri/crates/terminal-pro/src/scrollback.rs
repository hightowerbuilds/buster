use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Configuration for scrollback buffer management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrollbackConfig {
    /// Maximum number of lines to retain (default: 10000).
    pub max_lines: usize,
    /// Whether alt-screen mode should use a separate buffer.
    pub separate_alt_screen: bool,
}

impl Default for ScrollbackConfig {
    fn default() -> Self {
        Self {
            max_lines: 10_000,
            separate_alt_screen: true,
        }
    }
}

/// Managed scrollback buffer with configurable size limits.
///
/// Automatically trims old lines when the limit is exceeded.
/// Supports separate alt-screen buffer for full-screen apps (vim, less).
pub struct ScrollbackBuffer {
    config: ScrollbackConfig,
    /// Primary scrollback (normal mode).
    primary: VecDeque<String>,
    /// Alt-screen buffer (for vim, less, htop, etc.)
    alt_screen: VecDeque<String>,
    /// Whether we're currently in alt-screen mode.
    in_alt_screen: bool,
}

impl ScrollbackBuffer {
    pub fn new(config: ScrollbackConfig) -> Self {
        Self {
            primary: VecDeque::with_capacity(config.max_lines.min(1000)),
            alt_screen: VecDeque::new(),
            in_alt_screen: false,
            config,
        }
    }

    /// Push a line into the active buffer.
    pub fn push(&mut self, line: String) {
        let max = self.config.max_lines;
        let buffer = self.active_buffer_mut();
        buffer.push_back(line);

        // Trim if over limit
        while buffer.len() > max {
            buffer.pop_front();
        }
    }

    /// Enter alt-screen mode (e.g., when vim or less starts).
    pub fn enter_alt_screen(&mut self) {
        if self.config.separate_alt_screen {
            self.in_alt_screen = true;
            self.alt_screen.clear();
        }
    }

    /// Exit alt-screen mode (e.g., when vim or less exits).
    pub fn exit_alt_screen(&mut self) {
        self.in_alt_screen = false;
        self.alt_screen.clear();
    }

    pub fn is_alt_screen(&self) -> bool {
        self.in_alt_screen
    }

    /// Get the number of lines in the active buffer.
    pub fn len(&self) -> usize {
        self.active_buffer().len()
    }

    pub fn is_empty(&self) -> bool {
        self.active_buffer().is_empty()
    }

    /// Get a line by index (0 = oldest line).
    pub fn get(&self, index: usize) -> Option<&str> {
        self.active_buffer().get(index).map(|s| s.as_str())
    }

    /// Get a range of lines for rendering.
    pub fn get_range(&self, start: usize, end: usize) -> Vec<&str> {
        let buffer = self.active_buffer();
        let end = end.min(buffer.len());
        (start..end)
            .filter_map(|i| buffer.get(i).map(|s| s.as_str()))
            .collect()
    }

    /// Clear the active buffer.
    pub fn clear(&mut self) {
        self.active_buffer_mut().clear();
    }

    /// Memory usage estimate in bytes.
    pub fn memory_usage(&self) -> usize {
        let primary: usize = self.primary.iter().map(|s| s.len()).sum();
        let alt: usize = self.alt_screen.iter().map(|s| s.len()).sum();
        primary + alt
    }

    fn active_buffer(&self) -> &VecDeque<String> {
        if self.in_alt_screen {
            &self.alt_screen
        } else {
            &self.primary
        }
    }

    fn active_buffer_mut(&mut self) -> &mut VecDeque<String> {
        if self.in_alt_screen {
            &mut self.alt_screen
        } else {
            &mut self.primary
        }
    }
}

impl Default for ScrollbackBuffer {
    fn default() -> Self {
        Self::new(ScrollbackConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_get() {
        let mut buf = ScrollbackBuffer::default();
        buf.push("line 1".into());
        buf.push("line 2".into());
        assert_eq!(buf.len(), 2);
        assert_eq!(buf.get(0), Some("line 1"));
        assert_eq!(buf.get(1), Some("line 2"));
    }

    #[test]
    fn test_trim_at_limit() {
        let config = ScrollbackConfig { max_lines: 3, ..Default::default() };
        let mut buf = ScrollbackBuffer::new(config);
        for i in 0..5 {
            buf.push(format!("line {}", i));
        }
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.get(0), Some("line 2"));
    }

    #[test]
    fn test_alt_screen_isolation() {
        let mut buf = ScrollbackBuffer::default();
        buf.push("primary 1".into());
        buf.push("primary 2".into());

        buf.enter_alt_screen();
        assert!(buf.is_alt_screen());
        assert_eq!(buf.len(), 0); // alt screen is empty

        buf.push("alt 1".into());
        assert_eq!(buf.len(), 1);

        buf.exit_alt_screen();
        assert_eq!(buf.len(), 2); // primary restored
        assert_eq!(buf.get(0), Some("primary 1"));
    }

    #[test]
    fn test_get_range() {
        let mut buf = ScrollbackBuffer::default();
        for i in 0..10 {
            buf.push(format!("line {}", i));
        }
        let range = buf.get_range(3, 6);
        assert_eq!(range, vec!["line 3", "line 4", "line 5"]);
    }
}
