use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A named color in the terminal palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ThemeColor {
    Black, Red, Green, Yellow, Blue, Magenta, Cyan, White,
    BrightBlack, BrightRed, BrightGreen, BrightYellow,
    BrightBlue, BrightMagenta, BrightCyan, BrightWhite,
    Background, Foreground, Cursor, Selection,
}

/// Runtime-switchable terminal color theme.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalTheme {
    pub name: String,
    colors: HashMap<ThemeColor, String>,
}

impl TerminalTheme {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            colors: HashMap::new(),
        }
    }

    pub fn set(&mut self, color: ThemeColor, hex: &str) {
        self.colors.insert(color, hex.to_string());
    }

    pub fn get(&self, color: ThemeColor) -> &str {
        self.colors.get(&color).map(|s| s.as_str()).unwrap_or("#cdd6f4")
    }

    /// Catppuccin Mocha (Buster's default).
    pub fn catppuccin_mocha() -> Self {
        let mut t = Self::new("Catppuccin Mocha");
        t.set(ThemeColor::Background, "#1e1e2e");
        t.set(ThemeColor::Foreground, "#cdd6f4");
        t.set(ThemeColor::Cursor, "#f5e0dc");
        t.set(ThemeColor::Selection, "#45475a");
        t.set(ThemeColor::Black, "#45475a");
        t.set(ThemeColor::Red, "#f38ba8");
        t.set(ThemeColor::Green, "#a6e3a1");
        t.set(ThemeColor::Yellow, "#f9e2af");
        t.set(ThemeColor::Blue, "#89b4fa");
        t.set(ThemeColor::Magenta, "#cba6f7");
        t.set(ThemeColor::Cyan, "#89dceb");
        t.set(ThemeColor::White, "#bac2de");
        t.set(ThemeColor::BrightBlack, "#585b70");
        t.set(ThemeColor::BrightRed, "#f38ba8");
        t.set(ThemeColor::BrightGreen, "#a6e3a1");
        t.set(ThemeColor::BrightYellow, "#f9e2af");
        t.set(ThemeColor::BrightBlue, "#89b4fa");
        t.set(ThemeColor::BrightMagenta, "#cba6f7");
        t.set(ThemeColor::BrightCyan, "#94e2d5");
        t.set(ThemeColor::BrightWhite, "#a6adc8");
        t
    }

    /// Solarized Dark.
    pub fn solarized_dark() -> Self {
        let mut t = Self::new("Solarized Dark");
        t.set(ThemeColor::Background, "#002b36");
        t.set(ThemeColor::Foreground, "#839496");
        t.set(ThemeColor::Cursor, "#93a1a1");
        t.set(ThemeColor::Selection, "#073642");
        t.set(ThemeColor::Black, "#073642");
        t.set(ThemeColor::Red, "#dc322f");
        t.set(ThemeColor::Green, "#859900");
        t.set(ThemeColor::Yellow, "#b58900");
        t.set(ThemeColor::Blue, "#268bd2");
        t.set(ThemeColor::Magenta, "#d33682");
        t.set(ThemeColor::Cyan, "#2aa198");
        t.set(ThemeColor::White, "#eee8d5");
        t.set(ThemeColor::BrightBlack, "#586e75");
        t.set(ThemeColor::BrightRed, "#cb4b16");
        t.set(ThemeColor::BrightGreen, "#586e75");
        t.set(ThemeColor::BrightYellow, "#657b83");
        t.set(ThemeColor::BrightBlue, "#839496");
        t.set(ThemeColor::BrightMagenta, "#6c71c4");
        t.set(ThemeColor::BrightCyan, "#93a1a1");
        t.set(ThemeColor::BrightWhite, "#fdf6e3");
        t
    }
}

impl Default for TerminalTheme {
    fn default() -> Self {
        Self::catppuccin_mocha()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catppuccin_colors() {
        let theme = TerminalTheme::catppuccin_mocha();
        assert_eq!(theme.get(ThemeColor::Background), "#1e1e2e");
        assert_eq!(theme.get(ThemeColor::Red), "#f38ba8");
    }

    #[test]
    fn test_solarized_colors() {
        let theme = TerminalTheme::solarized_dark();
        assert_eq!(theme.get(ThemeColor::Background), "#002b36");
    }

    #[test]
    fn test_runtime_switch() {
        let mocha = TerminalTheme::catppuccin_mocha();
        let solar = TerminalTheme::solarized_dark();
        assert_ne!(mocha.get(ThemeColor::Background), solar.get(ThemeColor::Background));
    }
}
