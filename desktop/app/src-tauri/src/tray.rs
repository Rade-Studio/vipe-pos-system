//! Tray icon. The first menu mirrors `trayMenu` in src/panel/model.ts (same ids
//! and labels); the title bar replaces it through `update_tray` once it knows
//! the printer health.

use crate::state::AppState;
use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Wry};

pub const TRAY_ID: &str = "vipe";

#[derive(Debug, Clone, Deserialize)]
pub struct TrayItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
}

fn item(id: &str, label: &str, enabled: bool) -> TrayItem {
    TrayItem { id: id.into(), label: label.into(), enabled }
}

/// Same items as trayMenu before any status is known (every printer "Lista").
pub fn initial_items(state: &AppState) -> Vec<TrayItem> {
    let printers = state.settings().printers;
    let mut items = vec![item("open_vipe", "Abrir VIPE", true), item("open_panel", "Estación de impresión", true)];
    if printers.is_empty() {
        items.push(item("printer:none", "Sin impresoras", false));
    }
    for p in printers {
        items.push(item(&format!("printer:{}", p.id), &format!("{} · Lista", p.name), false));
    }
    items.push(item("quit", "Salir", true));
    items
}

fn menu(app: &AppHandle, items: &[TrayItem]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    for i in items {
        menu.append(&MenuItem::with_id(app, &i.id, &i.label, i.enabled, None::<&str>)?)?;
    }
    Ok(menu)
}

pub fn build(app: &AppHandle, state: &AppState) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("VIPE")
        .menu(&menu(app, &initial_items(state))?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_vipe" => crate::shell::show_vipe_window(app),
            "open_panel" => crate::shell::show_panel(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                crate::shell::show_vipe_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn update_tray(app: AppHandle, items: Vec<TrayItem>, tooltip: String) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("Sin icono de bandeja")?;
    tray.set_menu(Some(menu(&app, &items).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())
}
