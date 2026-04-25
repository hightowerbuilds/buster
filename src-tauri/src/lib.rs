mod commands;
mod terminal;
mod syntax;
mod lsp;
mod extensions;
mod debugger;
pub mod workspace;
pub mod watcher;
mod browser;
mod browser_module;
pub mod filebuffer;

use terminal::TerminalManager;
use syntax::SyntaxService;
use lsp::LspManager;
use debugger::DebugManager;
use browser::BrowserManager;
use tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(workspace::WorkspaceState::new())
        .manage(TerminalManager::new())
        .manage(SyntaxService::new())
        .manage(LspManager::new())
        .manage(extensions::ExtensionManager::new())
        .manage(Arc::new(extensions::surface::SurfaceManager::new()))
        .manage(watcher::FileWatcher::new())
        .manage(Arc::new(BrowserManager::new()))
        .manage(filebuffer::FileBufferManager::new())
        .manage(DebugManager::new())
        .manage(tokio::sync::Mutex::new(Option::<browser_module::BrowserModule>::None))
        .setup(|app| {
            // Build the native menu bar
            let change_dir = MenuItem::with_id(app, "change_directory", "Change Directory", true, None::<&str>)?;
            let close_dir = MenuItem::with_id(app, "close_directory", "Close Directory", true, None::<&str>)?;
            let view_extensions = MenuItem::with_id(
                app,
                "view_extensions",
                "Extensions (Ctrl+` then E)",
                true,
                None::<&str>,
            )?;
            let view_debug = MenuItem::with_id(
                app,
                "view_debug",
                "Debug (Ctrl+` then D)",
                true,
                None::<&str>,
            )?;
            let view_settings = MenuItem::with_id(
                app,
                "view_settings",
                "Settings (Cmd+, / Ctrl+` then S)",
                true,
                None::<&str>,
            )?;
            let new_file = MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?;
            let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as = MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?;
            let close_tab = MenuItem::with_id(
                app,
                "close_tab",
                "Close Tab",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let file_menu = Submenu::with_items(app, "File", true, &[
                &new_file,
                &PredefinedMenuItem::separator(app)?,
                &change_dir,
                &close_dir,
                &PredefinedMenuItem::separator(app)?,
                &save,
                &save_as,
                &PredefinedMenuItem::separator(app)?,
                &close_tab,
            ])?;

            // Use PredefinedMenuItems so macOS registers native selectors (undo:, cut:, copy:, paste:, selectAll:).
            // This is critical for compatibility with voice dictation tools (Wispr Flow, macOS Dictation)
            // which inject text via simulated Cmd+V through the macOS responder chain.
            // PredefinedMenuItems route through the native NSResponder paste: selector,
            // while custom MenuItems with accelerators only intercept the key combo from real keyboard events.
            let select_all = MenuItem::with_id(app, "select_all", "Select All", true, Some("CmdOrCtrl+A"))?;
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, Some("Undo"))?,
                &PredefinedMenuItem::redo(app, Some("Redo"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("Cut"))?,
                &PredefinedMenuItem::copy(app, Some("Copy"))?,
                &PredefinedMenuItem::paste(app, Some("Paste"))?,
                &select_all,
            ])?;

            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[&view_extensions, &view_debug, &view_settings],
            )?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu])?;
            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "change_directory" => {
                        let _ = app_handle.emit("menu-change-directory", ());
                    }
                    "close_directory" => {
                        let _ = app_handle.emit("menu-close-directory", ());
                    }
                    "close_tab" => {
                        let _ = app_handle.emit("menu-close-tab", ());
                    }
                    "undo" => {
                        let _ = app_handle.emit("menu-undo", ());
                    }
                    "redo" => {
                        let _ = app_handle.emit("menu-redo", ());
                    }
                    "cut" => {
                        let _ = app_handle.emit("menu-cut", ());
                    }
                    "copy" => {
                        let _ = app_handle.emit("menu-copy", ());
                    }
                    "paste" => {
                        let _ = app_handle.emit("menu-paste", ());
                    }
                    "select_all" => {
                        let _ = app_handle.emit("menu-select-all", ());
                    }
                    "view_extensions" => {
                        let _ = app_handle.emit("menu-open-extensions", ());
                    }
                    "view_debug" => {
                        let _ = app_handle.emit("menu-open-debug", ());
                    }
                    "view_settings" => {
                        let _ = app_handle.emit("menu-open-settings", ());
                    }
                    "new_file" => {
                        let _ = app_handle.emit("menu-new-file", ());
                    }
                    "save" => {
                        let _ = app_handle.emit("menu-save", ());
                    }
                    "save_as" => {
                        let _ = app_handle.emit("menu-save-as", ());
                    }
                    _ => {}
                }
            });

            // Set window icon (visible in dev mode dock/taskbar)
            {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_icon(icon);
                    }
                }
            }

            // Block ALL window close attempts. Cmd+W closes tabs via the menu
            // accelerator; Cmd+Q terminates the process. This is diagnostic:
            // if the app still closes on Cmd+W, prevent_close() isn't working.
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                });
            }

            // Spawn diagnostic forwarding thread (LSP -> frontend)
            let lsp_mgr = app.state::<LspManager>();
            if let Some(rx) = lsp_mgr.take_diag_rx() {
                let diag_handle = app.handle().clone();
                std::thread::spawn(move || {
                    while let Ok((file_path, diagnostics)) = rx.recv() {
                        #[derive(serde::Serialize, Clone)]
                        struct DiagnosticEvent {
                            file_path: String,
                            diagnostics: Vec<lsp::client::LspDiagnostic>,
                        }
                        let _ = diag_handle.emit("lsp-diagnostics", DiagnosticEvent { file_path, diagnostics });
                    }
                });
            }

            // Start file watcher and spawn forwarding thread
            let file_watcher = app.state::<watcher::FileWatcher>();
            file_watcher.start().expect("Failed to start file watcher");
            if let Some(rx) = file_watcher.take_event_rx() {
                let watcher_handle = app.handle().clone();
                std::thread::spawn(move || {
                    while let Ok(file_path) = rx.recv() {
                        #[derive(serde::Serialize, Clone)]
                        struct FileChangedEvent {
                            path: String,
                        }
                        let _ = watcher_handle.emit(
                            "file-changed-externally",
                            FileChangedEvent { path: file_path },
                        );
                    }
                });
            }

            // Spawn debug event forwarding thread (DAP → frontend)
            {
                let debug_mgr = app.state::<debugger::DebugManager>();
                if let Some(rx) = debug_mgr.take_event_rx() {
                    let debug_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        while let Ok(event) = rx.recv() {
                            let _ = debug_handle.emit("debug-event", &event);
                        }
                    });
                }
            }

            // Wire surface event sink
            {
                let surface_handle = app.handle().clone();
                let sm = app.state::<Arc<extensions::surface::SurfaceManager>>();
                sm.set_event_sink(Arc::new(move |event| {
                    let _ = surface_handle.emit("surface-event", &event);
                }));
                let measure_handle = app.handle().clone();
                sm.set_measure_sink(Arc::new(move |req| {
                    let _ = measure_handle.emit("surface-measure-text", &req);
                }));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File commands
            commands::file::set_workspace_root,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::list_directory,
            commands::file::move_entry,
            commands::file::create_file,
            commands::file::create_directory,
            commands::file::rename_entry,
            commands::file::delete_entry,
            commands::file::read_binary_file,
            commands::file::watch_file,
            commands::file::unwatch_file,
            // Terminal commands
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::terminal::terminal_resync,
            commands::terminal::set_terminal_theme,
            // Syntax highlighting
            commands::syntax::highlight_code,
            commands::syntax::syntax_open,
            commands::syntax::syntax_close,
            commands::syntax::syntax_edit,
            commands::syntax::syntax_languages,
            // Debugger
            commands::debugger::debug_toggle_breakpoint,
            commands::debugger::debug_get_breakpoints,
            commands::debugger::debug_state,
            commands::debugger::debug_launch,
            commands::debugger::debug_continue,
            commands::debugger::debug_step_over,
            commands::debugger::debug_step_into,
            commands::debugger::debug_step_out,
            commands::debugger::debug_pause,
            commands::debugger::debug_stop,
            commands::debugger::debug_stack_trace,
            commands::debugger::debug_variables,
            // Search
            commands::search::list_workspace_files,
            commands::search::workspace_search,
            // Settings
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::add_recent_folder,
            // LSP
            commands::lsp::lsp_start,
            commands::lsp::lsp_did_change,
            commands::lsp::lsp_did_change_incremental,
            commands::lsp::lsp_did_save,
            commands::lsp::lsp_did_close,
            commands::lsp::lsp_completion,
            commands::lsp::lsp_hover,
            commands::lsp::lsp_definition,
            commands::lsp::lsp_type_definition,
            commands::lsp::lsp_inlay_hints,
            commands::lsp::lsp_signature_help,
            commands::lsp::lsp_code_action,
            commands::lsp::lsp_document_symbol,
            commands::lsp::lsp_rename,
            commands::lsp::lsp_references,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_status,
            // Git
            commands::git::git_status,
            commands::git::git_branch,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_diff_file,
            commands::git::git_diff_staged,
            commands::git::git_show_file,
            commands::git::git_log_graph,
            commands::git::git_is_repo,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_fetch,
            commands::git::git_ahead_behind,
            commands::git::git_branch_list,
            commands::git::git_branch_create,
            commands::git::git_branch_switch,
            commands::git::git_branch_delete,
            commands::git::git_stash_save,
            commands::git::git_stash_pop,
            commands::git::git_stash_list,
            commands::git::git_stash_drop,
            commands::git::git_commit_amend,
            commands::git::git_conflict_markers,
            commands::git::git_resolve_conflict,
            commands::git::git_remote_list,
            commands::git::git_remote_add,
            commands::git::git_remote_remove,
            commands::git::git_remote_rename,
            commands::git::git_remote_set_url,
            commands::git::git_diff_hunks,
            commands::git::git_blame,
            // Extensions
            commands::extensions::ext_list,
            commands::extensions::ext_load,
            commands::extensions::ext_unload,
            commands::extensions::ext_restore,
            commands::extensions::ext_gateway_connect,
            commands::extensions::ext_gateway_send,
            commands::extensions::ext_gateway_disconnect,
            commands::extensions::ext_call,
            commands::extensions::ext_install,
            commands::extensions::ext_uninstall,
            // Surface
            commands::surface::surface_measure_text_response,
            commands::surface::surface_get_last_paint,
            commands::surface::surface_resize_notify,
            // Browser
            commands::browser::create_browser_view,
            commands::browser::navigate_browser_view,
            commands::browser::resize_browser_view,
            commands::browser::show_browser_view,
            commands::browser::hide_browser_view,
            commands::browser::close_browser_view,
            commands::browser::hide_all_browser_views,
            commands::browser::show_all_browser_views,
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_reload,
            commands::browser::scan_local_ports,
            commands::browser::browser_module_launch,
            commands::browser::browser_module_navigate,
            commands::browser::browser_module_refresh,
            commands::browser::browser_module_poll,
            commands::browser::browser_module_on_click,
            commands::browser::browser_module_on_key,
            commands::browser::browser_module_on_resize,
            commands::browser::browser_module_on_visibility,
            commands::browser::browser_module_on_mouse_move,
            commands::browser::browser_module_close,
            // Keymap (Lua evaluation)
            commands::keymap::evaluate_keymap,
            // Session
            commands::session::save_session,
            commands::session::load_session,
            commands::session::save_backup_buffer,
            commands::session::load_backup_buffer,
            commands::session::delete_backup_buffer,
            commands::session::clear_session,
            commands::session::confirm_app_close,
            commands::session::set_running_flag,
            commands::session::clear_running_flag,
            // Large file buffer
            commands::filebuffer::file_is_large,
            commands::filebuffer::large_file_open,
            commands::filebuffer::large_file_read_lines,
            commands::filebuffer::large_file_line_count,
            commands::filebuffer::large_file_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let lsp = app_handle.state::<LspManager>();
                lsp.stop_all();
            }
        });
}
