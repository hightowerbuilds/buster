use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

// buster-terminal-pro integration — runtime themes, CJK width, sixel, crash recovery
pub mod term_pro {
    pub use buster_terminal_pro::{
        TerminalTheme, ThemeColor, PtyMonitor, SixelParser, SixelImage,
    };
}

// Active terminal theme — used by color_to_rgb/color_to_bg_rgb/idx_to_rgb
use std::sync::RwLock;
use std::sync::LazyLock;
static ACTIVE_THEME: LazyLock<RwLock<term_pro::TerminalTheme>> =
    LazyLock::new(|| RwLock::new(term_pro::TerminalTheme::catppuccin_mocha()));

fn with_active_theme<R>(f: impl FnOnce(&term_pro::TerminalTheme) -> R) -> R {
    let guard = ACTIVE_THEME.read().unwrap();
    f(&guard)
}

/// Set the active terminal theme at runtime.
pub fn set_terminal_theme(theme: term_pro::TerminalTheme) {
    let mut guard = ACTIVE_THEME.write().unwrap();
    *guard = theme;
}

#[derive(Clone, Serialize, PartialEq)]
pub struct TermCell {
    pub ch: String,
    pub fg: [u8; 3],
    pub bg: [u8; 3],
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
    pub strikethrough: bool,
    pub faint: bool,
    /// 0 = wide-char continuation (skip), 1 = normal, 2 = double-width
    pub width: u8,
}

#[derive(Clone, Serialize)]
pub struct TermScreen {
    pub rows: u16,
    pub cols: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub cells: Vec<Vec<TermCell>>,
}

fn color_to_rgb(color: &vt100::Color) -> [u8; 3] {
    match color {
        vt100::Color::Default => with_active_theme(|t| hex_to_rgb(t.get(term_pro::ThemeColor::Foreground))),
        vt100::Color::Idx(i) => idx_to_rgb(*i),
        vt100::Color::Rgb(r, g, b) => [*r, *g, *b],
    }
}

fn color_to_bg_rgb(color: &vt100::Color) -> [u8; 3] {
    match color {
        vt100::Color::Default => with_active_theme(|t| hex_to_rgb(t.get(term_pro::ThemeColor::Background))),
        vt100::Color::Idx(i) => idx_to_rgb(*i),
        vt100::Color::Rgb(r, g, b) => [*r, *g, *b],
    }
}

/// Parse a "#RRGGBB" hex string to [r, g, b].
fn hex_to_rgb(hex: &str) -> [u8; 3] {
    if hex.len() >= 7 && hex.starts_with('#') {
        let r = u8::from_str_radix(&hex[1..3], 16).unwrap_or(205);
        let g = u8::from_str_radix(&hex[3..5], 16).unwrap_or(214);
        let b = u8::from_str_radix(&hex[5..7], 16).unwrap_or(244);
        [r, g, b]
    } else {
        [205, 214, 244] // fallback to Catppuccin text
    }
}

fn idx_to_rgb(i: u8) -> [u8; 3] {
    use term_pro::ThemeColor;
    // Standard 16 ANSI colors — read from the active theme
    match i {
        0 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Black))),
        1 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Red))),
        2 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Green))),
        3 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Yellow))),
        4 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Blue))),
        5 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Magenta))),
        6 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::Cyan))),
        7 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::White))),
        8 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightBlack))),
        9 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightRed))),
        10 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightGreen))),
        11 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightYellow))),
        12 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightBlue))),
        13 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightMagenta))),
        14 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightCyan))),
        15 => with_active_theme(|t| hex_to_rgb(t.get(ThemeColor::BrightWhite))),
        // 256-color: 16-231 = 6x6x6 cube, 232-255 = grayscale
        16..=231 => {
            let c = i - 16;
            let r = (c / 36) * 51;
            let g = ((c % 36) / 6) * 51;
            let b = (c % 6) * 51;
            [r, g, b]
        }
        232..=255 => {
            let v = 8 + (i - 232) * 10;
            [v, v, v]
        }
    }
}

fn extract_screen(parser: &vt100::Parser) -> TermScreen {
    let screen = parser.screen();
    let (rows, cols) = screen.size();
    let (cursor_row, cursor_col) = screen.cursor_position();

    let mut cells = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        let mut row_cells = Vec::with_capacity(cols as usize);
        for col in 0..cols {
            let cell = screen.cell(row, col).unwrap();
            let contents = cell.contents();
            let ch = if contents.is_empty() {
                " ".to_string()
            } else {
                contents
            };

            let fg = if cell.inverse() {
                color_to_bg_rgb(&cell.bgcolor())
            } else {
                color_to_rgb(&cell.fgcolor())
            };
            let bg = if cell.inverse() {
                color_to_rgb(&cell.fgcolor())
            } else {
                color_to_bg_rgb(&cell.bgcolor())
            };

            let width = if cell.is_wide() {
                2
            } else if cell.is_wide_continuation() {
                0
            } else {
                1
            };

            row_cells.push(TermCell {
                ch,
                fg,
                bg,
                bold: cell.bold(),
                italic: cell.italic(),
                underline: cell.underline(),
                inverse: cell.inverse(),
                strikethrough: false, // vt100 0.15 doesn't expose SGR 9
                faint: false,         // vt100 0.15 doesn't expose SGR 2
                width,
            });
        }
        cells.push(row_cells);
    }

    TermScreen {
        rows,
        cols,
        cursor_row,
        cursor_col,
        cells,
    }
}

#[derive(Clone, Serialize)]
pub struct ChangedRow {
    pub index: u16,
    pub cells: Vec<TermCell>,
}

#[derive(Clone, Serialize)]
pub struct TermScreenDelta {
    pub rows: u16,
    pub cols: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub changed_rows: Vec<ChangedRow>,
    pub full: bool,
    /// "none", "press", "press_release", "button_motion", "any_motion"
    pub mouse_mode: String,
    /// "default", "utf8", "sgr"
    pub mouse_encoding: String,
    pub bracketed_paste: bool,
    /// Window title from OSC 2 (None if unchanged)
    pub title: Option<String>,
    /// True if BEL (0x07) fired since last delta
    pub bell: bool,
    /// True when terminal is in alternate screen mode (vim, less, etc.)
    pub alt_screen: bool,
}

fn compute_delta(
    new_screen: TermScreen,
    last_cells: &mut Vec<Vec<TermCell>>,
    parser: &vt100::Parser,
    last_bell_count: &mut u32,
    last_title: &mut String,
) -> TermScreenDelta {
    let rows = new_screen.rows;
    let cols = new_screen.cols;

    let full = last_cells.is_empty()
        || last_cells.len() != rows as usize
        || last_cells.first().map(|r| r.len()).unwrap_or(0) != cols as usize;

    let mut changed_rows = Vec::new();

    for (i, row) in new_screen.cells.iter().enumerate() {
        let changed = full || i >= last_cells.len() || last_cells[i] != *row;
        if changed {
            changed_rows.push(ChangedRow {
                index: i as u16,
                cells: row.clone(),
            });
        }
    }

    *last_cells = new_screen.cells;

    let screen = parser.screen();
    let mouse_mode = match screen.mouse_protocol_mode() {
        vt100::MouseProtocolMode::None => "none",
        vt100::MouseProtocolMode::Press => "press",
        vt100::MouseProtocolMode::PressRelease => "press_release",
        vt100::MouseProtocolMode::ButtonMotion => "button_motion",
        vt100::MouseProtocolMode::AnyMotion => "any_motion",
    };
    let mouse_encoding = match screen.mouse_protocol_encoding() {
        vt100::MouseProtocolEncoding::Default => "default",
        vt100::MouseProtocolEncoding::Utf8 => "utf8",
        vt100::MouseProtocolEncoding::Sgr => "sgr",
    };

    // Bell detection: compare audible bell count with last known value
    let current_bell_count = screen.audible_bell_count() as u32;
    let bell = current_bell_count > *last_bell_count;
    *last_bell_count = current_bell_count;

    // Title detection: only emit when changed
    let current_title = screen.title().to_string();
    let title = if current_title != *last_title && !current_title.is_empty() {
        *last_title = current_title.clone();
        Some(current_title)
    } else {
        None
    };

    let alt_screen = screen.alternate_screen();

    TermScreenDelta {
        rows,
        cols,
        cursor_row: new_screen.cursor_row,
        cursor_col: new_screen.cursor_col,
        changed_rows,
        full,
        mouse_mode: mouse_mode.to_string(),
        mouse_encoding: mouse_encoding.to_string(),
        bracketed_paste: screen.bracketed_paste(),
        title,
        bell,
        alt_screen,
    }
}

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    _master: Box<dyn MasterPty + Send>,
    parser: Arc<Mutex<vt100::Parser>>,
    /// PID of the shell process — used to kill the entire process group on close.
    child_pid: Option<u32>,
}

pub struct TerminalManager {
    instances: Mutex<HashMap<String, Arc<Mutex<PtyInstance>>>>,
    next_id: Mutex<u32>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }

    pub fn spawn(
        &self,
        rows: u16,
        cols: u16,
        cwd: Option<String>,
        on_screen: impl Fn(String, TermScreenDelta) + Send + Sync + 'static,
        on_sixel: impl Fn(String, term_pro::SixelImage) + Send + Sync + 'static,
        on_pty_error: impl Fn(String, String) + Send + Sync + 'static,
        on_pty_restart: impl Fn(String, u32) + Send + Sync + 'static,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&shell);
        // Login shell on macOS (needed for path_helper env), interactive elsewhere
        if cfg!(target_os = "macos") {
            cmd.arg("-l");
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;
        let child_pid = child.process_id();

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let mut id_counter = self.next_id.lock().map_err(|e| e.to_string())?;
        let term_id = format!("term_{}", *id_counter);
        *id_counter += 1;

        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 10_000)));

        // Create a PtyMonitor for crash recovery (allow up to 3 restarts)
        let monitor = Arc::new(term_pro::PtyMonitor::new(3));

        let instance = Arc::new(Mutex::new(PtyInstance {
            writer,
            _master: pair.master,
            parser: parser.clone(),
            child_pid,
        }));

        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .insert(term_id.clone(), instance.clone());

        // Send initial empty screen as a full delta
        let on_screen = Arc::new(on_screen);
        let on_sixel = Arc::new(on_sixel);
        let on_pty_error = Arc::new(on_pty_error);
        let on_pty_restart = Arc::new(on_pty_restart);
        {
            let p = parser.lock().unwrap_or_else(|e| e.into_inner());
            let screen = extract_screen(&p);
            drop(p);
            let initial_delta = TermScreenDelta {
                rows: screen.rows,
                cols: screen.cols,
                cursor_row: screen.cursor_row,
                cursor_col: screen.cursor_col,
                changed_rows: screen.cells.into_iter().enumerate().map(|(i, cells)| ChangedRow {
                    index: i as u16,
                    cells,
                }).collect(),
                full: true,
                mouse_mode: "none".to_string(),
                mouse_encoding: "default".to_string(),
                bracketed_paste: false,
                title: None,
                bell: false,
                alt_screen: false,
            };
            on_screen(term_id.clone(), initial_delta);
        }

        // Reader thread: feed PTY output into vt100, detect sixel, handle crash recovery
        let term_id_for_reader = term_id.clone();
        let parser_for_reader = parser.clone();
        let on_screen_for_reader = on_screen.clone();
        let on_sixel_for_reader = on_sixel.clone();
        let on_pty_error_for_reader = on_pty_error.clone();
        let on_pty_restart_for_reader = on_pty_restart.clone();
        let monitor_for_reader = monitor.clone();
        let cwd_for_reader = cwd.clone();
        let instance_for_reader = instance.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut last_cells: Vec<Vec<TermCell>> = Vec::new();
            let mut last_bell_count: u32 = 0;
            let mut last_title = String::new();
            let mut sixel_parser = term_pro::SixelParser::new();
            let mut sixel_buf: Vec<u8> = Vec::new();
            let mut in_sixel = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        // PTY exited or errored — attempt respawn via PtyMonitor
                        monitor_for_reader.mark_crashed();
                        match monitor_for_reader.try_restart() {
                            Ok(count) => {
                                // Attempt to respawn the PTY
                                let pty_system = native_pty_system();
                                let pair = match pty_system.openpty(PtySize {
                                    rows,
                                    cols,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                }) {
                                    Ok(p) => p,
                                    Err(_) => {
                                        on_pty_error_for_reader(
                                            term_id_for_reader.clone(),
                                            "Failed to reopen PTY after crash".to_string(),
                                        );
                                        break;
                                    }
                                };

                                let shell = std::env::var("SHELL")
                                    .unwrap_or_else(|_| "/bin/zsh".to_string());
                                let mut cmd = CommandBuilder::new(&shell);
                                if cfg!(target_os = "macos") {
                                    cmd.arg("-l");
                                }
                                cmd.env("TERM", "xterm-256color");
                                cmd.env("COLORTERM", "truecolor");
                                if let Some(ref dir) = cwd_for_reader {
                                    cmd.cwd(dir);
                                }

                                if pair.slave.spawn_command(cmd).is_err() {
                                    on_pty_error_for_reader(
                                        term_id_for_reader.clone(),
                                        "Failed to respawn shell after crash".to_string(),
                                    );
                                    break;
                                }

                                let new_reader = match pair.master.try_clone_reader() {
                                    Ok(r) => r,
                                    Err(_) => {
                                        on_pty_error_for_reader(
                                            term_id_for_reader.clone(),
                                            "Failed to clone reader for respawned PTY".to_string(),
                                        );
                                        break;
                                    }
                                };

                                let new_writer = match pair.master.take_writer() {
                                    Ok(w) => w,
                                    Err(_) => {
                                        on_pty_error_for_reader(
                                            term_id_for_reader.clone(),
                                            "Failed to take writer for respawned PTY".to_string(),
                                        );
                                        break;
                                    }
                                };

                                // Update the instance with new PTY handles
                                {
                                    let mut inst = instance_for_reader.lock()
                                        .unwrap_or_else(|e| e.into_inner());
                                    inst.writer = new_writer;
                                    inst._master = pair.master;
                                    // Reset the vt100 parser for the new session
                                    let mut p = inst.parser.lock()
                                        .unwrap_or_else(|e| e.into_inner());
                                    *p = vt100::Parser::new(rows, cols, 10_000);
                                }

                                reader = new_reader;
                                last_cells.clear();
                                last_bell_count = 0;
                                last_title.clear();
                                eprintln!(
                                    "[terminal] PTY {} respawned (restart #{})",
                                    term_id_for_reader, count
                                );
                                on_pty_restart_for_reader(
                                    term_id_for_reader.clone(),
                                    count,
                                );
                                continue;
                            }
                            Err(e) => {
                                // Max restarts exceeded — notify frontend
                                on_pty_error_for_reader(
                                    term_id_for_reader.clone(),
                                    format!("Terminal crashed: {}", e),
                                );
                                break;
                            }
                        }
                    }
                    Ok(n) => {
                        let data = &buf[..n];

                        // Detect sixel sequences in the raw PTY output
                        let mut i = 0;
                        while i < n {
                            if in_sixel {
                                sixel_buf.push(data[i]);
                                // Check for sixel terminator (ESC \ or ST)
                                let slen = sixel_buf.len();
                                if (data[i] == 0x5C && slen >= 2 && sixel_buf[slen - 2] == 0x1B)
                                    || data[i] == 0x9C
                                {
                                    // End of sixel — decode and emit
                                    let cursor_row = {
                                        let p = parser_for_reader.lock()
                                            .unwrap_or_else(|e| e.into_inner());
                                        let (cr, _) = p.screen().cursor_position();
                                        cr
                                    };
                                    let img = sixel_parser.decode(&sixel_buf, cursor_row, 0);
                                    if img.width > 0 && img.height > 0 {
                                        on_sixel_for_reader(term_id_for_reader.clone(), img);
                                    }
                                    sixel_buf.clear();
                                    in_sixel = false;
                                }
                                i += 1;
                            } else if term_pro::SixelParser::is_sixel_start(&data[i..]) {
                                in_sixel = true;
                                sixel_buf.clear();
                                // Skip the DCS introducer bytes
                                if data[i] == 0x1B {
                                    i += 2; // ESC P
                                } else {
                                    i += 1; // 0x90
                                }
                            } else {
                                i += 1;
                            }
                        }

                        // Feed the full output into vt100 (sixel bytes are ignored by vt100)
                        let mut p = parser_for_reader.lock().unwrap_or_else(|e| e.into_inner());
                        p.process(data);
                        let screen = extract_screen(&p);
                        let delta = compute_delta(screen, &mut last_cells, &p, &mut last_bell_count, &mut last_title);
                        drop(p);
                        on_screen_for_reader(term_id_for_reader.clone(), delta);
                    }
                }
            }
        });

        Ok(term_id)
    }

    pub fn write(&self, term_id: &str, data: &[u8]) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(term_id).ok_or("Terminal not found")?;
        let mut inst = instance.lock().map_err(|e| e.to_string())?;
        inst.writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        inst.writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, term_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(term_id).ok_or("Terminal not found")?;
        let inst = instance.lock().map_err(|e| e.to_string())?;
        inst._master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        // Also resize the vt100 parser
        inst.parser.lock().unwrap_or_else(|e| e.into_inner()).set_size(rows, cols);
        Ok(())
    }

    pub fn resync(&self, term_id: &str) -> Result<TermScreenDelta, String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get(term_id).ok_or("Terminal not found")?;
        let inst = instance.lock().map_err(|e| e.to_string())?;
        let p = inst.parser.lock().unwrap_or_else(|e| e.into_inner());
        let screen = extract_screen(&p);
        Ok(TermScreenDelta {
            rows: screen.rows,
            cols: screen.cols,
            cursor_row: screen.cursor_row,
            cursor_col: screen.cursor_col,
            changed_rows: screen.cells.into_iter().enumerate().map(|(i, cells)| ChangedRow {
                index: i as u16,
                cells,
            }).collect(),
            full: true,
            mouse_mode: "none".to_string(),
            mouse_encoding: "default".to_string(),
            bracketed_paste: p.screen().bracketed_paste(),
            title: None,
            bell: false,
            alt_screen: p.screen().alternate_screen(),
        })
    }

    pub fn kill(&self, term_id: &str) -> Result<(), String> {
        let mut instances = self.instances.lock().map_err(|e| e.to_string())?;
        if let Some(instance) = instances.remove(term_id) {
            let inst = instance.lock().unwrap_or_else(|e| e.into_inner());
            // Kill the entire process group so child processes (dev servers etc.) also die
            if let Some(pid) = inst.child_pid {
                #[cfg(unix)]
                {
                    // Negative PID sends the signal to the entire process group
                    unsafe { libc::kill(-(pid as i32), libc::SIGHUP); }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idx_to_rgb_standard_black() {
        assert_eq!(idx_to_rgb(0), [69, 71, 90]);
    }

    #[test]
    fn idx_to_rgb_standard_red() {
        assert_eq!(idx_to_rgb(1), [243, 139, 168]);
    }

    #[test]
    fn idx_to_rgb_standard_green() {
        assert_eq!(idx_to_rgb(2), [166, 227, 161]);
    }

    #[test]
    fn idx_to_rgb_bright_white() {
        assert_eq!(idx_to_rgb(15), [166, 173, 200]);
    }

    #[test]
    fn idx_to_rgb_256_cube_origin() {
        // Color 16 = (0,0,0) in 6x6x6 cube
        assert_eq!(idx_to_rgb(16), [0, 0, 0]);
    }

    #[test]
    fn idx_to_rgb_256_cube_red() {
        // Color 196 = (5,0,0) in 6x6x6 cube → (255, 0, 0)
        assert_eq!(idx_to_rgb(196), [255, 0, 0]);
    }

    #[test]
    fn idx_to_rgb_256_cube_white() {
        // Color 231 = (5,5,5) → (255, 255, 255)
        assert_eq!(idx_to_rgb(231), [255, 255, 255]);
    }

    #[test]
    fn idx_to_rgb_grayscale_darkest() {
        // Color 232 = darkest gray → 8
        assert_eq!(idx_to_rgb(232), [8, 8, 8]);
    }

    #[test]
    fn idx_to_rgb_grayscale_lightest() {
        // Color 255 = lightest gray → 238
        assert_eq!(idx_to_rgb(255), [238, 238, 238]);
    }

    #[test]
    fn color_to_rgb_default_is_catppuccin_text() {
        let c = color_to_rgb(&vt100::Color::Default);
        assert_eq!(c, [205, 214, 244]);
    }

    #[test]
    fn color_to_bg_rgb_default_is_catppuccin_base() {
        let c = color_to_bg_rgb(&vt100::Color::Default);
        assert_eq!(c, [30, 30, 46]);
    }

    #[test]
    fn color_to_rgb_direct_rgb() {
        let c = color_to_rgb(&vt100::Color::Rgb(100, 200, 50));
        assert_eq!(c, [100, 200, 50]);
    }

    #[test]
    fn terminal_manager_starts_empty() {
        let mgr = TerminalManager::new();
        let instances = mgr.instances.lock().unwrap();
        assert!(instances.is_empty());
    }
}
