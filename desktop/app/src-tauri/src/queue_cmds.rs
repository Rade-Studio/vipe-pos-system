//! Queue commands (src/bridge/tauri.ts): jobs in from the sync loop, acks out,
//! Cola (retry/cancel), Historial (reprint) and the read-only station status,
//! which is the only command the hosted VIPE origin may call.

use crate::state::{now_ms, AppState};
use crate::worker;
use chrono::{Local, TimeZone};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;
use vipe_desktop_core::jobs::{classify, Disposition, PrintJob};
use vipe_desktop_core::queue::{JobStatus, QueuedJob};
use vipe_desktop_core::station::{job_summary, printers_for_job, Settings};

type S<'a> = State<'a, Arc<AppState>>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn iso(ms: i64) -> String {
    Local.timestamp_millis_opt(ms).single().map(|t| t.to_rfc3339()).unwrap_or_default()
}

fn status_str(s: JobStatus) -> Value {
    serde_json::to_value(s).unwrap_or(Value::Null)
}

/// Pending jobs from the API; duplicates (same id) are ignored by the queue.
#[tauri::command]
pub fn enqueue_jobs(state: S, jobs: Vec<PrintJob>) -> Result<(), String> {
    let q = state.queue.lock().unwrap();
    for job in jobs {
        match classify(&job, chrono::Utc::now()) {
            Disposition::Print => q.enqueue(&job, now_ms()).map(|_| ()).map_err(err)?,
            Disposition::Skip(reason) => q.record_skipped(&job, &reason, now_ms()).map_err(err)?,
            Disposition::Reject(_) => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub fn take_acks(state: S) -> Result<Vec<Value>, String> {
    let q = state.queue.lock().unwrap();
    let mut out = Vec::new();
    for id in q.pending_acks().map_err(err)? {
        if let Some(j) = q.get(&id).map_err(err)? {
            let reason = (j.status == JobStatus::Skipped).then(|| j.last_error.clone()).flatten();
            out.push(json!({ "id": id, "status": status_str(j.status), "reason": reason }));
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn mark_acked(state: S, id: String) -> Result<(), String> {
    state.queue.lock().unwrap().mark_acked(&id).map_err(err)
}

#[tauri::command]
pub fn retry_job(state: S, id: String) -> Result<(), String> {
    state.queue.lock().unwrap().retry(&id, now_ms()).map(|_| ()).map_err(err)
}

#[tauri::command]
pub fn cancel_job(state: S, id: String) -> Result<(), String> {
    state.queue.lock().unwrap().cancel(&id, now_ms()).map(|_| ()).map_err(err)
}

/// "Reimprimir" prints the stored job again without changing its history row.
#[tauri::command]
pub fn reprint_job(state: S, id: String) -> Result<(), String> {
    let job = state.queue.lock().unwrap().get(&id).map_err(err)?.ok_or("El trabajo ya no está en el historial")?;
    worker::print_job(&state, &job.job)
}

fn queue_item(j: &QueuedJob, settings: &Settings) -> Value {
    let (title, detail) = job_summary(&j.job);
    let printers = printers_for_job(&j.job, &settings.printers).iter().map(|p| p.name.clone()).collect::<Vec<_>>();
    json!({
        "id": j.job.id, "title": title, "detail": detail, "printerName": printers.join(", "),
        "status": status_str(j.status), "attempts": j.attempts, "error": j.last_error, "at": iso(j.enqueued_at),
    })
}

/// StationStatus of src/bridge/types.ts. Connection and printingEnabled come
/// from the heartbeat in the page; the native side reports what it knows.
#[tauri::command]
pub fn station_status(state: S) -> Result<Value, String> {
    let settings = state.settings();
    let now = now_ms();
    let (active, history) = {
        let q = state.queue.lock().unwrap();
        (q.active().map_err(err)?, q.history(now).map_err(err)?)
    };
    let health = state.health.lock().unwrap();
    let printers: Vec<Value> = settings
        .printers
        .iter()
        .map(|p| health.get(&p.id).map(|h| json!(h)).unwrap_or_else(|| json!({ "id": p.id, "health": "ready" })))
        .collect();
    let midnight = Local::now().date_naive().and_hms_opt(0, 0, 0).and_then(|t| Local.from_local_datetime(&t).single());
    let since = midnight.map(|t| t.timestamp_millis()).unwrap_or(now);
    let printed_today = history.iter().filter(|j| j.status == JobStatus::Printed && j.updated_at >= since).count();
    let history: Vec<Value> = history
        .iter()
        .map(|j| {
            let (title, detail) = job_summary(&j.job);
            json!({ "id": j.job.id, "title": title, "detail": detail, "status": status_str(j.status), "at": iso(j.updated_at) })
        })
        .collect();
    Ok(json!({
        "connection": if settings.device_token.is_some() { "online" } else { "offline" },
        "lastSignalAt": null, "printingEnabled": true, "printers": printers,
        "queue": active.iter().map(|j| queue_item(j, &settings)).collect::<Vec<_>>(),
        "history": history, "printedToday": printed_today, "version": env!("CARGO_PKG_VERSION"),
    }))
}
