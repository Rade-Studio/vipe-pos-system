//! Commands of the local pages (src/bridge/tauri.ts): settings, printers,
//! cash drawer, autostart and the read-only station status. Pairing runs in
//! the setup page through the typed API client; its result is saved here.
//! Queue commands live in queue_cmds.rs, window commands in shell.rs.

use crate::state::AppState;
use crate::worker;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use vipe_desktop_core::escpos::{drawer_pulse, lines_to_bytes, printer_preamble, Align, PrintLine, FULL_CUT};
use vipe_desktop_core::station::Printer;
use vipe_desktop_core::transport::list_system_printers;

type S<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
pub fn demo_mode(state: S) -> bool {
    state.demo
}

#[tauri::command]
pub fn load_settings(state: S) -> Value {
    state.settings_json()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: S, settings: Value) -> Result<(), String> {
    state.save_settings(settings)?;
    crate::updater::schedule(&app);
    Ok(())
}

/// Printers installed in Windows (USB through the spooler). Network and
/// Bluetooth printers are added by address in the setup.
#[tauri::command]
pub fn discover_printers() -> Vec<Value> {
    list_system_printers()
        .into_iter()
        .map(|name| {
            json!({
                "id": format!("win:{name}"), "model": name, "connection": "usb", "address": name,
                "detail": "Instalada en Windows", "paperMm": 80, "hasDrawer": false, "suggestedName": name,
            })
        })
        .collect()
}

fn parse_printer(printer: Value) -> Result<Printer, String> {
    serde_json::from_value(printer).map_err(|e| format!("Impresora no válida: {e}"))
}

fn line(text: impl Into<String>, bold: bool, align: Align) -> PrintLine {
    PrintLine { text: text.into(), bold, align }
}

#[tauri::command]
pub fn test_print(state: S, printer: Value, restaurant: Option<Value>) -> Result<(), String> {
    let printer = parse_printer(printer)?;
    let name = restaurant.as_ref().and_then(|r| r["name"].as_str()).unwrap_or("VIPE").to_string();
    let lines = [
        line(name, true, Align::Center),
        line("Prueba de impresión", false, Align::Center),
        line(printer.name.clone(), false, Align::Center),
        line("Á É Í Ó Ú Ñ ¿? ¡! $ 12.500", false, Align::Left),
        line(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(), false, Align::Left),
    ];
    let mut bytes = printer_preamble(printer.encoding);
    bytes.extend(lines_to_bytes(&lines, printer.encoding));
    if !printer.cut && bytes.ends_with(FULL_CUT) {
        // lines_to_bytes feeds and cuts; printers without a cutter only feed.
        bytes.truncate(bytes.len() - FULL_CUT.len());
    }
    worker::send(&state, &printer, &bytes)
}

/// "Abrir cajón" opens at once; the page records the event in the API (§6).
#[tauri::command]
pub fn open_drawer(state: S, printer: Value) -> Result<(), String> {
    let printer = parse_printer(printer)?;
    let mut bytes = printer_preamble(printer.encoding);
    bytes.extend(drawer_pulse());
    worker::send(&state, &printer, &bytes)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())
}
