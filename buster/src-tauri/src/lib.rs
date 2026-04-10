mod commands;
mod terminal;
mod syntax;
mod lsp;
mod ai;
mod extensions;
mod debugger;
mod remote;
mod collab;
pub mod workspace;
pub mod watcher;
mod browser;
pub mod filebuffer;

use terminal::TerminalManager;
use syntax::SyntaxService;
use lsp::LspManager;
use ai::agent::ApprovalManager;
use debugger::DebugManager;
use remote::RemoteManager;
use collab::CollabManager;
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
        .manage(workspace::WorkspaceState::new())
        .manage(TerminalManager::new())
        .manage(SyntaxService::new())
        .manage(LspManager::new())
        .manage(extensions::ExtensionManager::new())
        .manage(watcher::FileWatcher::new())
        .manage(BrowserManager::new())
        .manage(filebuffer::FileBufferManager::new())
        .manage(ai::audit::AuditLogger::new())
        .manage(DebugManager::new())
        .manage(RemoteManager::new())
        .manage(CollabManager::new())
        .setup(|app| {
            // Build the native menu bar
            let change_dir = MenuItem::with_id(app, "change_directory", "Change Directory", true, None::<&str>)?;
            let close_dir = MenuItem::with_id(app, "close_directory", "Close Directory", true, None::<&str>)?;

            let file_menu = Submenu::with_items(app, "File", true, &[
                &change_dir,
                &close_dir,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
            ])?;

            // Use PredefinedMenuItems so macOS registers native selectors (undo:, cut:, copy:, paste:, selectAll:).
            // This is critical for compatibility with voice dictation tools (Wispr Flow, macOS Dictation)
            // which inject text via simulated Cmd+V through the macOS responder chain.
            // PredefinedMenuItems route through the native NSResponder paste: selector,
            // while custom MenuItems with accelerators only intercept the key combo from real keyboard events.
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, Some("Undo"))?,
                &PredefinedMenuItem::redo(app, Some("Redo"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("Cut"))?,
                &PredefinedMenuItem::copy(app, Some("Copy"))?,
                &PredefinedMenuItem::paste(app, Some("Paste"))?,
                &PredefinedMenuItem::select_all(app, Some("Select All"))?,
            ])?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu])?;
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

            // Intercept window close to allow frontend to persist session
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = app_handle.emit("window-close-requested", ());
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

            Ok(())
        })
        .manage(Arc::new(ApprovalManager::new()))
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
            commands::terminal::set_terminal_theme,
            // Syntax highlighting
            commands::syntax::highlight_code,
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
            // Remote SSH
            commands::remote::remote_connect,
            commands::remote::remote_disconnect,
            commands::remote::remote_status,
            commands::remote::remote_list_directory,
            commands::remote::remote_read_file,
            commands::remote::remote_write_file,
            commands::remote::remote_exec,
            // Collaborative editing
            commands::collab::collab_start_session,
            commands::collab::collab_end_session,
            commands::collab::collab_insert,
            commands::collab::collab_delete,
            commands::collab::collab_apply_remote,
            commands::collab::collab_get_text,
            commands::collab::collab_get_peers,
            commands::collab::collab_update_cursor,
            commands::collab::collab_active_sessions,
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
            // AI
            commands::ai::ai_chat,
            commands::ai::ai_cancel,
            commands::ai::ai_inline_complete,
            commands::ai::store_api_key,
            commands::ai::load_api_key,
            commands::ai::delete_api_key,
            commands::ai::ai_approve_tool,
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
            // Browser
            commands::browser::create_browser_view,
            commands::browser::navigate_browser_view,
            commands::browser::resize_browser_view,
            commands::browser::show_browser_view,
            commands::browser::hide_browser_view,
            commands::browser::close_browser_view,
            commands::browser::scan_local_ports,
            // GitHub (gh CLI)
            commands::github::gh_auth_status,
            commands::github::gh_repo_info,
            commands::github::gh_pr_list,
            commands::github::gh_pr_view,
            commands::github::gh_issue_list,
            commands::github::gh_issue_view,
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
