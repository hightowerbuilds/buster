use std::collections::HashMap;
use tauri::{command, AppHandle, Emitter, State};

use crate::terminal::{TermScreenDelta, TerminalManager};
use crate::terminal::term_pro;

#[command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let app_handle = app.clone();
    let app_sixel = app.clone();
    let app_error = app.clone();
    state.spawn(
        rows,
        cols,
        cwd,
        move |id, delta| {
            let _ = app_handle.emit("terminal-screen", TermScreenEvent {
                term_id: id,
                delta,
            });
        },
        move |id, image| {
            let _ = app_sixel.emit("terminal-sixel", SixelEvent {
                term_id: id,
                image,
            });
        },
        move |id, message| {
            let _ = app_error.emit("terminal-pty-error", PtyErrorEvent {
                term_id: id,
                message,
            });
        },
    )
}

#[command]
pub fn set_terminal_theme(app: AppHandle, colors: HashMap<String, String>) -> Result<(), String> {
    use term_pro::ThemeColor;

    let mut theme = term_pro::TerminalTheme::new("app");
    for (key, hex) in &colors {
        let tc = match key.as_str() {
            "background" => ThemeColor::Background,
            "foreground" => ThemeColor::Foreground,
            "cursor" => ThemeColor::Cursor,
            "selection" => ThemeColor::Selection,
            "black" => ThemeColor::Black,
            "red" => ThemeColor::Red,
            "green" => ThemeColor::Green,
            "yellow" => ThemeColor::Yellow,
            "blue" => ThemeColor::Blue,
            "magenta" => ThemeColor::Magenta,
            "cyan" => ThemeColor::Cyan,
            "white" => ThemeColor::White,
            "brightBlack" => ThemeColor::BrightBlack,
            "brightRed" => ThemeColor::BrightRed,
            "brightGreen" => ThemeColor::BrightGreen,
            "brightYellow" => ThemeColor::BrightYellow,
            "brightBlue" => ThemeColor::BrightBlue,
            "brightMagenta" => ThemeColor::BrightMagenta,
            "brightCyan" => ThemeColor::BrightCyan,
            "brightWhite" => ThemeColor::BrightWhite,
            _ => continue,
        };
        theme.set(tc, hex);
    }
    crate::terminal::set_terminal_theme(theme);
    let _ = app.emit("terminal-theme-changed", ());
    Ok(())
}

#[command]
pub fn terminal_write(
    state: State<'_, TerminalManager>,
    term_id: String,
    data: String,
) -> Result<(), String> {
    state.write(&term_id, data.as_bytes())
}

#[command]
pub fn terminal_resize(
    state: State<'_, TerminalManager>,
    term_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.resize(&term_id, rows, cols)
}

#[command]
pub fn terminal_kill(
    state: State<'_, TerminalManager>,
    term_id: String,
) -> Result<(), String> {
    state.kill(&term_id)
}

#[derive(Clone, serde::Serialize)]
struct TermScreenEvent {
    term_id: String,
    delta: TermScreenDelta,
}

#[derive(Clone, serde::Serialize)]
struct SixelEvent {
    term_id: String,
    image: term_pro::SixelImage,
}

#[derive(Clone, serde::Serialize)]
struct PtyErrorEvent {
    term_id: String,
    message: String,
}
