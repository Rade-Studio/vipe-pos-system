// Declaring the app commands generates one `allow-<command>` permission each,
// so capabilities/ decides which webview may call which command.
const COMMANDS: &[&str] = &[
    "station_status",
    "load_settings",
    "save_settings",
    "discover_printers",
    "test_print",
    "open_drawer",
    "enqueue_jobs",
    "take_acks",
    "mark_acked",
    "retry_job",
    "cancel_job",
    "reprint_job",
    "set_autostart",
    "update_tray",
    "open_panel",
    "show_vipe",
    "demo_mode",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build script");
}
