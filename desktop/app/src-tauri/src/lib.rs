//! VIPE desktop shell (Tauri 2): plugins, native state, windows, tray, the
//! print worker and the command handlers. Print logic lives in desktop/core.

mod commands;
mod queue_cmds;
mod shell;
mod state;
mod tray;
mod updater;
mod worker;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

/// Updater public key (desktop/signing/updater.key.pub), checked against every
/// downloaded update.
const UPDATER_PUBKEY: &str = include_str!("../../../signing/updater.key.pub");
/// Autostart launches with this flag: start in the tray without a window.
const MINIMIZED_ARG: &str = "--minimized";

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let demo = args.iter().any(|a| a == "--demo");
    let minimized = args.iter().any(|a| a == MINIMIZED_ARG);
    tauri::Builder::default()
        // Must be the first plugin: a second launch focuses the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_vipe_window(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .plugin(tauri_plugin_updater::Builder::new().pubkey(UPDATER_PUBKEY.trim()).build())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            let state = Arc::new(AppState::open(dir, demo)?);
            app.manage(state.clone());
            let handle = app.handle().clone();
            shell::create(&handle, &state, minimized)?;
            tray::build(&handle, &state)?;
            worker::spawn(state);
            updater::schedule(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            queue_cmds::station_status,
            commands::load_settings,
            commands::save_settings,
            commands::discover_printers,
            commands::test_print,
            commands::open_drawer,
            queue_cmds::enqueue_jobs,
            queue_cmds::take_acks,
            queue_cmds::mark_acked,
            queue_cmds::retry_job,
            queue_cmds::cancel_job,
            queue_cmds::reprint_job,
            commands::set_autostart,
            tray::update_tray,
            shell::open_panel,
            shell::show_vipe,
            commands::demo_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VIPE");
}
