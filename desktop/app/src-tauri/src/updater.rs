//! Updates (desktop/API-CONTRACT.md §7). The endpoint is built at runtime from
//! the template and the saved VIPE web URL, with the device token as Bearer;
//! the public key is compiled in (lib.rs). The update downloads in the
//! background and installs only out of service (no job waiting or printing,
//! no print in the last 10 minutes).

use crate::state::{now_ms, AppState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::UpdaterExt;
use vipe_desktop_core::station::{idle_for_update, updater_endpoint};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
const IDLE_POLL: Duration = Duration::from_secs(60);
static RUNNING: AtomicBool = AtomicBool::new(false);
static WAKE: Notify = Notify::const_new();

/// Check now (at most one check at a time), then every 6 hours. Called again
/// (settings saved, e.g. right after pairing) it wakes the loop for a new check.
pub fn schedule(app: &AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        WAKE.notify_one();
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = check_and_install(&app).await;
            let _ = tokio::time::timeout(CHECK_EVERY, WAKE.notified()).await;
        }
    });
}

async fn check_and_install(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>().inner().clone();
    let settings = state.settings();
    let (Some(token), false, true) = (settings.device_token.clone(), state.demo, settings.auto_update) else {
        return Ok(());
    };
    let endpoint = updater_endpoint(&settings.web_url).ok_or("URL de VIPE no válida")?;
    let url = Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .header("Authorization", format!("Bearer {token}"))
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    loop {
        let active = state.queue.lock().unwrap().counts().map(|c| c.pending + c.printing).unwrap_or(1);
        let last = *state.last_print_ms.lock().unwrap();
        if idle_for_update(active, last, now_ms()) {
            break;
        }
        tokio::time::sleep(IDLE_POLL).await;
    }
    update.install(bytes).map_err(|e| e.to_string())
}
