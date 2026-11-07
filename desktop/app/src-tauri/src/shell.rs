//! Windows. "main" holds two webviews: "titlebar" (bundled #/titlebar, local
//! capability) and "vipe" (the hosted VIPE web URL from the settings, remote
//! capability: station_status only). "estacion" is a separate window with the
//! bundled first-run setup or the Estación panel. First run shows only
//! "estacion"; `show_vipe` (after setup) points "vipe" at the saved URL and
//! shows "main". Closing either window hides it: printing keeps running in
//! the tray until "Salir".

use crate::state::AppState;
use std::sync::Arc;
use tauri::webview::WebviewBuilder;
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const TITLEBAR_HEIGHT: f64 = 40.0;
const MAIN_SIZE: (f64, f64) = (1280.0, 800.0);

fn web_url(state: &AppState) -> Url {
    Url::parse(&state.settings().web_url)
        .unwrap_or_else(|_| Url::parse(vipe_desktop_core::station::DEFAULT_WEB_URL).expect("default url"))
}

fn first_run(state: &AppState) -> bool {
    let s = state.settings_json();
    !(s["setup"]["completed"] == true || s["setup"]["deferred"] == true)
}

fn hide_on_close(window: &tauri::Window) {
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w.hide();
        }
    });
}

pub fn create(app: &AppHandle, state: &AppState, minimized: bool) -> tauri::Result<()> {
    let first = first_run(state);
    let main = WindowBuilder::new(app, "main")
        .title("VIPE")
        .inner_size(MAIN_SIZE.0, MAIN_SIZE.1)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .visible(!first && !minimized)
        .build()?;
    let (w, h) = MAIN_SIZE;
    main.add_child(
        WebviewBuilder::new("titlebar", WebviewUrl::App("index.html#/titlebar".into())),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(w, TITLEBAR_HEIGHT),
    )?;
    main.add_child(
        WebviewBuilder::new("vipe", WebviewUrl::External(web_url(state))),
        LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
        LogicalSize::new(w, h - TITLEBAR_HEIGHT),
    )?;
    hide_on_close(&main);
    let resized = main.clone();
    main.on_window_event(move |event| {
        if let WindowEvent::Resized(size) = event {
            let scale = resized.scale_factor().unwrap_or(1.0);
            let size = size.to_logical::<f64>(scale);
            if let Some(t) = resized.app_handle().get_webview("titlebar") {
                let _ = t.set_size(LogicalSize::new(size.width, TITLEBAR_HEIGHT));
            }
            if let Some(v) = resized.app_handle().get_webview("vipe") {
                let _ = v.set_size(LogicalSize::new(size.width, (size.height - TITLEBAR_HEIGHT).max(0.0)));
            }
        }
    });
    let panel = WebviewWindowBuilder::new(app, "estacion", WebviewUrl::App("index.html#/estacion".into()))
        .title("VIPE · Estación de impresión")
        .inner_size(1040.0, 720.0)
        .min_inner_size(860.0, 600.0)
        .center()
        .visible(first)
        .build()?;
    let hidden = panel.clone();
    panel.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
    Ok(())
}

pub fn show_vipe_window(app: &AppHandle) {
    if let (Some(state), Some(vipe)) = (app.try_state::<Arc<AppState>>(), app.get_webview("vipe")) {
        let target = web_url(&state);
        if vipe.url().map(|u| u.origin() != target.origin()).unwrap_or(true) {
            let _ = vipe.navigate(target);
        }
    }
    if let Some(main) = app.get_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

pub fn show_panel(app: &AppHandle, page: Option<String>) {
    let Some(panel) = app.get_webview_window("estacion") else { return };
    if let Some(page) = page.filter(|p| p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        let _ = panel.eval(&format!("location.hash = '#/estacion/{page}'; location.reload();"));
    }
    let _ = panel.show();
    let _ = panel.unminimize();
    let _ = panel.set_focus();
}

#[tauri::command]
pub fn open_panel(app: AppHandle, page: Option<String>) {
    show_panel(&app, page);
}

#[tauri::command]
pub fn show_vipe(app: AppHandle) {
    show_vipe_window(&app);
    if let Some(panel) = app.get_webview_window("estacion") {
        let _ = panel.hide();
    }
}
